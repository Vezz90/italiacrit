"""Costruisce i dati per Statistiche (Almanacco) e Comparatore (carriere) dall'archivio ciclismo.info 2007-2025.

Output:
  data/almanacco.json  - sala dei campioni, dinastie team, record di sempre, anno per anno.
                         Le sezioni sono calcolate per SESSO (chiave "sex": M / F) e per singola CATEGORIA (chiave "cat"),
                         cosi la pagina mostra numeri reali per il sottoinsieme scelto; le chiavi di primo livello sono quelle storiche
                         (tutti insieme) e restano per compatibilita.
  data/almanacco_regioni/<REGIONE>.json (+ index.json) - stessi sottoinsiemi (tutto / sesso / categoria) ma solo per le gare disputate in quella regione:
                         vittorie e podi di atleti e team, stagioni da record, vincitori anno per anno. Si caricano solo quando si sceglie la regione.
  data/carriere.json   - carriera di ogni atleta e di ogni team, anno per anno (per il Comparatore)

Da rilanciare a fine stagione, dopo aver aggiunto data/ciclismo-storico/<anno>/ (races, classifica, classifica_team).
Uso: python scripts/build_almanacco.py
"""
import json, os, re, collections, time, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data', 'ciclismo-storico')
CATS = ['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES']
CI = {c: i for i, c in enumerate(CATS)}
MEN = {'ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23'}
WOMEN = {'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES'}


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


REG_FIX = {'TRENTINO': 'TRENTINO ALTO ADIGE', 'FRIULI': 'FRIULI VENEZIA GIULIA'}


def reg_of(e):
    r = re.sub(r'\s+', ' ', str(e.get('regione') or '')).strip().upper()
    return REG_FIX.get(r, r)


