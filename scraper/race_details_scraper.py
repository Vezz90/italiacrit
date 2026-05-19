import json
import os
import urllib.request
import ssl
import bs4
import re
import time
from pathlib import Path
from bs4 import BeautifulSoup
import unicodedata

# ----------------- CONFIGURAZIONE -----------------
DATA_DIR = Path(__file__).parent.parent / "data"
CALENDAR_FILE = DATA_DIR / "calendar.json"
DETAILS_FILE = DATA_DIR / "race_details.json"
YEAR = 2026

# Disabilita verifica SSL
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch_html(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        res = urllib.request.urlopen(req, context=ctx, timeout=15)
        return res.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def robust_norm(s):
    if not s: return ""
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\'", " ", s)
    s = re.sub(r"[^a-z0-9]", " ", s)
    s = re.sub(r"\b(di|del|della|dei|delle|da|in|con|su|per|tra|fra|il|lo|la|i|gli|le|un|uno|una|gp|g p|gran premio|memorial|trofeo|coppa)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def extract_race_details(raceid):
    url = f"https://www.federciclismo.it/ricerca-gare/dettaglio-gara/?raceid={raceid}&site=strada_it"
    html = fetch_html(url)
    if not html: return None
    
    soup = BeautifulSoup(html, 'html.parser')
    main = soup.find('div', class_='main-content') or soup
    
    details = {}
    
    # Raccogliamo i blocchi principali
    testo_completo = []
    
    for row in main.find_all(['li', 'p']):
        text = row.get_text(" ", strip=True).replace("\n", " ")
        if text and len(text) > 3:
            testo_completo.append(text)
            
    for div in main.find_all('div', class_=re.compile('col-')):
        text = div.get_text(" ", strip=True).replace("\n", " ")
        if text and len(text) > 3:
            testo_completo.append(text)
            
    # Filtriamo e raggruppiamo i blocchi di interesse
    keywords = ["Ritrovo", "Partenza", "Arrivo", "Verifica", "Descrizione:", "Lunghezza KM", "Iscrizioni", "Organizzatore", "Email", "Telefono"]
    
    info_utili = []
    seen = set()
    for block in testo_completo:
        if any(k.lower() in block.lower() for k in keywords):
            # Puliamo doppi spazi
            clean_block = re.sub(r'\s+', ' ', block).strip()
            # Rimuoviamo blocchi enormi spazzatura
            if len(clean_block) > 10 and clean_block not in seen:
                seen.add(clean_block)
                info_utili.append(clean_block)
                
    # Uniamo tutte le info in un formato leggibile
    # Filtro social e spazzatura
    cleaned_info = []
    for blk in info_utili:
        if "BICIMPARO" in blk or "Twitter feed" in blk or "Retweet on Twitter" in blk:
            continue
        blk = blk.replace("Home / Ricerca Gare / Dettaglio Gara / Dettaglio Gara", "")
        blk = blk.replace("📅 AGGIUNGI QUESTA GARA AL CALENDARIO", "")
        
        # Inserisci <b> prima dei label noti
        labels = [
            'Località:', 'Provincia:', 'Categoria:', 'Categorie Ammesse:', 'Categoria Geografica:',
            'Specifica Gara:', 'Tipo di Gara:', 'Tipo di Programma:', 'Direttore di Corsa:', 
            'Vice Direttore di Corsa:', 'Approvazione:', 'Nome:', 'Indirizzo:', 'CAP:', 'Città:', 
            'Telefono:', 'Email:', 'Luogo:', 'Iscrizioni Dal - Al:', 'Tipo:', 'Prova:', 'Data:', 
            'Descrizione:', 'Luogo Ritrovo:', 'Indirizzo Ritrovo:', 'Orario Ritrovo:', 
            'Luogo Partenza:', 'Orario Partenza:', 'Luogo Arrivo:', 'Orario Arrivo:', 
            'Luogo Verifica:', 'Punto Incontro DS:', 'Lunghezza KM:', 'Note:'
        ]
        
        for lbl in labels:
            blk = re.sub(rf'\b({lbl})', r'<br><b>\1</b>', blk)
            
        blk = re.sub(r'<br>\s*<br>', '<br>', blk)
        cleaned_info.append(blk.strip())

    if cleaned_info:
        best_block = max(cleaned_info, key=len)
        final_info = [best_block]
    else:
        final_info = []

    return {
        "raceid": raceid,
        "fci_url": url,
        "info": final_info
    }

def scrape_all_details():
    if not CALENDAR_FILE.exists():
        print("Calendar file not found!")
        return

    with open(CALENDAR_FILE, 'r', encoding='utf-8') as f:
        calendar = json.load(f)

    # 1. Estrarre tutti i mesi presenti nel calendario
    mesi_da_cercare = set()
    for c in calendar:
        mesi_da_cercare.add(int(c["data"].split("-")[1]))

    # 2. Mappare race_id per ogni mese
    fci_races_map = {} # (data_iso, norm_name) -> raceid
    print("Cerco raceid sul sito FCI...")
    for mese in sorted(mesi_da_cercare):
        print(f"  -> Mese {mese:02d}...")
        for pagina in range(1, 50):
            url = f"https://www.federciclismo.it/ricerca-gare/?site=strada_it&mese={mese:02d}&anno2={YEAR}&pagina={pagina}"
            html = fetch_html(url)
            if not html: break
            
            soup = BeautifulSoup(html, 'html.parser')
            races_divs = soup.find_all('div', class_='wp-race-info')
            if not races_divs:
                break
                
            for race in races_divs:
                onclick = race.get('onclick', '')
                m_id = re.search(r'raceid=(\d+)', onclick)
                if not m_id: continue
                raceid = m_id.group(1)
                
                date_div = race.find('div', class_='wp-race-date')
                if not date_div: continue
                date_str = date_div.get_text(strip=True).lower()
                
                mesi_ita = {"gennaio": "01", "febbraio": "02", "marzo": "03", "aprile": "04", "maggio": "05", "giugno": "06", "luglio": "07", "agosto": "08", "settembre": "09", "ottobre": "10", "novembre": "11", "dicembre": "12"}
                for m_ita, m_num in mesi_ita.items():
                    if m_ita in date_str:
                        date_str = date_str.replace(m_ita, " " + m_num + " ")
                        break
                parts = re.findall(r'\d+', date_str)
                if len(parts) >= 3:
                    data_iso = f"20{parts[2][-2:]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
                else:
                    continue
                    
                name_span = race.find('span', class_='wp-race-details')
                nome = name_span.get_text(strip=True) if name_span else ""
                norm_n = robust_norm(nome)
                
                if data_iso not in fci_races_map:
                    fci_races_map[data_iso] = []
                fci_races_map[data_iso].append((norm_n, raceid, nome))

    # 3. Match races and fetch details
    print("Match e download dettagli...")
    details_map = {}
    if DETAILS_FILE.exists():
        with open(DETAILS_FILE, 'r', encoding='utf-8') as f:
            details_map = json.load(f)

    for c in calendar:
        cal_id = c["id"]
        c_date = c["data"]
        c_norm = robust_norm(c["nome"])
        
        # Evita di riscaricare se c'è già (commentalo per forzare il refresh)
        if cal_id in details_map and details_map[cal_id].get("info"):
            continue
            
        fci_list = fci_races_map.get(c_date, [])
        best_match_id = None
        
        # Exact/Substring match
        for (f_norm, f_id, f_nome) in fci_list:
            if c_norm in f_norm or f_norm in c_norm:
                best_match_id = f_id
                break
                
        if best_match_id:
            print(f"  Scraping dettagli per {c['nome']} (FCI: {best_match_id})")
            data = extract_race_details(best_match_id)
            if data:
                details_map[cal_id] = data
            time.sleep(0.5)
        else:
            print(f"  [!] Nessun match per: {c['nome']} in data {c_date}")

    # Salva
    with open(DETAILS_FILE, 'w', encoding='utf-8') as f:
        json.dump(details_map, f, indent=2, ensure_ascii=False)
    print(f"Salvati dettagli per {len(details_map)} gare in {DETAILS_FILE}")

if __name__ == "__main__":
    scrape_all_details()
