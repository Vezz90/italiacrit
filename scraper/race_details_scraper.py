import json
import os
import urllib.request
import urllib.parse
import ssl
import bs4
import re
import time
import signal
from pathlib import Path
from bs4 import BeautifulSoup
import unicodedata

# Timeout globale: interrompe lo script dopo MAX_SECONDS secondi
# così non può bloccare il job GitHub Actions oltre il necessario
MAX_SECONDS = 18 * 60  # 18 minuti

class _TimeoutError(Exception): pass

def _timeout_handler(signum, frame):
    raise _TimeoutError("Timeout globale raggiunto — dettagli parziali salvati")

# SIGALRM disponibile solo su Unix/Linux (GitHub Actions usa Ubuntu)
if hasattr(signal, 'SIGALRM'):
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(MAX_SECONDS)

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

def extract_field(text, *field_names):
    """Estrae il valore di un campo dal testo grezzo.
    Cerca 'NomeCampo: valore' e restituisce il valore fino al prossimo label noto.
    """
    ALL_LABELS = [
        'Luogo Ritrovo', 'Indirizzo Ritrovo', 'Orario Ritrovo',
        'Luogo Partenza', 'Orario Partenza', 'Luogo Arrivo', 'Orario Arrivo',
        'Luogo Verifica', 'Punto Incontro DS', 'Lunghezza KM',
        'Località', 'Provincia', 'Categoria', 'Indirizzo', 'CAP', 'Città',
        'Telefono', 'Email', 'Note', 'Descrizione', 'Organizzatore',
    ]
    for fname in field_names:
        pattern = rf'{re.escape(fname)}\s*:\s*(.+?)(?=' + '|'.join(re.escape(l + ':') for l in ALL_LABELS if l != fname) + r'|$)'
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if m:
            val = re.sub(r'\s+', ' ', m.group(1)).strip().rstrip('.,;')
            if val:
                return val
    return None


_geocode_cache = {}

def geocode_location(query):
    """Geocodifica con Nominatim (OSM). Restituisce (lat, lng) o (None, None)."""
    if not query:
        return None, None
    if query in _geocode_cache:
        return _geocode_cache[query]
    try:
        encoded = urllib.parse.quote(query)
        url = f"https://nominatim.openstreetmap.org/search?q={encoded}&countrycodes=it&format=json&limit=1"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'ItaliacritScraper/1.0 (ciclismo-agonistico)'
        })
        res = urllib.request.urlopen(req, context=ctx, timeout=8)
        data = json.loads(res.read().decode('utf-8'))
        if data:
            lat = round(float(data[0]['lat']), 5)
            lng = round(float(data[0]['lon']), 5)
            _geocode_cache[query] = (lat, lng)
            time.sleep(1.1)   # rispetta il rate-limit Nominatim (1 req/sec)
            return lat, lng
    except Exception as e:
        print(f"    [geocode] Errore per '{query}': {e}")
    _geocode_cache[query] = (None, None)
    return None, None


