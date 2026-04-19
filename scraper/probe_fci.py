import requests
from bs4 import BeautifulSoup
import re, html, sys

s = requests.Session()
s.headers['User-Agent'] = 'Mozilla/5.0'

r = s.get('https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm', timeout=15)
r.encoding = 'iso-8859-1'
soup = BeautifulSoup(r.text, 'html.parser')

tables = soup.find_all('table')
print(f'Totale tabelle: {len(tables)}')

for i, t in enumerate(tables[:4]):
    prev = t.find_previous(['h2','h3','h4','p','div','strong'])
    print(f'--- TABELLA {i+1} ---')
    print(f'  Prev: tag={prev.name if prev else None}, text={repr(prev.get_text()[:100]) if prev else None}')
    for row in t.find_all('tr')[:4]:
        th = row.find('th')
        tds = row.find_all('td')
        print(f'  TH=[{th.get_text(strip=True) if th else ""}] TDs={[td.get_text(strip=True)[:30] for td in tds]}')

# Cerca anche elementi con data nel testo
print('\n--- CERCA DATE ---')
for el in soup.find_all(text=re.compile(r'\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2}')):
    print(f'  [{el[:100]}]')

sys.stdout.flush()
