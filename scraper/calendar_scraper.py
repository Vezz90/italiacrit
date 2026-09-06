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
                        
                        id_class_div = race.find('div', class_='wp-race-id-class')
                        categoria = ""
                        fci_id = ""
                        if id_class_div:
                            text = id_class_div.get_text(strip=True)
                            m = re.search(r"Classe:\s*(?:\([^)]+\))?\s*(.*)", text)
                            if m: categoria = m.group(1).strip()
                            # ID numerico interno FCI (es. "ID Gara: 179880 -
                            # Classe: ..."): a differenza del nostro gara_id
                            # (derivato dal nome), è STABILE anche se la FCI
                            # corregge il nome/edizione dopo la prima
                            # pubblicazione (visto dal vivo: "13° TROFEO A.
                            # COMBERLATO" "In fase di approvazione" diventato
                            # poi "14° TROFEO A. COMBERLATO" "Approvata" per
                            # lo stesso ID Gara 179879 — senza questo id
                            # tracciato, il rename creava un doppione fantasma
                            # invece di aggiornare la riga esistente). Usato
                            # sotto per sanare i rename durante il merge.
                            m2 = re.search(r"ID\s*Gara:\s*(\d+)", text)
                            if m2: fci_id = m2.group(1)
                            
                        loc_div = race.find('div', class_='wp-race-location')
                        regione = ""
                        luogo = ""
                        if loc_div:
                            b_tag = loc_div.find('b')
                            if b_tag:
                                regione = b_tag.get_text(strip=True).upper()
                            full_text = loc_div.get_text(strip=True)
                            if full_text.startswith(regione):
                                luogo = full_text[len(regione):].strip(" -").strip()
                                
                        is_cr = "campionato regionale" in nome.lower()
                        is_ci = "campionato italiano" in nome.lower()

                        gara_id = f"{slug(nome)}_{data_iso}"

                        calendar.append({
                            "id": gara_id,
                            "id_base": gara_id,
                            "fci_id": fci_id,
                            "nome": nome,
                            "data": data_iso,
                            "tipo": tipo,
                            "moltiplicatore": mult,
                            "campionato_regionale": is_cr,
                            "campionato_italiano": is_ci,
                            "regione": regione,
                            "categoria": categoria,
                            "luogo": luogo
                        })
                        
                    # print(f"Mese {mese:02d} | Geo {geo} | Pagina {pagina} -> Trovate {len(races)} gare.")
                    pagina += 1
                    time.sleep(0.1) # Pausa gentile
                except Exception as e:
                    print(f"Errore scraping calendario URL {url}: {e}")
                    break

    # La FCI a volte pubblica PIU' righe calendario con nome+data identici ma
    # categoria diversa (es. "14° TROFEO A. COMBERLATO" il 06/09/2026: una
    # riga "Donne Esordienti" ID Gara 179879, una "Donne Allieve" ID Gara
    # 179880 — stesso evento fisico, due gare/categorie ufficialmente
    # distinte). Il gara_id sopra è derivato solo da nome+data, quindi
    # collidevano: la seconda spariva silenziosamente nel dedup finale (mai
    # scaricata a calendario, anche se i suoi risultati venivano poi scrapati
    # regolarmente da un'altra fonte — segnalato dal vivo con screenshot
    # della pagina federciclismo.it che mostra chiaramente le due righe).
    # Fix: quando un id_base raccoglie PIU' categorie diverse, si
    # disambigua appendendo la categoria all'id di OGNI riga di quel
    # gruppo (non solo delle successive) — così nessuna vince silenziosamente
    # sull'altra e l'id resta stabile indipendentemente dall'ordine di
    # scraping. Se invece tutte le righe di un id_base condividono la stessa
    # categoria, sono vere ripetizioni (es. ri-fetch di pagine diverse) e
    # l'id resta quello di sempre, per non rompere link/alias già in uso.
    cats_per_base = {}
    for g in calendar:
        cats_per_base.setdefault(g["id_base"], set()).add(g["categoria"] or "")
    for g in calendar:
        if len(cats_per_base[g["id_base"]]) > 1:
            g["id"] = f"{g['id_base']}_{slug(g['categoria'])}"
        del g["id_base"]

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
