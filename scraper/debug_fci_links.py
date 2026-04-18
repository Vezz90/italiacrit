import asyncio
from playwright.async_api import async_playwright

async def debug_links():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        url = "https://risultati-strada.federciclismo.it/risultati_gare_elite-under23.htm"
        print(f"Scanning {url}...")
        await page.goto(url)
        await asyncio.sleep(2)
        links = await page.query_selector_all("a")
        for link in links:
            href = await link.get_attribute("href")
            text = (await link.inner_text()).strip()
            if href and ("classifica" in href or "risultati" in href or "gara" in href):
                print(f"TEXT: '{text}' | HREF: '{href}'")
        await browser.close()

asyncio.run(debug_links())
