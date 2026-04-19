import json
from collections import OrderedDict

res = json.load(open('data/results_raw.json', encoding='utf-8'))
cal = json.load(open('data/calendar.json', encoding='utf-8'))
atl = json.load(open('data/athletes.json', encoding='utf-8'))
meta = json.load(open('data/meta.json', encoding='utf-8'))
rnk = json.load(open('data/rankings/JUN_M.json', encoding='utf-8'))

print(f'Risultati: {len(res)}, Gare: {len(cal)}, Atleti: {len(atl)}')
print(f'Aggiornato: {meta["last_update"]}')
print()

races = OrderedDict()
for r in sorted(res, key=lambda x: x['data'], reverse=True):
    if r['gara_id'] not in races:
        races[r['gara_id']] = f"{r['nome_gara']} ({r['data']}) [{r['categoria']}]"

for i, (gid, name) in enumerate(list(races.items())[:15]):
    print(f'  {i+1:2d}. {name}')

print()
print('TOP 5 JUN M:')
for r in rnk[:5]:
    print(f"  {r['pos']}. {r['cognome']} {r['nome']} - {r['punti']} pt - {r['team_nome']}")
