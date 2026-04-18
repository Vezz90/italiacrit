"""
results_scraper.py — Scarica i risultati delle singole gare da risultati-strada.federciclismo.it
Nuova versione: Parsing in-page per scrolling list (FCI 2026).
"""
import asyncio
import re
import html
import unicodedata
from difflib import SequenceMatcher
from datetime import datetime
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

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

def match_calendar(race_name, race_date, calendar):
    """Trova la gara nel calendario tramite nome normalizzato + data (con fallback substring)."""
    norm_name = normalize_str(race_name)
    
    # 1. Match esatto (nome + data)
    for g in calendar:
        if g["data"] == race_date and normalize_str(g["nome"]) == norm_name:
            return g
            
    # 2. Match substring (se il nome dell'Excel \u00e8 contenuto nel titolo portal o viceversa)
    for g in calendar:
        g_name = normalize_str(g["nome"])
        if g["data"] == race_date and (g_name in norm_name or norm_name in g_name):
            return g

    # 3. Solo data + fuzzy nome (threshold ridotto)
    for g in calendar:
        if g["data"] == race_date and fuzzy_match(race_name, g["nome"], threshold=0.7):
            return g
            
    # 4. Solo fuzzy nome (senza data, se somiglianza \u00e8 molto alta)
    for g in calendar:
        if fuzzy_match(race_name, g["nome"], threshold=0.85):
            return g
            
    return None

def parse_page_results(html_content, category, calendar):
    """Parsa l'HTML di una pagina di categoria per estrarre tutti i blocchi classifica."""
    soup = BeautifulSoup(html_content, 'html.parser')
    all_extracted = []
    
    # Cerchiamo tutti gli elementi che potrebbero essere titoli o tabelle
    # Scansioniamo linearmente per associare l'ultimo titolo trovato alla tabella successiva
    elements = soup.find_all(['h1', 'h2', 'h3', 'h4', 'strong', 'b', 'p', 'table'])
    
    current_title = None
    
    for el in elements:
        if el.name == 'table':
            if not current_title: continue
            
            rows = el.find_all('tr')
            if not rows: continue
            
            # Data dal titolo (gg/mm/yyyy o gg-mm-yyyy)
            race_date = f"{CURRENT_YEAR}-01-01"
            date_match = re.search(r"(\d{2})[/\-\s](\d{2})[/\-\s](\d{4})", current_title)
            if date_match:
                d, m, y = date_match.groups()
                race_date = f"{y}-{m}-{d}"

            # Pulizia nome (rimuovi data)
            race_name_portal = re.sub(r"(\d{2})[/\-\s](\d{2})[/\-\s](\d{4})", "", current_title).replace(" - ", " ").strip()
            
            matched = match_calendar(race_name_portal, race_date, calendar)
            if not matched:
                continue
                
            final_race_name = matched["nome"]
            final_race_date = matched["data"]
            gara_id = matched["id"]

            race_results = []
            for row in rows:
                try:
                    # Posizione: prima cella numerica
                    pos_el = row.find(['th', 'td'])
                    if not pos_el: continue
                    pos_text = pos_el.get_text().strip()
                    if not re.match(r"^\d+", pos_text.replace("°", "").strip()):
                        continue
                    
                    position = int(re.sub(r"\D", "", pos_text))
                    if position > 10: continue
                    
                    tds = row.find_all('td')
                    idx = 0 if pos_el.name == 'th' else 1
                    if len(tds) <= idx: continue
                    
                    full_name = tds[idx].get_text().strip().upper()
                    parts = full_name.split()
                    if len(parts) < 2: continue
                    cognome = parts[0]
                    nome = " ".join(parts[1:])
                    
                    team = tds[idx+1].get_text().strip().upper() if len(tds) > idx+1 else ""
                    tempo = tds[-1].get_text().strip() if len(tds) > idx+1 else ""
                    
                    race_results.append({
                        "gara_id": gara_id,
                        "nome_gara": final_race_name,
                        "data": final_race_date,
                        "categoria": category,
                        "posizione": position,
                        "nome": nome,
                        "cognome": cognome,
                        "atleta_id": f"{slugify(cognome)}_{slugify(nome)}",
                        "team": team,
                        "team_id": slugify(team) if team else "TEAM_SCONOSCIUTO",
                        "tempo": tempo,
                    })
                except: continue
            
            if race_results:
                all_extracted.extend(race_results)
                print(f"      ✓ Matched: {final_race_name} ({len(race_results)} entries)")
            
            current_title = None # Resetta per il prossimo blocco
            
        else:
            text = el.get_text().strip()
            # Un titolo deve avere una lunghezza minima e non appartenere ai menu
            if len(text) > 12 and not any(kw in text.lower() for kw in ["federciclismo", "risultati", "comunicato", "privacy", "cookie", "scrivici"]):
                current_title = text
            
    return all_extracted

async def scrape_all_results(calendar: list, existing_gara_ids: set = None) -> list[dict]:
    """Scarica tutti i risultati analizzando le pagine di categoria (formato scrolling)."""
    all_results = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        for cat_name, cat_url in CATEGORY_URLS.items():
            print(f"    Analisi Risultati [{cat_name}] ...")
            try:
                await page.goto(cat_url, timeout=30000)
                await page.wait_for_load_state("networkidle", timeout=15000)
                await asyncio.sleep(3) # Attesa caricamento tabelle JS
                
                content = await page.content()
                new_results = parse_page_results(content, cat_name, calendar)
                all_results.extend(new_results)
            except Exception as e:
                print(f"      WARN {cat_name}: {e}")
                continue

        await browser.close()
    return all_results
