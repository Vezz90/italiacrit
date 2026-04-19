import json
from difflib import SequenceMatcher

res = json.load(open('data/results_raw.json', encoding='utf-8'))
cal = json.load(open('data/calendar.json', encoding='utf-8'))

# Trova le gare con "campionato regionale" nel nome dei risultati ancora ×1
prob_gare = {}
for r in res:
    if r['moltiplicatore'] == 1:
        nome_lower = r['nome_gara'].lower()
        if any(k in nome_lower for k in ['campionato', 'valida', 'c.r.', 'camp']):
            prob_gare[r['gara_id']] = r['nome_gara']

print(f"Gare con 'campionato/valida' ma ×1: {len(prob_gare)}")
for gid, nome in sorted(prob_gare.items()):
    print(f"  '{nome}'")
    # Cerca nel calendario per data
    data = gid.split('_')[-1] if '_' in gid else ''
    # Fuzzy match
    best_cal = None
    best_r = 0
    for c in cal:
        ratio = SequenceMatcher(None, nome.lower(), c['nome'].lower()).ratio()
        if ratio > best_r:
            best_r, best_cal = ratio, c
    if best_cal:
        print(f"    → Best cal match ({best_r:.2f}): '{best_cal['nome']}' [{best_cal['tipo']}] ×{best_cal['moltiplicatore']}")
    print()

# Verifica gare ×2 attuali
print("Gare ×2 attuali:")
gare_x2 = set((r['gara_id'], r['nome_gara']) for r in res if r['moltiplicatore'] == 2)
for gid, nome in gare_x2:
    print(f"  {nome}")
