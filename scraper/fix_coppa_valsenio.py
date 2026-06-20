"""
Fix per la gara JUNIORES_2026-06-21 = 70ª COPPA VALSENIO JUNIORES
Fetcha i dati FCI per raceid=179765, aggiorna race_details.json e calendar.json.
"""
import json, sys, re, ssl, urllib.request, urllib.parse
from pathlib import Path
from bs4 import BeautifulSoup

DATA_DIR = Path(__file__).parent.parent / "data"
DETAILS_FILE = DATA_DIR / "race_details.json"
CALENDAR_FILE = DATA_DIR / "calendar.json"
CAL_KEY = "JUNIORES_2026-06-21"
RACEID = "179765"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    res = urllib.request.urlopen(req, context=ctx, timeout=15)
    return res.read().decode('utf-8', errors='replace')

def extract_field(text, *names):
    ALL = ['Luogo Ritrovo','Indirizzo Ritrovo','Orario Ritrovo','Luogo Partenza','Orario Partenza',
           'Luogo Arrivo','Orario Arrivo','Luogo Verifica','Punto Incontro DS','Lunghezza KM',
           'Localita','Provincia','Categoria','Indirizzo','CAP','Citta','Telefono','Email',
           'Note','Descrizione','Organizzatore']
    for fname in names:
        pattern = rf'{re.escape(fname)}\s*:\s*(.+?)(?=' + '|'.join(re.escape(l + ':') for l in ALL if l != fname) + r'|$)'
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if m:
            val = re.sub(r'\s+', ' ', m.group(1)).strip().rstrip('.,;')
            if val:
                return val
    return None

url = f"https://www.federciclismo.it/ricerca-gare/dettaglio-gara/?raceid={RACEID}&site=strada_it"
print(f"Fetching {url} ...")
html = fetch(url)
soup = BeautifulSoup(html, 'html.parser')
main = soup.find('div', class_='main-content') or soup

testo_completo = []
for row in main.find_all(['li', 'p']):
    text = row.get_text(" ", strip=True).replace("\n", " ")
    if text and len(text) > 3:
        testo_completo.append(text)
for div in main.find_all('div', class_=re.compile('col-')):
    text = div.get_text(" ", strip=True).replace("\n", " ")
    if text and len(text) > 3:
        testo_completo.append(text)

keywords = ["Ritrovo","Partenza","Arrivo","Verifica","Descrizione","Lunghezza","Iscrizioni","Organizzatore","Email","Telefono","Localita","Categoria"]
info_utili = []
seen = set()
for block in testo_completo:
    if any(k.lower() in block.lower() for k in keywords):
        clean = re.sub(r'\s+', ' ', block).strip()
        if len(clean) > 10 and clean not in seen:
            seen.add(clean)
            info_utili.append(clean)

# Anche raccogliere i blocchi h1/h2 per estrarre il nome gara
title_tags = main.find_all(['h1','h2','h3'])
title_texts = [t.get_text(" ", strip=True) for t in title_tags if t.get_text(" ", strip=True)]
print("Titoli trovati:", title_texts[:5])

full_text = ' '.join(info_utili)
luogo_ritrovo     = extract_field(full_text, 'Luogo Ritrovo', 'Luogo Partenza')
indirizzo_ritrovo = extract_field(full_text, 'Indirizzo Ritrovo', 'Indirizzo')
orario_partenza   = extract_field(full_text, 'Orario Partenza', 'Orario Ritrovo')
km                = extract_field(full_text, 'Lunghezza KM')

print(f"luogo_ritrovo: {luogo_ritrovo}")
print(f"indirizzo_ritrovo: {indirizzo_ritrovo}")
print(f"km: {km}")

