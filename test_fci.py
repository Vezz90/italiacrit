import urllib.request
import re
import bs4

url = 'https://www.federciclismo.it/ricerca-gare/dettaglio-gara/?raceid=178967&site=strada_it&region=08&pagina=2'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    res = urllib.request.urlopen(req)
    html = res.read().decode('utf-8', errors='replace')
    soup = bs4.BeautifulSoup(html, 'html.parser')
    
    with open('race_detail_parsed.txt', 'w', encoding='utf-8') as f:
        # Trova la tabella dei dettagli. Spesso e' un elenco di <li> o <div> con class="row"
        main_content = soup.find('div', class_='main-content') or soup
        
        # Le info potrebbero essere dentro dei "list-group" o "card"
        list_items = main_content.find_all('li')
        for li in list_items:
            f.write(li.get_text(' ', strip=True) + '\n')
            
        f.write('\n--- DIVS ---\n')
        divs = main_content.find_all('div', class_=re.compile('col-'))
        for d in divs:
            f.write(d.get_text(' ', strip=True) + '\n')
            
except Exception as e:
    print('Error:', e)
