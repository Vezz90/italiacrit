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
        
        # Le tabelle hanno classe 'classifica'?
        tables = soup.find_all('table', class_='classifica')
        if not tables:
            tables = soup.find_all('table')
            
        print(f"Found {len(tables)} tables")
        
        # Proviamo a trovare i blocchi: di solito c'è un titolo e poi la tabella
        # A volte il titolo è nel <thead> o in un div precedente
        for table in tables:
            # Cerca il titolo "sopra" la tabella
            title = "Unknown Race"
            prev = table.find_previous(['h1', 'h2', 'h3', 'h4', 'strong', 'b', 'p'])
            if prev:
                title = prev.get_text().strip()
            
            rows = table.find_all('tr')
            print(f"Race: {title[:60]}... | Rows: {len(rows)}")
            
        await browser.close()

asyncio.run(inspect())
