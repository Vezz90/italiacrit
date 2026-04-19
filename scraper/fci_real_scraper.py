"""
fci_real_scraper.py — Scraper reale FCI robusto
Raccoglie dati veri da:
  - risultati-strada.federciclismo.it   (risultati gare)
  - federciclismo.it/ricerca-gare/      (calendario)

Usa requests+bs4 per pagine statiche, Playwright solo quando necessario.
Encoding: ISO-8859-1

Esegui: python scraper/fci_real_scraper.py
"""
import asyncio
import sys
import json
import re
import html
import unicodedata
import time
from pathlib import Path
from datetime import datetime
from difflib import SequenceMatcher

import requests
from bs4 import BeautifulSoup

# ─── Playwright import (solo se disponibile) ─────────────────────────────────
try:
    from playwright.async_api import async_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    print("WARN: playwright non disponibile, uso solo requests")

# ─── COSTANTI ─────────────────────────────────────────────────────────────────
CURRENT_YEAR = datetime.now().year
DATA_DIR = Path(__file__).parent.parent / "data"

BASE_RISULTATI = "https://risultati-strada.federciclismo.it"
BASE_CALENDAR  = "https://www.federciclismo.it"

# Pagine lista risultati per categoria
CATEGORY_PAGES = {
    "Elite-Under23": f"{BASE_RISULTATI}/risultati_gare_elite-under23.htm",
    "Juniores":      f"{BASE_RISULTATI}/risultati_gare_juniores.htm",
    "Allievi":       f"{BASE_RISULTATI}/risultati_gare_allievi.htm",
    "Esordienti":    f"{BASE_RISULTATI}/risultati_gare_esordienti.htm",
    "Donne":         f"{BASE_RISULTATI}/risultati_gare_donne.htm",
}

BASE_POINTS = {1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1}
MULTIPLIERS = {"regionale":1, "nazionale":2, "internazionale":3}

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "it-IT,it;q=0.9",
})


# ─── UTILITY ──────────────────────────────────────────────────────────────────
def normalize(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower()).strip()


