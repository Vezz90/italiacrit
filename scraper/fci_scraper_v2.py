"""
fci_scraper_v2.py — Scraper FCI ottimizzato basato sulla struttura reale
Le pagine risultati-strada.federciclismo.it sono STATICHE (non JS-rendered):
- Ogni tabella sulla pagina = una gara
- Prima della tabella: data + regione + nome gara
- Posizione in <th> (formato "1°" o "1░")
- Classifica solo top-N nella pagina

Esegui: python scraper/fci_scraper_v2.py
"""
import requests
from bs4 import BeautifulSoup
import re, html, json, sys, time, unicodedata
from pathlib import Path
from datetime import datetime

CURRENT_YEAR = datetime.now().year
DATA_DIR = Path(__file__).parent.parent / "data"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "it-IT,it;q=0.9",
})

BASE_URL = "https://risultati-strada.federciclismo.it"
CAL_URL  = "https://www.federciclismo.it"

CATEGORY_PAGES = {
    "Elite-Under23": f"{BASE_URL}/risultati_gare_elite-under23.htm",
    "Juniores":      f"{BASE_URL}/risultati_gare_juniores.htm",
    "Allievi":       f"{BASE_URL}/risultati_gare_allievi.htm",
    "Esordienti":    f"{BASE_URL}/risultati_gare_esordienti.htm",
    "Donne":         f"{BASE_URL}/risultati_gare_donne.htm",
}

BASE_POINTS = {1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1}


# ── UTILITY ───────────────────────────────────────────────────────────────────
def normalize(s):
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower()).strip()

