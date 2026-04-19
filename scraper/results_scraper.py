"""
results_scraper.py — Scarica i risultati delle singole gare da risultati-strada.federciclismo.it
ATTENZIONE: la posizione è in <th>, non <td>!
Encoding: ISO-8859-1
"""
import asyncio
import re
import html
import unicodedata
from difflib import SequenceMatcher
from datetime import datetime
from playwright.async_api import async_playwright


BASE_URL = "https://risultati-strada.federciclismo.it/"
CURRENT_YEAR = datetime.now().year

CATEGORY_URLS = {
    "Elite-Under23": f"{BASE_URL}risultati_gare_elite-under23.htm",
    "Juniores":      f"{BASE_URL}risultati_gare_juniores.htm",
    "Allievi":       f"{BASE_URL}risultati_gare_allievi.htm",
    "Esordienti":    f"{BASE_URL}risultati_gare_esordienti.htm",
    "Donne":         f"{BASE_URL}risultati_gare_donne.htm",
}


def normalize_str(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slugify(s: str) -> str:
    s = normalize_str(s)
    return re.sub(r"\s+", "_", s).upper()


def fuzzy_match(a: str, b: str, threshold: float = 0.85) -> bool:
    return SequenceMatcher(None, normalize_str(a), normalize_str(b)).ratio() >= threshold


def match_calendar(race_name: str, race_date: str, calendar: list) -> dict | None:
    """Trova la gara nel calendario tramite nome normalizzato + data."""
    norm_name = normalize_str(race_name)
    # Prima: match esatto (nome + data)
    for g in calendar:
        if g["data"] == race_date and normalize_str(g["nome"]) == norm_name:
            return g
    # Seconda: solo data + fuzzy nome
    for g in calendar:
        if g["data"] == race_date and fuzzy_match(race_name, g["nome"]):
            return g
    # Terza: solo fuzzy nome (±3 giorni)
    for g in calendar:
        if fuzzy_match(race_name, g["nome"]):
            return g
    return None


async def scrape_race_results(page, race_url: str, race_name: str, race_date: str, category: str) -> list[dict]:
    """Scrapa la classifica di una singola gara."""
    results = []
    try:
        await page.goto(race_url, timeout=20000)
        # Attendi la tabella classifica (JS-rendered)
        try:
            await page.wait_for_selector("table.classifica, table#classifica, table[class*='class']", timeout=15000)
        except Exception:
            await page.wait_for_selector("table", timeout=10000)

        # Distanza e Media (nuova estrazione)
        km = ""
        media = ""
        header_text = await page.evaluate("() => document.body.innerText")
        # Cerca nel testo della pagina pattern come "di Km. 100,000" e "media di 43,705 Km/h"
        # Il pattern è solitamente vicino al nome gara o in un div fs-6
        dist_match = re.search(r"di Km\.\s*([\d,\.]+)", header_text, re.I)
        media_match = re.search(r"media di\s*([\d,\.]+)\s*Km/h", header_text, re.I)
        if dist_match: km = dist_match.group(1).replace(",", ".")
        if media_match: media = media_match.group(1).replace(",", ".")

        rows = await page.query_selector_all("table tr")
        for row in rows:
            try:
                # CRITICO: posizione è in <th>, non <td>
                pos_el = await row.query_selector("th")
                if not pos_el:
                    continue

                pos_text = (await pos_el.inner_text()).strip()
                # Filtra header rows e righe non numeriche
                if not re.match(r"^\d+", pos_text.replace("°", "").strip()):
                    continue

                position = int(re.sub(r"\D", "", pos_text))
                if position > 10:
                    continue  # salva solo top 10

                tds = await row.query_selector_all("td")
                if len(tds) < 2:
                    continue

                # Nome: usa data-nome / data-cognome se presenti (apostrofi)
                nome = ""
                cognome = ""
                for td in tds:
                    data_nome = await td.get_attribute("data-nome")
                    data_cognome = await td.get_attribute("data-cognome")
                    if data_nome:
                        nome = html.unescape(data_nome).strip().upper()
                    if data_cognome:
                        cognome = html.unescape(data_cognome).strip().upper()

                # Fallback: testo diretto
                if not cognome or not nome:
                    tds_texts = [html.unescape((await td.inner_text()).strip()) for td in tds]
                    # Tipicamente: [nome_cognome, team, tempo/distacco]
                    if tds_texts:
                        parts = tds_texts[0].upper().split()
                        if len(parts) >= 2:
                            cognome = parts[0]
                            nome = " ".join(parts[1:])
                        elif len(parts) == 1:
                            cognome = parts[0]
                            nome = ""

                # Team (seconda cella)
                team = ""
                if len(tds) > 1:
                    team_el = tds[1]
                    team_data = await team_el.get_attribute("data-team")
                    if team_data:
                        team = html.unescape(team_data).strip().upper()
                    else:
                        team = html.unescape((await team_el.inner_text()).strip()).upper()

                # Tempo/distacco (ultima cella)
                tempo = ""
                if len(tds) > 2:
                    tempo_el = tds[-1]
                    tempo = html.unescape((await tempo_el.inner_text()).strip())

                if not cognome:
                    continue

                gara_id = f"{slugify(race_name)}_{race_date}"
                atleta_id = f"{slugify(cognome)}_{slugify(nome)}"
                team_id = slugify(team) if team else "TEAM_SCONOSCIUTO"

                results.append({
                    "gara_id": gara_id,
                    "nome_gara": race_name,
                    "data": race_date,
                    "categoria": category,
                    "posizione": position,
                    "nome": nome,
                    "cognome": cognome,
                    "atleta_id": atleta_id,
                    "team": team,
                    "team_id": team_id,
                    "tempo": tempo,
                    "km": km,
                    "media": media
                })

            except Exception:
                continue

    except Exception as e:
        print(f"      WARN scraping {race_url}: {e}")

    return results


async def scrape_all_results(calendar: list) -> list[dict]:
    """Scarica tutti i risultati dalle pagine FCI risultati-strada."""
    all_results = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        for cat_name, cat_url in CATEGORY_URLS.items():
            print(f"    Risultati [{cat_name}] ...")
            try:
                await page.goto(cat_url, timeout=20000)
                await page.wait_for_load_state("networkidle", timeout=15000)
                await asyncio.sleep(2)

                # Trova link a singole gare
                race_links = await page.query_selector_all("a[href*='classifica'], a[href*='risultati'], a[href*='gara']")
                # Dedup
                seen_hrefs = set()
                races_to_scrape = []
                for link in race_links:
                    href = await link.get_attribute("href")
                    text = (await link.inner_text()).strip()
                    if href and href not in seen_hrefs:
                        seen_hrefs.add(href)
                        # Cerca data nel testo circostante
                        full_url = href if href.startswith("http") else BASE_URL.rstrip("/") + "/" + href.lstrip("/")
                        races_to_scrape.append((text, full_url))

                print(f"      -> {len(races_to_scrape)} gare trovate")

                for race_name, race_url in races_to_scrape[:50]:  # limite sicurezza
                    # Estrai data dall'URL o testo
                    date_match = re.search(r"(\d{4})[_\-](\d{2})[_\-](\d{2})", race_url)
                    if date_match:
                        race_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
                    else:
                        race_date = f"{CURRENT_YEAR}-01-01"  # fallback

                    # Salta gare non dell'anno corrente
                    if not race_date.startswith(str(CURRENT_YEAR)):
                        continue

                    results = await scrape_race_results(page, race_url, race_name, race_date, cat_name)
                    all_results.extend(results)
                    await asyncio.sleep(2)  # rate limiting

            except Exception as e:
                print(f"      WARN {cat_name}: {e}")
                continue

        await browser.close()

    return all_results
