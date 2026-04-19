from bs4 import BeautifulSoup
import re

with open('data/debug_jun.html', encoding='iso-8859-1') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

tables = soup.find_all('table')
print(f'Tabelle: {len(tables)}')

t = tables[0]
prev = t.find_previous_sibling()
print('--- PREV SIBLINGS ---')
for _ in range(8):
    if prev is None:
        break
    txt = prev.get_text()[:120].replace('\n',' ')
    print(f'  TAG={prev.name}: [{txt}]')
    prev = prev.find_previous_sibling()

print('--- PARENT ---')
parent = t.parent
ptxt = parent.get_text()[:300].replace('\n','|')
print(f'  TAG={parent.name}')
print(f'  TEXT=[{ptxt}]')

# Stampa HTML raw del parent
print('\n--- RAW HTML (parent, 500 chars) ---')
print(str(parent)[:500])
