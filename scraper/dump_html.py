import requests, re
from bs4 import BeautifulSoup

soup = BeautifulSoup(requests.get('https://risultati-strada.federciclismo.it/').text, 'html.parser')
races = soup.find_all('h4', style=re.compile(r'color\s*:\s*#1a8ad8', re.I))

with open('scraper/html_dump.txt', 'w', encoding='utf-8') as f:
    for h in races[:25]:
        prev = h.find_previous_sibling()
        prev_text = prev.get_text(strip=True) if prev else "None"
        f.write(f"CONTEXT: {prev_text}\n")
        f.write(f"RACE: {h.get_text(strip=True)}\n")
        f.write("-" * 40 + "\n")
