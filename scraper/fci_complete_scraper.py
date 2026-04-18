"""
fci_complete_scraper.py — Scraper completo FCI con:
1. Tutte le gare della stagione (via calendario Playwright geo_category 1/2/3)
2. Moltiplicatori da geo_category del calendario (1=×1, 2=×2, 3=×3)
3. Classifiche team per categoria

Il calendario FCI (federciclismo.it/ricerca-gare) è JS-rendered → Playwright.
I risultati individuali (risultati-strada.federciclismo.it) sono statici → requests.

Esegui: python scraper/fci_complete_scraper.py
"""
import asyncio, requests, json, re, sys, time, unicodedata, html as HTMLMOD
from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime
from difflib import SequenceMatcher

try:
    from playwright.async_api import async_playwright
    HAS_PW = True
except ImportError:
    HAS_PW = False
    print("WARN: playwright non disponibile")

CURRENT_YEAR = datetime.now().year
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

RISULTATI_URLS = {
    "Elite-Under23": "https://risultati-strada.federciclismo.it/risultati_gare_elite-under23.htm",
    "Juniores":       "https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm",
    "Allievi":        "https://risultati-strada.federciclismo.it/risultati_gare_allievi.htm",
    "Esordienti":     "https://risultati-strada.federciclismo.it/risultati_gare_esordienti.htm",
    "Donne":          "https://risultati-strada.federciclismo.it/risultati_gare_donne.htm",
}

