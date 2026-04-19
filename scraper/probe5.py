from bs4 import BeautifulSoup
import re

with open('data/debug_jun.html', encoding='iso-8859-1') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

# Approccio diverso: trova tutti gli h4 con stile color:#1a8ad8 (colore FCI)
# poi cerca la tabella successiva
h4s = soup.find_all('h4')
print(f'h4: {len(h4s)}')
for h in h4s:
    print(f'  style=[{h.get("style","")}] text=[{h.get_text()[:100]}]')

# Cerca tutti i div con classe che contiene 'mb'
for cls_name in ['mb-2', 'mb-3', 'mb-4']:
    els = soup.find_all(class_=cls_name)
    for el in els[:3]:
        txt = el.get_text()[:200].replace('\n',' ')
        has_date = bool(re.search(r'\d{4}-\d{2}-\d{2}', txt))
        if has_date:
            print(f'  .{cls_name} con data: [{txt}]')

# Brute force: cerca il pattern data nel raw text e stampa HTML
raw = str(soup)
matches = [(m.start(), m.end()) for m in re.finditer(r'\d{4}-\d{2}-\d{2}', raw)]
print(f'\nDate trovate nel HTML raw: {len(matches)}')
for s, e in matches[:5]:
    context = raw[max(0,s-200):e+200]
    context = re.sub(r'<[^>]+>', ' ', context)
    context = re.sub(r'\s+', ' ', context).strip()
    print(f'  CONTEXT: [{context}]')
    print()
