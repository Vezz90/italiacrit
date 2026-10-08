"""Conserva per sempre i Campioni Italiani della stagione in corso.

Ogni volta che gira lo scraper (workflow "Scrape FCI Results") questo script legge data/results_raw.json,
trova i vincitori dei Campionati Italiani individuali e li AGGIUNGE a data/titoli_stagioni.json senza mai
cancellare niente: quando la stagione cambia e results_raw.json riparte da zero, i titoli restano sui profili.
(I titoli regionali assegnati dall'admin stanno gia' nel database e non scompaiono.)
Solo libreria standard. Uso: python scripts/accumula_titoli.py
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'results_raw.json')
OUT = os.path.join(ROOT, 'data', 'titoli_stagioni.json')


def prova(n):
    n = str(n or '')
    if re.search(r'cronometro.*squadre|a\s+squadre', n, re.I):
        return 'CRONOMETRO A SQUADRE'
    if re.search(r'cronoscalata', n, re.I):
        return 'CRONOSCALATA'
    if re.search(r'cronometro', n, re.I):
        return 'CRONOMETRO'
    return 'STRADA'


def main():
    try:
        rows = json.load(open(SRC, encoding='utf-8'))
    except Exception:
        print('results_raw.json non leggibile: niente da fare')
        return
    try:
        old = json.load(open(OUT, encoding='utf-8')).get('t', [])
    except Exception:
        old = []
    have = {(t['y'], t['gid'], t['aid']) for t in old}
    new = []
    for r in rows:
        if r.get('posizione') != 1 or not r.get('atleta_id'):
            continue
        n = r.get('nome_gara') or ''
        if not re.search(r'campionato\s+italiano', n, re.I):
            continue
        pv = prova(n)
        if pv == 'CRONOMETRO A SQUADRE':
            continue
        m = re.search(r'_((?:ES1|ES2|AL|JUN|ELI)_[MF])$', r.get('gara_id') or '')
        y = int(str(r.get('data') or '0000')[:4])
        key = (y, r['gara_id'], r['atleta_id'])
        if key in have or not y:
            continue
        have.add(key)
        new.append({'y': y, 'kind': 'it', 'catCode': m.group(1) if m else '', 'aid': r['atleta_id'],
                    'n': f"{r.get('cognome', '')} {r.get('nome', '')}".strip(), 'team': r.get('team') or '',
                    'gid': r['gara_id'], 'gara': n, 'prova': pv})
    if new or not os.path.exists(OUT):
        allt = old + new
        allt.sort(key=lambda t: (-t['y'], t['gid']))
        json.dump({'t': allt}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'titoli_stagioni: {len(old)} gia\' presenti, {len(new)} nuovi')


if __name__ == '__main__':
    main()
