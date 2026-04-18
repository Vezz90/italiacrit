"""
Ricalcola i risultati con i moltiplicatori corretti usando:
1. Il calendario già scaricato (data/calendar.json)
2. Il fix ai moltiplicatori dalla funzione infer_tipo_from_geo aggiornata

Non riscarica il calendario — usa quello già in data/calendar.json
"""
import json
import re
import unicodedata
import html as HTMLMOD
import time
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict
from difflib import SequenceMatcher

import sys
sys.path.insert(0, str(Path(__file__).parent))
from fci_final_v3 import (
    norm, slug, get_page, detect_gender, infer_tipo_from_geo,
    parse_risultati_page, _find_cal, aggregate, RISULTATI_URLS,
    CURRENT_YEAR, DATA_DIR, BASE_PTS, CAT_CODES, ALL_CODES
)

# Carica calendario già in cache
calendar = json.load(open(DATA_DIR / "calendar.json", encoding="utf-8"))
cal_by_date = {}
for g in calendar:
    cal_by_date.setdefault(g["data"], []).append(g)

print(f"Calendario caricato: {len(calendar)} gare")
print(f"Scraping risultati con moltiplicatori corretti…")

import requests
from bs4 import BeautifulSoup

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "it-IT,it;q=0.9",
})

all_results = []
races_map = {}

for cat_name, url in RISULTATI_URLS.items():
    print(f"\n  [{cat_name}]")
    try:
        r = SESSION.get(url, timeout=20)
        r.encoding = "iso-8859-1"
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        print(f"  SKIP: {e}")
        continue

    results = parse_risultati_page(cat_name, soup, cal_by_date)
    all_results.extend(results)

    cnt = Counter(r["gara_id"] for r in results)
    for gid, n in cnt.most_common():
        r0 = next(x for x in results if x["gara_id"] == gid)
        print(f"    ×{r0['moltiplicatore']} | {r0['data']} | {r0['nome_gara'][:48]:48s} | {n}")
        if gid not in races_map:
            races_map[gid] = {
                "id": gid, "nome": r0["nome_gara"], "data": r0["data"],
                "mese": int(r0["data"][5:7]) if r0.get("data") else 0,
                "anno": CURRENT_YEAR, "categoria": cat_name, "genere": r0["genere"],
                "tipo": r0["tipo"], "moltiplicatore": r0["moltiplicatore"],
                "campionato_regionale": r0["campionato_regionale"],
                "campionato_italiano": r0["campionato_italiano"],
            }

# Merge con calendario
existing_ids = set(races_map.keys())
for g in calendar:
    if g["id"] not in existing_ids:
        races_map[g["id"]] = g
        existing_ids.add(g["id"])

final_calendar = sorted(races_map.values(), key=lambda g: g["data"], reverse=True)

print(f"\nAggregazione…")
athletes, teams, athlete_rankings, team_rankings = aggregate(all_results)

def wj(path, data):
    with open(path,"w",encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

wj(DATA_DIR/"results_raw.json", all_results)
wj(DATA_DIR/"calendar.json", final_calendar)
wj(DATA_DIR/"athletes.json", athletes)
wj(DATA_DIR/"teams.json", teams)

for code, rows in athlete_rankings.items():
    wj(DATA_DIR/f"rankings/{code}.json", rows)

for code, rows in team_rankings.items():
    wj(DATA_DIR/f"team_rankings/{code}.json", rows)

wj(DATA_DIR/"meta.json", {
    "last_update": datetime.now().isoformat(),
    "total_races": len(races_map),
    "total_results": len(all_results),
    "total_athletes": len(athletes),
    "total_teams": len(teams),
    "seed_mode": False,
})

print(f"\n{'='*60}")
print(f"  Risultati: {len(all_results)} | Atleti: {len(athletes)} | Team: {len(teams)}")
print(f"{'='*60}")

# Distribuzione moltiplicatori
mult_cnt = Counter(r["moltiplicatore"] for r in all_results)
for m, c in sorted(mult_cnt.items()):
    gare_m = len({r["gara_id"] for r in all_results if r["moltiplicatore"]==m})
    print(f"  ×{m}: {c} risultati in {gare_m} gare")

print("\n  Team leader per categoria:")
for cc, rows in team_rankings.items():
    if rows:
        print(f"    [{cc}] 1° {rows[0]['team_nome']} — {rows[0]['punti']} pt")

print("\n  TOP 3 JUN_M con nuovi moltiplicatori:")
for r in athlete_rankings.get("JUN_M", [])[:5]:
    print(f"    {r['pos']}. {r['cognome']} {r['nome']} — {r['punti']} pt")
