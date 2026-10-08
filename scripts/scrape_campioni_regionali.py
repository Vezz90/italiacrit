"""Titoli di Campione Regionale / Italiano dall'archivio ciclismo.info (2007-2025).

Le pagine di gara di ciclismo.info raccontano chi ha vinto il titolo ("... conquista il titolo di Campione
Regionale", "Aurora Masi (Zhiraf Guerciotti) conquista il titolo di Campionessa Regionale Toscana ...").
Il titolo non va sempre al vincitore della gara: spesso e' un atleta piu' indietro nell'ordine d'arrivo.

Per ogni gara con "CAMPION" o "REGIONAL" nel nome: scarica la pagina, legge la cronaca e l'ordine d'arrivo,
cerca le frasi con campione/campionessa/titolo/maglia, ricava il nome citato e lo abbina a una riga
dell'ordine d'arrivo. Scrive data/campioni_regionali.json.

Uso: python scripts/scrape_campioni_regionali.py [anno_da] [anno_a]     (cache pagine in scripts/.cache_gare/)
"""
import json, os, re, sys, time, unicodedata, urllib.request, hashlib, html as htmllib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH = os.path.join(ROOT, 'data', 'ciclismo-storico')
CACHE = os.path.join(ROOT, 'scripts', '.cache_gare')
OUT = os.path.join(ROOT, 'data', 'campioni_regionali.json')

NAME_OK = re.compile(r'CAMPION|REGIONAL|TITOLO|TRIVENETO|ALTO ADIGE', re.I)
NAME_SKIP = re.compile(r'EUROP|MOND|WORLD|NAZIONALE\s+(ALBANIA|SLOVEN|CROAZ|SVIZZ|AUSTR|FRANC|BELG|OLAND|TEDESC|GERMAN|SPAGN|POLON|UNGHER)', re.I)
REGIONI_AGG = {  # aggettivo/denominazione usata nel testo -> regione
    'TOSCAN': 'TOSCANA', 'VENET': 'VENETO', 'LOMBARD': 'LOMBARDIA', 'PIEMONTES': 'PIEMONTE', 'LIGUR': 'LIGURIA', 'EMILIAN': 'EMILIA ROMAGNA',
    'ROMAGNOL': 'EMILIA ROMAGNA', 'MARCHIGIAN': 'MARCHE', 'UMBR': 'UMBRIA', 'LAZIAL': 'LAZIO', 'ABRUZZES': 'ABRUZZO', 'MOLISAN': 'MOLISE',
    'CAMPAN': 'CAMPANIA', 'PUGLIES': 'PUGLIA', 'LUCAN': 'BASILICATA', 'CALABRES': 'CALABRIA', 'SICILIAN': 'SICILIA', 'SARD': 'SARDEGNA',
    'FRIULAN': 'FRIULI VENEZIA GIULIA', 'FRIULI': 'FRIULI VENEZIA GIULIA', 'TRENTIN': 'TRENTINO ALTO ADIGE', 'ALTOATESIN': 'TRENTINO ALTO ADIGE',
    'ALTO ADIGE': 'TRENTINO ALTO ADIGE', 'VALDOSTAN': 'VALLE D AOSTA', 'AOSTA': 'VALLE D AOSTA',
}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').upper())
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^A-Z0-9]+', ' ', s).strip()


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + '.html')
    if os.path.exists(fn):
        return open(fn, 'rb').read().decode('cp1252', errors='replace')
    for _ in range(2):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            raw = urllib.request.urlopen(req, timeout=25).read()
            open(fn, 'wb').write(raw)
            time.sleep(0.35)
            return raw.decode('cp1252', errors='replace')
        except Exception:
            time.sleep(1.5)
    return None


def page_parts(h):
    """(cronaca, ordine) dalla pagina di gara. ordine = [(pos, 'NOME COGNOME', team)]"""
    t = re.sub(r'\s+', ' ', h)
    t = htmllib.unescape(re.sub(r'<[^>]+>', '\n', t))
    t = re.sub(r'\n\s*\n+', '\n', t)
    i = t.find('ORDINE DI ARRIVO')
    if i < 0:
        return '', []
    # la cronaca sta tra l'intestazione "di Km." e l'ordine d'arrivo
    head = t[:i]
    j = max(head.rfind(' alla media di'), head.rfind(' di Km.'))
    cron = head[j:] if j >= 0 else head[-700:]
    body = t[i + len('ORDINE DI ARRIVO'):]
    rows = []
    for m in re.finditer(r'(\d+)\s*°\s*\n\s*([^\n]+)\n\s*\(([^)]*)\)', body):
        rows.append((int(m.group(1)), m.group(2).strip(), m.group(3).strip()))
    return cron, rows