def extract_race_details(raceid):
    url = f"https://www.federciclismo.it/ricerca-gare/dettaglio-gara/?raceid={raceid}&site=strada_it"
    html = fetch_html(url)
    if not html: return None

    soup = BeautifulSoup(html, 'html.parser')
    main = soup.find('div', class_='main-content') or soup

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
            clean_block = re.sub(r'\s+', ' ', block).strip()
            if len(clean_block) > 10 and clean_block not in seen:
                seen.add(clean_block)
                info_utili.append(clean_block)

    # ── Estrai campi strutturati dal testo grezzo ─────────────────
    # Unisci tutti i blocchi in un unico testo per la ricerca dei campi
    full_text = ' '.join(info_utili)

    # Il "Luogo Ritrovo" è il punto di partenza della gara (start location)
    luogo_ritrovo   = extract_field(full_text, 'Luogo Ritrovo', 'Luogo Partenza', 'Luogo')
    indirizzo_ritrovo = extract_field(full_text, 'Indirizzo Ritrovo', 'Indirizzo')
    orario_partenza   = extract_field(full_text, 'Orario Partenza', 'Orario Ritrovo')
    km                = extract_field(full_text, 'Lunghezza KM')

    # Costruisci stringa per geocoding: "Via Roma 1, Comune, Italia"
    geo_parts = []
    if indirizzo_ritrovo:
        geo_parts.append(indirizzo_ritrovo)
    if luogo_ritrovo:
        geo_parts.append(luogo_ritrovo)
    geo_parts.append('Italia')
    location_str = ', '.join(geo_parts) if geo_parts[:-1] else None

    # ── Formatta HTML per display ─────────────────────────────────
    cleaned_info = []
    for blk in info_utili:
        if "BICIMPARO" in blk or "Twitter feed" in blk or "Retweet on Twitter" in blk:
            continue
        blk = blk.replace("Home / Ricerca Gare / Dettaglio Gara / Dettaglio Gara", "")
        blk = blk.replace("📅 AGGIUNGI QUESTA GARA AL CALENDARIO", "")

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
        "info": final_info,
        # Campi strutturati per la mappa
        "luogo_ritrovo":    luogo_ritrovo,
        "indirizzo_ritrovo": indirizzo_ritrovo,
        "orario_partenza":  orario_partenza,
        "km":               km,
        "location_str":     location_str,
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

    try:
        for c in calendar:
            cal_id = c["id"]
            c_date = c["data"]
            c_norm = robust_norm(c["nome"])

            existing = details_map.get(cal_id, {})

            # ── Scarica dettagli se non ci sono ancora ───────────
            if not existing.get("info"):
                fci_list = fci_races_map.get(c_date, [])
                best_match_id = None
                for (f_norm, f_id, f_nome) in fci_list:
                    if c_norm in f_norm or f_norm in c_norm:
                        best_match_id = f_id
                        break

                if best_match_id:
                    print(f"  Scraping dettagli per {c['nome']} (FCI: {best_match_id})")
                    data = extract_race_details(best_match_id)
                    if data:
                        details_map[cal_id] = data
                        existing = data
                    time.sleep(0.5)
                else:
                    print(f"  [!] Nessun match per: {c['nome']} in data {c_date}")

            # ── Geocoding: solo se mancano lat/lng ───────────────
            if existing and existing.get("location_str") and existing.get("lat") is None:
                loc = existing["location_str"]
                print(f"  Geocoding: {loc}")
                lat, lng = geocode_location(loc)
                if lat is not None:
                    details_map[cal_id]["lat"] = lat
                    details_map[cal_id]["lng"] = lng
                    print(f"    → {lat}, {lng}")
                else:
                    # Fallback: solo comune senza indirizzo
                    fallback = (existing.get("luogo_ritrovo") or "") + ", Italia"
                    lat, lng = geocode_location(fallback)
                    if lat is not None:
                        details_map[cal_id]["lat"] = lat
                        details_map[cal_id]["lng"] = lng
                        print(f"    → {lat}, {lng} (fallback comune)")
                    else:
                        details_map[cal_id]["lat"] = None
                        details_map[cal_id]["lng"] = None
    finally:
        # Salva sempre — anche se interrotto da timeout
        with open(DETAILS_FILE, 'w', encoding='utf-8') as f:
            json.dump(details_map, f, indent=2, ensure_ascii=False)
        print(f"Salvati dettagli per {len(details_map)} gare in {DETAILS_FILE}")

    # Salva file per categoria (subset del principale)
    cat_key_map = {
        'elite': [], 'juniores': [], 'allievi': [], 'esordienti': [], 'altri': []
    }
    for c in calendar:
        cal_id = c["id"]
        if cal_id not in details_map:
            continue
        cat_raw = (c.get("categoria") or "").lower()
        if "elite" in cat_raw:
            cat_key_map['elite'].append(cal_id)
        elif "junior" in cat_raw:
            cat_key_map['juniores'].append(cal_id)
        elif "alliev" in cat_raw:
            cat_key_map['allievi'].append(cal_id)
        elif "esordient" in cat_raw:
            cat_key_map['esordienti'].append(cal_id)
        else:
            cat_key_map['altri'].append(cal_id)

    for cat_key, ids in cat_key_map.items():
        if not ids:
            continue
        subset = {i: details_map[i] for i in ids if i in details_map}
        cat_file = DATA_DIR / f"race_details_{cat_key}.json"
        with open(cat_file, 'w', encoding='utf-8') as f:
            json.dump(subset, f, indent=2, ensure_ascii=False)
        print(f"  {cat_key}: {len(subset)} gare → {cat_file.name}")

if __name__ == "__main__":
    try:
        scrape_all_details()
    except _TimeoutError as e:
        print(f"\n[WARNING] {e} — uscita pulita, i dati parziali sono stati salvati.")
    except Exception as e:
        print(f"\n[ERROR] Errore non gestito: {e}")
        raise
