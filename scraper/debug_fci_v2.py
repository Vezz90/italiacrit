import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        for cat in ["Elite-Under23", "Juniores"]:
            url = f"https://risultati-strada.federciclismo.it/risultati_gare_{cat.lower()}.htm"
            print(f"--- {cat} ---")
            try:
                await page.goto(url, timeout=30000)
                await asyncio.sleep(2)
                links = await page.query_selector_all("a")
                found = 0
                for link in links:
                    href = await link.get_attribute("href")
                    text = (await link.inner_text()).strip()
                    if href and (".htm" in href and ("/" not in href or href.startswith("classifica"))):
                        print(f"  {text} -> {href}")
                        found += 1
                if found == 0:
                    print("  No links found")
            except Exception as e:
                print(f"  Error: {e}")
        await browser.close()

asyncio.run(main())
