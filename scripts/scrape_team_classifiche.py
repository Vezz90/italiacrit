"""Classifiche a squadre per anno e categoria da ciclismo.info -> data/ciclismo-storico/<anno>/classifica_team.json

Stesse chiavi categoria di classifica.json (ELITE_UNDER23, JUNIORES, DONNE_ALLIEVE, ...).
Uso:  python scripts/scrape_team_classifiche.py [anno_da] [anno_a]
"""
import json, os, re, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'ciclismo-storico')

# chiave categoria -> (sottodominio, slug dell'URL "classifica_<slug>_a_squadre_<anno>.htm")
CATS = {
    'ELITE_UNDER23':    ('elite-under23', 'elite-under23'),
    'JUNIORES':         ('juniores', 'juniores'),
    'ALLIEVI':          ('allievi', 'allievi'),
    'ESORDIENTI2':      ('esordienti', 'esordienti'),
    'ESORDIENTI1':      ('esordienti', 'esordienti_a_squadre_primo_anno'),
    'DONNE_JUNIORES':   ('donne-juniores', 'donne-juniores'),
    'DONNE_ALLIEVE':    ('donne-allieve', 'donne-allieve'),
    'DONNE_ESORDIENTI': ('donne-esordienti', 'donne-esordienti'),
}

ROW = re.compile(
    r'<td width="6%" align="right">\s*<font[^>]*><b>(\d+)(?:&nbsp;)*\s*</b></font>.*?'
    r'href="/scheda_team_risultati_gare_(\d+)_[^"]*"[^>]*>\s*<font[^>]*><b>(.*?)</b></font>.*?'
    r'<b>P\.\s*(\d+)</b>', re.S)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode('cp1252', errors='replace')
    except urllib.error.HTTPError as e:
        return None
    except Exception as e:
        print('  errore rete', url, e)
        return None


def parse(html):
    out, seen = [], set()
    for pos, tid, name, pts in ROW.findall(html):
        name = re.sub(r'<[^>]+>', '', name).replace('&amp;', '&').replace('&nbsp;', ' ').strip()
        key = (int(pos), tid)
        if key in seen or not name:
            continue
        seen.add(key)
        out.append({'pos': int(pos), 'team_id': tid, 'team': name, 'punti': int(pts)})
    out.sort(key=lambda r: r['pos'])
    return out


def main():
    y0 = int(sys.argv[1]) if len(sys.argv) > 1 else 2007
    y1 = int(sys.argv[2]) if len(sys.argv) > 2 else 2025
    for y in range(y1, y0 - 1, -1):
        res = {}
        for key, (dom, slug) in CATS.items():
            url = (f'http://{dom}.ciclismo.info/classifica_{slug}_{y}.htm' if slug.endswith('primo_anno') else f'http://{dom}.ciclismo.info/classifica_{slug}_a_squadre_{y}.htm')
            html = fetch(url)
            time.sleep(0.3)
            if not html:
                continue
            rows = parse(html)
            if rows:
                res[key] = rows
        d = os.path.join(OUT, str(y))
        if res and os.path.isdir(d):
            with open(os.path.join(d, 'classifica_team.json'), 'w', encoding='utf-8') as f:
                json.dump({'anno': y, 'classifica': res}, f, ensure_ascii=False, separators=(',', ':'))
        print(y, {k: len(v) for k, v in res.items()}, flush=True)


if __name__ == '__main__':
    main()
