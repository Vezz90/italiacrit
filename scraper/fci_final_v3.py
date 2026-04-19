"""
fci_final_v3.py — Scraper FCI completo e corretto

STRUTTURA VERIFICATA:
===================
RISULTATI (risultati-strada.federciclismo.it):
- Pagine statiche categoria (solo ultime ~6 gare)
- Struttura: h4[color:#1a8ad8]=nome, div.mb-4=data, table=classifica
- Per gare più vecchie: NESSUNA paginazione, devo usare il calendario

CALENDARIO (www.federciclismo.it/ricerca-gare/):
- Pagina server-rendered (NON JS!) — requests funziona
- Selector: div.wp-race-info (ogni gara)
- Data: testo italiano "DD Mese YYYY"
- Campo "Classe": "1.12 Elite e Under 23", "2.1 Juniores", ecc.
- Il geo_category URL determina il livello: 1=regionale(×1), 2=nazionale(×2), 3=internazionale(×3)
- IMPORTANTE: geo_category=1 in URL → TYPE "regionale" (×1)
             geo_category=2 in URL → TYPE "nazionale" (×2) — include anche CR
             geo_category=3 in URL → TYPE "internazionale" (×3)

MOLTIPLICATORI:
- Tutte le gare dal calendario con geo_category=1 → ×1 (salvo nome)
- geo_category=2 → ×2
- geo_category=3 → ×3
- Eccezione: "Campionato Italiano" in geo_category=2 → ×3

CLASSIFICHE TEAM PER CATEGORIA:
- Per ogni categoria, i team vengono classificati in base ai punti
  totali accumulati solo in quella categoria dai loro atleti.

Esegui: python scraper/fci_final_v3.py
"""
import asyncio, requests, json, re, sys, time, unicodedata, html as HTMLMOD
from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime
from difflib import SequenceMatcher
from collections import Counter, defaultdict

CURRENT_YEAR = datetime.now().year
DATA_DIR = Path(__file__).parent.parent / "data"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "it-IT,it;q=0.9",
})

RISULTATI_URLS = {
    "Elite-Under23": "https://risultati-strada.federciclismo.it/risultati_gare_elite-under23.htm",
    "Juniores":      "https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm",
    "Allievi":       "https://risultati-strada.federciclismo.it/risultati_gare_allievi.htm",
    "Esordienti":    "https://risultati-strada.federciclismo.it/risultati_gare_esordienti.htm",
    "Donne":         "https://risultati-strada.federciclismo.it/risultati_gare_donne.htm",
}

BASE_PTS = {1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1}

# Mesi italiani per parsing date
MESI_IT = {
    "gennaio":1,"febbraio":2,"marzo":3,"aprile":4,"maggio":5,
    "giugno":6,"luglio":7,"agosto":8,"settembre":9,"ottobre":10,
    "novembre":11,"dicembre":12,
    "gen":1,"feb":2,"mar":3,"apr":4,"mag":5,"giu":6,
    "lug":7,"ago":8,"set":9,"ott":10,"nov":11,"dic":12,
}

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
ALL_CODES = list(dict.fromkeys(CAT_CODES.values()))


# ═══ UTILITY ═════════════════════════════════════════════════════
def norm(s):
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower()).strip()

