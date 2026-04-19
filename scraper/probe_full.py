"""
Probe completo: struttura pagine FCI per trovare
1. Tutte le gare dall'inizio della stagione (febbraio+)
2. Come FCI distingue il livello (regionale/nazionale/internazionale)
"""
import requests
from bs4 import BeautifulSoup
import re

SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

def get(url):
    r = SESSION.get(url, timeout=20)
    r.encoding = 'iso-8859-1'
    return BeautifulSoup(r.text, 'html.parser'), r.text

# ── 1. Quante gare sulla pagina Juniores? Cerca paginazione
print("=== JUNIORES PAGE ===")
soup, raw = get('https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm')
tables = soup.find_all('table')
h4s = soup.find_all('h4')
print(f"  Tabelle (=gare): {len(tables)}")
print(f"  H4 (=nomi gare): {len(h4s)}")

# Cerca link paginazione o archivio
for a in soup.find_all('a', href=True):
    href = a['href']
    txt = a.get_text(strip=True)
    if any(k in (href+txt).lower() for k in ['archiv', 'precedent', 'older', 'page', 'tutte', 'storia']):
        print(f"  LINK ARCHIVIO: [{txt}] -> {href}")

# Cerca link alle gare dei mesi precedenti
print("\n  Tutti i link trovati:")
for a in soup.find_all('a', href=True):
    href = a['href']
    txt = a.get_text(strip=True)
    if txt and len(txt) > 2:
        print(f"    [{txt[:50]}] -> {href[:80]}")

# ── 2. Homepage risultati (TUTTE LE CATEGORIE)
print("\n=== HOMEPAGE risultati-strada ===")
soup2, raw2 = get('https://risultati-strada.federciclismo.it/')
tables2 = soup2.find_all('table')
h4s2 = soup2.find_all('h4')
print(f"  Tabelle: {len(tables2)}, H4: {len(h4s2)}")

# Date trovate
dates = re.findall(r'\d{4}-\d{2}-\d{2}', raw2)
print(f"  Date trovate: {len(dates)}, prima: {min(dates) if dates else 'N/A'}, ultima: {max(dates) if dates else 'N/A'}")

# ── 3. Prova URL con parametro anno o mese
print("\n=== PROVA URL CON PARAMETRI ===")
test_urls = [
    'https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm?anno=2026',
    'https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm?mese=02',
    'https://risultati-strada.federciclismo.it/archivio/',
    'https://risultati-strada.federciclismo.it/risultati_gare_juniores_archivio.htm',
]
for url in test_urls:
    try:
        r = SESSION.get(url, timeout=10)
        r.encoding = 'iso-8859-1'
        soup_t = BeautifulSoup(r.text, 'html.parser')
        dates_t = re.findall(r'\d{4}-\d{2}-\d{2}', r.text)
        tbls = soup_t.find_all('table')
        print(f"  {url[-60:]}: status={r.status_code}, tabelle={len(tbls)}, date={len(dates_t)}")
    except Exception as e:
        print(f"  {url[-60:]}: ERRORE {e}")

# ── 4. FCI Calendario - prova con requests (potrebbe essere statico)
print("\n=== FCI CALENDARIO (requests) ===")
for geo_cat, tipo in [(1,'regionale'), (2,'nazionale'), (3,'internazionale')]:
    url = f'https://www.federciclismo.it/ricerca-gare/?site=strada_it&mese=02&geo_category={geo_cat}'
    try:
        r = SESSION.get(url, timeout=15)
        r.encoding = 'iso-8859-1'
        dates_c = re.findall(r'\d{1,2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2}', r.text)
        print(f"  [{tipo}] status={r.status_code}, len={len(r.text)}, date_nel_html={len(dates_c)}")
        if len(r.text) > 500:
            # Cerca nomi di gare nel testo
            soup_c = BeautifulSoup(r.text, 'html.parser')
            txt = soup_c.get_text()[:500].replace('\n',' ')
            print(f"    Testo: {txt[:200]}")
    except Exception as e:
        print(f"  [{tipo}]: ERRORE {e}")

# ── 5. Dentro ogni tabella JUN: cerca descrizione livello gara
print("\n=== LIVELLO GARA NELLA PAGINA ===")
soup3, raw3 = get('https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm')
# Cerca parole chiave di livello nel testo raw
for kw in ['regionale', 'nazionale', 'internazionale', 'geo_cat', 'categoria_gara', 'livello']:
    count = raw3.lower().count(kw)
    if count > 0:
        # Mostra contesto
        idx = raw3.lower().find(kw)
        ctx = raw3[max(0,idx-100):idx+100]
        ctx = re.sub(r'<[^>]+>', ' ', ctx).strip()[:120]
        print(f"  [{kw}] x{count}: ...{ctx}...")