def slugify(s):
    s = normalize(s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

def get_page(url, retries=3):
    for attempt in range(retries):
        try:
            r = SESSION.get(url, timeout=20)
            r.encoding = "iso-8859-1"
            time.sleep(1.5)
            return BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            print(f"    retry {attempt+1} [{url[:60]}]: {e}")
            time.sleep(3)
    return None

def get_multiplier(nome_gara, tipo):
    n = normalize(nome_gara)
    if "campionato italiano" in n or "campionati italiani" in n:
        return 3, True, False
    if tipo == "internazionale":
        return 3, False, False
    if "campionato regionale" in n or "camp. reg" in n or "c.r." in n or "prova valida campionato" in n:
        return 2, False, True
    if tipo == "nazionale":
        return 2, False, False
    return 1, False, False

def detect_gender(cat_name, race_name=""):
    combined = (cat_name + " " + race_name).lower()
    if any(k in combined for k in ["donne", "femm", "allieve", "donna"]):
        return "F"
    return "M"

def infer_tipo(geo_cat):
    return {1: "regionale", 2: "nazionale", 3: "internazionale"}.get(geo_cat, "regionale")


# ── PARSE PAGINA CATEGORIA (struttura reale FCI) ───────────────────────────────
def parse_category_page(cat_name: str, soup: BeautifulSoup) -> list[dict]:
    """
    Ogni pagina categoria contiene N tabelle, una per gara.
    Prima di ogni tabella c'è un testo con: data, regione, nome gara.
    """
    results = []
    gender = detect_gender(cat_name)

    tables = soup.find_all("table")
    if not tables:
        print(f"    WARN: nessuna tabella in [{cat_name}]")
        return []

    for table in tables:
        # Cerca testo precedente alla tabella (data + nome gara)
        # Risali per trovare il nodo con data e nome
        race_name = ""
        race_date = ""
        race_region = ""

        # Cerca nel corpo del documento il testo vicino alla tabella
        prev_texts = []
        el = table.find_previous_sibling()
        for _ in range(10):
            if el is None:
                break
            txt = el.get_text(" ", strip=True)
            if txt and len(txt) > 3:
                prev_texts.append(txt)
                if len(prev_texts) >= 3:
                    break
            el = el.find_previous_sibling()

        # Cerca anche nel contenitore parent
        parent = table.parent
        if parent:
            parent_text = parent.get_text(" ", strip=True)
            prev_texts.append(parent_text)

        # Unisci e cerca data + nome gara
        full_context = " | ".join(prev_texts)

        # Data: formato YYYY-MM-DD nel contesto
        date_m = re.search(r"(\d{4}-\d{2}-\d{2})", full_context)
        if date_m:
            race_date = date_m.group(1)

        # Se non troviamo data, prova DD/MM/YYYY
        if not race_date:
            date_m2 = re.search(r"(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})", full_context)
            if date_m2:
                d, m, y = date_m2.groups()
                race_date = f"{y}-{int(m):02d}-{int(d):02d}"

        # Solo gare anno corrente
        if not race_date or not race_date.startswith(str(CURRENT_YEAR)):
            continue

        # Nome gara: cerca testo dopo la data che non sia solo numeri/coordinate
        # Formato tipico: "2026-04-06 - LAZIO|CASTROCIELO (FR)|NOME GARA"
        name_m = re.search(
            r"\d{4}-\d{2}-\d{2}\s*[-–]\s*[A-Z ]+\|[^\|]*\|([^\|]+)",
            full_context, re.IGNORECASE
        )
        if name_m:
            race_name = name_m.group(1).strip()
        else:
            # Fallback: prendi tutto dopo il pattern data-regione
            name_m2 = re.search(r"\d{4}-\d{2}-\d{2}\s*[-–]\s*(.+?)(?:\||\n|$)", full_context)
            if name_m2:
                raw = name_m2.group(1).strip()
                # Rimuovi coordinata comune: "REGIONE|COMUNE (PROV)|NOME"
                parts = [p.strip() for p in raw.split("|") if p.strip()]
                # Il nome gara è generalmente l'ultimo elemento più lungo
                name_parts = [p for p in parts if len(p) > 5 and not re.match(r"^[A-Z]{1,3}$", p)]
                race_name = name_parts[-1] if name_parts else raw[:60]

        if not race_name:
            # Ultimo tentativo: prendi capitalized text più lungo vicino alla tabella
            long_texts = [t for t in prev_texts if len(t) > 10 and re.search(r"[A-Z]{3,}", t)]
            if long_texts:
                # Prendi la parte che sembra un nome gara
                candidate = max(long_texts, key=len)
                # Rimuovi data e coordinate
                candidate = re.sub(r"\d{4}-\d{2}-\d{2}\s*[-–]\s*", "", candidate)
                candidate = re.sub(r"\d+[,\.]\d+\s*Km", "", candidate)
                candidate = re.sub(r"alla media.*", "", candidate, flags=re.IGNORECASE)
                race_name = candidate.strip()[:80]

        if not race_name:
            race_name = f"{cat_name} {race_date}"

        # Pulizia nome gara
        race_name = html.unescape(race_name).strip()
        race_name = re.sub(r"\s+", " ", race_name)

        # Determina tipo gara
        tipo = "regionale"
        mult, is_ci, is_cr = get_multiplier(race_name, tipo)

        gara_id = f"{slugify(race_name)}_{race_date}"

        # Parsa la classifica dalla tabella
        race_gender = detect_gender(cat_name, race_name)
        header_passed = False

        for row in table.find_all("tr"):
            # Riga header
            th = row.find("th")
            if not th:
                continue

            pos_raw = th.get_text(strip=True)
            # Gestisci "░" come "°" (encoding issue comune FCI)
            pos_raw = pos_raw.replace("░", "°").replace(".", "").replace("°", "").strip()

            if not pos_raw.isdigit():
                continue

            pos = int(pos_raw)
            if pos < 1 or pos > 10:
                continue

            tds = row.find_all("td")
            if not tds:
                continue

            # Cognome/Nome
            cognome = ""
            nome = ""
            team = ""
            tempo = ""

            # Cerca data-attributes (apostrofi)
            for td in tds:
                if td.get("data-cognome"):
                    cognome = html.unescape(td["data-cognome"]).strip().upper()
                if td.get("data-nome"):
                    nome = html.unescape(td["data-nome"]).strip().upper()
                if td.get("data-team") or td.get("data-squadra"):
                    team = html.unescape(td.get("data-team") or td.get("data-squadra", "")).strip().upper()

            # Fallback testo
            if not cognome and tds:
                raw = html.unescape(tds[0].get_text(strip=True)).upper()
                raw = re.sub(r"\s+", " ", raw).strip()
                parts = raw.split()
                if len(parts) >= 2:
                    cognome = parts[0]
                    nome = " ".join(parts[1:])
                else:
                    cognome = raw

            if not team and len(tds) >= 2:
                for td in tds[1:]:
                    txt = html.unescape(td.get_text(strip=True)).upper()
                    txt = re.sub(r"\s+", " ", txt).strip()
                    # Team è generalmente il secondo campo non numerico
                    if txt and len(txt) > 2 and not re.match(r"^\d", txt):
                        team = txt
                        break

            if tds:
                # Tempo/distacco è l'ultimo td
                last = html.unescape(tds[-1].get_text(strip=True))
                if last and last != team:
                    tempo = last

            if not cognome:
                continue

            # Genera IDs
            atleta_id = slugify(f"{cognome}_{nome}") if nome else slugify(cognome)
            team_id   = slugify(team) if team else "SCONOSCIUTO"
            pts_base  = BASE_POINTS.get(pos, 0)
            pts_eff   = pts_base * mult

            results.append({
                "gara_id":   gara_id,
                "nome_gara": race_name,
                "data":      race_date,
                "categoria": cat_name,
                "genere":    race_gender,
                "tipo":      tipo,
                "moltiplicatore": mult,
                "campionato_regionale": is_cr,
                "campionato_italiano":  is_ci,
                "posizione": pos,
                "cognome":   cognome,
                "nome":      nome,
                "atleta_id": atleta_id,
                "team":      team,
                "team_id":   team_id,
                "tempo":     tempo,
                "punti_base":     pts_base,
                "punti_effettivi": pts_eff,
            })

    return results


# ── CALENDARIO FCI ─────────────────────────────────────────────────────────────
def scrape_calendar() -> list[dict]:
    """Scarica calendario da federciclismo.it."""
    calendar = []
    seen = set()

    for geo_cat in [1, 2, 3]:
        tipo = infer_tipo(geo_cat)
        for month in range(1, 13):
            url = f"{CAL_URL}/ricerca-gare/?site=strada_it&mese={month:02d}&geo_category={geo_cat}"
            print(f"    Cal [{tipo}] mese {month:02d}… ", end="", flush=True)
            soup = get_page(url)
            if not soup:
                print("SKIP")
                continue

            count = 0
            # FCI calendario: cerca elementi con data + nome gara
            for el in soup.find_all(text=re.compile(r"\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2}")):
                parent = el.parent
                if not parent:
                    continue
                container_text = parent.get_text(" ", strip=True)

                # Data
                dm = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", container_text)
                if dm:
                    d, m, y = dm.groups()
                    date_iso = f"{y}-{int(m):02d}-{int(d):02d}"
                else:
                    dm2 = re.search(r"(\d{4}-\d{2}-\d{2})", container_text)
                    date_iso = dm2.group(1) if dm2 else ""

                if not date_iso or not date_iso.startswith(str(CURRENT_YEAR)):
                    continue

                # Nome gara: prendi il testo rimanente
                nome = re.sub(r"\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2}", "", container_text).strip()
                nome = re.sub(r"\s+", " ", nome).strip()[:80]
                if len(nome) < 4:
                    continue

                is_cr = any(k in normalize(nome) for k in ["campionato regionale", "camp reg"])
                is_ci = any(k in normalize(nome) for k in ["campionati italiani", "campionato italiano"])
                tipo_final = "internazionale" if is_ci or geo_cat == 3 else ("nazionale" if is_cr or geo_cat == 2 else "regionale")

                gender = detect_gender("", nome)
                gara_id = slugify(nome) + "_" + date_iso
                if gara_id in seen:
                    continue
                seen.add(gara_id)

                calendar.append({
                    "id": gara_id,
                    "nome": nome,
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
                count += 1

            print(f"{count} gare")

    return calendar


# ── AGGREGAZIONE PUNTI ─────────────────────────────────────────────────────────
def aggregate(results: list[dict]) -> tuple[dict, dict, dict]:
    """Calcola atleti, team e classifiche dai risultati raw."""
    athletes = {}
    teams = {}

    # Codici categoria
    CAT_CODES = {
        ("Elite-Under23","M"): "ELI_M",
        ("Juniores","M"):      "JUN_M",
        ("Allievi","M"):       "AL2_M",
        ("Esordienti","M"):    "ES2_M",
        ("Donne","F"):         "ELI_F",
        ("Juniores","F"):      "JUN_F",
        ("Allievi","F"):       "AL2_F",
        ("Esordienti","F"):    "ES2_F",
    }

    for r in results:
        if not r["data"].startswith(str(CURRENT_YEAR)):
            continue
        pos = r["posizione"]
        if pos < 1 or pos > 10:
            continue

        aid  = r["atleta_id"]
        tid  = r["team_id"]
        pts  = r["punti_effettivi"]
        cat  = r["categoria"]
        gen  = r["genere"]
        cc   = CAT_CODES.get((cat, gen), "ELI_M" if gen == "M" else "ELI_F")

        # Atleta
        if aid not in athletes:
            athletes[aid] = {
                "id": aid, "nome": r["nome"], "cognome": r["cognome"],
                "team_attuale": r["team"], "team_id": tid,
                "categoria": cc, "genere": gen,
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

        # Team
        if tid not in teams:
            teams[tid] = {
                "id": tid, "nome": r["team"],
                "punti_totali": 0, "atleti": [], "risultati": [],
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

    # Classifiche
    all_codes = set(CAT_CODES.values())
    rankings = {c: [] for c in all_codes}

    for aid, a in athletes.items():
        cc = a["categoria"]
        if cc not in rankings:
            continue
        r_list = a["risultati"]
        vittorie = sum(1 for r in r_list if r["posizione"] == 1)
        podi     = sum(1 for r in r_list if r["posizione"] <= 3)
        top10    = len(r_list)
        best     = min((r["posizione"] for r in r_list), default=99)

        rankings[cc].append({
            "atleta_id": aid,
            "cognome": a["cognome"], "nome": a["nome"],
            "team_id": a["team_id"], "team_nome": a["team_attuale"],
            "punti": a["punti_totali"],
            "gare": top10, "vittorie": vittorie,
            "podi": podi, "top10": top10, "migliore": best,
        })

    for cc in rankings:
        rankings[cc].sort(key=lambda x: (-x["punti"], -x["vittorie"], -x["podi"]))
        for i, row in enumerate(rankings[cc]):
            row["pos"] = i + 1

    return athletes, teams, rankings


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  FCI REAL SCRAPER v2 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    # ── RISULTATI GARE ─────────────────────────────────────────
    print("[1/3] Scraping risultati gare…")
    all_results = []
    races_found = {}  # gara_id → info gara

    for cat_name, cat_url in CATEGORY_PAGES.items():
        print(f"\n  Categoria: {cat_name}")
        soup = get_page(cat_url)
        if not soup:
            print(f"    SKIP — pagina non raggiungibile")
            continue
        results = parse_category_page(cat_name, soup)
        all_results.extend(results)

        for r in results:
            gid = r["gara_id"]
            if gid not in races_found:
                races_found[gid] = {
                    "id": gid, "nome": r["nome_gara"], "data": r["data"],
                    "mese": int(r["data"][5:7]) if r["data"] else 0,
                    "anno": CURRENT_YEAR,
                    "categoria": r["categoria"], "genere": r["genere"],
                    "tipo": r["tipo"],
                    "campionato_regionale": r["campionato_regionale"],
                    "campionato_italiano": r["campionato_italiano"],
                    "url": None,
                }

        # Dedup risultati per gara
        from collections import Counter
        gare_cat = Counter(r["gara_id"] for r in results)
        for gid, n in gare_cat.most_common():
            nome = next(r["nome_gara"] for r in results if r["gara_id"] == gid)
            print(f"    ✓ {nome[:50]} — {n} risultati")

    print(f"\n  → Totale gare con risultati: {len(races_found)}")
    print(f"  → Totale risultati: {len(all_results)}")

    # ── CALENDARIO ────────────────────────────────────────────
    print("\n[2/3] Scarico calendario…")
    calendar = list(races_found.values())  # Partenza: gare trovate nei risultati
    print(f"  → Calendario (da risultati): {len(calendar)} gare\n")

    # Tenta anche calendario FCI (best-effort)
    try:
        extra_cal = scrape_calendar()
        cal_ids = {g["id"] for g in calendar}
        added = 0
        for g in extra_cal:
            if g["id"] not in cal_ids:
                calendar.append(g)
                cal_ids.add(g["id"])
                added += 1
        print(f"  → Calendario FCI aggiunte: {added} gare extra")
    except Exception as e:
        print(f"  WARN calendario FCI: {e}")

    # Ordina per data decrescente
    calendar.sort(key=lambda g: g["data"], reverse=True)

    # ── CALCOLO E SCRITTURA ────────────────────────────────────
    print("\n[3/3] Calcolo punti e scrittura JSON…")
    athletes, teams, rankings = aggregate(all_results)

    with open(DATA_DIR / "results_raw.json", "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"  ✓ results_raw.json ({len(all_results)})")

    with open(DATA_DIR / "calendar.json", "w", encoding="utf-8") as f:
        json.dump(calendar, f, ensure_ascii=False, indent=2)
    print(f"  ✓ calendar.json ({len(calendar)})")

    with open(DATA_DIR / "athletes.json", "w", encoding="utf-8") as f:
        json.dump(athletes, f, ensure_ascii=False, indent=2)
    print(f"  ✓ athletes.json ({len(athletes)})")

    with open(DATA_DIR / "teams.json", "w", encoding="utf-8") as f:
        json.dump(teams, f, ensure_ascii=False, indent=2)
    print(f"  ✓ teams.json ({len(teams)})")

    for code, rows in rankings.items():
        with open(DATA_DIR / f"rankings/{code}.json", "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        print(f"  ✓ rankings/{code}.json ({len(rows)})")

    meta = {
        "last_update": datetime.now().isoformat(),
        "total_races": len(races_found),
        "total_results": len(all_results),
        "total_athletes": len(athletes),
        "total_teams": len(teams),
        "seed_mode": False,
    }
    with open(DATA_DIR / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"  COMPLETATO! Atleti: {len(athletes)} | Team: {len(teams)}")
    print(f"  Gare: {len(races_found)} | Risultati: {len(all_results)}")
    print(f"{'='*60}")

    # Preview ultime 5 gare
    if all_results:
        print("\n  Ultime gare scrappate:")
        seen_g = set()
        for r in sorted(all_results, key=lambda x: x["data"], reverse=True):
            if r["gara_id"] not in seen_g:
                seen_g.add(r["gara_id"])
                win = next((a for a in all_results if a["gara_id"]==r["gara_id"] and a["posizione"]==1), None)
                winner = f"{win['cognome']} {win['nome']}" if win else "?"
                print(f"    {r['data']} | {r['nome_gara'][:45]:45s} | Vince: {winner}")
                if len(seen_g) >= 8:
                    break


if __name__ == "__main__":
    main()