def slug(s):
    s = norm(s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

def get_page(url, retries=3, extra_sleep=0):
    for i in range(retries):
        try:
            r = SESSION.get(url, timeout=20)
            r.encoding = "iso-8859-1"
            time.sleep(1.0 + extra_sleep)
            return BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            print(f"  retry {i+1}: {e}")
            time.sleep(3)
    return None

def parse_date_it(text: str) -> str:
    """Converte '14 Febbraio 2026' o '14/02/2026' in 'YYYY-MM-DD'."""
    # Formato numerico DD/MM/YYYY
    m = re.search(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", text)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    # Formato italiano DD Mese YYYY
    m = re.search(
        r"(\d{1,2})\s+(" + "|".join(MESI_IT.keys()) + r")\s+(\d{4})",
        text.lower()
    )
    if m:
        d, nome_m, y = m.groups()
        return f"{y}-{MESI_IT.get(nome_m,1):02d}-{int(d):02d}"
    # Formato YYYY-MM-DD già presente
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return m.group(0)
    return ""

def detect_gender(text: str) -> str:
    t = norm(text)
    return "F" if any(k in t for k in ["donne","femm","allieve","donna","women"]) else "M"

def infer_tipo_from_geo(geo_cat: int, race_name: str) -> tuple[str, int, bool, bool]:
    n = norm(race_name)
    is_ci = any(k in n for k in ["campionato italiano","campionati italiani","camp. ital","ci "," ci "])
    is_cr = any(k in n for k in [
        "campionato regionale","camp. reg","camp reg","c.r.",
        "prova valida campionato","valida per il campionato",
        "prova valida per","valida campionato",
    ])
    if is_ci or geo_cat == 3:
        return "internazionale", 3, False, True if is_ci else False
    if is_cr:
        # CR sempre ×2 indipendentemente dal geo_cat
        return "nazionale", 2, True, False
    if geo_cat == 2:
        return "nazionale", 2, False, False
    return "regionale", 1, False, False


# ═══ CALENDARIO FCI (requests, server-rendered) ════════════════════
def scrape_calendar() -> list[dict]:
    """
    Scarica il calendario da federciclismo.it/ricerca-gare/.
    Usa il selector div.wp-race-info verificato dal browser.
    geo_category: 1=regionale, 2=nazionale, 3=internazionale
    """
    calendar = []
    seen = set()
    meses_it_full = {
        "gennaio":1,"febbraio":2,"marzo":3,"aprile":4,"maggio":5,"giugno":6,
        "luglio":7,"agosto":8,"settembre":9,"ottobre":10,"novembre":11,"dicembre":12,
    }

    for geo_cat in [1, 2, 3]:
        tipo_label = {1:"regionale",2:"nazionale",3:"internazionale"}[geo_cat]
        for month in range(1, 13):
            url = (f"https://www.federciclismo.it/ricerca-gare/"
                   f"?site=strada_it&mese={month:02d}&geo_category={geo_cat}")
            print(f"  Cal [{tipo_label}] mese {month:02d}… ", end="", flush=True)

            soup = get_page(url, extra_sleep=0.5)
            if not soup:
                print("SKIP")
                continue

            count = 0
            for card in soup.find_all("div", class_="wp-race-info"):
                text = card.get_text(" ", strip=True)

                # Data
                date_iso = parse_date_it(text)
                if not date_iso or not date_iso.startswith(str(CURRENT_YEAR)):
                    continue

                # Nome gara (cerca il <b> o il testo principale)
                b_tags = card.find_all("b")
                nome = ""
                for b in b_tags:
                    bt = b.get_text(strip=True)
                    if len(bt) > 5 and not any(k in norm(bt) for k in ["strada","pista","mtb"]):
                        nome = bt
                        break
                if not nome:
                    # Fallback: prendi il testo più lungo
                    parts = [p.strip() for p in text.split("\n") if len(p.strip()) > 8]
                    if parts:
                        nome = max(parts, key=len)[:100]

                # "Classe" campo: testo con "1.12" o "2.1" etc
                classe = ""
                for div in card.find_all("div"):
                    dt = div.get_text(" ", strip=True)
                    if re.search(r"\d+\.\d+\s*(Elite|Junior|Allievi|Esord|Donne)", dt, re.I):
                        classe = dt
                        break

                nome = HTMLMOD.unescape(re.sub(r"\s+", " ", nome)).strip()
                if len(nome) < 3:
                    continue

                tipo, mult, is_cr, is_ci = infer_tipo_from_geo(geo_cat, nome)
                gender = detect_gender(nome + " " + classe)
                gara_id = slug(nome) + "_" + date_iso
                if gara_id in seen:
                    continue
                seen.add(gara_id)

                calendar.append({
                    "id": gara_id,
                    "nome": nome,
                    "data": date_iso,
                    "mese": int(date_iso[5:7]),
                    "anno": CURRENT_YEAR,
                    "categoria": _infer_cat_from_classe(classe),
                    "genere": gender,
                    "tipo": tipo,
                    "geo_category": geo_cat,
                    "moltiplicatore": mult,
                    "campionato_regionale": is_cr,
                    "campionato_italiano":  is_ci,
                    "classe_fci": classe,
                })
                count += 1

            print(count)

    return sorted(calendar, key=lambda g: g["data"], reverse=True)


def _infer_cat_from_classe(classe: str) -> str:
    n = norm(classe)
    if "elite" in n or "under 23" in n or "u23" in n:
        return "Elite-Under23"
    if "junior" in n:
        return "Juniores"
    if "allievi" in n or "allievi" in n:
        return "Allievi"
    if "esord" in n:
        return "Esordienti"
    if "donne" in n or "femm" in n:
        return "Donne"
    return "Varie"


# ═══ RISULTATI PAGINE CATEGORIA ════════════════════════════════════
def parse_risultati_page(cat_name: str, soup: BeautifulSoup, cal_by_date: dict) -> list[dict]:
    """Parser pagina risultati FCI — struttura h4[color:#1a8ad8] verificata."""
    results = []
    h4_races = soup.find_all("h4", style=re.compile(r"color\s*:\s*#1a8ad8", re.I))
    if not h4_races:
        h4_races = soup.find_all("h4")

    for h4 in h4_races:
        race_name = HTMLMOD.unescape(h4.get_text(strip=True))
        if not race_name or len(race_name) < 3:
            continue

        # Trova data
        race_date = ""
        context_text = ""
        el = h4
        for _ in range(25):
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
            p = h4.parent
            for _ in range(8):
                if p is None: break
                ptxt = p.get_text(" ", strip=True)
                dm = re.search(r"(\d{4}-\d{2}-\d{2})", ptxt)
                if dm:
                    race_date = dm.group(1)
                    context_text = ptxt[:400]
                    break
                p = p.parent

        if not race_date or not race_date.startswith(str(CURRENT_YEAR)):
            continue

        # Cerca nel calendario per moltiplicatore corretto
        cal_entry = _find_cal(race_name, race_date, cal_by_date)
        if cal_entry:
            mult  = cal_entry["moltiplicatore"]
            tipo  = cal_entry["tipo"]
            is_cr = cal_entry["campionato_regionale"]
            is_ci = cal_entry["campionato_italiano"]
        else:
            tipo, mult, is_cr, is_ci = infer_tipo_from_geo(1, race_name + " " + context_text)

        race_gender = detect_gender(cat_name + " " + race_name)
        gara_id = slug(race_name) + "_" + race_date

        # Trova tabella
        table = h4.find_next("table")
        if not table and h4.parent:
            table = h4.parent.find("table")
        if not table:
            continue

        # Parsa righe classifica
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

            for td in tds:
                if td.get("data-cognome"):
                    cognome = HTMLMOD.unescape(td["data-cognome"]).strip().upper()
                if td.get("data-nome"):
                    nome = HTMLMOD.unescape(td["data-nome"]).strip().upper()
                if td.get("data-team") or td.get("data-squadra"):
                    team = HTMLMOD.unescape(td.get("data-team","") or td.get("data-squadra","")).strip().upper()

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
                "gara_id": gara_id, "nome_gara": race_name, "data": race_date,
                "categoria": cat_name, "genere": race_gender,
                "tipo": tipo, "moltiplicatore": mult,
                "campionato_regionale": is_cr, "campionato_italiano": is_ci,
                "posizione": pos, "cognome": cognome, "nome": nome,
                "atleta_id": atleta_id, "team": team, "team_id": team_id,
                "tempo": tempo, "punti_base": pts_base, "punti_effettivi": pts_eff,
            })

    return results


