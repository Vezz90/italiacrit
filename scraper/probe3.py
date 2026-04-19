from bs4 import BeautifulSoup
import re

with open('data/debug_jun.html', encoding='iso-8859-1') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

tables = soup.find_all('table')
print(f'Tabelle: {len(tables)}')

# Per ogni tabella, cerca il container principale
for i, t in enumerate(tables[:3]):
    parent = t.parent  # div immediato
    gp = parent.parent  # nonno

    print(f'\n=== TABELLA {i+1} ===')
    print(f'  Parent: {parent.name}, class={parent.get("class")}')
    print(f'  Grandparent: {gp.name}, class={gp.get("class")}, id={gp.get("id")}')

    # Cerca siblings del parent (div fratelli)
    siblings = list(gp.children)
    for j, s in enumerate(siblings):
        if not hasattr(s, 'name') or not s.name:
            continue
        txt = s.get_text()[:150].replace('\n','|')
        print(f'  SIBLING[{j}] tag={s.name}: [{txt}]')

    print()
    # Stampa raw HTML grandparent (600 chars)
    print('  RAW GP:', str(gp)[:400])
