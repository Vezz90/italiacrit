import json
import asyncio
from playwright.async_api import async_playwright
import re

async def scrape_tech_data(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            print(f"Scraping {url}...")
            await page.goto(url, timeout=30000)
            header_text = await page.evaluate("() => document.body.innerText")
            dist_match = re.search(r"di Km\.\s*([\d,\.]+)", header_text, re.I)
            media_match = re.search(r"media di\s*([\d,\.]+)\s*Km/h", header_text, re.I)
            km = dist_match.group(1).replace(",", ".") if dist_match else ""
            media = media_match.group(1).replace(",", ".") if media_match else ""
            await browser.close()
            return km, media
        except Exception as e:
            print(f"Error scraping {url}: {e}")
            await browser.close()
            return "", ""

async def main():
    # Carica results_raw.json
    results_path = r"c:\Users\vezza\.gemini\antigravity\scratch\italiacrit\data\results_raw.json"
    calendar_path = r"c:\Users\vezza\.gemini\antigravity\scratch\italiacrit\data\calendar.json"
    
    with open(results_path, "r", encoding="utf-8") as f:
        results = json.load(f)
    
    with open(calendar_path, "r", encoding="utf-8") as f:
        calendar = json.load(f)

    # Identifica le prime 5 gare uniche per test
    unique_races = {}
    for r in results:
        if r["gara_id"] not in unique_races:
            # Trova l'URL nel calendario
            cal_entry = next((c for c in calendar if c["id"] == r["gara_id"]), None)
            if cal_entry and cal_entry.get("url_risultati"):
                unique_races[r["gara_id"]] = cal_entry["url_risultati"]
        
        if len(unique_races) >= 3: break

    # Scrapa i dati tecnici per queste gare
    tech_data_map = {}
    for gid, url in unique_races.items():
        km, media = await scrape_tech_data(url)
        tech_data_map[gid] = {"km": km, "media": media}

    # Aggiorna results_raw.json
    updated_count = 0
    for r in results:
        if r["gara_id"] in tech_data_map:
            r["km"] = tech_data_map[r["gara_id"]]["km"]
            r["media"] = tech_data_map[r["gara_id"]]["media"]
            updated_count += 1

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"Updated {updated_count} result entries with technical data.")

if __name__ == "__main__":
    asyncio.run(main())
