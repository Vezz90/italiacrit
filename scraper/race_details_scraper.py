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

# Stessa identica funzione di calendar_scraper.py (id gara di base) — usata
# qui per costruire gli id delle tappe divise ESATTAMENTE come li costruisce
# in autonomia fci_complete_scraper.py per i risultati (gara_id =
# slug(nome_gara_come_appare_nella_pagina_risultati) + "_" + data + "_" +
# cat_code, vedi quel file riga ~416) — i due scraper non si parlano fra
# loro, quindi l'UNICO modo perché "62° Giro ... - 1a tappa" (calendario)
# e "62 GIRO ... PRIMA TAPPA" (risultati FCI) puntino allo stesso id è
# generare il nome delle tappe divise usando la STESSA convenzione italiana
# a parole (PRIMA/SECONDA/TERZA TAPPA, CLASSIFICA GENERALE) che FCI usa
# nativamente sulla pagina risultati — non un nostro schema inventato
# (_TAPPA1/_TAPPA2), che non avrebbe mai potuto combaciare. Bug reale,
# segnalato dal vivo dall'utente: la tappa 1 del Giro del FVG (2026-09-03)
# aveva già i risultati veri sotto l'id FCI nativo, ma la card 'gara di
# oggi' del sito continuava a mostrarla come 'senza risultati' perché
# cercava un id (_TAPPA1) che i risultati non usano.
def _slug(s):
    if not s: return "SCONOSCIUTO"
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]", " ", s)
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

# Ordinali italiani in lettere, stesso stile usato da FCI sulla pagina
# risultati ("PRIMA TAPPA", "SECONDA TAPPA", ... "CLASSIFICA GENERALE" per
# l'ultima) — coprono fino a 20 tappe, più che sufficiente per qualunque
# giro a tappe del calendario FCI.
_ORDINALI_IT = [
    'PRIMA', 'SECONDA', 'TERZA', 'QUARTA', 'QUINTA', 'SESTA', 'SETTIMA', 'OTTAVA', 'NONA', 'DECIMA',
    'UNDICESIMA', 'DODICESIMA', 'TREDICESIMA', 'QUATTORDICESIMA', 'QUINDICESIMA',
    'SEDICESIMA', 'DICIASSETTESIMA', 'DICIOTTESIMA', 'DICIANNOVESIMA', 'VENTESIMA',
]
def _ordinale_it(n):
    return _ORDINALI_IT[n - 1] if 1 <= n <= len(_ORDINALI_IT) else f"{n}ª"

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


def _parse_date_ddmmyyyy(s):
    """'03/09/2026' -> '2026-09-03'. Ritorna None se non riconosciuto."""
    if not s: return None
    m = re.search(r'(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})', s)
    if not m: return None
    g, mese, a = m.groups()
    return f"{a}-{mese.zfill(2)}-{g.zfill(2)}"

def _tabella_kv(table):
    """Estrae {label: value} da una <table class="race-table"><tbody><tr><td class="label">X:</td><td class="value">Y</td></tr>...</tbody></table>."""
    out = {}
    for tr in table.find_all('tr'):
        tds = tr.find_all('td')
        if len(tds) < 2: continue
        label = tds[0].get_text(" ", strip=True).rstrip(':').strip()
        value = tds[1].get_text(" ", strip=True).strip()
        if label:
            out[label] = value
    return out

def extract_stages(soup):
    """Estrae la sezione 'PROVE' (tappe) della pagina dettaglio-gara, quando
    presente (gare a tappe) — una <table class="race-table"> per tappa,
    ognuna con Prova/Data/Tipo/Descrizione/Luogo Ritrovo-Partenza-Arrivo/
    Orari/Lunghezza KM. Assente per le gare in linea (single-day).
    Ritorna una lista ordinata per numero di prova, o [] se non è una gara
    a tappe (o la sezione non è ancora pubblicata da FCI per questa gara).
    """
    title = None
    for div in soup.find_all('div', class_='race-section-title'):
        if div.get_text(strip=True).upper() == 'PROVE':
            title = div
            break
    if not title: return []

    section = title.find_parent('section') or title.parent
    stages = []
    for table in section.find_all('table', class_='race-table'):
        kv = _tabella_kv(table)
        numero_raw = kv.get('Prova')
        try:
            numero = int(re.search(r'\d+', numero_raw or '').group())
        except Exception:
            continue
        data_iso = _parse_date_ddmmyyyy(kv.get('Data'))
        if not data_iso: continue
        stages.append({
            'numero':            numero,
            'tipo':              kv.get('Tipo'),
            'data':              data_iso,
            'descrizione':       kv.get('Descrizione'),
            'luogo_ritrovo':     kv.get('Luogo Ritrovo'),
            'indirizzo_ritrovo': kv.get('Indirizzo Ritrovo'),
            'orario_ritrovo':    kv.get('Orario Ritrovo'),
            'luogo_partenza':    kv.get('Luogo Partenza'),
            'orario_partenza':   kv.get('Orario Partenza'),
            'luogo_arrivo':      kv.get('Luogo Arrivo'),
            'orario_arrivo':     kv.get('Orario Arrivo'),
            'km':                kv.get('Lunghezza KM'),
        })
    stages.sort(key=lambda s: s['numero'])
    return stages

