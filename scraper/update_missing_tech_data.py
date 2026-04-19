import json, requests, re, sys, os
from bs4 import BeautifulSoup
from pathlib import Path

# Aggiungi la cartella scraper al path per importare le utility
sys.path.append(os.path.dirname(__file__))

# Importiamo le costanti e le funzioni dallo scraper principale
try:
    from fci_complete_scraper import (
        RISULTATI_URLS, parse_risultati_page, DATA_DIR, 
        CURRENT_YEAR, get_page, slug
    )
except ImportError:
    print("Errore d'importazione. Verifica che fci_complete_scraper.py sia nella stessa cartella.")
    sys.exit(1)

def run_update():
    print("--- INIZIO RECUPERO UNIFICATO DATI TECNICI ---")
    
    # Carica dati correnti
    results_path = DATA_DIR / "results_raw.json"
    calendar_path = DATA_DIR / "calendar.json"
    
    if not results_path.exists() or not calendar_path.exists():
        print("Errore: file dati non trovati.")
        return

    with open(results_path, "r", encoding="utf-8") as f:
        all_results = json.load(f)
    with open(calendar_path, "r", encoding="utf-8") as f:
        calendar = json.load(f)

    # Indicizza calendario per data per parse_risultati_page
    cal_by_date = {}
    for g in calendar:
        cal_by_date.setdefault(g["data"], []).append(g)

    # Sessione per requests
    SESSION = requests.Session()
    SESSION.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "it-IT,it;q=0.9",
    })

    # Mappa per aggiornare le gare esistenti
    tech_updates = {} # gara_id -> {km, media}

    for label, url in RISULTATI_URLS.items():
        print(f"\nScraping {label} ({url})...")
        try:
            # Usa la funzione get_page dello scraper
            soup, _ = get_page(url, SESSION)
            if not soup:
                print("  Impossibile caricare la pagina.")
                continue
            
            # Utilizziamo la funzione parse_risultati_page aggiornata (unificata)
            updated_results = parse_risultati_page(soup, cal_by_date)
            
            for res in updated_results:
                gid = res["gara_id"]
                if res.get("km") or res.get("media"):
                    tech_updates[gid] = {"km": res["km"], "media": res["media"]}
                    print(f"  [TROVATO] {gid} | Cat: {res['categoria']} | Km: {res['km']}, Media: {res['media']}")
        except Exception as e:
            print(f"  Errore durante lo scraping: {e}")

    # Applica aggiornamenti a results_raw.json
    res_count = 0
    for r in all_results:
        gid = r["gara_id"]
        if gid in tech_updates:
            # Aggiorna km e media se trovati
            val_km = tech_updates[gid]["km"]
            val_media = tech_updates[gid]["media"]
            
            # Se r non ha km o è vuoto, aggiorna
            if not r.get("km"): 
                r["km"] = val_km
                res_count += 1
            if not r.get("media"):
                r["media"] = val_media
                res_count += 1

    # Applica aggiornamenti a calendar.json
    cal_count = 0
    for g in calendar:
        gid = g["id"]
        if gid in tech_updates:
            if not g.get("km"): 
                g["km"] = tech_updates[gid]["km"]
                cal_count += 1
            if not g.get("media"):
                g["media"] = tech_updates[gid]["media"]
                cal_count += 1

    # Salva i file
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    with open(calendar_path, "w", encoding="utf-8") as f:
        json.dump(calendar, f, ensure_ascii=False, indent=2)

    print(f"\n--- FINE AGGIORNAMENTO ---")
    print(f"Campi aggiornati in results_raw: {res_count}")
    print(f"Campi aggiornati in calendar: {cal_count}")

if __name__ == "__main__":
    run_update()
