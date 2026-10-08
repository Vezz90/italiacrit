"""Da data/campioni_regionali.json (scraper delle cronache di ciclismo.info) a data/titoli_campione.json (compatto, per il sito).

Ogni titolo: [anno, kind(0 regionale / 1 italiano), cat, regione, atleta_id, nome, team, id_gara, nome_gara, posizione, prova]
  cat = indice in CATS (stesso ordine di build_almanacco.py); prova = STRADA / CRONOMETRO / CRONOSCALATA / CRONOMETRO A SQUADRE
Uso: python scripts/build_titoli.py
"""
import json, os, re, time, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATS = ['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES']
CI = {c: i for i, c in enumerate(CATS)}


def norm_id(s):
    s = unicodedata.normalize('NFD', str(s or '').upper())
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^A-Z0-9]+', '_', s).strip('_')


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
    src = json.load(open(os.path.join(ROOT, 'data', 'campioni_regionali.json'), encoding='utf-8'))['titles']
    seen, out = set(), []
    for t in src:
        if t['cat'] not in CI:
            continue
        kind = 1 if t['kind'] == 'italiano' else 0
        reg = (t.get('reg') or t.get('regione') or '').upper().strip()
        if t['kind'] == 'provinciale' and 'TRENTINO' not in reg and 'BOLZANO' not in reg and 'TRENTO' not in reg:
            continue
        if kind == 1:
            reg = ''
        pv = prova(t['gara'])
        key = (t['y'], kind, t['cat'], norm_id(t['n']), pv, reg if kind == 0 else '')
        if key in seen:
            continue
        seen.add(key)
        out.append([t['y'], kind, CI[t['cat']], reg, norm_id(t['n']), t['n'], t['team'], t['id'], t['gara'], t['pos'], pv])
    out.sort(key=lambda r: (-r[0], r[1], r[2]))
    json.dump({'generated': time.strftime('%Y-%m-%d'), 'cats': CATS, 't': out}, open(os.path.join(ROOT, 'data', 'titoli_campione.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    reg = sum(1 for r in out if r[1] == 0)
    print('titoli', len(out), 'regionali', reg, 'italiani', len(out) - reg, round(os.path.getsize(os.path.join(ROOT, 'data', 'titoli_campione.json')) / 1024), 'KB')


if __name__ == '__main__':
    main()