def extract_race_details(raceid):
    url = f"https://www.federciclismo.it/ricerca-gare/dettaglio-gara/?raceid={raceid}&site=strada_it"
    html = fetch_html(url)
    if not html: return None

    soup = BeautifulSoup(html, 'html.parser')
    main = soup.find('div', class_='main-content') or soup
    tappe = extract_stages(soup)

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
        # Sezione "PROVE" — presente solo per le gare a tappe (vedi
        # extract_stages). Usata da split_stage_races per dividere la gara
        # in un documento per tappa + uno per la classifica generale.
        "tappe": tappe,
    }

def _stage_info_html(parent_nome, stage):
    """Blocco HTML per la pagina di una singola tappa — stesso stile/label
    già usato altrove (extract_race_details), così la pagina gara la
    renderizza senza bisogno di codice frontend dedicato."""
    labels = [
        ('Tipo', stage.get('tipo')),
        ('Data', stage.get('data')),
        ('Descrizione', stage.get('descrizione')),
        ('Luogo Ritrovo', stage.get('luogo_ritrovo')),
        ('Indirizzo Ritrovo', stage.get('indirizzo_ritrovo')),
        ('Orario Ritrovo', stage.get('orario_ritrovo')),
        ('Luogo Partenza', stage.get('luogo_partenza')),
        ('Orario Partenza', stage.get('orario_partenza')),
        ('Luogo Arrivo', stage.get('luogo_arrivo')),
        ('Orario Arrivo', stage.get('orario_arrivo')),
        ('Lunghezza KM', stage.get('km')),
    ]
    parts = [f"{parent_nome} — {stage['numero']}ª tappa"]
    for lbl, val in labels:
        if val:
            parts.append(f"<br><b>{lbl}:</b> {val}")
    return [''.join(parts)]

def _gc_info_html(parent_nome, parent_detail, tappe):
    prima = tappe[0]['data'] if tappe else None
    ultima = tappe[-1]['data'] if tappe else None
    parts = [f"{parent_nome} — Classifica Generale"]
    if prima and ultima:
        parts.append(f"<br><b>Copre le tappe dal:</b> {prima} <b>al:</b> {ultima}")
    parts.append(f"<br><b>Numero di tappe:</b> {len(tappe)}")
    return [''.join(parts)]

