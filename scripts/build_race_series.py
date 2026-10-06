"""Costruisce le "serie" di gare (la stessa gara negli anni) per l'albo d'oro.

Input : data/ciclismo-storico/<anno>/races.json (31k edizioni 2007-2025)
Output: data/albo/index.json      chiave-nome -> id serie (+ alias)
        data/albo/shard_XX.json   le serie (con i podi) divise in 64 file
        audit/albo_review.json    coppie dubbie da far guardare all'admin
Regole: stesso luogo e stesso genere, anni che non si sovrappongono, nomi uguali
dopo aver normalizzato abbreviazioni e parole vuote -> fusione automatica.
Il resto (nomi simili ma non uguali) va nella coda di revisione, non si fonde.
Correzioni a mano: data/albo_manual.json  {"merge": [[nomeA, nomeB], ...], "split": [nome, ...]}

Uso: python scripts/build_race_series.py
"""
import json, re, sys, unicodedata, collections, pathlib, hashlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HIST = ROOT / 'data' / 'ciclismo-storico'
OUT = ROOT / 'data' / 'albo'
N_SHARD = 64

CAT_NOISE = {'JUNIORES', 'ALLIEVI', 'ALLIEVE', 'ESORDIENTI', 'UNDER', 'ELITE', 'DONNE', 'DONNA', 'U23', 'UNDER23', 'JUNIOR',
             'OPEN', 'MASCHILE', 'FEMMINILE', 'ROSA', 'EDIZIONE', 'EDIZ'}
# parole che non distinguono una gara dall'altra
STOP = {'DI', 'DEL', 'DELLA', 'DELLE', 'DEI', 'DEGLI', 'DELL', 'DALL', 'DA', 'DE', 'E', 'IN', 'AL', 'ALLA', 'ALLO', 'IL', 'LA', 'LO', 'I', 'LE', 'GLI',
        'A', 'ED', 'PER', 'CON', 'NEL', 'NELLA', 'SUL', 'SULLA', 'GRAN', 'PREMIO', 'TROFEO', 'MEMORIAL', 'COPPA', 'CITTA', 'COMUNE', 'CIRCUITO',
        'GARA', 'LINEA', 'ASD', 'GS', 'SC', 'UC', 'PROVA', 'VALIDA', 'XXI', 'XX', 'XIX', 'XVIII', 'XVII', 'XVI', 'XV', 'XIV', 'XIII', 'XII', 'XI', 'X'}