def _find_cal(race_name: str, date: str, cal_by_date: dict) -> dict | None:
    by_date = cal_by_date.get(date, [])
    best, best_r = None, 0.0
    for e in by_date:
        r = SequenceMatcher(None, norm(race_name), norm(e["nome"])).ratio()
        if r > best_r:
            best_r, best = r, e
    return best if best_r >= 0.55 else None  # soglia ribassata


# ═══ AGGREGAZIONE ═════════════════════════════════════════════════
def aggregate(results: list[dict]):
    athletes     = {}
    teams        = {}
    team_by_cat  = defaultdict(lambda: defaultdict(lambda: {
        "punti":0,"vittorie":0,"podi":0,"atleti":set(),"nome":""
    }))

    for r in results:
        if not str(r["data"]).startswith(str(CURRENT_YEAR)):
            continue
        pos = r["posizione"]
        if pos < 1 or pos > 10:
            continue

        aid = r["atleta_id"]
        tid = r["team_id"]
        pts = r["punti_effettivi"]
        cc  = CAT_CODES.get((r["categoria"], r["genere"]),
                            "ELI_M" if r["genere"]=="M" else "ELI_F")

        # Atleta
        if aid not in athletes:
            athletes[aid] = {"id":aid,"nome":r["nome"],"cognome":r["cognome"],
                             "team_attuale":r["team"],"team_id":tid,
                             "categoria":cc,"genere":r["genere"],
                             "punti_totali":0,"risultati":[]}
        athletes[aid]["punti_totali"] += pts
        athletes[aid]["team_attuale"]  = r["team"]
        athletes[aid]["team_id"]       = tid
        athletes[aid]["risultati"].append({
            "gara_id":r["gara_id"],"nome_gara":r["nome_gara"],"data":r["data"],
            "posizione":pos,"tipo_gara":r["tipo"],"moltiplicatore":r["moltiplicatore"],
            "punti_base":r["punti_base"],"punti_effettivi":pts,"team":r["team"],
        })

        # Team globale
        if tid not in teams:
            teams[tid] = {"id":tid,"nome":r["team"],"punti_totali":0,
                          "atleti":[],"risultati":[],"punti_per_cat":{}}
        teams[tid]["punti_totali"] += pts
        if aid not in teams[tid]["atleti"]:
            teams[tid]["atleti"].append(aid)
        teams[tid]["risultati"].append({
            "gara_id":r["gara_id"],"nome_gara":r["nome_gara"],"data":r["data"],
            "atleta_id":aid,"atleta_cognome":r["cognome"],"atleta_nome":r["nome"],
            "posizione":pos,"punti_base":r["punti_base"],"punti_effettivi":pts,
        })
        teams[tid]["punti_per_cat"][cc] = teams[tid]["punti_per_cat"].get(cc,0) + pts

        # Team per categoria
        tbc = team_by_cat[cc][tid]
        tbc["punti"] += pts
        if pos==1: tbc["vittorie"] += 1
        if pos<=3: tbc["podi"]    += 1
        tbc["atleti"].add(aid)
        tbc["nome"] = r["team"]

    # Classifiche atleti
    athlete_rankings = {c:[] for c in ALL_CODES}
    for aid, a in athletes.items():
        cc = a["categoria"]
        rl = a["risultati"]
        vit = sum(1 for x in rl if x["posizione"]==1)
        pod = sum(1 for x in rl if x["posizione"]<=3)
        top = len(rl)
        bst = min((x["posizione"] for x in rl), default=99)
        if cc in athlete_rankings:
            athlete_rankings[cc].append({
                "atleta_id":aid,"cognome":a["cognome"],"nome":a["nome"],
                "team_id":a["team_id"],"team_nome":a["team_attuale"],
                "punti":a["punti_totali"],"gare":top,"vittorie":vit,"podi":pod,
                "top10":top,"migliore":bst,
            })
    for cc in athlete_rankings:
        athlete_rankings[cc].sort(key=lambda x:(-x["punti"],-x["vittorie"],-x["podi"]))
        for i,row in enumerate(athlete_rankings[cc]):
            row["pos"] = i+1

    # Classifiche team per categoria
    team_rankings = {}
    for cc, tdict in team_by_cat.items():
        rows = []
        for tid, t in tdict.items():
            rows.append({
                "team_id":tid,"team_nome":t["nome"],"punti":t["punti"],
                "vittorie":t["vittorie"],"podi":t["podi"],"n_atleti":len(t["atleti"]),
            })
        rows.sort(key=lambda x:(-x["punti"],-x["vittorie"]))
        for i,row in enumerate(rows):
            row["pos"] = i+1
        team_rankings[cc] = rows

    return athletes, teams, athlete_rankings, team_rankings


