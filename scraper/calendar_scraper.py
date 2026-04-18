"""
calendar_scraper.py — Scarica il calendario gare da federciclismo.it
Usa Playwright per pagine JavaScript-rendered.
Encoding: ISO-8859-1
"""
import asyncio
import re
import unicodedata
from datetime import datetime
from playwright.async_api import async_playwright


BASE_URL = "https://www.federciclismo.it/ricerca-gare/"
CURRENT_YEAR = datetime.now().year

GEO_CATEGORIES = {
    "1": "regionale",
    "2": "nazionale",
    "3": "internazionale",
}

MONTHS = [f"{m:02d}" for m in range(1, 13)]

CATEGORY_MAP = {
    "esordienti": "Esordienti",
    "allievi": "Allievi",
    "allieve": "Allievi",
    "juniores": "Juniores",
    "under 23": "Under23",
    "u23": "Under23",
    "elite": "Elite",
    "donne": "Donne",
    "femmine": "Donne",
    "women": "Donne",
}

GENDER_KEYWORDS_F = ["donne", "femmin", "allieve", "ragazze", "women"]


def normalize_str(s: str) -> str:
    """Rimuove accenti, lowercase, strip punteggiatura."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def detect_gender(name: str, category_raw: str) -> str:
    combined = (name + " " + category_raw).lower()
    for kw in GENDER_KEYWORDS_F:
        if kw in combined:
            return "F"
    return "M"


def detect_category(text: str) -> str:
    t = text.lower()
    for kw, cat in CATEGORY_MAP.items():
        if kw in t:
            return cat
    return "Varie"


def slugify(s: str) -> str:
    s = normalize_str(s)
    s = re.sub(r"\s+", "_", s)
    return s.upper()


async def scrape_calendar() -> list[dict]:
    """Scarica il calendario completo da federciclismo.it."""
    calendar = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            extra_http_headers={"Accept-Charset": "ISO-8859-1"}
        )
        page = await context.new_page()

        for geo_id, geo_type in GEO_CATEGORIES.items():
            for month in MONTHS:
                url = f"{BASE_URL}?site=strada_it&mese={month}&geo_category={geo_id}"
                print(f"    Calendar [{geo_type}] mese={month} …")

                try:
                    await page.goto(url, timeout=20000)
                    await page.wait_for_load_state("networkidle", timeout=15000)
                    await asyncio.sleep(2)  # rate limiting

                    # Estrai tutte le righe gara
                    rows = await page.query_selector_all("table tr, .gara-row, .race-row, li.gara")
                    if not rows:
                        # Fallback: cerca qualsiasi elemento con data-gara o simili
                        rows = await page.query_selector_all("[class*='gara'], [class*='race']")

                    for row in rows:
                        try:
                            text = await row.inner_text()
                            if not text.strip():
                                continue

                            # Estrai data (pattern gg/mm/yyyy o gg-mm-yyyy o simile)
                            date_match = re.search(r"(\d{1,2})[/\-\s](\d{1,2})[/\-\s](\d{4})", text)
                            if not date_match:
                                continue

                            day, mon, year = date_match.groups()
                            if int(year) != CURRENT_YEAR:
                                continue

                            date_iso = f"{year}-{int(mon):02d}-{int(day):02d}"

                            # Estrai nome gara
                            name_el = await row.query_selector("a, .nome-gara, .race-name, strong")
                            name = (await name_el.inner_text()).strip() if name_el else text.split("\n")[0].strip()
                            if not name or len(name) < 3:
                                continue

                            # URL gara se disponibile
                            href = await name_el.get_attribute("href") if name_el else None

                            category_raw = text
                            gender = detect_gender(name, category_raw)
                            category = detect_category(name + " " + category_raw)

                            # Flag speciali
                            is_campionato_regionale = any(
                                kw in normalize_str(name) for kw in ["campionato regionale", "camp reg"]
                            )
                            is_campionato_italiano = any(
                                kw in normalize_str(name) for kw in ["campionato italiano", "camp ital", "campionati italiani"]
                            )

                            gara_id = f"{slugify(name)}_{date_iso}"

                            calendar.append({
                                "id": gara_id,
                                "nome": name,
                                "data": date_iso,
                                "mese": int(mon),
                                "anno": int(year),
                                "categoria": category,
                                "genere": gender,
                                "tipo": geo_type,
                                "campionato_regionale": is_campionato_regionale,
                                "campionato_italiano": is_campionato_italiano,
                                "url": href,
                            })
                        except Exception:
                            continue

                except Exception as e:
                    print(f"      WARN: {geo_type}/{month} → {e}")
                    continue

        await browser.close()

    # Dedup per id
    seen = set()
    deduped = []
    for g in calendar:
        if g["id"] not in seen:
            seen.add(g["id"])
            deduped.append(g)

    return deduped
