import asyncio, requests, json, re, sys, time, unicodedata, html as HTMLMOD, argparse
from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime
from difflib import SequenceMatcher
try:
    from .excel_loader import load_calendar_from_excel
except (ImportError, ValueError):
    from excel_loader import load_calendar_from_excel

CURRENT_YEAR = 2026
DATA_DIR = Path(__file__).parent.parent / "data"

# ═══════════════════════════════════════════════════════════════
# UTILITY
# ═══════════════════════════════════════════════════════════════
def norm(s):
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower()).strip()

def slug(s):
    s = norm(s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

def fuzzy(a, b, thr=0.78):
    return SequenceMatcher(None, norm(a), norm(b)).ratio() >= thr

def get_page(url, session, retries=3):
    for i in range(retries):
        try:
            r = session.get(url, timeout=20)
            r.encoding = "iso-8859-1"
            time.sleep(1.0)
            return BeautifulSoup(r.text, "html.parser"), r.text
        except Exception as e:
            print(f"  retry {i+1}: {e}")
            time.sleep(3)
    return None, ""

BASE_PTS = {1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1}

# ── URL RISULTATI (Unificato sulla homepage) ───────────────────────
RISULTATI_URLS = {
    "Tutte le Categorie": "https://risultati-strada.federciclismo.it/",
}

def _map_cat_from_tag(tag_text: str) -> str:
    """Mappa il testo del tag FCI nella nostra categoria interna."""
    t = tag_text.upper().strip()
    if "ELITE" in t or "UNDER" in t: return "Elite-Under23"
    if "JUNIORES" in t: return "Juniores"
    if "ALLIEV" in t:   return "Allievi"
    if "ESORDIENT" in t: return "Esordienti"
    if "DONNE" in t:    return "Donne"
    return "VARIE"

# ═══════════════════════════════════════════════════════════════
# 1. CALENDARIO (da Excel manuale)
# ═══════════════════════════════════════════════════════════════
# Sostituito lo scraper automatico con il caricamento da Excel


# Mapping categoria FCI + genere → codice interno
CAT_CODES = {
    ("Elite-Under23","M"): "ELI_M", ("Juniores","M"): "JUN_M", ("Allievi","M"): "AL1_M", ("Esordienti","M"): "ES1_M",
    ("Donne","F"): "ELI_F", ("Elite-Under23","F"): "ELI_F", ("Juniores","F"): "JUN_F", ("Allievi","F"): "AL1_F", ("Esordienti","F"): "ES1_F",
    ("Esordienti 1° Anno","M"): "ES1_M", ("Esordienti 2° Anno","M"): "ES2_M", ("Allievi 1° Anno","M"): "AL1_M", ("Allievi 2° Anno","M"): "AL2_M",
}
ALL_CODES = list(dict.fromkeys(CAT_CODES.values()))  # mantiene ordine, dedup

# ═══════════════════════════════════════════════════════════════
# 2. RISULTATI GARE via requests (pagine statiche)
# ═══════════════════════════════════════════════════════════════
def parse_risultati_page(soup: BeautifulSoup, calendar_map: dict, existing_ids: set) -> list[dict]:
    """Parsa la pagina radice dei risultati FCI. 
    Estrae dinamicamente la categoria dal tag <font color="#1a8ad8"> sopra ogni h4.
    """
    results = []
    new_races_count = 0

    h4_races = soup.find_all("h4")

    for h4 in h4_races:
        race_name_raw = HTMLMOD.unescape(h4.get_text(strip=True))
        if not race_name_raw or len(race_name_raw) < 3:
            continue

        # Trova la categoria (tag b > font color=#1a8ad8 sopra h4)
        cat_tag = h4.find_previous(["b", "font"], string=re.compile(r"ELITE|JUN|ALL|ESO|DONNE|GARA", re.I))
        extracted_cat = _map_cat_from_tag(cat_tag.get_text() if cat_tag else "Elite-Under23")

        # Trova data nel contesto
        race_date = ""
        context_text = ""
        p = h4.parent
        full_p_text = p.get_text(" ", strip=True) if p else ""
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", full_p_text)
        if dm:
            race_date, context_text = dm.group(1), full_p_text[:500]

        if not race_date or not race_date.startswith(str(CURRENT_YEAR)):
            continue

        # ── Determina moltiplicatore ──────────────────────────
        cal_entry = _find_in_calendar(race_name_raw, race_date, calendar_map)
        if cal_entry:
            mult, tipo, is_cr, is_ci = cal_entry["moltiplicatore"], cal_entry["tipo"], cal_entry.get("campionato_regionale",False), cal_entry.get("campionato_italiano",False)
        else:
            mult, tipo, is_cr, is_ci = _infer_mult_from_name(race_name_raw, context_text)

        race_gender = "F" if "DONNE" in (cat_tag.get_text().upper() if cat_tag else "") or any(k in race_name_raw.lower() for k in ["donne","femm"]) else "M"
        cat_code = CAT_CODES.get((extracted_cat, race_gender), "ELI_M" if race_gender=="M" else "ELI_F")
        gara_id = slug(race_name_raw) + "_" + race_date + "_" + cat_code

        if gara_id in existing_ids:
            # print(f"  [Skip] {race_name_raw} ({cat_code})")
            continue

        new_races_count += 1
        print(f"  [Nuova Gara] {race_name_raw} ({cat_code})")

        # ── Estrazione Km e Media ────────────────────────────
        km, media, tech_text = "", "", ""
        fs6 = h4.find_next_sibling("div", class_=re.compile(r"fs-6|text-muted", re.I))
        if not fs6: 
            fs6 = h4.find_previous_sibling("div", class_=re.compile(r"fs-6|text-muted", re.I))
        if not fs6 and h4.parent: 
            fs6 = h4.parent.find("div", class_=re.compile(r"fs-6|text-muted", re.I))
        
        tech_text = fs6.get_text(" ", strip=True) if fs6 else (h4.parent.get_text(" ", strip=True) if h4.parent else "")
        dm_ = re.search(r"di Km\.\s*([\d,\.]+)", tech_text, re.I)
        mm_ = re.search(r"media di\s*([\d,\.]+)\s*Km/h", tech_text, re.I)
        if dm_: km = dm_.group(1).replace(",", ".")
        if mm_: media = mm_.group(1).replace(",", ".")

        # Trova tabella
        table = h4.find_next("table") or (h4.parent.find("table") if h4.parent else None)
        if not table: continue

        # Parsa classifica
        for row in table.find_all("tr"):
            th = row.find("th")
            if not th: continue
            pos_raw = th.get_text(strip=True).replace("°","").replace(".","").strip()
            if not pos_raw.isdigit(): continue
            pos = int(pos_raw)
            if pos < 1 or pos > 10: continue

            tds = row.find_all("td")
            if len(tds) < 2: continue

            cognome, nome, team, tempo = "", "", "", ""

            # data-attributes (apostrofi)
            cog_td = row.find("td", {"data-cognome": True})
            if cog_td:
                cognome = HTMLMOD.unescape(cog_td["data-cognome"]).strip().upper()
                nome = HTMLMOD.unescape(cog_td.get("data-nome","")).strip().upper()
                tm_td = row.find("td", {"data-team": True}) or row.find("td", {"data-squadra": True})
                if tm_td: team = HTMLMOD.unescape(tm_td.get("data-team") or tm_td.get("data-squadra")).strip().upper()

            if not cognome:
                raw = HTMLMOD.unescape(tds[0].get_text(strip=True)).upper()
                pp = raw.split("  ", 1) if "  " in raw else raw.split()
                if len(pp)>=2: 
                    cognome, nome = pp[0].strip(), (pp[1].strip() if "  " in raw else " ".join(pp[1:]))
                else: 
                    cognome = pp[0]
            if not team and len(tds) >= 2:
                team = HTMLMOD.unescape(tds[1].get_text(strip=True)).upper().strip()
            if len(tds) >= 3:
                tempo = HTMLMOD.unescape(tds[-1].get_text(strip=True))

            if not cognome: continue

            atleta_id = slug(f"{cognome}_{nome}")
            team_id   = slug(team) if team else "SCONOSCIUTO"
            pts_base  = BASE_PTS.get(pos, 0)
            pts_eff   = pts_base * mult

            results.append({
                "gara_id":   gara_id,
                "nome_gara": race_name_raw,
                "data":      race_date,
                "categoria": extracted_cat,
                "genere":    race_gender,
                "tipo":      tipo,
                "moltiplicatore":      mult,
                "campionato_regionale": is_cr,
                "campionato_italiano":  is_ci,
                "posizione": pos,
                "cognome":   cognome,
                "nome":      nome,
                "atleta_id": atleta_id,
                "team":      team,
                "team_id":   team_id,
                "tempo":     tempo,
                "km":        km,
                "media":     media,
                "punti_base":      pts_base,
                "punti_effettivi": pts_eff,
            })

    return results


def _find_in_calendar(race_name: str, race_date: str, cal_map: dict) -> dict | None:
    """Cerca nel calendario per data esatta, poi fuzzy match sul nome."""
    for entry in cal_map.get(race_date, []):
        if SequenceMatcher(None, norm(race_name), norm(entry["nome"])).ratio() >= 0.70:
            return entry
    return None


def _infer_mult_from_name(race_name: str, context: str) -> tuple[int, str, bool, bool]:
    """Inferisce moltiplicatore dal nome e contesto della gara."""
    n = norm(race_name + " " + context)
    is_ci = any(k in n for k in ["campionato italiano","campionati italiani"])
    is_cr = any(k in n for k in ["campionato regionale","camp. reg"])
    if is_ci: return 3, "internazionale", False, True
    if is_cr: return 2, "nazionale", True, False
    return 1, "regionale", False, False


# ═══════════════════════════════════════════════════════════════
# 3. AGGREGAZIONE con classifiche team per categoria
# ═══════════════════════════════════════════════════════════════

def aggregate(results: list[dict]) -> tuple[dict, dict, dict, dict]:
    athletes, teams = {}, {}
    team_by_cat: dict[str, dict[str, dict]] = {c: {} for c in ALL_CODES}

    for r in results:
        if not str(r["data"]).startswith(str(CURRENT_YEAR)): continue
        aid, tid, pts, pos = r["atleta_id"], r["team_id"], r["punti_effettivi"], r["posizione"]
        cc = CAT_CODES.get((r["categoria"], r["genere"]), "ELI_M" if r["genere"]=="M" else "ELI_F")

        # ── Atleta
        if aid not in athletes:
            athletes[aid] = {
                "id": aid, "nome": r["nome"], "cognome": r["cognome"],
                "team_attuale": r["team"], "team_id": tid,
                "categoria": cc, "genere": r["genere"],
                "punti_totali": 0, "risultati": [],
            }
        athletes[aid]["punti_totali"] += pts
        athletes[aid]["risultati"].append({
            "gara_id": r["gara_id"], "nome_gara": r["nome_gara"],
            "data": r["data"], "posizione": pos,
            "punti_effettivi": pts, "team": r["team"],
        })

        # ── Team globale
        if tid not in teams:
            teams[tid] = {
                "id": tid, "nome": r["team"],
                "punti_totali": 0, "atleti": [],
                "risultati": [], "punti_per_cat": {},
            }
        teams[tid]["punti_totali"] += pts
        if aid not in teams[tid]["atleti"]:
            teams[tid]["atleti"].append(aid)
        teams[tid]["risultati"].append({
            "gara_id": r["gara_id"], "atleta_id": aid,
            "posizione": pos, "punti_effettivi": pts,
        })
        teams[tid]["punti_per_cat"][cc] = teams[tid]["punti_per_cat"].get(cc, 0) + pts

        # ── Team per categoria
        if cc in team_by_cat:
            if tid not in team_by_cat[cc]:
                team_by_cat[cc][tid] = {
                    "team_id": tid, "team_nome": r["team"],
                    "punti": 0, "vittorie": 0, "podi": 0, "atleti": set(),
                }
            team_by_cat[cc][tid]["punti"] += pts
            if pos == 1: team_by_cat[cc][tid]["vittorie"] += 1
            if pos <= 3: team_by_cat[cc][tid]["podi"]    += 1
            team_by_cat[cc][tid]["atleti"].add(aid)

    # ── Classifiche
    athlete_rankings: dict[str, list] = {c: [] for c in ALL_CODES}
    for aid, a in athletes.items():
        cc  = a["categoria"]
        vit = sum(1 for x in a["risultati"] if x["posizione"]==1)
        if cc in athlete_rankings:
            athlete_rankings[cc].append({
                "atleta_id": aid, "cognome": a["cognome"], "nome": a["nome"],
                "team_id": a["team_id"], "team_nome": a["team_attuale"],
                "punti": a["punti_totali"], "vittorie": vit,
            })
    for cc in athlete_rankings:
        athlete_rankings[cc].sort(key=lambda x: (-x["punti"],-x["vittorie"]))
        for i, row in enumerate(athlete_rankings[cc]): row["pos"] = i+1

    team_rankings: dict[str, list] = {}
    for cc, tdict in team_by_cat.items():
        rows = []
        for tid, t in tdict.items():
            rows.append({
                "team_id": tid, "team_nome": t["team_nome"],
                "punti": t["punti"], "vittorie": t["vittorie"],
            })
        rows.sort(key=lambda x: (-x["punti"], -x["vittorie"]))
        for i, row in enumerate(rows): row["pos"] = i+1
        team_rankings[cc] = rows

    return athletes, teams, athlete_rankings, team_rankings


# ═══════════════════════════════════════════════════════════════
# MAIN / CYCLE
# ═══════════════════════════════════════════════════════════════
async def run_cycle():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)
    (DATA_DIR / "team_rankings").mkdir(exist_ok=True)

    print(f"\n--- SCRAPER COMPLETATO ---")
    # Caricamento calendario da Excel manuale (come richiesto)
    calendar = load_calendar_from_excel(DATA_DIR / "calendario_manuale_v2.xlsx")
    cal_by_date = {}
    for g in calendar: cal_by_date.setdefault(g["data"], []).append(g)

    SESSION = requests.Session()
    SESSION.headers.update({"User-Agent": "Mozilla/5.0", "Accept-Language": "it-IT"})

    # 1. Caricamento risultati esistenti per scraping incrementale
    results_path = DATA_DIR / "results_raw.json"
    all_results = []
    if results_path.exists():
        try:
            with open(results_path, "r", encoding="utf-8") as f:
                all_results = json.load(f)
            print(f"Caricati {len(all_results)} risultati esistenti.")
        except:
            print("Errore caricamento risultati, inizio da zero.")

    existing_ids = {r["gara_id"] for r in all_results}
    races_map = {}
    
    # Ricostruisce races_map dai risultati esistenti
    for r in all_results:
        gid = r["gara_id"]
        if gid not in races_map:
            races_map[gid] = {
                "id": gid, "nome": r["nome_gara"], "data": r["data"],
                "categoria": r["categoria"], "genere": r["genere"],
                "tipo": r["tipo"], "moltiplicatore": r["moltiplicatore"],
                "km": r.get("km", ""), "media": r.get("media", ""),
            }

    for label, url in RISULTATI_URLS.items():
        print(f"Scraping [{label}]...")
        soup, _ = get_page(url, SESSION)
        if not soup: continue

        new_results = parse_risultati_page(soup, cal_by_date, existing_ids)
        all_results.extend(new_results)
        for res in new_results:
            gid = res["gara_id"]
            if gid not in races_map:
                races_map[gid] = {
                    "id": gid, "nome": res["nome_gara"], "data": res["data"],
                    "categoria": res["categoria"], "genere": res["genere"],
                    "tipo": res["tipo"], "moltiplicatore": res["moltiplicatore"],
                    "km": res.get("km", ""), "media": res.get("media", ""),
                }

    for g in calendar:
        if g["id"] not in races_map: races_map[g["id"]] = g

    athletes, teams, a_rank, t_rank = aggregate(all_results)
    
    def wj(path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    wj(DATA_DIR/"results_raw.json", all_results)
    wj(DATA_DIR/"calendar.json", sorted(races_map.values(), key=lambda g: g["data"], reverse=True))
    wj(DATA_DIR/"athletes.json", athletes)
    wj(DATA_DIR/"teams.json", teams)
    for code, rows in a_rank.items(): wj(DATA_DIR/f"rankings/{code}.json", rows)
    for code, rows in t_rank.items(): wj(DATA_DIR/f"team_rankings/{code}.json", rows)
    
    print(f"\nCiclo completato: {len(all_results)} risultati totali.")

async def main():
    parser = argparse.ArgumentParser(description="Scraper Italiacrit Continuo")
    parser.add_argument("--loop", action="store_true", help="Esegue lo scraper in loop continuo")
    parser.add_argument("--interval", type=int, default=30, help="Intervallo in minuti tra i cicli (default: 30)")
    args = parser.parse_args()

    if args.loop:
        print(f"MODALITÀ CONTINUA ATTIVATA (Ogni {args.interval} minuti)")
        while True:
            try:
                await run_cycle()
                print(f"\n--- In attesa del prossimo ciclo (tra {args.interval}m) ---")
                await asyncio.sleep(args.interval * 60)
            except KeyboardInterrupt:
                print("\nInterruzione manuale rilevata. Uscita...")
                break
            except Exception as e:
                print(f"\nERRORE CRITICO DURANTE IL CICLO: {e}")
                print("Riprovo tra 60 secondi...")
                await asyncio.sleep(60)
    else:
        await run_cycle()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