# abbreviazioni -> forma piena
ABBR = {'GP': 'GRAN PREMIO', 'G P': 'GRAN PREMIO', 'MEM': 'MEMORIAL', 'TR': 'TROFEO', 'C': 'COPPA', 'CIT': 'CITTA', 'CITTÀ': 'CITTA'}
# se una e' presente e l'altra no, sono gare diverse (stesso luogo, evento diverso)
DISCRIMINATORS = {'CAMP', 'CAMPIONATO', 'CAMPIONATI', 'REGIONALE', 'REGIONALI', 'ITALIANO', 'ITALIANI', 'CRONOMETRO', 'CRONO', 'CRONOSCALATA',
                  'SQUADRE', 'PISTA', 'TAPPA', 'TAPPE', 'GIRO', 'PROVINCIALE', 'NAZIONALE', 'INDIVIDUALE', 'STAFFETTA'}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').upper())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r"[’'`.\-–,;:()\"/#]", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def base_name(nome):
    s = norm(nome)
    s = re.sub(r'^\d+\s*[°^ª]?\s*', '', s)
    toks = [t for t in s.split() if t]
    while len(toks) > 1 and toks[-1] in CAT_NOISE:
        toks.pop()
    return ' '.join(t for t in toks if t != 'EDIZIONE')


def canon_tokens(base):
    s = ' ' + base + ' '
    s = s.replace(' G P ', ' GRAN PREMIO ')
    toks = []
    for t in s.split():
        t = ABBR.get(t, t)
        toks.extend(t.split())
    return [t for t in toks if not t.isdigit() and not re.fullmatch(r'[IVXL]+', t)]


def key_tokens(base):
    return frozenset(t for t in canon_tokens(base) if t not in STOP and len(t) > 1)


def disc(base):
    return frozenset(t for t in canon_tokens(base) if t in DISCRIMINATORS)


def gender_of(race):
    cats = list((race.get('categorie') or {}).keys())
    if not cats:
        return '?'
    f = sum(1 for c in cats if str(c).upper().startswith('DONNE'))
    return 'F' if f == len(cats) else ('M' if f == 0 else 'X')


def luogo_key(race):
    loc = norm(race.get('luogo') or '')
    return re.sub(r'\s*\b[A-Z]{2}\b$', '', loc).strip()


def load_all():
    races = []
    for yd in sorted(HIST.iterdir()):
        f = yd / 'races.json'
        if yd.name.isdigit() and f.exists():
            for r in json.load(open(f, encoding='utf-8')).get('races', []):
                r['_year'] = int(yd.name)
                races.append(r)
    return races


class UF:
    def __init__(self): self.p = {}
    def f(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]; x = self.p[x]
        return x
    def u(self, a, b): self.p[self.f(a)] = self.f(b)


def main():
    races = load_all()
    manual = {}
    mp = ROOT / 'data' / 'albo_manual.json'
    if mp.exists():
        manual = json.load(open(mp, encoding='utf-8'))
    groups = collections.defaultdict(list)          # (base, genere) -> edizioni
    for r in races:
        r['_base'] = base_name(r.get('nome')); r['_g'] = gender_of(r)
        generic = len(key_tokens(r['_base'])) < 2          # "GRAN PREMIO", "TROFEO"...: da soli non dicono quale gara sia
        r['_ex'] = luogo_key(r) if generic else ''
        groups[(r['_base'], r['_g'], r['_ex'])].append(r)
    uf = UF()
    for k in groups: uf.f(k)
    review = []
    by_loc = collections.defaultdict(list)
    for k, lst in groups.items():
        if k[2]:
            continue
        by_loc[(luogo_key(lst[0]), k[1])].append(k)
    auto = 0
    for (loc, g), keys in by_loc.items():
        if not loc or len(keys) < 2:
            continue
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                a, b = keys[i], keys[j]
                ya = {r['_year'] for r in groups[a]}; yb = {r['_year'] for r in groups[b]}
                if ya & yb:
                    continue                          # due edizioni nello stesso anno: gare diverse
                if disc(a[0]) != disc(b[0]):
                    continue
                ta, tb = key_tokens(a[0]), key_tokens(b[0])
                if not ta or not tb:
                    continue
                inter = len(ta & tb)
                sim = inter / len(ta | tb)
                near = min(abs(x - y) for x in ya for y in yb) <= 3
                if ta == tb and near:
                    uf.u(a, b); auto += 1
                elif (ta <= tb or tb <= ta) and min(len(ta), len(tb)) >= 2 and near:
                    uf.u(a, b); auto += 1
                elif sim >= 0.5 and near:
                    review.append({'a': a[0], 'b': b[0], 'luogo': loc, 'g': g, 'anni_a': sorted(ya), 'anni_b': sorted(yb), 'sim': round(sim, 2)})
    # stessa gara che cambia sede: nomi identici (almeno 2 parole distintive), stessa regione, anni vicini e disgiunti
    by_reg = collections.defaultdict(list)
    for k, lst in groups.items():
        if k[2]:
            continue
        by_reg[(norm(lst[0].get('regione') or ''), k[1])].append(k)
    for (reg, g), keys in by_reg.items():
        if not reg:
            continue
        idx_tok = collections.defaultdict(list)
        for k in keys:
            tk = key_tokens(k[0])
            if len(tk) >= 2:
                idx_tok[(tk, disc(k[0]))].append(k)
        for lst_k in idx_tok.values():
            for i in range(len(lst_k)):
                for j in range(i + 1, len(lst_k)):
                    a_, b_ = lst_k[i], lst_k[j]
                    ya = {r['_year'] for r in groups[a_]}; yb = {r['_year'] for r in groups[b_]}
                    if ya & yb:
                        continue
                    if min(abs(x - y) for x in ya for y in yb) <= 3 and uf.f(a_) != uf.f(b_):
                        uf.u(a_, b_); auto += 1
    # fusioni/separazioni manuali
    for a, b in manual.get('merge', []):
        ka = [k for k in groups if k[0] == base_name(a) and not k[2]]; kb = [k for k in groups if k[0] == base_name(b) and not k[2]]
        for x in ka:
            for y in kb:
                if x[1] == y[1]: uf.u(x, y)
    # serie
    series = collections.defaultdict(list)
    for k, lst in groups.items():
        series[uf.f(k)].append((k, lst))
    out_series = {}; index = {}
    for root, parts in series.items():
        eds = []
        names = collections.Counter()
        for (base, g, ex), lst in parts:
            for r in lst:
                names[(base, ex)] += 1
        # nome della serie = quello dell'edizione piu' recente
        latest = max((r for _, lst in parts for r in lst), key=lambda r: (r['_year'], r.get('data') or ''))
        sid = hashlib.md5(f"{latest['_base']}|{root[1]}|{latest['_ex']}".encode()).hexdigest()[:10]
        for (base, g, ex), lst in parts:
            for r in lst:
                pods = []
                for cat, pod in (r.get('categorie') or {}).items():
                    for p in pod[:3]:
                        pods.append([cat, p.get('posizione'), p.get('atleta_id'), p.get('nome_completo'), p.get('team')])
                eds.append({'y': r['_year'], 'id': r.get('id'), 'd': r.get('data'), 'n': r.get('nome'), 'p': pods})
        eds.sort(key=lambda e: (-e['y'], e['d'] or ''))
        out_series[sid] = {'nome': latest.get('nome'), 'base': latest['_base'], 'g': root[1], 'luogo': latest.get('luogo'), 'regione': latest.get('regione'), 'ed': eds}
        for (b, ex) in names:
            index[f'{b}|{root[1]}' + (f'|{ex}' if ex else '')] = sid
    # shard
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob('shard_*.json'):
        f.unlink()
    shards = collections.defaultdict(dict)
    for sid, s in out_series.items():
        shards[int(sid, 16) % N_SHARD][sid] = s
    for n in range(N_SHARD):
        json.dump(shards.get(n, {}), open(OUT / f'shard_{n:02d}.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'n_shard': N_SHARD, 'index': index}, open(OUT / 'index.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    (ROOT / 'audit').mkdir(exist_ok=True)
    json.dump(review[:4000], open(ROOT / 'audit' / 'albo_review.json', 'w', encoding='utf-8'), ensure_ascii=False)
    gaps = 0; ser_gap = 0
    for s in out_series.values():
        ys = sorted({e['y'] for e in s['ed']})
        if len(ys) > 1:
            m = [y for y in range(ys[0], ys[-1] + 1) if y not in ys]
            if m: ser_gap += 1; gaps += len(m)
    print(f'edizioni {len(races)} | serie prima {len(groups)} -> dopo {len(out_series)} | fusioni automatiche {auto} | in revisione {len(review)}')
    print(f'serie con buchi {ser_gap} | anni mancanti {gaps} | indice {len(index)} nomi')


if __name__ == '__main__':
    main()