PERSON = re.compile(r"((?:[A-ZÀ-Ý][\w'’.\-]+)(?: (?:[A-ZÀ-Ý][\w'’.\-]+|de|di|del|della|dal|dalla|da|van|von|la|le|lo)){1,4})\s*\(([^)]{2,60})\)")
TITLE = re.compile(r'(?i)(campion(?:e|essa|i)?\s+(?:regional\w*|italian\w*|provincial\w*|triveneto|toscan\w*|ligur\w*|veneto|lombard\w*|piemontes\w*|[a-zà-ÿ]+)|titol\w+\s+(?:di|regional\w*|italian\w*|provincial\w*)[^.]{0,30}|maglia di\s+campion\w+[^.]{0,25})')


def kind_of(text, race_name):
    s = (text + ' ' + race_name).upper()
    if 'ITALIAN' in s:
        return 'italiano'
    if 'PROVINCIAL' in s:
        return 'provinciale'
    return 'regionale'


def find_champions(cron, rows, race_name):
    out = []
    if not cron or not rows:
        return out
    cron = re.sub(r'\s*\n\s*', ' ', cron)
    sents = re.split(r'(?<=[.!?])\s+', cron)
    for si, s in enumerate(sents):
        tm = re.search(r'(?i)campion(?:e|essa|i|ato)\b|titolo|maglia di', s)
        if not tm:
            continue
        if re.search(r'(?i)europe|mondial|del mondo|campionato italiano.*(?:vince|vinto).*(?:ieri|scors)', s):
            continue
        # persona "Nome Cognome (Team)" piu' vicina PRIMA dell'espressione del titolo, nella stessa frase;
        # se la frase inizia col team/verbo (nome nella frase precedente) si usa l'ultima persona di quella
        before = [m for m in PERSON.finditer(s) if m.start() < tm.start() + 3]
        cand = before[-1] if before else None
        if cand is None and si > 0:
            prev = list(PERSON.finditer(sents[si - 1]))
            if prev and re.match(r'^[\s(]', s):
                cand = prev[-1]
        if cand is None:
            continue
        toks = set(norm(cand.group(1)).split())
        hit = None
        for pos, rname, rteam in rows:
            rt = set(norm(rname).split())
            if toks and (toks == rt or (len(toks) >= 2 and toks <= rt) or (len(rt) >= 2 and rt <= toks)):
                hit = (pos, rname, rteam); break
        if not hit:
            continue
        reg = ''
        for k, v in REGIONI_AGG.items():
            if re.search(k, norm(s)):
                reg = v; break
        out.append({'pos': hit[0], 'n': hit[1], 'team': hit[2], 'text': s.strip()[:200], 'kind': kind_of(s, race_name), 'reg': reg})
    seen = set(); res = []
    for o in out:
        if o['pos'] not in seen:
            seen.add(o['pos']); res.append(o)
    return res


def region_of(e, cron):
    r = norm(e.get('regione'))
    return r or ''


def main():
    y0 = int(sys.argv[1]) if len(sys.argv) > 1 else 2007
    y1 = int(sys.argv[2]) if len(sys.argv) > 2 else 2025
    res = []
    tot = found = 0
    for y in range(y1, y0 - 1, -1):
        p = os.path.join(ARCH, str(y), 'races.json')
        if not os.path.exists(p):
            continue
        for e in json.load(open(p, encoding='utf-8'))['races']:
            n = e.get('nome', '')
            if not NAME_OK.search(n) or NAME_SKIP.search(n) or not e.get('url'):
                continue
            tot += 1
            h = fetch(e['url'])
            if not h:
                continue
            cron, rows = page_parts(h)
            champs = find_champions(cron, rows, n)
            for c in champs:
                found += 1
                cat = next(iter(e['categorie'].keys()), '')
                res.append({'y': y, 'id': e['id'], 'gara': n, 'data': e.get('data'), 'regione': e.get('regione') or '', 'cat': cat,
                            'pos': c['pos'], 'n': c['n'], 'team': c['team'], 'kind': c['kind'], 'reg': c['reg'], 'txt': c['text']})
        print(y, tot, found, flush=True)
    json.dump({'generated': time.strftime('%Y-%m-%d'), 'titles': res}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('gare esaminate', tot, 'titoli trovati', found)


if __name__ == '__main__':
    main()