# ═══ MAIN ═════════════════════════════════════════════════════════
def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)
    (DATA_DIR / "team_rankings").mkdir(exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  FCI SCRAPER v3 — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*60}\n")

    # ── 1. CALENDARIO (requests, server-rendered) ──────────────
    print("[1/3] Calendario FCI (requests)…")
    calendar = scrape_calendar()
    print(f"  → Totale: {len(calendar)} gare")

    # Indicizza per data
    cal_by_date: dict[str, list] = {}
    for g in calendar:
        cal_by_date.setdefault(g["data"], []).append(g)

    # ── 2. RISULTATI ───────────────────────────────────────────
    print("\n[2/3] Risultati gare (requests)…")
    all_results = []
    races_map   = {}

    for cat_name, url in RISULTATI_URLS.items():
        print(f"\n  [{cat_name}]")
        soup = get_page(url)
        if not soup:
            print("  SKIP")
            continue
        results = parse_risultati_page(cat_name, soup, cal_by_date)
        all_results.extend(results)

        cnt = Counter(r["gara_id"] for r in results)
        for gid, n in cnt.most_common():
            r0 = next(x for x in results if x["gara_id"]==gid)
            print(f"    ×{r0['moltiplicatore']} | {r0['data']} | {r0['nome_gara'][:50]:50s} | {n}")
            if gid not in races_map:
                races_map[gid] = {
                    "id":gid,"nome":r0["nome_gara"],"data":r0["data"],
                    "mese":int(r0["data"][5:7]) if r0.get("data") else 0,
                    "anno":CURRENT_YEAR,"categoria":cat_name,"genere":r0["genere"],
                    "tipo":r0["tipo"],"moltiplicatore":r0["moltiplicatore"],
                    "campionato_regionale":r0["campionato_regionale"],
                    "campionato_italiano":r0["campionato_italiano"],
                }

    # Merge calendario con risultati
    existing_ids = set(races_map.keys())
    for g in calendar:
        if g["id"] not in existing_ids:
            races_map[g["id"]] = g
            existing_ids.add(g["id"])

    final_calendar = sorted(races_map.values(), key=lambda g: g["data"], reverse=True)

    # ── 3. AGGREGAZIONE e SCRITTURA ────────────────────────────
    print(f"\n[3/3] Calcolo punti e scrittura JSON…")
    athletes, teams, athlete_rankings, team_rankings = aggregate(all_results)

    def wj(path, data):
        with open(path,"w",encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    wj(DATA_DIR/"results_raw.json", all_results)
    print(f"  ✓ results_raw.json ({len(all_results)})")
    wj(DATA_DIR/"calendar.json", final_calendar)
    print(f"  ✓ calendar.json ({len(final_calendar)} — {len(calendar)} da FCI, {len(races_map)-len(calendar)} da risultati)")
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
        "total_calendar_fci": len(calendar),
        "total_results": len(all_results),
        "total_athletes": len(athletes),
        "total_teams": len(teams),
        "seed_mode": False,
    })

    print(f"\n{'='*60}")
    print(f"  Gare calendario FCI: {len(calendar)}")
    print(f"  Gare con risultati: {len([g for g in races_map.values() if g['id'] in {r['gara_id'] for r in all_results}])}")
    print(f"  Risultati totali: {len(all_results)}")
    print(f"  Atleti: {len(athletes)} | Team: {len(teams)}")
    print(f"{'='*60}\n")

    # Distribuzione moltiplicatori
    print("  Distribuzione moltiplicatori:")
    mult_cnt = Counter(r["moltiplicatore"] for r in all_results)
    for m, cnt in sorted(mult_cnt.items()):
        gare_m = len({r["gara_id"] for r in all_results if r["moltiplicatore"]==m})
        print(f"    ×{m}: {cnt} risultati in {gare_m} gare")

    # Top team per categoria
    print("\n  Team leader per categoria:")
    for cc, rows in team_rankings.items():
        if rows:
            print(f"    [{cc}] 1° {rows[0]['team_nome']} — {rows[0]['punti']} pt")


if __name__ == "__main__":
    main()
