"""
Probe specifico: struttura pagina FCI con gestione encoding corretto
"""
import requests
from bs4 import BeautifulSoup
import re, sys

SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'Mozilla/5.0'

def get(url):
    r = SESSION.get(url, timeout=20)
    r.encoding = 'iso-8859-1'
    return BeautifulSoup(r.text, 'html.parser'), r.text

# ── 1. Pagina Juniores
print("=== JUNIORES PAGE ===")
soup, raw = get('https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm')
tables = soup.find_all('table')
h4s = soup.find_all('h4')
print(f"  Tabelle (=gare): {len(tables)}")
print(f"  H4 (=nomi gare): {len(h4s)}")

# Date trovate
dates = re.findall(r'\d{4}-\d{2}-\d{2}', raw)
print(f"  Date trovate: {len(set(dates))}, range: {min(dates) if dates else 'N/A'} -> {max(dates) if dates else 'N/A'}")

# Tutti i link
print("  Link trovati:")
for a in soup.find_all('a', href=True):
    txt = a.get_text(strip=True)
    href = a['href']
    if txt and len(txt) > 2:
        print(f"    [{txt[:50]}] -> {href[:80]}")

# ── 2. Homepage
print("\n=== HOMEPAGE risultati-strada ===")
soup2, raw2 = get('https://risultati-strada.federciclismo.it/')
dates2 = re.findall(r'\d{4}-\d{2}-\d{2}', raw2)
print(f"  Tabelle: {len(soup2.find_all('table'))}, H4: {len(soup2.find_all('h4'))}")
print(f"  Date: {len(set(dates2))}, range: {min(dates2) if dates2 else 'N/A'} -> {max(dates2) if dates2 else 'N/A'}")
print("  Link:")
for a in soup2.find_all('a', href=True):
    txt = a.get_text(strip=True)
    href = a['href']
    if txt and len(txt) > 2:
        print(f"    [{txt[:50]}] -> {href[:80]}")

# ── 3. Test URL archivio/anno/mese
print("\n=== TEST URL ALTERNATIVI ===")
test_urls = [
    'https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm?anno=2026&mese=02',
    'https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm?anno=2026',
    'https://risultati-strada.federciclismo.it/archivio/risultati_gare_juniores.htm',
    'https://risultati-strada.federciclismo.it/risultati_gare_juniores2026.htm',
    'https://risultati-strada.federciclismo.it/risultati_gare_juniores_2026.htm',
]
for url in test_urls:
    try:
        r = SESSION.get(url, timeout=8)
        dates_t = re.findall(r'\d{4}-\d{2}-\d{2}', r.text)
        tbls = len(BeautifulSoup(r.text,'html.parser').find_all('table'))
        print(f"  {r.status_code} | tab={tbls} | date={len(set(dates_t))} | {url[-60:]}")
    except Exception as e:
        print(f"  ERR | {url[-60:]}: {e}")

# ── 4. Check livello gara nel testo vicino a ogni tabella
print("\n=== LIVELLO GARA - KEYWORDS ===")
for kw in ['regionale', 'nazionale', 'internazionale', 'geo', 'livello', 'classe']:
    count = raw.lower().count(kw)
    if count > 0:
        idx = raw.lower().find(kw)
        ctx = raw[max(0,idx-150):idx+150]
        ctx_clean = re.sub(r'<[^>]+>', ' ', ctx)
        ctx_clean = re.sub(r'\s+', ' ', ctx_clean).strip()[:200]
        print(f"  [{kw}] x{count}: {ctx_clean}")

# ── 5. Testo raw attorno a un h4 (nome gara + contesto)
print("\n=== CONTEXT ATTORNO H4 ===")
for h4 in h4s[:3]:
    print(f"  H4: {h4.get_text()[:80]}")
    # Cerca testo nel parent del parent
    container = h4.parent
    for _ in range(4):
        if container is None: break
        txt = container.get_text(' ', strip=True)
        if re.search(r'\d{4}-\d{2}-\d{2}', txt):
            print(f"  CONTAINER({container.name}): {txt[:300]}")
            break
        container = container.parent
    print()

sys.stdout.flush()
