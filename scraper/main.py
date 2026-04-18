"""
ItaliacritResultati — Main Orchestrator
Uso: python scraper/main.py [--seed]
  --seed: genera dati demo realistici senza scraping reale
"""
import asyncio
import argparse
import sys
import json
import os
from pathlib import Path
from datetime import datetime

# Aggiungi la cartella scraper al path
sys.path.insert(0, str(Path(__file__).parent))

from calendar_scraper import scrape_calendar
from results_scraper import scrape_all_results
from points_calculator import calculate_all
from json_builder import write_all_json
import seed_data


DATA_DIR = Path(__file__).parent.parent / "data"


def ensure_dirs():
    (DATA_DIR / "rankings").mkdir(parents=True, exist_ok=True)


async def run_pipeline(seed: bool = False):
    ensure_dirs()
    print(f"\n{'='*60}")
    print(f"  ITALIACRIT — Pipeline avviata {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Modalità: {'SEED (demo)' if seed else 'SCRAPING REALE'}")
    print(f"{'='*60}\n")

    if seed:
        print("[1/4] Generazione dati seed (calendario)...")
        calendar = seed_data.make_calendar()
        print("[2/4] Generazione dati seed (risultati)...")
        results_raw = seed_data.make_results_raw(calendar)
    else:
        print("[1/4] Scraping calendario FCI...")
        calendar = await scrape_calendar()
        
        # 1. Carica risultati esistenti
        existing_results = []
        existing_gara_ids = set()
        results_path = DATA_DIR / "results_raw.json"
        
        if results_path.exists():
            try:
                with open(results_path, "r", encoding="utf-8") as f:
                    existing_results = json.load(f)
                    # Estrae ID univoci delle gare gi\u00e0 presenti
                    existing_gara_ids = {r["gara_id"] for r in existing_results if "gara_id" in r}
                print(f"       → Database esistente caricato: {len(existing_results)} risultati ({len(existing_gara_ids)} gare)")
            except Exception as e:
                print(f"       WARN caricamento results_raw.json: {e}")

        # 2. Filtra il calendario (solo gare passate/odierne non nel database)
        today = datetime.now().strftime("%Y-%m-%d")
        missing_races = [
            g for g in calendar 
            if g["id"] not in existing_gara_ids and g["data"] <= today
        ]
        
        print(f"       → Gare totali in calendario: {len(calendar)}")
        print(f"       → Gare mancanti da analizzare: {len(missing_races)}")

        # 3. Scraping mirato dei risultati
        print("[2/4] Scraping risultati per le gare mancanti...")
        new_results = await scrape_all_results(missing_races, existing_gara_ids=existing_gara_ids)
        
        # 4. Fusione (Append)
        results_raw = existing_results + new_results
        if new_results:
            print(f"       → {len(new_results)} nuovi risultati aggiunti")
        else:
            print("       → Nessun nuovo risultato da aggiungere")

    print(f"       → Totale risultati grezzi disponibili: {len(results_raw)}\n")

    print("[3/4] Calcolo punti e classifiche...")
    athletes, teams, rankings = calculate_all(calendar, results_raw)
    print(f"       → {len(athletes)} atleti | {len(teams)} team\n")

    print("[4/4] Scrittura JSON...")
    write_all_json(calendar, results_raw, athletes, teams, rankings, DATA_DIR)

    # Salva timestamp ultimo aggiornamento
    meta = {
        "last_update": datetime.now().isoformat(),
        "total_races": len(calendar),
        "total_results": len(results_raw),
        "total_athletes": len(athletes),
        "total_teams": len(teams),
        "seed_mode": seed
    }
    with open(DATA_DIR / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"  Pipeline completata! Dati scritti in data/")
    print(f"  Ultimo aggiornamento: {meta['last_update']}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ItaliacritResultati scraper")
    parser.add_argument("--seed", action="store_true", help="Genera dati demo senza scraping reale")
    args = parser.parse_args()

    asyncio.run(run_pipeline(seed=args.seed))
