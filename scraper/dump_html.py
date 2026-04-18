import asyncio
from playwright.async_api import async_playwright

async def dump():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        print("Navigating...")
        await page.goto("https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm")
        await asyncio.sleep(3)
        html = await page.content()
        with open("scraper/debug_page.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("Dumped to scraper/debug_page.html")
        await browser.close()

asyncio.run(dump())
