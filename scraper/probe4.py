from bs4 import BeautifulSoup
import re

with open('data/debug_jun.html', encoding='iso-8859-1') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

# Cerca tutti i div container-fluid
containers = soup.find_all('div', class_='container-fluid')
print(f'container-fluid trovati: {len(containers)}')

for i, c in enumerate(containers[:5]):
    txt = c.get_text()[:400].replace('\n','|').replace('  ',' ')
    print(f'CONTAINER {i}: [{txt[:200]}]')
    print()

# Cerca h4 
h4s = soup.find_all('h4')
print(f'h4 trovati: {len(h4s)}')
for h4 in h4s[:5]:
    print(f'  h4: [{h4.get_text()[:80]}]')

# Cerca div con mb-2 o simili (titolo gara)
divs_with_date = []
for div in soup.find_all('div'):
    txt = div.get_text()
    if re.search(r'\d{4}-\d{2}-\d{2}', txt) and 'table' not in div.text.lower()[:50]:
        if div.find('table') is None and len(txt) < 200:
            divs_with_date.append(div)

print(f'\ndiv con data (no tabella): {len(divs_with_date)}')
for d in divs_with_date[:10]:
    print(f'  [{d.get_text()[:100].replace(chr(10)," ")}]')
