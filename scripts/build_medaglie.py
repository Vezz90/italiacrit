"""Medaglie (primi 3) ai Campionati Europei e Mondiali dall'archivio ciclismo.info 2007-2025 -> data/medaglie_internazionali.json

Una riga per medaglia: [anno, kind(0 europeo / 1 mondiale), cat, prova, posizione, atleta_id, nome, team, id_gara, nome_gara]
cat = indice in CATS (stesso ordine di build_almanacco.py). Sono incluse solo persone gia' presenti nel nostro database
(classifiche dell'archivio) oppure con team "ITALIA/NAZIONALE": i primi arrivati stranieri senza profilo si scartano.
Uso: python scripts/build_medaglie.py
"""
import json, os, re, time, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data', 'ciclismo-storico')
CATS = ['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES']
CI = {c: i for i, c in enumerate(CATS)}
NAT = re.compile(r'CAMPIONAT\w*\s+(?:DEL\s+MONDO|MONDIAL\w*|EUROP\w*|MONDO)|CAMPIONAT\w*.*(?:EUROP|MONDIAL)', re.I)


def prova(n):
    n = str(n or '')
    if re.search(r'squadre|staffetta|team relay', n, re.I):
        return 'SQUADRE'
    if re.search(r'cronoscalata', n, re.I):
        return 'CRONOSCALATA'
    if re.search(r'cronometro', n, re.I):
        return 'CRONOMETRO'
    return 'STRADA'


def main():
    known = set()
    for y in range(2007, 2026):
        p = os.path.join(D, str(y), 'classifica.json')
        if os.path.exists(p):
            for rows in json.load(open(p, encoding='utf-8'))['classifica'].values():
                for r in rows:
                    if r.get('atleta_id'):
                        known.add(r['atleta_id'])
    out, seen = [], set()
    for y in range(2007, 2026):
        p = os.path.join(D, str(y), 'races.json')
        if not os.path.exists(p):
            continue
        for e in json.load(open(p, encoding='utf-8'))['races']:
            n = e['nome']
            if not NAT.search(n) or re.search(r'NAZIONALE\s+\w+', n, re.I) and not re.search(r'EUROP|MOND', n, re.I):
                continue
            kind = 0 if re.search(r'EUROP', n, re.I) else 1
            pv = prova(n)
            if pv == 'SQUADRE':
                continue
            for cat, top in (e.get('categorie') or {}).items():
                if cat not in CI:
                    continue
                for x in top:
                    pos = x.get('posizione')
                    if not pos or pos > 3:
                        continue
                    aid = x.get('atleta_id')
                    team = x.get('team') or ''
                    if not aid or (aid not in known and not re.search(r'ITALIA|NAZIONALE', team, re.I)):
                        continue
                    key = (y, kind, cat, pv, pos, aid)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append([y, kind, CI[cat], pv, pos, aid, x.get('nome_completo', ''), team, e['id'], n])
    out.sort(key=lambda r: (-r[0], r[1], r[2], r[4]))
    json.dump({'generated': time.strftime('%Y-%m-%d'), 'cats': CATS, 't': out}, open(os.path.join(ROOT, 'data', 'medaglie_internazionali.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('medaglie', len(out), 'europei', sum(1 for r in out if r[1] == 0), 'mondiali', sum(1 for r in out if r[1] == 1), 'ori', sum(1 for r in out if r[4] == 1))


if __name__ == '__main__':
    main()
