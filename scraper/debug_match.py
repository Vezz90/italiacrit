import pandas as pd
from scraper.excel_loader import load_calendar_from_excel
from scraper.results_scraper import scrape_all_results
import asyncio
import os

async def debug_match():
    # Load Excel
    excel_path = "data/calendario_manuale_v2.xlsx"
    calendar = load_calendar_from_excel(excel_path)
    print(f"Calendar has {len(calendar)} races")
    
    # Run scraper in debug mode? 
    # Actually, let's just inspect the page again and print matching scores
    # for the first few headers found.
    pass

if __name__ == "__main__":
    # Just run a test of the parser logic with a real page
    from playwright.async_api import async_playwright
    from scraper.results_scraper import parse_page_results, CATEGORY_URLS
    
    async def run():
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await b = await browser.new_page()
            url = CATEGORY_URLS["Elite-Under23"]
            print(f"Checking {url}...")
            await page.goto(url)
            await asyncio.sleep(2)
            content = await page.content()
            excel_path = "data/calendario_manuale_v2.xlsx"
            calendar = load_calendar_from_excel(excel_path)
            results = await parse_page_results(content, "Elite-Under23", calendar)
            print(f"Total results found: {len(results)}")
            await browser.close()
            
    asyncio.run(run())
