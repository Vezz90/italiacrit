import requests
from bs4 import BeautifulSoup
import re
import unicodedata
import time

def slug(s):
    if not s: return "SCONOSCIUTO"
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]", " ", s)
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

MESI_ITA = {
    "gennaio": "01", "febbraio": "02", "marzo": "03", "aprile": "04",
    "maggio": "05", "giugno": "06", "luglio": "07", "agosto": "08",
    "settembre": "09", "ottobre": "10", "novembre": "11", "dicembre": "12"
}

def parse_date(date_str):
    date_str = date_str.lower().strip()
    for m_ita, m_num in MESI_ITA.items():
        if m_ita in date_str:
            date_str = date_str.replace(m_ita, " " + m_num + " ")
            break
    parts = re.findall(r'\d+', date_str)
    if len(parts) >= 3:
        g = parts[0].zfill(2)
        m = parts[1].zfill(2)
        a = parts[2]
        if len(a) == 2: a = "20" + a
        return f"{a}-{m}-{g}"
    return ""

def scrape_calendar_fci(year=2026):
    calendar = []
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    
    geo_map = {
        1: ("internazionale", 3),
        2: ("nazionale", 2),
        3: ("regionale", 1)
    }
    
    print("--- INIZIO SCRAPING CALENDARIO FCI ---")
    for mese in range(1, 13):
        for geo, (tipo, mult) in geo_map.items():
            pagina = 1
            while True:
                url = f"https://www.federciclismo.it/ricerca-gare/?site=strada_it&mese={mese:02d}&anno2={year}&geo_category={geo}&pagina={pagina}"
                try:
                    r = session.get(url, timeout=15)
                    soup = BeautifulSoup(r.text, 'html.parser')
                    races = soup.find_all('div', class_='wp-race-info')
                    if not races:
                        break # Fine pagine per questo mese/geo
                        
                    for race in races:
                        date_div = race.find('div', class_='wp-race-date')
                        date_str = date_div.get_text(strip=True) if date_div else ""
                        data_iso = parse_date(date_str)
                        if not data_iso: continue
                        
                        details_span = race.find('span', class_='wp-race-details')
                        nome = details_span.get_text(strip=True) if details_span else ""
                        
                        loc_div = race.find('div', class_='wp-race-location')
                        regione = ""
                        if loc_div:
                            b_tag = loc_div.find('b')
                            if b_tag:
                                regione = b_tag.get_text(strip=True).upper()
                                
                        is_cr = "campionato regionale" in nome.lower()
                        is_ci = "campionato italiano" in nome.lower()
                        
                        gara_id = f"{slug(nome)}_{data_iso}"
                        
                        calendar.append({
                            "id": gara_id,
                            "nome": nome,
                            "data": data_iso,
                            "tipo": tipo,
                            "moltiplicatore": mult,
                            "campionato_regionale": is_cr,
                            "campionato_italiano": is_ci,
                            "regione": regione
                        })
                        
                    # print(f"Mese {mese:02d} | Geo {geo} | Pagina {pagina} -> Trovate {len(races)} gare.")
                    pagina += 1
                    time.sleep(0.1) # Pausa gentile
                except Exception as e:
                    print(f"Errore scraping calendario URL {url}: {e}")
                    break

    unique_calendar = []
    seen = set()
    for g in calendar:
        if g["id"] not in seen:
            seen.add(g["id"])
            unique_calendar.append(g)
            
    print(f"--- FINE SCRAPING CALENDARIO: TROVATE {len(unique_calendar)} GARE UNICHE ---")
    return unique_calendar

if __name__ == '__main__':
    c = scrape_calendar_fci(2026)
    print("Gare estratte:", len(c))
    if c: print("Esempio:", c[0])