# ═══════════════════════════════════════════════════════════════
# 1. CALENDARIO FCI via Playwright (unico modo, JS-rendered)
# ═══════════════════════════════════════════════════════════════
async def scrape_calendar_playwright() -> list[dict]:
    """
    Scarica il calendario da federciclismo.it/ricerca-gare per ogni mese e
    geo_category (1=regionale ×1, 2=nazionale ×2, 3=internazionale ×3).
    """
    calendar = []
    seen = set()

    GEO_MAP = {
        1: ("regionale",      1, False, False),
        2: ("nazionale",      2, False, False),   # include CR
        3: ("internazionale", 3, False, False),
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_extra_http_headers({"Accept-Language": "it-IT"})

        for geo_cat, (tipo, mult, _, __) in GEO_MAP.items():
            for month in range(1, 13):
                url = (f"https://www.federciclismo.it/ricerca-gare/"
                       f"?site=strada_it&mese={month:02d}&geo_category={geo_cat}")
                print(f"  Cal [{tipo}] mese {month:02d}… ", end="", flush=True)
                try:
                    await page.goto(url, timeout=25000, wait_until="domcontentloaded")
                    # Attendi il contenuto dinamico
                    try:
                        await page.wait_for_selector(".risultati-gare, .gara-item, table, .elenco", timeout=8000)
                    except:
                        pass
                    await asyncio.sleep(1.5)

                    content = await page.content()
                    soup = BeautifulSoup(content, "html.parser")
                    raw_text = soup.get_text(" ", strip=True)

                    count = 0
                    # Cerca tutte le date + nomi gare nella pagina
                    # Pattern FCI calendario: data + nome gara su elementi consecutivi
                    
                    # Metodo 1: cerca elementi con data
                    for el in soup.find_all(text=re.compile(r"\d{2}/\d{2}/\d{4}")):
                        parent = el.parent
                        if not parent:
                            continue
                        container = parent
                        # Sali fino a trovare il blocco gara
                        for _ in range(5):
                            if container.get("class"):
                                break
                            container = container.parent or container

                        ctxt = container.get_text(" ", strip=True)
                        dm = re.search(r"(\d{2})/(\d{2})/(\d{4})", ctxt)
                        if not dm:
                            continue
                        d_, m_, y_ = dm.groups()
                        date_iso = f"{y_}-{m_}-{d_}"
                        if not date_iso.startswith(str(CURRENT_YEAR)):
                            continue

                        # Nome gara: rimuovi data e testo irrilevante
                        nome = re.sub(r"\d{2}/\d{2}/\d{4}", "", ctxt)
                        nome = re.sub(r"\s+", " ", nome).strip()[:100]
                        if len(nome) < 4:
                            continue

                        is_ci = any(k in norm(nome) for k in [
                            "campionato italiano", "campionati italiani", "camp. ital"
                        ])
                        is_cr = any(k in norm(nome) for k in [
                            "campionato regionale", "camp. reg", "c.r."
                        ]) or (geo_cat == 2 and not is_ci)

                        tipo_final = "internazionale" if is_ci or geo_cat == 3 else (
                            "nazionale" if is_cr or geo_cat == 2 else "regionale")
                        mult_final = 3 if tipo_final == "internazionale" else (
                            2 if tipo_final == "nazionale" else 1)

                        gender = "F" if any(k in norm(nome) for k in
                                           ["donne", "femm", "allieve"]) else "M"
                        gara_id = slug(nome) + "_" + date_iso
                        if gara_id in seen:
                            continue
                        seen.add(gara_id)

                        calendar.append({
                            "id": gara_id,
                            "nome": HTMLMOD.unescape(nome),
                            "data": date_iso,
                            "mese": int(m_),
                            "anno": CURRENT_YEAR,
                            "categoria": "Varie",
                            "genere": gender,
                            "tipo": tipo_final,
                            "geo_category": geo_cat,
                            "moltiplicatore": mult_final,
                            "campionato_regionale": is_cr,
                            "campionato_italiano": is_ci,
                        })
                        count += 1

                    # Metodo 2: cerca in tabelle/liste
                    if count == 0:
                        for row in soup.find_all(["tr", "li"]):
                            rtxt = row.get_text(" ", strip=True)
                            dm2 = re.search(r"(\d{2})/(\d{2})/(\d{4})", rtxt)
                            if not dm2:
                                continue
                            d_, m_, y_ = dm2.groups()
                            date_iso = f"{y_}-{m_}-{d_}"
                            if not date_iso.startswith(str(CURRENT_YEAR)):
                                continue
                            nome2 = re.sub(r"\d{2}/\d{2}/\d{4}", "", rtxt)
                            nome2 = re.sub(r"\s+", " ", nome2).strip()[:100]
                            if len(nome2) < 4:
                                continue
                            is_ci = any(k in norm(nome2) for k in ["campionato italiano","campionati italiani"])
                            is_cr = any(k in norm(nome2) for k in ["campionato regionale","camp. reg"]) or (geo_cat==2 and not is_ci)
                            tipo_f = "internazionale" if is_ci or geo_cat==3 else ("nazionale" if geo_cat==2 else "regionale")
                            mult_f = 3 if tipo_f=="internazionale" else (2 if tipo_f=="nazionale" else 1)
                            gender = "F" if any(k in norm(nome2) for k in ["donne","femm","allieve"]) else "M"
                            gid = slug(nome2) + "_" + date_iso
                            if gid in seen:
                                continue
                            seen.add(gid)
                            calendar.append({
                                "id": gid, "nome": HTMLMOD.unescape(nome2),
                                "data": date_iso, "mese": int(m_), "anno": CURRENT_YEAR,
                                "categoria": "Varie", "genere": gender,
                                "tipo": tipo_f, "geo_category": geo_cat,
                                "moltiplicatore": mult_f,
                                "campionato_regionale": is_cr, "campionato_italiano": is_ci,
                            })
                            count += 1

                    print(f"{count}")
                except Exception as e:
                    print(f"ERR: {e}")
                    continue

        await browser.close()

    print(f"  → Calendario totale: {len(calendar)} gare")
    return sorted(calendar, key=lambda g: g["data"], reverse=True)


# ═══════════════════════════════════════════════════════════════
# 2. RISULTATI GARE via requests (pagine statiche)
#    Strategia migliorata per catturare TUTTE le gare:
#    - Pagina principale categoria (ultime ~6 gare)
#    - Pagina archivio precedente (se esiste)
#    - Il calendario viene usato per assegnare il moltiplicatore corretto
# ═══════════════════════════════════════════════════════════════
def parse_risultati_page(cat_name: str, soup: BeautifulSoup, calendar_map: dict) -> list[dict]:
    """Parsa una pagina risultati FCI. Struttura verificata:
    - h4[color:#1a8ad8] = nome gara
    - div prima dell'h4 contiene: "CATEGORIA YYYY-MM-DD - REGIONE COMUNE (PROV)"
    - div.table-responsive > table con th=posizione, td1=atleta, td2=squadra
    """
    results = []
    gender_base = "F" if "donne" in cat_name.lower() or "alliev" in cat_name.lower() else "M"

    h4_races = soup.find_all("h4", style=re.compile(r"color\s*:\s*#1a8ad8", re.I))
    if not h4_races:
        h4_races = soup.find_all("h4")

    for h4 in h4_races:
        race_name_raw = HTMLMOD.unescape(h4.get_text(strip=True))
        if not race_name_raw or len(race_name_raw) < 3:
            continue

        # Trova data nel contesto
        race_date = ""
        context_text = ""

        # Cerca nei sibling precedenti
        el = h4
        for _ in range(20):
            el = el.find_previous_sibling()
            if el is None:
                break
            etxt = el.get_text(" ", strip=True) if hasattr(el, 'get_text') else ""
            dm = re.search(r"(\d{4}-\d{2}-\d{2})", etxt)
            if dm:
                race_date = dm.group(1)
                context_text = etxt
                break

        if not race_date:
            # Cerca nel parent
            p = h4.parent
            for _ in range(6):
                if p is None: break
                ptxt = p.get_text(" ", strip=True)
                dm = re.search(r"(\d{4}-\d{2}-\d{2})", ptxt)
                if dm:
                    race_date = dm.group(1)
                    context_text = ptxt[:300]
                    break
                p = p.parent

        if not race_date or not race_date.startswith(str(CURRENT_YEAR)):
            continue

        # ── Determina moltiplicatore ──────────────────────────
        # Strategia: cerca nel calendario per data + nome (fuzzy)
        cal_entry = _find_in_calendar(race_name_raw, race_date, calendar_map)
        if cal_entry:
            mult = cal_entry["moltiplicatore"]
            tipo = cal_entry["tipo"]
            is_cr = cal_entry["campionato_regionale"]
            is_ci = cal_entry["campionato_italiano"]
        else:
            # Fallback: inferisci dal nome
            mult, tipo, is_cr, is_ci = _infer_mult_from_name(race_name_raw, context_text)

        race_gender = "F" if any(k in norm(race_name_raw + cat_name) for k in
                                 ["donne", "femm", "allieve", "donna"]) else "M"
        gara_id = slug(race_name_raw) + "_" + race_date

        # Trova tabella
        table = h4.find_next("table")
        if not table:
            if h4.parent:
                table = h4.parent.find("table")
        if not table:
            continue

        # Parsa classifica
        for row in table.find_all("tr"):
            th = row.find("th")
            if not th:
                continue
            pos_raw = th.get_text(strip=True).replace("░","").replace("°","").replace(".","").strip()
            if not pos_raw.isdigit():
                continue
            pos = int(pos_raw)
            if pos < 1 or pos > 10:
                continue

            tds = row.find_all("td")
            if not tds:
                continue

            cognome, nome, team, tempo = "", "", "", ""

            # data-attributes (apostrofi)
            for td in tds:
                if td.get("data-cognome"):
                    cognome = HTMLMOD.unescape(td["data-cognome"]).strip().upper()
                if td.get("data-nome"):
                    nome = HTMLMOD.unescape(td["data-nome"]).strip().upper()
                if td.get("data-team") or td.get("data-squadra"):
                    team = HTMLMOD.unescape(td.get("data-team","") or td.get("data-squadra","")).strip().upper()

            # Fallback testo
            if not cognome and tds:
                raw = HTMLMOD.unescape(tds[0].get_text(strip=True)).upper()
                raw = re.sub(r"\s{2,}", "  ", raw).strip()
                if "  " in raw:
                    pp = raw.split("  ", 1)
                    cognome, nome = pp[0].strip(), pp[1].strip()
                else:
                    pp = raw.split()
                    cognome = pp[0] if pp else ""
                    nome = " ".join(pp[1:]) if len(pp)>1 else ""

            if not team and len(tds) >= 2:
                t2 = HTMLMOD.unescape(tds[1].get_text(strip=True)).upper()
                t2 = re.sub(r"\s+", " ", t2).strip()
                if t2 and len(t2) > 2:
                    team = t2

            if len(tds) >= 3:
                tempo = HTMLMOD.unescape(tds[-1].get_text(strip=True))

            if not cognome:
                continue

            atleta_id = slug(f"{cognome}_{nome}") if nome else slug(cognome)
            team_id   = slug(team) if team else "SCONOSCIUTO"
            pts_base  = BASE_PTS.get(pos, 0)
            pts_eff   = pts_base * mult

            results.append({
                "gara_id":   gara_id,
                "nome_gara": race_name_raw,
                "data":      race_date,
                "categoria": cat_name,
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
                "punti_base":      pts_base,
                "punti_effettivi": pts_eff,
            })

    return results


def _find_in_calendar(race_name: str, race_date: str, cal_map: dict) -> dict | None:
    """Cerca nel calendario per data esatta, poi fuzzy match sul nome."""
    # Cerca per data
    by_date = cal_map.get(race_date, [])
    if not by_date:
        return None

    # Cerca fuzzy match sul nome
    best = None
    best_ratio = 0.0
    for entry in by_date:
        ratio = SequenceMatcher(None, norm(race_name), norm(entry["nome"])).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best = entry

    if best_ratio >= 0.70:
        return best
    return None


def _infer_mult_from_name(race_name: str, context: str) -> tuple[int, str, bool, bool]:
    """Inferisce moltiplicatore dal nome e contesto della gara."""
    n = norm(race_name + " " + context)
    is_ci = any(k in n for k in ["campionato italiano","campionati italiani","camp. ital"])
    is_cr = any(k in n for k in ["campionato regionale","camp. reg","prova valida campionato","valida per"])
    if is_ci:
        return 3, "internazionale", False, True
    if is_cr:
        return 2, "nazionale", True, False
    return 1, "regionale", False, False


# ═══════════════════════════════════════════════════════════════
# 3. AGGREGAZIONE con classifiche team per categoria
# ═══════════════════════════════════════════════════════════════
# Mapping categoria FCI + genere → codice interno
CAT_CODES = {
    ("Elite-Under23","M"): "ELI_M",
    ("Juniores","M"):      "JUN_M",
    ("Allievi","M"):       "AL1_M",
    ("Esordienti","M"):    "ES1_M",
    ("Donne","F"):         "ELI_F",
    ("Elite-Under23","F"): "ELI_F",
    ("Juniores","F"):      "JUN_F",
    ("Allievi","F"):       "AL1_F",
    ("Esordienti","F"):    "ES1_F",
}
ALL_CODES = list(dict.fromkeys(CAT_CODES.values()))  # mantiene ordine, dedup


def aggregate(results: list[dict]) -> tuple[dict, dict, dict, dict]:
    athletes = {}
    teams    = {}
    # team_rankings: per ogni categoria, punti totali team in quella categoria
    team_by_cat: dict[str, dict[str, dict]] = {c: {} for c in ALL_CODES}

    for r in results:
        if not str(r["data"]).startswith(str(CURRENT_YEAR)):
            continue
        pos = r["posizione"]
        if pos < 1 or pos > 10:
            continue

        aid  = r["atleta_id"]
        tid  = r["team_id"]
        pts  = r["punti_effettivi"]
        cc   = CAT_CODES.get((r["categoria"], r["genere"]),
                             "ELI_M" if r["genere"]=="M" else "ELI_F")

        # ── Atleta
        if aid not in athletes:
            athletes[aid] = {
                "id": aid, "nome": r["nome"], "cognome": r["cognome"],
                "team_attuale": r["team"], "team_id": tid,
                "categoria": cc, "genere": r["genere"],
                "punti_totali": 0, "risultati": [],
            }
        athletes[aid]["punti_totali"] += pts
        athletes[aid]["team_attuale"] = r["team"]
        athletes[aid]["team_id"] = tid
        athletes[aid]["risultati"].append({
            "gara_id": r["gara_id"], "nome_gara": r["nome_gara"],
            "data": r["data"], "posizione": pos,
            "tipo_gara": r["tipo"], "moltiplicatore": r["moltiplicatore"],
            "punti_base": r["punti_base"], "punti_effettivi": pts,
            "team": r["team"],
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
            "gara_id": r["gara_id"], "nome_gara": r["nome_gara"],
            "data": r["data"], "atleta_id": aid,
            "atleta_cognome": r["cognome"], "atleta_nome": r["nome"],
            "posizione": pos, "punti_base": r["punti_base"],
            "punti_effettivi": pts,
        })
        # punti per categoria (per ranking team per cat)
        teams[tid]["punti_per_cat"][cc] = \
            teams[tid]["punti_per_cat"].get(cc, 0) + pts

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

    # ── Classifiche atleti per categoria
    athlete_rankings: dict[str, list] = {c: [] for c in ALL_CODES}
    for aid, a in athletes.items():
        cc  = a["categoria"]
        rl  = a["risultati"]
        vit = sum(1 for x in rl if x["posizione"]==1)
        pod = sum(1 for x in rl if x["posizione"]<=3)
        top = len(rl)
        bst = min((x["posizione"] for x in rl), default=99)
        if cc in athlete_rankings:
            athlete_rankings[cc].append({
                "atleta_id": aid,
                "cognome": a["cognome"], "nome": a["nome"],
                "team_id": a["team_id"], "team_nome": a["team_attuale"],
                "punti": a["punti_totali"],
                "gare": top, "vittorie": vit, "podi": pod, "top10": top, "migliore": bst,
            })
    for cc in athlete_rankings:
        athlete_rankings[cc].sort(key=lambda x: (-x["punti"],-x["vittorie"],-x["podi"]))
        for i, row in enumerate(athlete_rankings[cc]):
            row["pos"] = i+1

    # ── Classifiche team per categoria
    team_rankings: dict[str, list] = {}
    for cc, tdict in team_by_cat.items():
        rows = []
        for tid, t in tdict.items():
            rows.append({
                "team_id":   tid,
                "team_nome": t["team_nome"],
                "punti":     t["punti"],
                "vittorie":  t["vittorie"],
                "podi":      t["podi"],
                "n_atleti":  len(t["atleti"]),
            })
        rows.sort(key=lambda x: (-x["punti"], -x["vittorie"]))
        for i, row in enumerate(rows):
            row["pos"] = i+1
        team_rankings[cc] = rows

    return athletes, teams, athlete_rankings, team_rankings


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════
async def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)
    (DATA_DIR / "team_rankings").mkdir(exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  FCI COMPLETE SCRAPER — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*60}\n")

    # ── 1. CALENDARIO con Playwright ────────────────────────────
    print("[1/3] Calendario FCI (Playwright)…")
    calendar = []
    if HAS_PW:
        calendar = await scrape_calendar_playwright()
    else:
        print("  SKIP: playwright non disponibile")

    # Indicizza calendario per data → lista gare
    cal_by_date: dict[str, list] = {}
    for g in calendar:
        cal_by_date.setdefault(g["data"], []).append(g)

    # ── 2. RISULTATI via requests ────────────────────────────────
    print("\n[2/3] Risultati gare (requests)…")
    SESSION = requests.Session()
    SESSION.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "it-IT,it;q=0.9",
    })

    all_results = []
    races_map   = {}

    for cat_name, url in RISULTATI_URLS.items():
        print(f"\n  [{cat_name}]")
        soup, _ = get_page(url, SESSION)
        if not soup:
            print("  SKIP")
            continue

        results = parse_risultati_page(cat_name, soup, cal_by_date)
        all_results.extend(results)

        from collections import Counter
        cnt = Counter(r["gara_id"] for r in results)
        for gid, n in cnt.most_common():
            r0 = next(x for x in results if x["gara_id"]==gid)
            mult_sym = f"×{r0['moltiplicatore']}"
            print(f"    ✓ {r0['data']} | {mult_sym} | {r0['nome_gara'][:48]:48s} | {n} ris.")
            if gid not in races_map:
                races_map[gid] = {
                    "id": gid, "nome": r0["nome_gara"], "data": r0["data"],
                    "mese": int(r0["data"][5:7]) if r0.get("data") else 0,
                    "anno": CURRENT_YEAR,
                    "categoria": cat_name, "genere": r0["genere"],
                    "tipo": r0["tipo"],
                    "moltiplicatore": r0["moltiplicatore"],
                    "campionato_regionale": r0["campionato_regionale"],
                    "campionato_italiano":  r0["campionato_italiano"],
                }

    # Merge calendario: aggiungi gare del calendario non nei risultati
    existing_ids = set(races_map.keys())
    for g in calendar:
        if g["id"] not in existing_ids:
            races_map[g["id"]] = g
            existing_ids.add(g["id"])

    final_calendar = sorted(races_map.values(), key=lambda g: g["data"], reverse=True)

    # ── 3. CALCOLO E SCRITTURA ───────────────────────────────────
    print(f"\n[3/3] Aggregazione e scrittura JSON…")
    athletes, teams, athlete_rankings, team_rankings = aggregate(all_results)

    def wj(path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    wj(DATA_DIR/"results_raw.json", all_results)
    print(f"  ✓ results_raw.json ({len(all_results)})")
    wj(DATA_DIR/"calendar.json", final_calendar)
    print(f"  ✓ calendar.json ({len(final_calendar)})")
    wj(DATA_DIR/"athletes.json", athletes)
    print(f"  ✓ athletes.json ({len(athletes)})")
    wj(DATA_DIR/"teams.json", teams)
    print(f"  ✓ teams.json ({len(teams)})")

    for code, rows in athlete_rankings.items():
        wj(DATA_DIR/f"rankings/{code}.json", rows)
        print(f"  ✓ rankings/{code}.json ({len(rows)})")

    for code, rows in team_rankings.items():
        wj(DATA_DIR/f"team_rankings/{code}.json", rows)
        print(f"  ✓ team_rankings/{code}.json ({len(rows)})")

    wj(DATA_DIR/"meta.json", {
        "last_update": datetime.now().isoformat(),
        "total_races": len(races_map),
        "total_results": len(all_results),
        "total_athletes": len(athletes),
        "total_teams": len(teams),
        "calendar_from_playwright": len(calendar),
        "seed_mode": False,
    })

    print(f"\n{'='*60}")
    print(f"  Gare: {len(races_map)} | Risultati: {len(all_results)}")
    print(f"  Atleti: {len(athletes)} | Team: {len(teams)}")
    print(f"  Calendario via Playwright: {len(calendar)}")
    print(f"{'='*60}\n")

    # Preview moltiplicatori
    print("  Distribuzione moltiplicatori:")
    from collections import Counter
    mult_count = Counter(r["moltiplicatore"] for r in all_results)
    for m, cnt in sorted(mult_count.items()):
        print(f"    ×{m}: {cnt} risultati")


if __name__ == "__main__":
    asyncio.run(main())
