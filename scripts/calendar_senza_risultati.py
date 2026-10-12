#!/usr/bin/env python
"""
Audit delle gare del calendario (da inizio anno a ieri) che NON hanno risultati sul sito, confrontate con members.federciclismo.it.

Per ogni gara senza risultati dice se su Members risulta:
  - ANNULLATA / RINVIATA / SOSPESA (scritto nel nome)
  - SPOSTATA (stesso nome ma data diversa) e, in quel caso, se alla nuova data ci sono risultati
  - SPARITA (non c'e' piu' su Members)
  - REGOLARE (c'e' alla stessa data, senza segni di annullamento): la FCI non ha (ancora) pubblicato i risultati

  python scripts/calendar_senza_risultati.py            scrive audit/calendario_senza_risultati.json e .csv
"""
import sys, re, json, datetime, csv
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parent.parent
sys.argv = [sys.argv[0]]                                    # niente --apply
spec = importlib.util.spec_from_file_location('mcs', ROOT / 'scripts' / 'members_calendar_sync.py')
mcs = importlib.util.module_from_spec(spec); spec.loader.exec_module(mcs)

today = datetime.date.today()
start = datetime.date(today.year, 1, 1)
yesterday = today - datetime.timedelta(days=1)

cal = json.load(open(ROOT / 'data' / 'calendar.json', encoding='utf-8'))
res = json.load(open(ROOT / 'data' / 'results_raw.json', encoding='utf-8'))
try:
    excl = json.load(open(ROOT / 'data' / 'calendar_exclude.json', encoding='utf-8'))
except Exception:
    excl = {'ids': {}, 'fci_ids': {}}

# risultati per data -> nomi normalizzati (senza data e senza suffisso categoria)
res_by_date = {}
for r in res:
    g = str(r.get('gara_id', '')); d = r.get('data', '')
    if d:
        name = re.sub(r'_\d{4}-\d{2}-\d{2}.*$', '', g).replace('_', ' ')
        res_by_date.setdefault(d, set()).add(mcs.core(name))


def results_on(d, c):
    a = mcs.toks(c['nome']); cn = mcs.core(c['nome'])
    for rn in res_by_date.get(d, ()):
        if cn and rn and (cn in rn or rn in cn):
            return True
        b = mcs.toks(rn)
        if len(a & b) >= 2:
            return True
    return False


def results_near(c, span=220):
    d0 = datetime.date.fromisoformat(c['data'])
    for k in range(-span, span + 1):
        if k == 0:
            continue
        d = (d0 + datetime.timedelta(days=k)).isoformat()
        if results_on(d, c):
            return d
    return None


missing = [c for c in cal if start.isoformat() <= c['data'] <= yesterday.isoformat()
           and not results_on(c['data'], c)
           and c['id'] not in (excl.get('ids') or {})
           and mcs.norm(c['nome']) not in ('', 'GARA')]
print(f'Righe di calendario {start}..{yesterday}: {sum(1 for c in cal if start.isoformat() <= c["data"] <= yesterday.isoformat())}, senza risultati: {len(missing)}')

print('Scansione Members dell\'intero anno (qualche minuto)...')
mem = mcs.scan_members(start - datetime.timedelta(days=30), datetime.date(today.year + 1, 3, 31))
print(f'  gare Strada su Members: {len(mem)}')
by_fci = {m['id']: m for m in mem.values()}

rows = []
for c in missing:
    fid = str(c.get('fci_id') or '')
    m = by_fci.get(fid) if fid else None
    if not m:
        cand = [x for x in mem.values() if mcs.same_race(c, x)]
        m = cand[0] if cand else None
    stato, nota, nuova = '', '', ''
    if mcs.STATE_RE.search(c['nome']) and not (m and mcs.STATE_RE.search(m['nome'])):
        stato = 'ANNULLATA/RINVIATA (nome nel nostro calendario)'; nota = c['nome']
    elif m and mcs.STATE_RE.search(m['nome']):
        stato = 'ANNULLATA/RINVIATA (nome su Members)'; nota = m['nome']
    elif m and m['data'] == c['data']:
        stato = 'REGOLARE: su Members, risultati non pubblicati'
    elif m and m['data'] >= f'{today.year}-12-31':
        stato = 'RINVIATA a data da destinarsi (31/12 su Members)'; nuova = m['data']; nota = m['nome']
    elif m:
        stato = 'SPOSTATA su Members'; nuova = m['data']; nota = m['nome']
    else:
        # stesso nome in altra data?
        mv = mcs.moved_to(c, mem.values())
        if mv:
            stato = 'SPOSTATA su Members'; nuova = mv['data']; nota = mv['nome']
        else:
            stato = 'SPARITA da Members'
    near = results_near(c)
    ris_nuova = ''
    if stato.startswith('SPARITA') and near:
        stato = 'POSSIBILE SPOSTAMENTO (risultati simili ad altra data, DA VERIFICARE)'
    if nuova and results_on(nuova, c):
        ris_nuova = f'SI ({nuova})'
    elif near:
        ris_nuova = f'risultati simili il {near}'
        if not nuova: nuova = near
    rows.append({'id': c['id'], 'nome': c['nome'], 'data': c['data'], 'categoria': c.get('categoria', ''), 'regione': c.get('regione', ''),
                 'stato': stato, 'nuova_data': nuova, 'risultati_alla_nuova_data': ris_nuova, 'nota': nota, 'fci_id': fid})

out = ROOT / 'audit'; out.mkdir(exist_ok=True)
json.dump(rows, open(out / 'calendario_senza_risultati.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
with open(out / 'calendario_senza_risultati.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=';'); w.writeheader(); w.writerows(rows)
from collections import Counter
print('\nRIEPILOGO'); [print(f'  {n:4d}  {s}') for s, n in Counter(r['stato'] for r in rows).most_common()]
print('\nSpostate con risultati alla nuova data:', sum(1 for r in rows if r['risultati_alla_nuova_data'].startswith('SI')))
print('Salvato in audit/calendario_senza_risultati.csv')
