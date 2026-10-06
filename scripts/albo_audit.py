"""Audit dell'albo d'oro delle gare (dati storici ciclismo.info 2007-2025).

Raggruppa le edizioni per "serie" (stessa gara nei vari anni) e misura i buchi:
anni mancanti dentro una serie, serie spezzate da un cambio di nome, podi
incompleti, gare maschili/femminili mescolate. Solo lettura: non modifica nulla.

Uso:  python scripts/albo_audit.py [--out audit/albo_audit.json]
"""
import json, re, sys, unicodedata, collections, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HIST = ROOT / 'data' / 'ciclismo-storico'

CAT_NOISE = {'JUNIORES', 'ALLIEVI', 'ALLIEVE', 'ESORDIENTI', 'UNDER', 'ELITE', 'DONNE', 'DONNA', 'U23', 'UNDER23', 'JUNIOR',
             'ALLIEVI/E', 'OPEN', 'MASCHILE', 'FEMMINILE', 'ROSA', 'EDIZIONE', 'EDIZ'}
STOP = {'DI', 'DEL', 'DELLA', 'DELLE', 'DEI', 'DEGLI', 'DA', 'DE', 'E', 'IN', 'AL', 'ALLA', 'ALLO', 'IL', 'LA', 'LO', 'I', 'LE', 'GLI',
        'GRAN', 'PREMIO', 'GP', 'TROFEO', 'MEMORIAL', 'COPPA', 'CITTA', 'COMUNE', 'CIRCUITO', 'GIRO', 'CLASSICA', 'MEM', 'TR', 'COPPA'}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').upper())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r"[’'`.\-–,;:()\"/]", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def base_name(nome):
    s = norm(nome)
    s = re.sub(r'^\d+\s*[°^ª]?\s*', '', s)           # numero di edizione iniziale
    s = re.sub(r'^\d+\s*(EDIZIONE|ED)\s+', '', s)
    toks = [t for t in s.split() if t]
    while len(toks) > 1 and toks[-1] in CAT_NOISE:
        toks.pop()
    toks = [t for t in toks if t not in {'EDIZIONE'}]
    return ' '.join(toks)


def gender_of(race):
    cats = list((race.get('categorie') or {}).keys())
    if not cats:
        return '?'
    f = sum(1 for c in cats if str(c).upper().startswith('DONNE'))
    return 'F' if f == len(cats) else ('M' if f == 0 else 'X')


def toks_key(base):
    return frozenset(t for t in base.split() if t not in STOP and not t.isdigit() and len(t) > 2)


def load_all():
    races = []
    for yd in sorted(HIST.iterdir()):
        f = yd / 'races.json'
        if not f.exists() or not yd.name.isdigit():
            continue
        for r in json.load(open(f, encoding='utf-8')).get('races', []):
            r['_year'] = int(yd.name)
            races.append(r)
    return races


def main():
    out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else ROOT / 'audit' / 'albo_audit.json'
    races = load_all()
    print('edizioni storiche:', len(races))
    ser = collections.defaultdict(list)
    for r in races:
        r['_base'] = base_name(r.get('nome'))
        r['_g'] = gender_of(r)
        ser[(r['_base'], r['_g'])].append(r)
    print('serie per nome+genere:', len(ser))

    # podi incompleti
    inc = 0; tot_cat = 0; empty = 0
    for r in races:
        cats = r.get('categorie') or {}
        if not cats:
            empty += 1
        for c, pod in cats.items():
            tot_cat += 1
            if len(pod) < 3:
                inc += 1
    # buchi dentro le serie
    gaps = []
    for (b, g), lst in ser.items():
        years = sorted({r['_year'] for r in lst})
        if len(years) < 2:
            continue
        miss = [y for y in range(years[0], years[-1] + 1) if y not in years]
        if miss:
            gaps.append({'base': b, 'g': g, 'years': years, 'missing': miss, 'luogo': lst[0].get('luogo'), 'regione': lst[0].get('regione')})
    # serie candidate a fusione: stesso luogo, token simili, anni che non si sovrappongono
    by_loc = collections.defaultdict(list)
    for (b, g), lst in ser.items():
        loc = norm(lst[0].get('luogo') or '')
        loc = re.sub(r'\s*\([A-Z]{2}\)$', '', loc)
        by_loc[(loc, g)].append((b, lst))
    merge = []
    for (loc, g), items in by_loc.items():
        if not loc or len(items) < 2:
            continue
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                (b1, l1), (b2, l2) = items[i], items[j]
                y1 = {r['_year'] for r in l1}; y2 = {r['_year'] for r in l2}
                if y1 & y2:
                    continue
                t1, t2 = toks_key(b1), toks_key(b2)
                inter = len(t1 & t2)
                sim = inter / max(1, min(len(t1), len(t2)))
                adjacent = min(abs(a - b) for a in y1 for b in y2) <= 2
                if (sim >= 0.5 or (adjacent and inter >= 1)) and adjacent:
                    merge.append({'a': b1, 'b': b2, 'luogo': loc, 'g': g, 'years_a': sorted(y1), 'years_b': sorted(y2), 'sim': round(sim, 2)})
    summary = {
        'edizioni': len(races), 'serie': len(ser), 'categorie_totali': tot_cat, 'podi_incompleti': inc, 'edizioni_senza_podio': empty,
        'serie_con_buchi': len(gaps), 'buchi_totali': sum(len(g['missing']) for g in gaps), 'fusioni_candidate': len(merge),
        'generi_misti': sum(1 for r in races if r['_g'] == 'X'),
    }
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    out.parent.mkdir(parents=True, exist_ok=True)
    json.dump({'summary': summary, 'gaps': gaps[:3000], 'merge': merge[:3000]}, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('scritto', out)


if __name__ == '__main__':
    main()