def slugify(s: str) -> str:
    s = normalize(s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", "_", s).strip("_").upper()


def get_page(url: str, retries: int = 3) -> BeautifulSoup | None:
    """Scarica una pagina con requests, encoding ISO-8859-1."""
    for attempt in range(retries):
        try:
            r = SESSION.get(url, timeout=20)
            r.encoding = "iso-8859-1"
            time.sleep(1.5)
            return BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            print(f"      retry {attempt+1}/{retries} — {url}: {e}")
            time.sleep(3)
    return None


def fuzzy_match(a: str, b: str, thr: float = 0.80) -> bool:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio() >= thr


def detect_gender(name: str, cat: str) -> str:
    combined = (name + " " + cat).lower()
    if any(k in combined for k in ["donne", "femm", "allieve", "donna", "women"]):
        return "F"
    return "M"


def detect_tipo(name: str, cat_type: int) -> str:
    n = normalize(name)
    if "campionato italiano" in n or "campionati italiani" in n:
        return "internazionale"
    if cat_type == 3:
        return "internazionale"
    if cat_type == 2 or "campionato regionale" in n or "camp. reg" in n:
        return "nazionale"
    return "regionale"


def get_multiplier(tipo: str, is_cr: bool, is_ci: bool) -> int:
    if is_ci or tipo == "internazionale":
        return 3
    if is_cr or tipo == "nazionale":
        return 2
    return 1


# ─── SCRAPE LISTA GARE (pagina categoria) ────────────────────────────────────
def scrape_race_list(cat_name: str, cat_url: str) -> list[dict]:
    """
    Restituisce lista di gare dalla pagina categoria FCI risultati.
    Ogni gara: {nome, data, url, categoria}
    """
    print(f"    Lista gare [{cat_name}]…")
    soup = get_page(cat_url)
    if not soup:
        return []

    races = []
    seen = set()

    # Cerca link a singole gare — FCI usa varie strutture
    # Pattern 1: link con "classifica" nell'href
    for a in soup.find_all("a", href=True):
        href = a["href"]
        link_text = a.get_text(strip=True)

        # Filtra link vuoti o di navigazione
        if not link_text or len(link_text) < 4:
            continue
        if any(k in href.lower() for k in ["javascript", "mailto", "#", "federciclismo.it/it/"]):
            continue
        # Cerca link che portino a pagine di classifica/risultati
        if not any(k in href.lower() for k in ["classifica", "risultati", "gare", ".htm", ".html"]):
            continue

        full_url = href if href.startswith("http") else (BASE_RISULTATI + "/" + href.lstrip("/"))

        # Cerca data nel testo del parent (spesso in una cella affianco)
        parent_text = ""
        for parent in [a.parent, a.parent.parent if a.parent else None]:
            if parent:
                parent_text += parent.get_text(" ", strip=True)

        date_iso = _extract_date(parent_text) or _extract_date(href)

        if not date_iso or not date_iso.startswith(str(CURRENT_YEAR)):
            continue

        gara_id = slugify(link_text) + "_" + date_iso
        if gara_id in seen:
            continue
        seen.add(gara_id)

        races.append({
            "id": gara_id,
            "nome": html.unescape(link_text),
            "data": date_iso,
            "url": full_url,
            "categoria": cat_name,
            "genere": detect_gender(link_text, cat_name),
        })

    # Se non trova nulla con il metodo sopra, prova a cercare tabelle
    if not races:
        for table in soup.find_all("table"):
            for row in table.find_all("tr"):
                cells = row.find_all(["td", "th"])
                if len(cells) < 2:
                    continue
                row_text = row.get_text(" ", strip=True)
                date_iso = _extract_date(row_text)
                if not date_iso or not date_iso.startswith(str(CURRENT_YEAR)):
                    continue
                a_tag = row.find("a", href=True)
                if not a_tag:
                    continue
                nome = html.unescape(a_tag.get_text(strip=True))
                if len(nome) < 4:
                    continue
                href = a_tag["href"]
                full_url = href if href.startswith("http") else (BASE_RISULTATI + "/" + href.lstrip("/"))
                gara_id = slugify(nome) + "_" + date_iso
                if gara_id in seen:
                    continue
                seen.add(gara_id)
                races.append({
                    "id": gara_id,
                    "nome": nome,
                    "data": date_iso,
                    "url": full_url,
                    "categoria": cat_name,
                    "genere": detect_gender(nome, cat_name),
                })

    print(f"      → {len(races)} gare trovate")
    return races


def _extract_date(text: str) -> str | None:
    """Estrae data ISO da testo in vari formati."""
    if not text:
        return None
    # formato YYYY-MM-DD o YYYY/MM/DD nell'URL
    m = re.search(r"(\d{4})[/_-](\d{2})[/_-](\d{2})", text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # formato DD/MM/YYYY o DD-MM-YYYY nel testo
    m = re.search(r"(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})", text)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    # formato "15 aprile 2026" o "15 apr 2026"
    mesi = {"gen":1,"feb":2,"mar":3,"apr":4,"mag":5,"giu":6,
            "lug":7,"ago":8,"set":9,"ott":10,"nov":11,"dic":12,
            "gennaio":1,"febbraio":2,"marzo":3,"aprile":4,"maggio":5,"giugno":6,
            "luglio":7,"agosto":8,"settembre":9,"ottobre":10,"novembre":11,"dicembre":12}
    m = re.search(r"(\d{1,2})\s+(" + "|".join(mesi.keys()) + r")\s+(\d{4})", text.lower())
    if m:
        d, nome_mese, y = m.groups()
        return f"{y}-{mesi.get(nome_mese,1):02d}-{int(d):02d}"
    return None


# ─── SCRAPE CLASSIFICA SINGOLA GARA ──────────────────────────────────────────
async def scrape_race_classifica_playwright(page, gara: dict) -> list[dict]:
    """Usa Playwright per pagine JS-rendered."""
    results = []
    try:
        await page.goto(gara["url"], timeout=25000, wait_until="domcontentloaded")
        # Attendi tabella classifica
        try:
            await page.wait_for_selector(
                "table.classifica, table#classifica, #classifica, table",
                timeout=12000
            )
        except:
            pass
        await asyncio.sleep(1.5)

        # Prova prima con requests (più veloce)
        content = await page.content()
        soup = BeautifulSoup(content, "html.parser")
        results = _parse_classifica_soup(soup, gara)
    except Exception as e:
        print(f"      WARN playwright [{gara['nome']}]: {e}")
    return results


def scrape_race_classifica_requests(gara: dict) -> list[dict]:
    """Usa requests per pagine statiche."""
    soup = get_page(gara["url"])
    if not soup:
        return []
    return _parse_classifica_soup(soup, gara)


def _parse_classifica_soup(soup: BeautifulSoup, gara: dict) -> list[dict]:
    """Estrae la classifica da un BeautifulSoup — cuore del parser FCI."""
    results = []

    # Cerca tabelle
    tables = soup.find_all("table")
    if not tables:
        return []

    # Prendi la tabella più grande (likely la classifica)
    best_table = max(tables, key=lambda t: len(t.find_all("tr")), default=None)
    if not best_table:
        return []

    for row in best_table.find_all("tr"):
        try:
            # CRITICO: posizione in <th>
            th = row.find("th")
            if not th:
                continue
            pos_text = th.get_text(strip=True).replace("°", "").replace(".", "").strip()
            if not pos_text.isdigit():
                continue
            pos = int(pos_text)
            if pos > 10 or pos < 1:
                continue

            tds = row.find_all("td")
            if not tds:
                continue

            # Nome/cognome: cerca data-attributes prima (gestione apostrofi)
            cognome = ""
            nome = ""
            team = ""
            tempo = ""

            for td in tds:
                if td.get("data-cognome"):
                    cognome = html.unescape(td["data-cognome"]).strip().upper()
                if td.get("data-nome"):
                    nome = html.unescape(td["data-nome"]).strip().upper()
                if td.get("data-team"):
                    team = html.unescape(td["data-team"]).strip().upper()

            # Fallback testo diretto
            if not cognome and tds:
                raw = html.unescape(tds[0].get_text(strip=True)).upper()
                parts = raw.split()
                if len(parts) >= 2:
                    cognome = parts[0]
                    nome = " ".join(parts[1:])
                else:
                    cognome = raw

            # Team (cerca in tutti i td non ancora usati)
            if not team:
                for td in tds[1:]:
                    txt = html.unescape(td.get_text(strip=True)).upper()
                    if txt and len(txt) > 2 and not re.match(r"^\d", txt):
                        team = txt
                        break

            # Tempo (ultimo td numerico o con "+" o con "'")
            if tds:
                last_td = html.unescape(tds[-1].get_text(strip=True))
                if re.search(r"[\d:'\"]+", last_td):
                    tempo = last_td

            if not cognome:
                continue

            atleta_id = slugify(f"{cognome}_{nome}") if nome else slugify(cognome)
            team_id = slugify(team) if team else "SCONOSCIUTO"
            gara_id = gara["id"]

            results.append({
                "gara_id": gara_id,
                "nome_gara": gara["nome"],
                "data": gara["data"],
                "categoria": gara["categoria"],
                "genere": gara["genere"],
                "tipo": gara.get("tipo", "regionale"),
                "posizione": pos,
                "cognome": cognome,
                "nome": nome,
                "atleta_id": atleta_id,
                "team": team,
                "team_id": team_id,
                "tempo": tempo,
            })

        except Exception:
            continue

    return results


# ─── CALENDARIO FCI ───────────────────────────────────────────────────────────
def scrape_calendar_month(month: int, geo_cat: int) -> list[dict]:
    """Scarica un singolo mese/tipo dal calendario FCI."""
    tipo = {1: "regionale", 2: "nazionale", 3: "internazionale"}[geo_cat]
    url = f"{BASE_CALENDAR}/ricerca-gare/?site=strada_it&mese={month:02d}&geo_category={geo_cat}"
    soup = get_page(url)
    if not soup:
        return []

    gare = []
    seen = set()

    # FCI calendario usa una tabella o lista con le gare
    for row in soup.find_all(["tr", "li", "div"], {"class": re.compile(r"gara|race|result|event", re.I)}):
        text = row.get_text(" ", strip=True)
        if not text or len(text) < 5:
            continue

        date_iso = _extract_date(text)
        if not date_iso or not date_iso.startswith(str(CURRENT_YEAR)):
            continue

        a_tag = row.find("a")
        nome = html.unescape(a_tag.get_text(strip=True)) if a_tag else text[:60]
        if len(nome) < 3:
            continue

        is_cr = any(k in normalize(nome) for k in ["campionato regionale", "camp reg"])
        is_ci = any(k in normalize(nome) for k in ["campionati italiani", "campionato italiano", "camp ital"])
        tipo_final = "internazionale" if is_ci or geo_cat == 3 else ("nazionale" if is_cr or geo_cat == 2 else "regionale")

        gender = detect_gender(nome, "")
        gender_suffix = " DONNE" if gender == "F" and "DONNE" not in nome.upper() else ""
        nome_display = nome + gender_suffix

        gara_id = slugify(nome_display) + "_" + date_iso
        if gara_id in seen:
            continue
        seen.add(gara_id)

        gare.append({
            "id": gara_id,
            "nome": nome_display,
            "data": date_iso,
            "mese": int(date_iso[5:7]),
            "anno": CURRENT_YEAR,
            "categoria": "Varie",
            "genere": gender,
            "tipo": tipo_final,
            "campionato_regionale": is_cr,
            "campionato_italiano": is_ci,
            "url": None,
        })

    return gare


# ─── PIPELINE PRINCIPALE ──────────────────────────────────────────────────────
async def run():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  FCI REAL SCRAPER — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    # ── 1. CALENDARIO ────────────────────────────────────────────
    print("[1/4] Scarico calendario FCI…")
    calendar = []
    for geo_cat in [1, 2, 3]:
        tipo = {1:"regionale",2:"nazionale",3:"internazionale"}[geo_cat]
        for month in range(1, 13):
            print(f"    [{tipo}] mese {month:02d}…", end=" ")
            gare = scrape_calendar_month(month, geo_cat)
            print(f"{len(gare)} gare")
            calendar.extend(gare)
            time.sleep(1)

    # Dedup calendario
    cal_seen = set()
    calendar_dedup = []
    for g in calendar:
        if g["id"] not in cal_seen:
            cal_seen.add(g["id"])
            calendar_dedup.append(g)
    print(f"    → Totale calendario: {len(calendar_dedup)} gare\n")

    # ── 2. LISTA GARE con RISULTATI ──────────────────────────────
    print("[2/4] Scarico lista gare con risultati…")
    all_race_entries = []  # gare con url per scraping classifica
    for cat_name, cat_url in CATEGORY_PAGES.items():
        races = scrape_race_list(cat_name, cat_url)
        all_race_entries.extend(races)

    # Abbina con calendario per tipo/moltiplicatore
    cal_by_id = {g["id"]: g for g in calendar_dedup}
    for race in all_race_entries:
        cal_entry = cal_by_id.get(race["id"])
        if cal_entry:
            race["tipo"] = cal_entry["tipo"]
            race["campionato_regionale"] = cal_entry.get("campionato_regionale", False)
            race["campionato_italiano"] = cal_entry.get("campionato_italiano", False)
        else:
            # Cerca per fuzzy match
            for cg in calendar_dedup:
                if cg["data"] == race["data"] and fuzzy_match(race["nome"], cg["nome"]):
                    race["tipo"] = cg["tipo"]
                    break
            if "tipo" not in race:
                race["tipo"] = "regionale"
        race["campionato_regionale"] = race.get("campionato_regionale", False)
        race["campionato_italiano"] = race.get("campionato_italiano", False)

    print(f"    → {len(all_race_entries)} gare con URL per scraping\n")

    # ── 3. SCRAPING CLASSIFICHE ───────────────────────────────────
    print("[3/4] Scraping classifiche…")
    all_results = []

    if HAS_PLAYWRIGHT and all_race_entries:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.set_extra_http_headers({"Accept-Language": "it-IT"})

            for i, race in enumerate(all_race_entries):
                print(f"    [{i+1}/{len(all_race_entries)}] {race['nome'][:50]}…", end=" ")

                # Prima prova requests (veloce)
                results = scrape_race_classifica_requests(race)

                # Se vuoto prova Playwright (JS-rendered)
                if not results:
                    results = await scrape_race_classifica_playwright(page, race)

                print(f"{len(results)} risultati")
                all_results.extend(results)
                await asyncio.sleep(1.5)

            await browser.close()
    else:
        # Solo requests
        for i, race in enumerate(all_race_entries):
            print(f"    [{i+1}/{len(all_race_entries)}] {race['nome'][:50]}…", end=" ")
            results = scrape_race_classifica_requests(race)
            print(f"{len(results)} risultati")
            all_results.extend(results)

    print(f"    → Totale risultati: {len(all_results)}\n")

    # ── 4. CALCOLO PUNTI e SCRITTURA JSON ───────────────────────
    print("[4/4] Calcolo punti e scrittura JSON…")
    sys.path.insert(0, str(Path(__file__).parent))
    from points_calculator import calculate_all
    from json_builder import write_all_json

    athletes, teams, rankings = calculate_all(calendar_dedup, all_results)

    # Aggiungi anche le gare dal calendario non ancora nei risultati
    # (gare future o senza classifica pubblicata)
    results_ids = {r["gara_id"] for r in all_results}
    for race in all_race_entries:
        if race["id"] not in cal_by_id and race["id"] not in cal_seen:
            calendar_dedup.append({
                "id": race["id"],
                "nome": race["nome"],
                "data": race["data"],
                "mese": int(race["data"][5:7]) if race.get("data") else 0,
                "anno": CURRENT_YEAR,
                "categoria": race["categoria"],
                "genere": race["genere"],
                "tipo": race.get("tipo", "regionale"),
                "campionato_regionale": race.get("campionato_regionale", False),
                "campionato_italiano": race.get("campionato_italiano", False),
                "url": race.get("url"),
            })

    write_all_json(calendar_dedup, all_results, athletes, teams, rankings, DATA_DIR)

    meta = {
        "last_update": datetime.now().isoformat(),
        "total_races": len(all_race_entries),
        "total_results": len(all_results),
        "total_athletes": len(athletes),
        "total_teams": len(teams),
        "seed_mode": False,
    }
    with open(DATA_DIR / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"  COMPLETATO! Atleti: {len(athletes)} | Team: {len(teams)}")
    print(f"  Risultati: {len(all_results)} | Gare calendario: {len(calendar_dedup)}")
    print(f"{'='*60}\n")

    # Stampa anteprima risultati
    if all_results:
        print("  Ultime 5 gare con risultati:")
        seen_g = set()
        count = 0
        for r in sorted(all_results, key=lambda x: x["data"], reverse=True):
            if r["gara_id"] not in seen_g:
                seen_g.add(r["gara_id"])
                print(f"    {r['data']} — {r['nome_gara']}")
                count += 1
                if count >= 5:
                    break


if __name__ == "__main__":
    asyncio.run(run())
