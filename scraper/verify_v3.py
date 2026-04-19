import json
from collections import Counter, defaultdict

res = json.load(open('data/results_raw.json', encoding='utf-8'))
cal = json.load(open('data/calendar.json', encoding='utf-8'))
team_jun = json.load(open('data/team_rankings/JUN_M.json', encoding='utf-8'))

print(f"Risultati: {len(res)}, Gare calendario: {len(cal)}")
print()

# Distribuzione moltiplicatori con nomi gare
print("=== GARE PER MOLTIPLICATORE ===")
gare_by_mult = defaultdict(set)
for r in res:
    gare_by_mult[r['moltiplicatore']].add((r['gara_id'], r['nome_gara']))

for mult in sorted(gare_by_mult.keys()):
    print(f"\n×{mult} ({len(gare_by_mult[mult])} gare):")
    for gid, nome in sorted(gare_by_mult[mult], key=lambda x: x[1]):
        print(f"  - {nome[:70]}")

print()
# Gare che dovrebbero avere ×2 ma hanno ×1
print("=== GARE CON 'CAMPIONATO' NEL NOME MA ×1 ===")
for gid, nome in gare_by_mult.get(1, set()):
    if any(k in nome.upper() for k in ['CAMPIONATO', 'CAMP.', 'C.R.', 'VALIDA']):
        print(f"  - {nome[:80]}")

print()
# Calendario: gare di febbraio-marzo
print("=== CALENDARIO FEB-MAR 2026 ===")
for g in sorted(cal, key=lambda x: x['data']):
    if g['data'] >= '2026-02-01' and g['data'] <= '2026-03-31':
        print(f"  {g['data']} ×{g['moltiplicatore']} [{g['tipo'][:3]}] {g['nome'][:60]}")

print()
print("=== TOP 5 TEAM JUNIORES M ===")
for t in team_jun[:5]:
    print(f"  {t['pos']}. {t['team_nome']} — {t['punti']} pt ({t['vittorie']} V, {t['podi']} P, {t['n_atleti']} atleti)")