labels = ['Localita:','Provincia:','Categoria:','Categorie Ammesse:','Categoria Geografica:',
          'Tipo di Gara:','Tipo di Programma:','Direttore di Corsa:','Approvazione:',
          'Nome:','Indirizzo:','CAP:','Citta:','Telefono:','Email:','Luogo:',
          'Iscrizioni Dal - Al:','Tipo:','Prova:','Data:','Descrizione:',
          'Luogo Ritrovo:','Indirizzo Ritrovo:','Orario Ritrovo:','Luogo Partenza:',
          'Orario Partenza:','Luogo Arrivo:','Orario Arrivo:','Luogo Verifica:',
          'Punto Incontro DS:','Lunghezza KM:','Note:']
cleaned_info = []
for blk in info_utili:
    if "BICIMPARO" in blk or "Twitter" in blk:
        continue
    blk = blk.replace("Home / Ricerca Gare / Dettaglio Gara / Dettaglio Gara", "")
    blk = blk.replace("📅 AGGIUNGI QUESTA GARA AL CALENDARIO", "")
    for lbl in labels:
        blk = re.sub(rf'\b({re.escape(lbl)})', r'<br><b>\1</b>', blk)
    blk = re.sub(r'<br>\s*<br>', '<br>', blk)
    blk = blk.strip()
    if blk:
        cleaned_info.append(blk)

if cleaned_info:
    final_info = [max(cleaned_info, key=len)]
else:
    # fallback: dump raw
    raw = main.get_text(" ", strip=True)[:3000]
    final_info = [raw]

# Cerca il nome gara nel titolo della pagina o nell'ID-gara block
nome_gara = None
id_block = main.get_text(" ", strip=True)
m = re.search(r'ID Gara:\s*' + re.escape(RACEID) + r'\s*\|?\s*([^\n<|]+)', id_block)
if m:
    nome_gara = m.group(1).strip()
print(f"nome_gara: {nome_gara}")

if not nome_gara:
    # prova nei title_texts
    for t in title_texts:
        if RACEID in t or 'VALSENIO' in t.upper() or 'COPPA' in t.upper():
            nome_gara = t
            break

detail_entry = {
    "raceid": RACEID,
    "fci_url": url,
    "info": final_info,
    "luogo_ritrovo": luogo_ritrovo,
    "indirizzo_ritrovo": indirizzo_ritrovo,
    "orario_partenza": orario_partenza,
    "km": km,
    "location_str": f"{indirizzo_ritrovo}, {luogo_ritrovo}, Italia" if indirizzo_ritrovo and luogo_ritrovo else (luogo_ritrovo + ", Italia" if luogo_ritrovo else None),
}
if nome_gara:
    detail_entry["nome_gara"] = nome_gara

# Update race_details.json
print(f"\nAggiorno {DETAILS_FILE} ...")
with open(DETAILS_FILE, 'r', encoding='utf-8') as f:
    details = json.load(f)

details[CAL_KEY] = detail_entry

with open(DETAILS_FILE, 'w', encoding='utf-8') as f:
    json.dump(details, f, ensure_ascii=False, indent=2)
print("race_details.json aggiornato.")

# Update calendar.json nome if we found the real name
if nome_gara:
    print(f"\nAggiorno calendar.json (nome: {nome_gara}) ...")
    cal_season_file = DATA_DIR / "seasons" / "2026" / "calendar.json"
    cal_file = DATA_DIR / "calendar.json"
    for cf in [cal_season_file, cal_file]:
        if cf.exists():
            with open(cf, 'r', encoding='utf-8') as f:
                cal = json.load(f)
            updated = False
            for entry in cal:
                if entry.get('id') == CAL_KEY:
                    old_nome = entry.get('nome', '')
                    entry['nome'] = nome_gara
                    print(f"  {cf}: nome '{old_nome}' → '{nome_gara}'")
                    updated = True
                    break
            if updated:
                with open(cf, 'w', encoding='utf-8') as f:
                    json.dump(cal, f, ensure_ascii=False, indent=2)
                print(f"  {cf} salvato.")
else:
    print("\nnome_gara non trovato automaticamente. Puoi aggiornarlo manualmente.")

print("\nFatto!")
