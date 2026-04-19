import json
from difflib import SequenceMatcher

def norm(s):
    return s.strip().lower()

cal = json.load(open('data/calendar.json', encoding='utf-8'))
res = json.load(open('data/results_raw.json', encoding='utf-8'))

cal_by_date = {}
for g in cal: cal_by_date.setdefault(g["data"], []).append(g)

matched = 0
for r in res:
    race_name = r["nome_gara"]
    race_date = r["data"]
    best_cal, best_r = None, 0.0
    for e in cal_by_date.get(race_date, []):
        r_val = SequenceMatcher(None, norm(race_name), norm(e["nome"])).ratio()
        if r_val > best_r: best_r, best_cal = r_val, e
    if best_cal and best_r >= 0.55:
        matched += 1
    else:
        print(f"FAILED: {race_date} '{race_name}' (best_r={best_r:.2f})")

print(f"Total matched: {matched} out of {len(res)}")
