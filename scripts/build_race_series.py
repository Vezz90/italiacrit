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
                  'SQUADRE', 'PISTA', 'TAPPA', 'TAPPE', 'PROVINCIALE', 'NAZIONALE', 'INDIVIDUALE', 'STAFFETTA'}


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


BAND_OF = {'ELITE_UNDER23': 'ELI', 'JUNIORES': 'JUN', 'ALLIEVI': 'AL', 'ESORDIENTI1': 'ES', 'ESORDIENTI2': 'ES',
           'DONNE_JUNIORES': 'JUN', 'DONNE_ALLIEVE': 'AL', 'DONNE_ESORDIENTI': 'ES', 'DONNE_ELITE': 'ELI', 'DONNE_ELITE_UNDER23': 'ELI'}
BAND_PRIO = ['ELI', 'JUN', 'AL', 'ES']


def band_of(race):
    # la categoria "principale" della gara: stessa corsa con categorie diverse = gare diverse
    bands = {BAND_OF.get(str(c).upper(), 'ELI') for c in (race.get('categorie') or {}).keys()}
    for b in BAND_PRIO:
        if b in bands:
            return b
    return 'ELI'


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


def manual_band(a, b):
    return ''


def main():
    races = load_all()
    manual = {}
    mp = ROOT / 'data' / 'albo_manual.json'
    if mp.exists():
        manual = json.load(open(mp, encoding='utf-8'))
    # una gara con piu' categorie compare in ogni albo di categoria, con i soli podi di quella categoria
    split = []
    for r in races:
        byband = collections.defaultdict(dict)
        for c, pod in (r.get('categorie') or {}).items():
            byband[BAND_OF.get(str(c).upper(), 'ELI')][c] = pod
        if not byband:
            byband['ELI'] = {}
        for band, cats in byband.items():
            r2 = dict(r); r2['categorie'] = cats; r2['_forced_band'] = band
            split.append(r2)
    races = split
    groups = collections.defaultdict(list)          # (base, genere) -> edizioni
    for r in races:
        r['_base'] = base_name(r.get('nome')); r['_g'] = gender_of(r); r['_b'] = r['_forced_band']
        generic = len(key_tokens(r['_base'])) < 2          # "GRAN PREMIO", "TROFEO"...: da soli non dicono quale gara sia
        r['_ex'] = luogo_key(r) if generic else ''
        groups[(r['_base'], r['_g'], r['_b'], r['_ex'])].append(r)
    uf = UF()
    for k in groups: uf.f(k)
    review = []
    auto_log = []
    auto = 0
    # ---- punteggio di somiglianza fra due gruppi (stessa gara in anni diversi?) ----
    # segnali: nome, luogo di svolgimento, data nell'anno (stessa settimana circa),
    # numero d'edizione che avanza (1° memorial -> 2° memorial l'anno dopo)
    def doy(d):
        try:
            y, m, dd = [int(x) for x in str(d).split('-')]
            import datetime
            return datetime.date(y, m, dd).timetuple().tm_yday
        except Exception:
            return None

    def edition_no(nome):
        m = re.match(r'^\s*(\d+)\s*[°^ª]?\s', norm(nome) + ' ')
        if m:
            return int(m.group(1))
        m = re.match(r'^\s*([IVXL]+)\s', norm(nome) + ' ')
        if m:
            vals = {'I': 1, 'V': 5, 'X': 10, 'L': 50}
            s = 0; prev = 0
            for ch in reversed(m.group(1)):
                v = vals[ch]; s += -v if v < prev else v; prev = max(prev, v)
            return s
        return None

    info = {}
    for k, lst in groups.items():
        years = {r['_year'] for r in lst}
        nums = {}
        for r in lst:
            n = edition_no(r.get('nome'))
            if n is not None:
                nums[r['_year']] = n
        days = sorted(d for d in (doy(r.get('data')) for r in lst) if d)
        info[k] = {'years': years, 'nums': nums, 'doy': days[len(days) // 2] if days else None,
                   'loc': luogo_key(lst[0]), 'reg': norm(lst[0].get('regione') or ''), 'ta': key_tokens(k[0]), 'disc': disc(k[0])}

    def score(a, b):
        A, B = info[a], info[b]
        if A['years'] & B['years'] or A['disc'] != B['disc']:
            return -99
        gap = min(abs(x - y) for x in A['years'] for y in B['years'])
        if gap > 4:
            return -99
        s = 0.0
        ta, tb = A['ta'], B['ta']
        name_pts = 0
        if ta and tb:
            if ta == tb:
                name_pts = 3 if len(ta) >= 2 else 2
            elif (ta <= tb or tb <= ta):
                name_pts = 2 if min(len(ta), len(tb)) >= 2 else 1
            elif len(ta & tb) / len(ta | tb) >= 0.5:
                name_pts = 1
        s += name_pts
        score.last_name = name_pts
        if A['loc'] and A['loc'] == B['loc']:
            s += 2
        elif A['reg'] and A['reg'] == B['reg']:
            s += 0.5
        if A['doy'] and B['doy']:
            d = abs(A['doy'] - B['doy']); d = min(d, 365 - d)
            s += 1.5 if d <= 14 else (0.5 if d <= 30 else (-1.5 if d > 60 else 0))
        # edizioni che si susseguono: il numero cresce di 1 per ogni anno (o poco meno se qualche anno e' saltato)
        ya, yb = (A, B) if max(A['years']) < min(B['years']) else (B, A)
        if ya['nums'] and yb['nums'] and max(ya['years']) < min(yb['years']):
            y1 = max(y for y in ya['nums']); y2 = min(y for y in yb['nums'])
            dn = yb['nums'][y2] - ya['nums'][y1]; dy = y2 - y1
            if dy > 0:
                s += 2.5 if 1 <= dn <= dy else -2
        return s

    buckets = collections.defaultdict(list)
    for k in groups:
        if k[3]:
            continue                                   # nomi generici: gestiti per luogo, mai fusi
        buckets[(k[1], k[2], info[k]['reg'])].append(k)
    for (g, bnd, reg), keys in buckets.items():
        if len(keys) < 2:
            continue
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                a, b = keys[i], keys[j]
                sc = score(a, b)
                # senza nessuna parola in comune serve una prova molto forte (luogo + data + numero d'edizione che avanza)
                if sc >= 5 and (score.last_name > 0 or sc >= 7):
                    if uf.f(a) != uf.f(b):
                        uf.u(a, b); auto += 1
                        auto_log.append({'a': a[0], 'b': b[0], 'g': g, 'band': bnd, 'score': round(sc, 1), 'anni_a': sorted(info[a]['years']), 'anni_b': sorted(info[b]['years']), 'luogo': info[a]['loc']})
                elif sc >= 4:
                    review.append({'a': a[0], 'b': b[0], 'luogo': info[a]['loc'] or info[b]['loc'], 'g': g, 'band': bnd,
                                   'anni_a': sorted(info[a]['years']), 'anni_b': sorted(info[b]['years']), 'sim': round(sc / 10, 2), 'score': round(sc, 1)})
    review.sort(key=lambda r: -r['score'])
    review = review[:600]
    # fusioni/separazioni manuali
    for a, b in manual.get('merge', []):
        ka = [k for k in groups if k[0] == base_name(a) and not k[3]]; kb = [k for k in groups if k[0] == base_name(b) and not k[3]]
        for x in ka:
            for y in kb:
                if x[1] == y[1] and x[2] == y[2] and (not manual_band(a, b) or x[2] == manual_band(a, b)): uf.u(x, y)
    # serie
    series = collections.defaultdict(list)
    for k, lst in groups.items():
        series[uf.f(k)].append((k, lst))
    out_series = {}; index = {}
    for root, parts in series.items():
        eds = []
        names = collections.Counter()
        for (base, g, bnd, ex), lst in parts:
            for r in lst:
                names[(base, ex)] += 1
        # nome della serie = quello dell'edizione piu' recente
        latest = max((r for _, lst in parts for r in lst), key=lambda r: (r['_year'], r.get('data') or ''))
        sid = hashlib.md5(f"{latest['_base']}|{root[1]}|{root[2]}|{latest['_ex']}".encode()).hexdigest()[:10]
        for (base, g, bnd, ex), lst in parts:
            for r in lst:
                pods = []
                for cat, pod in (r.get('categorie') or {}).items():
                    for p in pod[:3]:
                        pods.append([cat, p.get('posizione'), p.get('atleta_id'), p.get('nome_completo'), p.get('team')])
                eds.append({'y': r['_year'], 'id': r.get('id'), 'd': r.get('data'), 'n': r.get('nome'), 'p': pods})
        eds.sort(key=lambda e: (-e['y'], e['d'] or ''))
        out_series[sid] = {'nome': latest.get('nome'), 'base': latest['_base'], 'g': root[1], 'band': root[2], 'luogo': latest.get('luogo'), 'regione': latest.get('regione'), 'ed': eds}
        for (b, ex) in names:
            index[f'{b}|{root[1]}|{root[2]}' + (f'|{ex}' if ex else '')] = sid
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
    json.dump(review[:4000], open(OUT / 'review.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(auto_log, open(ROOT / 'audit' / 'albo_auto_merges.json', 'w', encoding='utf-8'), ensure_ascii=False)
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