def split_stage_races(calendar, details_map):
    """Divide ogni gara a tappe (rilevata dalla presenza di 'tappe' nel suo
    record dettagli) in N documenti separati (uno per tappa, ognuno con la
    propria data reale) più uno per la Classifica Generale — così l'admin
    può inserire i risultati di UNA tappa specifica anche prima che lo
    scraper dei risultati passi, e i risultati scrapati (che riportano la
    data della singola tappa, non quella d'inizio gara) si abbinano alla
    tappa giusta invece di finire tutti sprecati sull'unico giorno iniziale.

    La gara combinata originale (l'unico documento con la data della 1a
    tappa) viene rimossa dal calendario finale — resta solo nella cache
    details_map (chiave = id originale) per evitare di ri-scaricare la
    pagina FCI ad ogni giro. Idempotente e ricalcolato da zero ad ogni
    esecuzione: fci_complete_scraper.py rigenera calendar.json con la gara
    ancora "unica" ogni 30 minuti, quindi qui si riparte sempre dalla forma
    base, non da uno stato già diviso in precedenza.

    Applica SOLO alle gare i cui dettagli sono già stati scaricati e
    contengono 'tappe' (decisione con l'utente 2026-09-03: nessun tentativo
    di dividere retroattivamente gare passate già scrapate come gara unica).
    """
    out_calendar = []
    out_details = dict(details_map)  # tiene anche gli id base, come cache
    split_count = 0

    for c in calendar:
        cal_id = c['id']
        det = details_map.get(cal_id)
        tappe = det.get('tappe') if det else None
        # Una sola "Prova" nella sezione PROVE di FCI NON è una gara a tappe
        # vera — è solo il modo in cui FCI rappresenta anche una gara in
        # linea di un giorno solo. Dividerla avrebbe comunque creato un
        # doppione insensato "1ª tappa" + "Classifica Generale" della STESSA
        # identica gara (segnalato dal vivo dall'utente sul 28° Trofeo San
        # Rocco, 2026-09-03). Serve almeno 2 prove per essere davvero a tappe.
        if not tappe or len(tappe) < 2:
            out_calendar.append(c)
            continue

        split_count += 1
        base_fields = {k: c.get(k) for k in
                        ('tipo', 'moltiplicatore', 'campionato_regionale',
                         'campionato_italiano', 'regione', 'categoria', 'luogo')}

        for stage in tappe:
            # Stesso nome/id che assegnerebbe fci_complete_scraper.py quando
            # troverà i risultati di questa tappa — vedi commento su _slug()
            # in cima al file. NON usare un trattino o un numero (es. "-  1a
            # tappa"): deve essere la stessa sequenza di parole, altrimenti
            # lo slug non combacia più.
            stage_nome = f"{c['nome']} {_ordinale_it(stage['numero'])} TAPPA"
            stage_id = f"{_slug(stage_nome)}_{stage['data']}"
            out_calendar.append({
                'id': stage_id,
                'nome': stage_nome,
                'data': stage['data'],
                **base_fields,
            })
            out_details[stage_id] = {
                **det,
                'raceid': det.get('raceid'),
                'info': _stage_info_html(c['nome'], stage),
                'luogo_ritrovo': stage.get('luogo_ritrovo') or det.get('luogo_ritrovo'),
                'indirizzo_ritrovo': stage.get('indirizzo_ritrovo') or det.get('indirizzo_ritrovo'),
                'orario_partenza': stage.get('orario_partenza') or det.get('orario_partenza'),
                'km': stage.get('km') or det.get('km'),
                'tappe': [],  # una singola tappa non è a sua volta una gara a tappe
                # Posizione geografica ricalcolata al prossimo giro di
                # geocoding (lat/lng assenti finché non serve il fallback
                # sul luogo_ritrovo di QUESTA tappa, diverso da quello della
                # gara madre — vedi geocode_location più sotto).
                'lat': None, 'lng': None, 'location_str': None,
            }

        gc_nome = f"{c['nome']} CLASSIFICA GENERALE"
        gc_id = f"{_slug(gc_nome)}_{tappe[-1]['data']}"
        ultima_data = tappe[-1]['data']
        out_calendar.append({
            'id': gc_id,
            'nome': gc_nome,
            'data': ultima_data,
            **{**base_fields, 'moltiplicatore': (base_fields.get('moltiplicatore') or 1) + 1},
        })
        out_details[gc_id] = {
            **det,
            'info': _gc_info_html(c['nome'], det, tappe),
            'tappe': [],
        }

    if split_count:
        print(f"  {split_count} gare a tappe divise in documenti separati (tappe + classifica generale)")
    return out_calendar, out_details

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
            # Migrazione una tantum: i record già in cache PRIMA di
            # extract_stages() (commit 86810a1c) non hanno mai la chiave
            # 'tappe', quindi split_stage_races() non li dividerebbe mai —
            # anche se sono davvero gare a tappe — perché qui si salta il
            # ri-fetch quando "info" è già presente. Forza un ri-fetch (una
            # volta sola: dopo, 'tappe' esiste sempre, anche se vuota per le
            # gare in linea) SOLO per le gare non ancora passate, per non
            # rifare inutilmente ~1400 richieste su gare già concluse (e per
            # non toccare gare a tappe passate già scrapate come documento
            # unico, come deciso con l'utente il 2026-09-03).
            today_iso = time.strftime('%Y-%m-%d')
            needs_migration = 'tappe' not in existing and c_date >= today_iso
            if not existing.get("info") or needs_migration:
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
        # Salva sempre — anche se interrotto da timeout — la forma NON
        # ancora divisa: è la cache usata per evitare di riscaricare la
        # pagina FCI ad ogni giro (vedi "existing.get('info')" sopra), deve
        # restare indicizzata per id ORIGINALE per continuare a fare match.
        with open(DETAILS_FILE, 'w', encoding='utf-8') as f:
            json.dump(details_map, f, indent=2, ensure_ascii=False)
        print(f"Salvati dettagli per {len(details_map)} gare in {DETAILS_FILE}")

    # ── Divide le gare a tappe in documenti separati ──────────────────
    # Ricalcolato da zero ogni volta (vedi split_stage_races) — da qui in
    # poi 'calendar'/'details_map' sono la forma FINALE, con le tappe già
    # separate, usata per calendar.json/race_details*.json pubblicati.
    calendar, details_map = split_stage_races(calendar, details_map)
    with open(CALENDAR_FILE, 'w', encoding='utf-8') as f:
        json.dump(calendar, f, indent=2, ensure_ascii=False)
    with open(DETAILS_FILE, 'w', encoding='utf-8') as f:
        json.dump(details_map, f, indent=2, ensure_ascii=False)
    print(f"Calendario finale (post-divisione tappe): {len(calendar)} gare in {CALENDAR_FILE}")

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
