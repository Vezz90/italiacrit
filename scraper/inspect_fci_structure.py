import asyncio
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

async def inspect():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm")
        await asyncio.sleep(2)
        content = await page.content()
        soup = BeautifulSoup(content, 'html.parser')
        
        # Cerca tutti i titoli gara (h2, h3, b, strong o div.titolo)
        # Sulla base della descrizione del subagent, sono titoli seguiti da tabelle.
        for el in soup.find_all(['h1', 'h2', 'h3', 'h4', 'strong', 'b']):
            text = el.get_text().strip()
            if len(text) > 10 and not text.lower().startswith('risultati'):
                print(f"HEADER? {text}")
                # Cerca la tabella successiva
                sib = el.find_next_sibling('table')
                if sib:
                    print(f"  -> FOUND TABLE with {len(sib.find_all('tr'))} rows")
        
        await browser.close()

asyncio.run(inspect())
