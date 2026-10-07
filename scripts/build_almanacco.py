"""Costruisce i dati per Statistiche (Almanacco) e Comparatore (carriere) dall'archivio ciclismo.info 2007-2025.

Output:
  data/almanacco.json  - sala dei campioni, dinastie team, record di sempre, anno per anno
  data/carriere.json   - carriera di ogni atleta e di ogni team, anno per anno (per il Comparatore)

Da rilanciare a fine stagione, dopo aver aggiunto data/ciclismo-storico/<anno>/ (races, classifica, classifica_team).
Uso: python scripts/build_almanacco.py
"""
import json, os, re, collections, time, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data', 'ciclismo-storico')
CATS = ['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES']
CI = {c: i for i, c in enumerate(CATS)}


def jl(p):
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:
        return None


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').upper())
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^A-Z0-9]+', '_', s).strip('_')


def clean(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def main():
    years = sorted(int(y) for y in os.listdir(D) if y.isdigit())
    teams = []  # nomi squadra (indice nei dati atleta)
    tidx = {}

    def team_i(name):
        name = clean(name)
        if name not in tidx:
            tidx[name] = len(teams)
            teams.append(name)
        return tidx[name]

    ath = {}          # id -> {n, s:{(y,cat):[pos,pts,team,w,p]}}
    tcar = {}         # normteam -> {n, s:{(y,cat):[pos,pts]}}
    per_year = {}
    champs_by_ath = collections.defaultdict(list)    # id -> [(y,cat,pts)]
    titles_team = collections.defaultdict(list)       # normteam -> [(y,cat,pts)]
    team_names = {}
    wins_all = collections.Counter(); podi_all = collections.Counter()
    wins_cat = collections.defaultdict(collections.Counter)
    season_pts = []   # (pts, id, y, cat)
    tseason_pts = []  # (pts, normteam, y, cat)
    pos_by = {}       # (id,y,cat) -> pos
    races_per_year = []

    for y in years:
        cl = (jl(f'{D}/{y}/classifica.json') or {}).get('classifica', {})
        tm = (jl(f'{D}/{y}/classifica_team.json') or {}).get('classifica', {})
        rc = (jl(f'{D}/{y}/races.json') or {}).get('races', [])
        races_per_year.append({'y': y, 'n': len(rc)})
        py = {'races': len(rc), 'champs': {}, 'teamChamps': {}}
        for cat, rows in cl.items():
            if cat not in CI:
                continue
            for r in rows:
                aid = r.get('atleta_id') or norm(r.get('nome_completo'))
                a = ath.setdefault(aid, {'n': clean(r.get('nome_completo')), 's': {}})
                a['s'][(y, cat)] = [r.get('pos') or 0, r.get('punti') or 0, team_i(r.get('team')), 0, 0]
                pos_by[(aid, y, cat)] = r.get('pos') or 0
                season_pts.append((r.get('punti') or 0, aid, y, cat))
            if rows:
                r0 = rows[0]
                aid0 = r0.get('atleta_id') or norm(r0.get('nome_completo'))
                py['champs'][cat] = {'id': aid0, 'n': clean(r0.get('nome_completo')), 't': clean(r0.get('team')), 'p': r0.get('punti') or 0,
                                     'p2': (rows[1].get('punti') if len(rows) > 1 else 0) or 0}
                champs_by_ath[aid0].append((y, cat, r0.get('punti') or 0))
        for cat, rows in tm.items():
            if cat not in CI:
                continue
            for r in rows:
                k = norm(r.get('team'))
                if not k:
                    continue
                team_names[k] = clean(r.get('team'))
                t = tcar.setdefault(k, {'n': clean(r.get('team')), 's': {}})
                t['s'][(y, cat)] = [r.get('pos') or 0, r.get('punti') or 0]
                tseason_pts.append((r.get('punti') or 0, k, y, cat))
            if rows:
                r0 = rows[0]
                py['teamChamps'][cat] = {'n': clean(r0.get('team')), 'p': r0.get('punti') or 0}
                titles_team[norm(r0.get('team'))].append((y, cat, r0.get('punti') or 0))
        for e in rc:
            for cat, top in (e.get('categorie') or {}).items():
                if cat not in CI:
                    continue
                for x in top:
                    aid = x.get('atleta_id') or norm(x.get('nome_completo'))
                    if not aid:
                        continue
                    a = ath.setdefault(aid, {'n': clean(x.get('nome_completo')), 's': {}})
                    rec = a['s'].setdefault((y, cat), [0, 0, team_i(x.get('team')), 0, 0])
                    pz = x.get('posizione')
                    if pz == 1:
                        rec[3] += 1; wins_all[aid] += 1; wins_cat[cat][aid] += 1
                    if pz and pz <= 3:
                        rec[4] += 1; podi_all[aid] += 1
        per_year[str(y)] = py

    def an(aid):
        return ath[aid]['n']

    # --- sala dei campioni
    hall = []
    for aid, v in champs_by_ath.items():
        v.sort()
        cats = sorted({c for _, c, _ in v}, key=lambda c: CI[c])
        if len(v) >= 2:
            hall.append({'id': aid, 'n': an(aid), 'titles': [[y, CI[c], p] for y, c, p in v], 'cats': len(cats)})
    hall.sort(key=lambda h: (-len(h['titles']), -h['cats'], h['titles'][0][0]))
    multi = [h for h in hall if h['cats'] >= 2]
    multi.sort(key=lambda h: (-h['cats'], -len(h['titles'])))

    # --- dinastie team
    def longest_streak(yrs):
        yrs = sorted(set(yrs)); best = cur = 1 if yrs else 0
        for a, b in zip(yrs, yrs[1:]):
            cur = cur + 1 if b == a + 1 else 1
            best = max(best, cur)
        return best
    dyn = []
    for k, v in titles_team.items():
        v.sort()
        dyn.append({'team': team_names.get(k, k), 'k': k, 'titles': [[y, CI[c], p] for y, c, p in v], 'streak': longest_streak([y for y, _, _ in v])})
    dyn.sort(key=lambda d: (-len(d['titles']), -d['streak']))

    # --- record
    def rec_list(counter, extra=None, n=25):
        out = []
        for aid, w in counter.most_common(n):
            out.append({'id': aid, 'n': an(aid), 'w': w, 'p': podi_all[aid], 'y': sorted({y for (y, c) in ath[aid]['s']})[:1] + sorted({y for (y, c) in ath[aid]['s']})[-1:]})
        return out
    wins_top = rec_list(wins_all)
    podi_top = []
    for aid, p in podi_all.most_common(25):
        podi_top.append({'id': aid, 'n': an(aid), 'w': wins_all[aid], 'p': p})
    wins_by_cat = {}
    for cat, cnt in wins_cat.items():
        wins_by_cat[cat] = [{'id': aid, 'n': an(aid), 'w': w} for aid, w in cnt.most_common(8)]
    season_pts.sort(reverse=True)
    best_seasons = [{'id': aid, 'n': an(aid), 'y': y, 'c': CI[c], 'p': p} for p, aid, y, c in season_pts[:30]]
    tseason_pts.sort(reverse=True)
    best_tseasons = [{'team': team_names.get(k, k), 'y': y, 'c': CI[c], 'p': p} for p, k, y, c in tseason_pts[:20]]

    # --- salti in classifica (stessa categoria, anno su anno)
    jumps = []
    for (aid, y, cat), pos in pos_by.items():
        prev = pos_by.get((aid, y - 1, cat))
        if prev and pos and prev > 30 and pos <= 10:
            jumps.append((prev - pos, aid, y, cat, prev, pos))
    jumps.sort(reverse=True)
    rises = [{'id': aid, 'n': an(aid), 'y': y, 'c': CI[cat], 'from': a, 'to': b} for _, aid, y, cat, a, b in jumps[:20]]

    alm = {
        'generated': time.strftime('%Y-%m-%d'), 'from': years[0], 'to': years[-1], 'cats': CATS,
        'counts': {'athletes': len(ath), 'teams': len(tcar)},
        'racesPerYear': races_per_year, 'perYear': per_year,
        'hall': hall[:80], 'multi': multi[:50], 'dynasties': dyn[:25],
        'winsTop': wins_top, 'podiTop': podi_top, 'winsByCat': wins_by_cat,
        'bestSeasons': best_seasons, 'bestTeamSeasons': best_tseasons, 'rises': rises,
    }
    with open(os.path.join(ROOT, 'data', 'almanacco.json'), 'w', encoding='utf-8') as f:
        json.dump(alm, f, ensure_ascii=False, separators=(',', ':'))

    car = {
        'cats': CATS, 'teams': teams,
        'a': {aid: {'n': v['n'], 's': [[y, CI[c]] + vals for (y, c), vals in sorted(v['s'].items())]} for aid, v in ath.items()},
        't': {k: {'n': v['n'], 's': [[y, CI[c]] + vals for (y, c), vals in sorted(v['s'].items())]} for k, v in tcar.items()},
    }
    with open(os.path.join(ROOT, 'data', 'carriere.json'), 'w', encoding='utf-8') as f:
        json.dump(car, f, ensure_ascii=False, separators=(',', ':'))
    for fn in ('almanacco.json', 'carriere.json'):
        print(fn, round(os.path.getsize(os.path.join(ROOT, 'data', fn)) / 1024), 'KB')
    print('atleti', len(ath), 'team', len(tcar), 'hall', len(hall), 'multi', len(multi), 'dinastie', len(dyn))


if __name__ == '__main__':
    main()