def longest_streak(yrs):
    yrs = sorted(set(yrs)); best = cur = 1 if yrs else 0
    for a, b in zip(yrs, yrs[1:]):
        cur = cur + 1 if b == a + 1 else 1
        best = max(best, cur)
    return best


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
    wins_c = collections.Counter(); podi_c = collections.Counter()   # (id,cat) -> n
    season_pts = []   # (pts, id, y, cat)
    tseason_pts = []  # (pts, normteam, y, cat)
    pos_by = {}       # (id,y,cat) -> pos
    races_per_year = []
    races_cats = collections.defaultdict(list)       # y -> [set(categorie della gara)]
    reg_d = {}   # regione -> dati delle sole gare disputate li

    def new_reg():
        return {'races': collections.defaultdict(list), 'aw': collections.Counter(), 'ap': collections.Counter(), 'span': {}, 'aseen': set(),
                'tw': collections.Counter(), 'tp': collections.Counter(), 'tspan': {}, 'tseen': set(), 'tname': {},
                'ays': collections.Counter(), 'aypd': collections.Counter(), 'tys': collections.Counter(), 'ylast': {}}

    def reg_note(reg, y, cat, aid, x):
        R = reg_d.setdefault(reg, new_reg())
        pz = x.get('posizione'); tn = clean(x.get('team')); tk = norm(tn)
        R['aseen'].add((aid, cat))
        sp = R['span'].get((aid, cat)); R['span'][(aid, cat)] = [min(sp[0], y), max(sp[1], y)] if sp else [y, y]
        if pz == 1:
            R['aw'][(aid, cat)] += 1; R['ays'][(aid, y, cat)] += 1
        if pz and pz <= 3:
            R['ap'][(aid, cat)] += 1; R['aypd'][(aid, y, cat)] += 1
        R['ylast'][(aid, y, cat)] = tn
        if tk:
            R['tname'][tk] = tn; R['tseen'].add((tk, cat))
            sp = R['tspan'].get((tk, cat)); R['tspan'][(tk, cat)] = [min(sp[0], y), max(sp[1], y)] if sp else [y, y]
            if pz == 1:
                R['tw'][(tk, cat)] += 1; R['tys'][(tk, y, cat)] += 1
            if pz and pz <= 3:
                R['tp'][(tk, cat)] += 1

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
            cs = set()
            reg = reg_of(e)
            for cat, top in (e.get('categorie') or {}).items():
                if cat not in CI:
                    continue
                cs.add(cat)
                for x in top:
                    aid = x.get('atleta_id') or norm(x.get('nome_completo'))
                    if not aid:
                        continue
                    a = ath.setdefault(aid, {'n': clean(x.get('nome_completo')), 's': {}})
                    rec = a['s'].setdefault((y, cat), [0, 0, team_i(x.get('team')), 0, 0])
                    pz = x.get('posizione')
                    if pz == 1:
                        rec[3] += 1; wins_c[(aid, cat)] += 1
                    if pz and pz <= 3:
                        rec[4] += 1; podi_c[(aid, cat)] += 1
                    if reg:
                        reg_note(reg, y, cat, aid, x)
            races_cats[y].append(cs)
            if reg:
                reg_d.setdefault(reg, new_reg())['races'][y].append(cs)
        per_year[str(y)] = py

    def an(aid):
        return ath[aid]['n']

    def compute(catset):
        """Tutte le sezioni dell'almanacco, calcolate solo sulle categorie in catset."""
        ci = lambda c: CI[c]
        n_ath = sum(1 for v in ath.values() if any(c in catset for (_, c) in v['s']))
        n_team = sum(1 for v in tcar.values() if any(c in catset for (_, c) in v['s']))
        rpy = [{'y': y, 'n': sum(1 for cs in races_cats[y] if cs & catset)} for y in years]
        # sala dei campioni
        hall = []
        for aid, v in champs_by_ath.items():
            vv = sorted(t for t in v if t[1] in catset)
            cats = sorted({c for _, c, _ in vv}, key=ci)
            if len(vv) >= 2:
                hall.append({'id': aid, 'n': an(aid), 'titles': [[y, ci(c), p] for y, c, p in vv], 'cats': len(cats)})
        hall.sort(key=lambda h: (-len(h['titles']), -h['cats'], h['titles'][0][0]))
        multi = [h for h in hall if h['cats'] >= 2]
        multi.sort(key=lambda h: (-h['cats'], -len(h['titles'])))
        # dinastie team
        dyn = []
        for k, v in titles_team.items():
            vv = sorted(t for t in v if t[1] in catset)
            if vv:
                dyn.append({'team': team_names.get(k, k), 'k': k, 'titles': [[y, ci(c), p] for y, c, p in vv], 'streak': longest_streak([y for y, _, _ in vv])})
        dyn.sort(key=lambda d: (-len(d['titles']), -d['streak']))
        # record (200 per lista: servono per sommare le stagioni dal 2026 senza perdere chi e appena fuori dai primi)
        wins, podi = collections.Counter(), collections.Counter()
        for (aid, c), n in wins_c.items():
            if c in catset: wins[aid] += n
        for (aid, c), n in podi_c.items():
            if c in catset: podi[aid] += n
        def span(aid):
            ys = [y for (y, c) in ath[aid]['s'] if c in catset]
            return [min(ys), max(ys)] if ys else []
        wins_top = [{'id': aid, 'n': an(aid), 'w': w, 'p': podi[aid], 'y': span(aid)} for aid, w in wins.most_common(200)]
        podi_top = [{'id': aid, 'n': an(aid), 'w': wins[aid], 'p': p, 'y': span(aid)} for aid, p in podi.most_common(200)]
        best_seasons = [{'id': aid, 'n': an(aid), 'y': y, 'c': ci(c), 'p': p} for p, aid, y, c in sorted((x for x in season_pts if x[3] in catset), reverse=True)[:30]]
        best_tseasons = [{'team': team_names.get(k, k), 'y': y, 'c': ci(c), 'p': p} for p, k, y, c in sorted((x for x in tseason_pts if x[3] in catset), reverse=True)[:20]]
        # salti in classifica (stessa categoria, anno su anno)
        jumps = []
        for (aid, y, cat), pos in pos_by.items():
            if cat not in catset:
                continue
            prev = pos_by.get((aid, y - 1, cat))
            if prev and pos and prev > 30 and pos <= 10:
                jumps.append((prev - pos, aid, y, cat, prev, pos))
        jumps.sort(reverse=True)
        rises = [{'id': aid, 'n': an(aid), 'y': y, 'c': ci(cat), 'from': a, 'to': b} for _, aid, y, cat, a, b in jumps[:20]]
        return {
            'counts': {'athletes': n_ath, 'teams': n_team, 'races': sum(r['n'] for r in rpy)},
            'racesPerYear': rpy, 'hall': hall[:80], 'multi': multi[:50], 'dynasties': dyn[:25],
            'winsTop': wins_top, 'podiTop': podi_top, 'bestSeasons': best_seasons, 'bestTeamSeasons': best_tseasons, 'rises': rises,
        }

    base = compute(set(CATS))
    wins_by_cat = {}
    for cat in CATS:
        cnt = collections.Counter()
        for (aid, c), n in wins_c.items():
            if c == cat: cnt[aid] += n
        wins_by_cat[cat] = [{'id': aid, 'n': an(aid), 'w': w} for aid, w in cnt.most_common(8)]

    alm = {
        'generated': time.strftime('%Y-%m-%d'), 'from': years[0], 'to': years[-1], 'cats': CATS,
        'counts': {'athletes': len(ath), 'teams': len(tcar)},
        'racesPerYear': races_per_year, 'perYear': per_year,
        'hall': base['hall'], 'multi': base['multi'], 'dynasties': base['dynasties'],
        'winsTop': base['winsTop'], 'podiTop': base['podiTop'], 'winsByCat': wins_by_cat,
        'bestSeasons': base['bestSeasons'], 'bestTeamSeasons': base['bestTeamSeasons'], 'rises': base['rises'],
        # dati per sesso e per categoria (numeri reali del sottoinsieme)
        'sex': {'M': compute(MEN), 'F': compute(WOMEN)},
        'cat': {c: compute({c}) for c in CATS},
    }
    with open(os.path.join(ROOT, 'data', 'almanacco.json'), 'w', encoding='utf-8') as f:
        json.dump(alm, f, ensure_ascii=False, separators=(',', ':'))

    # ---- per regione ----
    out_dir = os.path.join(ROOT, 'data', 'almanacco_regioni')
    os.makedirs(out_dir, exist_ok=True)
    for fn in os.listdir(out_dir):
        if fn.endswith('.json'):
            os.remove(os.path.join(out_dir, fn))
    reg_index = []
    ci = lambda c: CI[c]
    for reg, R in sorted(reg_d.items()):
        # chi ha vinto di piu in ogni anno e categoria (vittorie, poi podi): "campione" dell'anno in quella regione
        best_a, best_t = {}, {}
        for (aid, y, cat), w in R['ays'].items():
            key = (y, cat); cand = (w, R['aypd'][(aid, y, cat)], aid); cur = best_a.get(key)
            if cur is None or cand[:2] > cur[:2] or (cand[:2] == cur[:2] and aid < cur[2]):
                best_a[key] = cand
        for (tk, y, cat), w in R['tys'].items():
            key = (y, cat); cur = best_t.get(key)
            if cur is None or w > cur[0] or (w == cur[0] and tk < cur[1]):
                best_t[key] = (w, tk)
        per_year_r = {}
        for y in years:
            n_races = len(R['races'].get(y, []))
            if not n_races:
                continue
            champs, tchamps = {}, {}
            for cat in CATS:
                if (y, cat) in best_a:
                    w, pd, aid = best_a[(y, cat)]
                    champs[cat] = {'id': aid, 'n': an(aid), 't': R['ylast'].get((aid, y, cat), ''), 'p': w, 'pd': pd}
                if (y, cat) in best_t:
                    w, tk = best_t[(y, cat)]
                    tchamps[cat] = {'n': R['tname'].get(tk, tk), 'k': tk, 'p': w}
            per_year_r[str(y)] = {'races': n_races, 'champs': champs, 'teamChamps': tchamps}

        def compute_reg(catset):
            seen_a = {a for (a, c) in R['aseen'] if c in catset}
            seen_t = {t for (t, c) in R['tseen'] if c in catset}
            rpy = [{'y': y, 'n': sum(1 for cs in R['races'].get(y, []) if cs & catset)} for y in years]
            wins, podi, span = collections.Counter(), collections.Counter(), {}
            for (a, c), n in R['aw'].items():
                if c in catset: wins[a] += n
            for (a, c), n in R['ap'].items():
                if c in catset: podi[a] += n
            for (a, c), sp in R['span'].items():
                if c in catset:
                    o = span.get(a); span[a] = [min(o[0], sp[0]), max(o[1], sp[1])] if o else list(sp)
            def top_a(counter, other, limit):
                keys = sorted(counter, key=lambda a: (-counter[a], -other[a], an(a)))[:limit]
                return [{'id': a, 'n': an(a), 'w': wins[a], 'p': podi[a], 'y': span.get(a, [])} for a in keys if counter[a] > 0]
            tw, tp, tsp = collections.Counter(), collections.Counter(), {}
            for (t, c), n in R['tw'].items():
                if c in catset: tw[t] += n
            for (t, c), n in R['tp'].items():
                if c in catset: tp[t] += n
            for (t, c), sp in R['tspan'].items():
                if c in catset:
                    o = tsp.get(t); tsp[t] = [min(o[0], sp[0]), max(o[1], sp[1])] if o else list(sp)
            tkeys = sorted((t for t in tsp), key=lambda t: (-tw[t], -tp[t], R['tname'].get(t, t)))[:80]
            teams_top = [{'team': R['tname'].get(t, t), 'w': tw[t], 'p': tp[t], 'y': tsp[t]} for t in tkeys if tw[t] or tp[t]]
            seas = sorted(((w, y, a, c) for (a, y, c), w in R['ays'].items() if c in catset), key=lambda x: (-x[0], -x[1], an(x[2])))[:20]
            tseas = sorted(((w, y, t, c) for (t, y, c), w in R['tys'].items() if c in catset), key=lambda x: (-x[0], -x[1], R['tname'].get(x[2], x[2])))[:20]
            dyn_map = collections.defaultdict(list)
            for y_s, py in per_year_r.items():
                for cat, tc_ in py['teamChamps'].items():
                    if cat in catset:
                        dyn_map[tc_['k']].append((int(y_s), cat, tc_['p']))
            dyn = [{'team': R['tname'].get(k, k), 'k': k, 'titles': [[y, ci(c), w] for y, c, w in sorted(v)], 'streak': longest_streak([y for y, _, _ in v])} for k, v in dyn_map.items()]
            dyn.sort(key=lambda d: (-len(d['titles']), -d['streak'], d['team']))
            return {
                'counts': {'athletes': len(seen_a), 'teams': len(seen_t), 'races': sum(r['n'] for r in rpy)},
                'racesPerYear': rpy, 'hall': [], 'multi': [], 'rises': [], 'dynasties': dyn[:25],
                'winsTop': top_a(wins, podi, 120), 'podiTop': top_a(podi, wins, 120), 'teamsTop': teams_top,
                'bestSeasons': [{'id': a, 'n': an(a), 'y': y, 'c': ci(c), 'w': w} for w, y, a, c in seas],
                'bestTeamSeasons': [{'team': R['tname'].get(t, t), 'y': y, 'c': ci(c), 'w': w} for w, y, t, c in tseas],
            }

        allc = compute_reg(set(CATS))
        doc = {'region': reg, 'slug': norm(reg), 'generated': time.strftime('%Y-%m-%d'), 'from': years[0], 'to': years[-1], 'cats': CATS, 'unit': 'vitt.',
               'counts': allc['counts'], 'racesPerYear': allc['racesPerYear'], 'perYear': per_year_r,
               'hall': [], 'multi': [], 'rises': [], 'dynasties': allc['dynasties'], 'winsTop': allc['winsTop'], 'podiTop': allc['podiTop'],
               'teamsTop': allc['teamsTop'], 'bestSeasons': allc['bestSeasons'], 'bestTeamSeasons': allc['bestTeamSeasons'],
               'sex': {'M': compute_reg(MEN), 'F': compute_reg(WOMEN)}, 'cat': {c: compute_reg({c}) for c in CATS}}
        with open(os.path.join(out_dir, norm(reg) + '.json'), 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        reg_index.append({'slug': norm(reg), 'name': reg, 'races': allc['counts']['races'], 'athletes': allc['counts']['athletes']})
    reg_index.sort(key=lambda r: -r['races'])
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'generated': time.strftime('%Y-%m-%d'), 'regions': reg_index}, f, ensure_ascii=False, separators=(',', ':'))
    print('regioni', len(reg_index), 'file', sum(os.path.getsize(os.path.join(out_dir, x)) for x in os.listdir(out_dir)) // 1024, 'KB')

    car = {
        'cats': CATS, 'teams': teams,
        'a': {aid: {'n': v['n'], 's': [[y, CI[c]] + vals for (y, c), vals in sorted(v['s'].items())]} for aid, v in ath.items()},
        't': {k: {'n': v['n'], 's': [[y, CI[c]] + vals for (y, c), vals in sorted(v['s'].items())]} for k, v in tcar.items()},
    }
    with open(os.path.join(ROOT, 'data', 'carriere.json'), 'w', encoding='utf-8') as f:
        json.dump(car, f, ensure_ascii=False, separators=(',', ':'))
    for fn in ('almanacco.json', 'carriere.json'):
        print(fn, round(os.path.getsize(os.path.join(ROOT, 'data', fn)) / 1024), 'KB')
    print('atleti', len(ath), 'team', len(tcar), 'uomini', alm['sex']['M']['counts'], 'donne', alm['sex']['F']['counts'])


if __name__ == '__main__':
    main()
