"""
fci_final_v4.py — Scraper FCI
- Fetch risultati ONLY from the homepage (risultati-strada.federciclismo.it) come richiesto.
- Classifica separata per Esordienti 1° e 2° anno.
- Classifica unica Elite-Under23.
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept-Language": "it-IT,it;q=0.9",
})

# SOLO LA HOMEPAGE
RISULTATI_URL = "https://risultati-strada.federciclismo.it/"

BASE_PTS = {1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1}

MESI_IT = {
    "gennaio":1,"febbraio":2,"marzo":3,"aprile":4,"maggio":5,
    "giugno":6,"luglio":7,"agosto":8,"settembre":9,"ottobre":10,
    "novembre":11,"dicembre":12,
    "gen":1,"feb":2,"mar":3,"apr":4,"mag":5,"giu":6,
    "lug":7,"ago":8,"set":9,"ott":10,"nov":11,"dic":12,
}

ALL_CODES = [
    "ES1_M","ES2_M","AL_M","JUN_M","ELI_M",
    "ES1_F","ES2_F","AL_F","JUN_F","ELI_F"
]

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
    m = re.search(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", text)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m = re.search(r"(\d{1,2})\s+(" + "|".join(MESI_IT.keys()) + r")\s+(\d{4})", text.lower())
    if m:
        d, nome_m, y = m.groups()
        return f"{y}-{MESI_IT.get(nome_m,1):02d}-{int(d):02d}"
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return m.group(0)
    return ""

def detect_gender(text: str) -> str:
    t = norm(text)
    return "F" if any(k in t for k in ["donne","femm","allieve","donna","women"]) else "M"

def infer_cat(race_name: str, context: str, genere: str) -> str:
    t_orig = norm(race_name + " " + context)
    
    if "elite" in t_orig or "under 23" in t_orig or "u23" in t_orig or "u.23" in t_orig or "u 23" in t_orig:
        return "ELI_" + genere
    if "junior" in t_orig:
        return "JUN_" + genere
    if "alliev" in t_orig:
        return "AL_" + genere # Accorpa Allievi 1° e 2° anno
    if "esord" in t_orig:
        if re.search(r"esordienti\s*2\b", t_orig) or any(k in t_orig for k in ["secondo anno", "2° anno", "2^ anno", "2 anno"]): return "ES2_" + genere
        if re.search(r"esordienti\s*1\b", t_orig) or any(k in t_orig for k in ["primo anno", "1° anno", "1^ anno", "1 anno"]): return "ES1_" + genere
        return "ES1_" + genere

    # Fallbacks se non trova la parola chiave (es gara open)
    # Guarda la classificazione
    if genere == "F": return "ELI_F"
    return "ELI_M"

def infer_tipo_from_class(classe_fci: str, race_name: str, geo_cat: int) -> tuple[str, int, bool, bool]:
    classe = classe_fci.upper().replace(",", ".")
    n = norm(race_name + " " + classe_fci)
    
    is_ci = any(k in n for k in ["campionato italiano","campionati italiani","camp. ital","camp ital"])
    is_cr = any(k in n for k in [
        "campionato regionale","camp. reg","camp reg",
        "prova valida campionato","valida per il campionato",
        "prova valida per","valida campionato","camp_reg", "camp.regionale"
    ])
    if is_ci: return "nazionale", 3, False, True
    if is_cr: return "regionale", 2, True, False
    
    m = re.search(r"([12])\.(WWT|UWT|PRO|NCUP|12|13|14|15|19|21|22|23|24|25|26|27|28|30|1|2(?!\d))", classe)
    if m:
        c = m.group(1) + "." + m.group(2)
        if c in ["1.WWT", "1.UWT", "2.UWT", "1.PRO", "1.NCUP", "1.1", "1.2", "2.1", "2.2"]:
            return "internazionale", 3, False, False
        if c in ["1.12", "1.13", "1.14", "1.15"]:
            return "nazionale", 2, False, False
        if c in ["1.19", "1.21", "1.23", "1.24", "1.25", "1.26", "1.27", "1.28", "1.30"]:
            return "regionale", 1, False, False

    if geo_cat == 3: return "internazionale", 3, False, False
    if geo_cat == 2: return "nazionale", 2, False, False
    return "regionale", 1, False, False

# ═══ CALENDARIO MANUALE DALL'UTENTE (EXCEL) ════════════════════════════
def load_manual_calendar() -> list[dict]:
    manual_file = DATA_DIR / "calendario_manuale_v2.xlsx"
    if not manual_file.exists():
        # Fallback al vecchio nome se esiste
        if (DATA_DIR / "calendario_manuale.xlsx").exists():
            manual_file = DATA_DIR / "calendario_manuale.xlsx"
        else:
            print(f"  File {manual_file} non trovato, salto il caricamento del calendario.")
            return []
            
    import openpyxl
    wb = openpyxl.load_workbook(manual_file, data_only=True)
    ws = wb.active
    
    calendar = []
    seen = set()
    
    # Mappa le categorie testuali dell'utente
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0]: continue
        
        nome = str(row[0]).strip()
        data_raw = str(row[1]).strip() if row[1] else ""
        cat_text = str(row[2]).strip().lower() if row[2] else ""
        gender_text = str(row[3]).strip().lower() if len(row) > 3 and row[3] else ""
        regione = str(row[4]).strip().upper() if len(row) > 4 and row[4] else ""
        localita = str(row[5]).strip() if len(row) > 5 and row[5] else ""

        # Conversione data da GG-MM-YYYY a YYYY-MM-DD
        date_iso = ""
        if data_raw:
            parts = re.split(r'[-/.]', data_raw)
            if len(parts) == 3:
                # Assumiamo formato DD MM YYYY se l'anno è lungo (o MM è al centro)
                # Facciamo fallback se l'utente ha messo YYYY per primo
                if len(parts[0]) == 4:
                    date_iso = f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
                else:
                    date_iso = f"{parts[2]}-{int(parts[1]):02d}-{int(parts[0]):02d}"
        if not date_iso:
            date_iso = parse_date_it(nome)
            
        tipo = "regionale"
        mult = 1
        is_cr = False
        is_ci = False
        
        if "internazionale" in cat_text:
            tipo = "internazionale"
            mult = 3
        elif "camp" in cat_text and "italiano" in cat_text:
            tipo = "nazionale"
            mult = 3
            is_ci = True
        elif "nazionale" in cat_text:
            tipo = "nazionale"
            mult = 2
        elif "camp" in cat_text and "regionale" in cat_text:
            tipo = "regionale"
            mult = 2
            is_cr = True

        # Rilevamento genere: diamo priorità alla colonna Excel
        gender = ""
        if "donne" in gender_text or "f" in gender_text:
            gender = "F"
        elif "uomin" in gender_text or "maschi" in gender_text or "m" in gender_text:
            gender = "M"
        if not gender:
            gender = detect_gender(nome)
            
        cat_code = infer_cat(nome, "", gender)
        
        # Forza Esordienti e Allievi a x1 Regionale (no NAZ/INT), ad ECCEZIONE dei campionati
        if cat_code.startswith("ES") or cat_code.startswith("AL"):
            if not is_cr and not is_ci:
                tipo = "regionale"
                mult = 1

        gara_id = f"{slug(nome)}_{date_iso}_{cat_code}"
        if gara_id in seen: continue
        seen.add(gara_id)

        calendar.append({
            "id": gara_id, "nome": nome, "data": date_iso,
            "mese": int(date_iso[5:7]) if date_iso and len(date_iso)>=7 else 0, 
            "anno": CURRENT_YEAR,
            "categoria": cat_code, "genere": gender,
            "tipo": tipo, "geo_category": 1, "moltiplicatore": mult,
            "campionato_regionale": is_cr, "campionato_italiano": is_ci,
            "classe_fci": cat_text,
            "regione": regione, "localita": localita
        })
    return sorted(calendar, key=lambda g: g.get("data", ""), reverse=True)

# ═══ RISULTATI HOME PAGE ══════════════════════════════════════════
def parse_risultati_homepage(soup: BeautifulSoup, cal_by_date: dict, user_overrides: dict) -> list[dict]:
    results = []
    h4_races = soup.find_all("h4", style=re.compile(r"color\s*:\s*#1a8ad8", re.I))
    if not h4_races: h4_races = soup.find_all("h4")

    for h4 in h4_races:
        race_name = HTMLMOD.unescape(h4.get_text(strip=True))
        if not race_name or len(race_name) < 3: continue

        race_date = ""
        context_text = ""
        el = h4
        for _ in range(25):
            el = el.find_previous_sibling()
            if el is None: break
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

        if not race_date or not race_date.startswith(str(CURRENT_YEAR)): continue

        # Identifica categoria
        gender = detect_gender(context_text + " " + race_name)
        cat_code = infer_cat(race_name, context_text, gender)

        best_cal, best_r = None, 0.0
        by_date = cal_by_date.get(race_date, [])
        
        # Remove category words to compare bare race names
        clean_rx = re.compile(r"\b(donne|esordienti|primo|secondo|anno|allievi|allieve|juniores|junior|elite|under 23|u23|u\.23|gara unica|valida perl il|campionato regionale)\b")
        bare_race = clean_rx.sub("", norm(race_name)).strip()
        
        for e in by_date:
            bare_cal = clean_rx.sub("", norm(e["nome"])).strip()
            r = SequenceMatcher(None, bare_race, bare_cal).ratio()
            if r > best_r: best_r, best_cal = r, e

        override_class = ""
        bare_for_ov = clean_rx.sub("", norm(race_name)).strip().replace("gran premio", "gp").replace("g.p.", "gp").replace("°", "")
        # Remove any non-alphanumeric (like ^ in 102^)
        bare_for_ov = re.sub(r"[^\w\s]", "", bare_for_ov)
        n_race = slug(bare_for_ov)
        
        for k, cl in user_overrides.items():
            if k in n_race or n_race in k:
                override_class = cl
                break

        if best_cal and best_r >= 0.40:
            mult  = best_cal["moltiplicatore"]
            tipo  = best_cal["tipo"]
            is_cr = best_cal["campionato_regionale"]
            is_ci = best_cal["campionato_italiano"]
        if override_class:
            # L'override esplicito domina sul calendario. La logic include già le chiavi di classe testuale
            nt, nm, ncr, nci = infer_tipo_from_class(override_class, race_name + " " + context_text, 1)
            tipo, mult, is_cr, is_ci = nt, nm, ncr, nci
        else:
            tipo, mult, is_cr, is_ci = infer_tipo_from_class(override_class, race_name + " " + context_text, 1)

        # Forza Esordienti e Allievi a x1 Regionale (no NAZ/INT), tranne CR/CI espliciti o taggati nel DB locale
        if cat_code.startswith("ES") or cat_code.startswith("AL"):
            if not is_cr and not is_ci:
                tipo = "regionale"
                mult = 1

        gara_id = f"{slug(race_name)}_{race_date}_{cat_code}"

        table = h4.find_next("table")
        if not table and h4.parent: table = h4.parent.find("table")
        if not table: continue

        for row in table.find_all("tr"):
            th = row.find("th")
            if not th: continue
            pos_raw = th.get_text(strip=True).replace("░","").replace("°","").replace(".","").strip()
            if not pos_raw.isdigit(): continue
            pos = int(pos_raw)
            if pos < 1 or pos > 10: continue
            tds = row.find_all("td")
            if not tds: continue

            cognome, nome, team, tempo = "", "", "", ""
            for td in tds:
                if td.get("data-cognome"): cognome = HTMLMOD.unescape(td["data-cognome"]).strip().upper()
                if td.get("data-nome"): nome = HTMLMOD.unescape(td["data-nome"]).strip().upper()
                if td.get("data-team") or td.get("data-squadra"): team = HTMLMOD.unescape(td.get("data-team","") or td.get("data-squadra","")).strip().upper()

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
                if t2 and len(t2) > 2: team = t2

            if len(tds) >= 3: tempo = HTMLMOD.unescape(tds[-1].get_text(strip=True))
            if not cognome: continue

            atleta_id = slug(f"{cognome}_{nome}") if nome else slug(cognome)
            team_id   = f"{slug(team)}_{cat_code}" if team else f"SCONOSCIUTO_{cat_code}"
            pts_base  = BASE_PTS.get(pos, 0)
            pts_eff   = pts_base * mult

            results.append({
                "gara_id": gara_id, "nome_gara": race_name, "data": race_date,
                "categoria": cat_code, "genere": gender,
                "tipo": tipo, "moltiplicatore": mult,
                "campionato_regionale": is_cr, "campionato_italiano": is_ci,
                "posizione": pos, "cognome": cognome, "nome": nome,
                "atleta_id": atleta_id, "team": team, "team_id": team_id,
                "tempo": tempo, "punti_base": pts_base, "punti_effettivi": pts_eff,
                "regione": best_cal.get("regione", "") if best_cal else ""
            })
    return results

# ═══ AGGREGAZIONE E SALVATAGGIO ══════════════════════════════════
def aggregate(results: list[dict]):
    athletes = {}
    teams = {}
    team_by_cat = defaultdict(lambda: defaultdict(lambda: {"punti":0,"p1":0,"p2":0,"p3":0,"pout":0,"atleti":set(),"nome":""}))
    
    # Classifiche regionali
    regional_scores_atleta = defaultdict(lambda: defaultdict(lambda: {}))
    regional_scores_team = defaultdict(lambda: defaultdict(lambda: {}))

    for r in results:
        pos = r["posizione"]
        if pos < 1 or pos > 10: continue

        aid = r["atleta_id"]
        tid = r["team_id"]
        pts = r["punti_effettivi"]
        cc  = r["categoria"]
        reg = r.get("regione", "").upper()

        if aid not in athletes:
            athletes[aid] = {"id":aid,"nome":r["nome"],"cognome":r["cognome"],
                             "team_attuale":r["team"],"team_id":tid,
                             "categoria":cc,"genere":r["genere"],
                             "punti_totali":0,"risultati":[]}
        athletes[aid]["punti_totali"] += pts
        athletes[aid]["team_attuale"] = r["team"]
        athletes[aid]["team_id"] = tid
        athletes[aid]["risultati"].append({
            "gara_id":r["gara_id"],"nome_gara":r["nome_gara"],"data":r["data"],
            "posizione":pos,"tipo_gara":r["tipo"],"moltiplicatore":r["moltiplicatore"],
            "punti_base":r["punti_base"],"punti_effettivi":pts,"team":r["team"],
            "rank_dopo_gara": r.get("rank_dopo_gara"),
            "punti_totali_dopo_gara": r.get("punti_totali_dopo_gara")
        })

        if tid not in teams:
            teams[tid] = {"id":tid,"nome":r["team"],"punti_totali":0,"atleti":[],"risultati":[],"punti_per_cat":{}}
        teams[tid]["punti_totali"] += pts
        if aid not in teams[tid]["atleti"]: teams[tid]["atleti"].append(aid)
        teams[tid]["risultati"].append({
            "gara_id":r["gara_id"],"nome_gara":r["nome_gara"],"data":r["data"],
            "atleta_id":aid,"atleta_cognome":r["cognome"],"atleta_nome":r["nome"],
            "posizione":pos,"punti_base":r["punti_base"],"punti_effettivi":pts,
            "rank_dopo_gara": r.get("rank_dopo_gara"),
            "team_rank_dopo_gara": r.get("team_rank_dopo_gara"),
            "punti_totali_dopo_gara": r.get("punti_totali_dopo_gara"),
            "team_punti_totali_dopo_gara": r.get("team_punti_totali_dopo_gara")
        })
        teams[tid]["punti_per_cat"][cc] = teams[tid]["punti_per_cat"].get(cc,0) + pts

        tbc = team_by_cat[cc][tid]
        tbc["punti"] += pts
        if pos == 1: tbc["p1"] += 1
        elif pos == 2: tbc["p2"] += 1
        elif pos == 3: tbc["p3"] += 1
        elif pos <= 10: tbc["pout"] += 1
        tbc["atleti"].add(aid)
        tbc["nome"] = r["team"]

    athlete_rankings = {c:[] for c in ALL_CODES}
    for aid, a in athletes.items():
        cc = a["categoria"]
        if cc not in athlete_rankings:
            athlete_rankings[cc] = []
        rl = a["risultati"]
        p1 = sum(1 for x in rl if x["posizione"]==1)
        p2 = sum(1 for x in rl if x["posizione"]==2)
        p3 = sum(1 for x in rl if x["posizione"]==3)
        pout = sum(1 for x in rl if 4 <= x["posizione"] <= 10)
        top = len(rl)
        bst = min((x["posizione"] for x in rl), default=99)
        athlete_rankings[cc].append({
            "atleta_id":aid,"cognome":a["cognome"],"nome":a["nome"],
            "team_id":a["team_id"],"team_nome":a["team_attuale"],
            "punti":a["punti_totali"],"gare":top,"p1":p1,"p2":p2,"p3":p3,"pout":pout,
            "top10":top,"migliore":bst,
        })
    for cc in athlete_rankings:
        athlete_rankings[cc].sort(key=lambda x:(-x["punti"],-x["p1"],-x["p2"],-x["p3"]))
        for i,row in enumerate(athlete_rankings[cc]): row["pos"] = i+1
        
        # Trend per Atleti
        cat_results = [r for r in results if r["categoria"] == cc]
        if cat_results:
            dates = sorted(list(set(r["data"] for r in cat_results)))
            if len(dates) >= 2:
                last_d = dates[-1]
                p_scores = defaultdict(lambda: {"pts":0,"p1":0,"p2":0,"p3":0})
                for r in cat_results:
                    if r["data"] < last_d:
                        aid = r["atleta_id"]
                        p_scores[aid]["pts"] += r["punti_effettivi"]
                        p = r["posizione"]
                        if p==1: p_scores[aid]["p1"]+=1
                        elif p==2: p_scores[aid]["p2"]+=1
                        elif p==3: p_scores[aid]["p3"]+=1
                p_rows = []
                for aid, s in p_scores.items():
                    p_rows.append({"id":aid,"pts":s["pts"],"p1":s["p1"],"p2":s["p2"],"p3":s["p3"]})
                p_rows.sort(key=lambda x:(-x["pts"],-x["p1"],-x["p2"],-x["p3"]))
                p_map = {row["id"]: i+1 for i,row in enumerate(p_rows)}
                for row in athlete_rankings[cc]:
                    if row["atleta_id"] in p_map: row["prev_pos"] = p_map[row["atleta_id"]]

    team_rankings = {c:[] for c in ALL_CODES}
    for cc, tdict in team_by_cat.items():
        rows = []
        for tid, t in tdict.items():
            rows.append({
                "team_id":tid,"team_nome":t["nome"],"punti":t["punti"],
                "p1":t["p1"],"p2":t["p2"],"p3":t["p3"],"pout":t["pout"],"n_atleti":len(t["atleti"]),
            })
        rows.sort(key=lambda x:(-x["punti"],-x["p1"],-x["p2"],-x["p3"]))
        for i,row in enumerate(rows): row["pos"] = i+1
        
        # Trend per Team
        cat_results = [r for r in results if r["categoria"] == cc]
        if cat_results:
            dates = sorted(list(set(r["data"] for r in cat_results)))
            if len(dates) >= 2:
                last_d = dates[-1]
                p_scores = defaultdict(lambda: {"pts":0,"p1":0,"p2":0,"p3":0})
                for r in cat_results:
                    if r["data"] < last_d:
                        tid = r["team_id"]
                        p_scores[tid]["pts"] += r["punti_effettivi"]
                        p = r["posizione"]
                        if p==1: p_scores[tid]["p1"]+=1
                        elif p==2: p_scores[tid]["p2"]+=1
                        elif p==3: p_scores[tid]["p3"]+=1
                p_rows = []
                for tid, s in p_scores.items():
                    p_rows.append({"id":tid,"pts":s["pts"],"p1":s["p1"],"p2":s["p2"],"p3":s["p3"]})
                p_rows.sort(key=lambda x:(-x["pts"],-x["p1"],-x["p2"],-x["p3"]))
                p_map = {row["id"]: i+1 for i,row in enumerate(p_rows)}
                for row in rows:
                    if row["team_id"] in p_map: row["prev_pos"] = p_map[row["team_id"]]
        
        team_rankings[cc] = rows

    # 4. Save Regional Rankings
    reg_dir = DATA_DIR / "rankings_regionali"
    reg_dir.mkdir(exist_ok=True)
    
    for reg, cats in regional_scores_atleta.items():
        r_path = reg_dir / reg
        r_path.mkdir(exist_ok=True)
        (r_path / "team").mkdir(exist_ok=True) # Per coerenza con folder
        
        for cc, scores in cats.items():
            # Atleti
            alist = sorted(scores.values(), key=lambda x: (x["pts"], x["p1"], x["p2"], x["p3"]), reverse=True)
            for i, it in enumerate(alist): it["pos"] = i + 1
            with open(r_path / f"{cc}.json", "w", encoding="utf-8") as f:
                json.dump(alist, f, indent=2)
            
            # Team
            t_scores = regional_scores_team[reg].get(cc, {})
            tlist = sorted(t_scores.values(), key=lambda x: (x["pts"], x["p1"], x["p2"], x["p3"]), reverse=True)
            for i, it in enumerate(tlist): it["pos"] = i + 1
            with open(r_path / "team" / f"{cc}.json", "w", encoding="utf-8") as f:
                json.dump(tlist, f, indent=2)

    return athletes, teams, athlete_rankings, team_rankings

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)
    (DATA_DIR / "team_rankings").mkdir(exist_ok=True)

    print(f"\n{'='*60}\n  FCI SCRAPER v4 — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n{'='*60}\n")

    print("[1/3] Lettura Calendario Manuale…")
    # Carichiamo il calendario da calendario_manuale.json (la sorgente utente)
    calendar_source = load_manual_calendar()
    
    # Inizializziamo cal_by_date usando il calendario caricato
    cal_by_date = {}
    for g in calendar_source: cal_by_date.setdefault(g["data"], []).append(g)

    print("  Caricamento overrides manuali storici (user_overrides.json)...")
    user_overrides = {}
    override_file = DATA_DIR / "user_overrides.json"
    clean_rx_ov = re.compile(r"\b(donne|esordienti|primo|secondo|anno|allievi|allieve|juniores|junior|elite|under 23|u23|u\.23|gara unica|valida perl il|campionato regionale)\b")
    if override_file.exists():
        with open(override_file, "r", encoding="utf-8") as f:
            for o in json.load(f):
                kbare = clean_rx_ov.sub("", norm(o["nome"])).strip().replace("gran premio", "gp").replace("g.p.", "gp").replace("°", "")
                kbare = re.sub(r"[^\w\s]", "", kbare)
                user_overrides[slug(kbare)] = o["classe_fci"]

    # Applica overrides anche alle entry del CALENDARIO (se vecchi overrides servono ancora)
    for g in calendar_source:
        gbare = clean_rx_ov.sub("", norm(g["nome"])).strip().replace("gran premio", "gp").replace("g.p.", "gp").replace("°", "")
        gbare = re.sub(r"[^\w\s]", "", gbare)
        gslug = slug(gbare)
        for ov_key, ov_class in user_overrides.items():
            if ov_key in gslug or gslug in ov_key:
                nt, nm, nis_cr, nis_ci = infer_tipo_from_class(ov_class, g["nome"], g.get("geo_category", 1))
                if getattr(g, "classe_fci", "") != ov_class or g["moltiplicatore"] != nm:
                    print(f"  [OVERRIDE CAL] {g['nome']}: {g['tipo']}(x{g['moltiplicatore']}) → {nt}(x{nm}) [{ov_class}]")
                    g["tipo"] = nt
                    g["moltiplicatore"] = nm
                    g["classe_fci"] = ov_class
                break

    print("\n[2/3] Risultati gare SOLO DA HOMEPAGE…")
    all_results = []
    soup = get_page(RISULTATI_URL)
    if soup:
        results = parse_risultati_homepage(soup, cal_by_date, user_overrides)
        all_results.extend(results)

    races_map = {}
    for r in all_results:
        gid = r["gara_id"]
        if gid not in races_map:
            races_map[gid] = {
                "id":gid,"nome":r["nome_gara"],"data":r["data"],
                "mese":int(r["data"][5:7]) if r.get("data") and len(r["data"])>=7 else 0,
                "anno":CURRENT_YEAR,"categoria":r["categoria"],"genere":r["genere"],
                "tipo":r["tipo"],"moltiplicatore":r["moltiplicatore"],
                "campionato_regionale":r["campionato_regionale"],
                "campionato_italiano":r["campionato_italiano"],
            }

    # Prioritize calendar metadata since it has correct multipliers
    final_races = {g["id"]: g for g in calendar_source}
    
    # Add homepage races that are missing
    for rid, rdata in races_map.items():
        if rid not in final_races:
            final_races[rid] = rdata

    final_calendar = sorted(final_races.values(), key=lambda g: g["data"], reverse=True)

    print(f"\n[3/4] Calcolo Storico Classifiche e Running Score...")
    # Calcoliamo posizione storica atleta e team per ogni gara
    all_results.sort(key=lambda x: (x["data"], x["gara_id"])) # cronologico
    
    # Strutture per tenere traccia dei punteggi correnti (Running)
    # running_scores[cat][id] = {"pts": 0, "p1": 0, "p2": 0, "p3": 0}
    run_athlete = defaultdict(lambda: defaultdict(lambda: {"pts":0, "p1":0, "p2":0, "p3":0}))
    run_team = defaultdict(lambda: defaultdict(lambda: {"pts":0, "p1":0, "p2":0, "p3":0}))
    
    r_grouped = {}
    for r in all_results:
        r_grouped.setdefault(r["gara_id"], []).append(r)
        
    for gid, r_list in r_grouped.items():
        # 1. Aggiorna punteggi running per tutti i partecipanti di questa gara
        for r in r_list:
            aid = r["atleta_id"]
            tid = r["team_id"]
            cc = r["categoria"]
            pts = r["punti_effettivi"]
            pos = r["posizione"]
            cal_entry = final_races.get(r["gara_id"], {})
            r["regione"] = cal_entry.get("regione", "")
            r["localita"] = cal_entry.get("localita", "")
            
            # Update Athlete
            a_score = run_athlete[cc][aid]
            a_score["pts"] += pts
            if pos == 1: a_score["p1"] += 1
            elif pos == 2: a_score["p2"] += 1
            elif pos == 3: a_score["p3"] += 1
            
            # Update Team
            t_score = run_team[cc][tid]
            t_score["pts"] += pts
            if pos == 1: t_score["p1"] += 1
            elif pos == 2: t_score["p2"] += 1
            elif pos == 3: t_score["p3"] += 1
            
        # 2. Calcola i ranking correnti (con tie-break) per ogni categoria coinvolta
        cats_in_race = set(r["categoria"] for r in r_list)
        for cc in cats_in_race:
            # Ranking Atleti
            aids_ranked = sorted(run_athlete[cc].keys(), 
                                 key=lambda x: (-run_athlete[cc][x]["pts"], -run_athlete[cc][x]["p1"], -run_athlete[cc][x]["p2"], -run_athlete[cc][x]["p3"]))
            a_rank_map = {aid: idx + 1 for idx, aid in enumerate(aids_ranked)}
            
            # Ranking Team
            tids_ranked = sorted(run_team[cc].keys(),
                                 key=lambda x: (-run_team[cc][x]["pts"], -run_team[cc][x]["p1"], -run_team[cc][x]["p2"], -run_team[cc][x]["p3"]))
            t_rank_map = {tid: idx + 1 for idx, tid in enumerate(tids_ranked)}
            
            # 3. Salva i rank nel risultato della gara
            for r in r_list:
                if r["categoria"] == cc:
                    aid = r["atleta_id"]
                    tid = r["team_id"]
                    r["rank_dopo_gara"] = a_rank_map[aid]
                    r["team_rank_dopo_gara"] = t_rank_map[tid]
                    r["punti_totali_dopo_gara"] = run_athlete[cc][aid]["pts"]
                    r["team_punti_totali_dopo_gara"] = run_team[cc][tid]["pts"]

    # Riordiniamo al contrario per output API standard (più recenti prima)
    all_results.sort(key=lambda x: (x["data"], x["gara_id"]), reverse=True)

    print(f"\n[4/4] Costruzione JSON…")
    athletes, teams, athlete_rankings, team_rankings = aggregate(all_results)

    def wj(p, d):
        with open(p,"w",encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)

    wj(DATA_DIR/"results_raw.json", all_results)
    wj(DATA_DIR/"calendar.json", final_calendar)
    wj(DATA_DIR/"athletes.json", athletes)
    wj(DATA_DIR/"teams.json", teams)

    for code, rows in athlete_rankings.items(): wj(DATA_DIR/f"rankings/{code}.json", rows)
    for code, rows in team_rankings.items(): wj(DATA_DIR/f"team_rankings/{code}.json", rows)

    wj(DATA_DIR/"meta.json", {
        "last_update": datetime.now().isoformat(),
        "total_races": len(races_map),
        "total_results": len(all_results),
        "total_athletes": len(athletes),
        "total_teams": len(teams),
        "seed_mode": False,
    })

    print(f"  Risultati totali: {len(all_results)} | Atleti: {len(athletes)} | Team: {len(teams)}")

if __name__ == "__main__":
    main()
