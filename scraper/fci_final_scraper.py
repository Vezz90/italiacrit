"""
fci_final_scraper.py — Parser FCI finale basato sulla struttura REALE verificata

Struttura pagina per categoria (es. risultati_gare_juniores.htm):
- div.container-fluid (uno a volta, per ogni gara)
  - div.mb-4: "CATEGORIA YYYY-MM-DD - REGIONE COMUNE (PROV)"
  - h4[color:#1a8ad8]: NOME GARA
  - div.table-responsive.mb-5 > table
    - thead: Pos. | Corridore | Squadra | Distacco
    - tbody: th[pos] | td[cognome nome] | td[squadra] | td[tempo]

Esegui: python scraper/fci_final_scraper.py
"""
import requests
from bs4 import BeautifulSoup
import re, html as HTMLMOD, json, sys, time, unicodedata
from pathlib import Path
from datetime import datetime

CURRENT_YEAR = datetime.now().year
DATA_DIR = Path(__file__).parent.parent / "data"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "it-IT,it;q=0.9",
})

CATEGORY_PAGES = {
    "Elite-Under23": "https://risultati-strada.federciclismo.it/risultati_gare_elite-under23.htm",
    "Juniores":      "https://risultati-strada.federciclismo.it/risultati_gare_juniores.htm",
    "Allievi":       "https://risultati-strada.federciclismo.it/risultati_gare_allievi.htm",
    "Esordienti":    "https://risultati-strada.federciclismo.it/risultati_gare_esordienti.htm",
    "Donne":         "https://risultati-strada.federciclismo.it/risultati_gare_donne.htm",
}

BASE_POINTS = {1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1}


def norm(s): 
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower()).strip()

def slug(s):
    s = norm(s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

def get_page(url):
    for attempt in range(3):
        try:
            r = SESSION.get(url, timeout=20)
            r.encoding = "iso-8859-1"
            time.sleep(1.2)
            return BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            print(f"  retry {attempt+1}: {e}")
            time.sleep(3)
    return None

def get_mult(race_name, cat_context):
    n = norm(race_name + " " + cat_context)
    if "campionato italiano" in n or "campionati italiani" in n:
        return 3, "internazionale", False, True
    if "campionato regionale" in n or "prova valida campionato" in n or "c.r." in n:
        return 2, "nazionale", True, False
    return 1, "regionale", False, False

def detect_gender(cat_name, race_name=""):
    c = (cat_name + " " + race_name).lower()
    return "F" if any(k in c for k in ["donne", "femm", "allieve"]) else "M"


def parse_page(cat_name: str, soup: BeautifulSoup) -> list[dict]:
    """Parser della pagina categoria FCI — struttura verificata."""
    results = []
    gender_base = detect_gender(cat_name)

    # Strategia: trova tutti gli h4 con colore FCI (nome gare)
    # Poi navigiamo avanti e indietro per trovare data e tabella
    h4_races = soup.find_all("h4", style=re.compile(r"color\s*:\s*#1a8ad8", re.I))

    if not h4_races:
        # Fallback: tutti gli h4
        h4_races = soup.find_all("h4")

    print(f"    h4 trovati: {len(h4_races)}")

    for h4 in h4_races:
        race_name = HTMLMOD.unescape(h4.get_text(strip=True))
        if not race_name or len(race_name) < 3:
            continue

        # Cerca la data nel testo predecessore (div.mb-4 o simile)
        race_date = ""
        cat_context = ""
        race_region = ""

        # Cerca all'indietro fino a 15 elementi
        el = h4.find_previous_sibling()
        for _ in range(15):
            if el is None:
                break
            el_text = el.get_text(" ", strip=True) if hasattr(el, 'get_text') else str(el)

            # Cerca data YYYY-MM-DD
            dm = re.search(r"(\d{4}-\d{2}-\d{2})", el_text)
            if dm:
                race_date = dm.group(1)
                cat_context = el_text
                break
            el = el.find_previous_sibling() if hasattr(el, 'find_previous_sibling') else None

        # Se non trovata come sibling, cerca nel parent
        if not race_date:
            parent = h4.parent
            for _ in range(5):
                if parent is None:
                    break
                ptxt = parent.get_text(" ", strip=True)
                dm = re.search(r"(\d{4}-\d{2}-\d{2})", ptxt)
                if dm:
                    race_date = dm.group(1)
                    cat_context = ptxt[:200]
                    break
                parent = parent.parent

        if not race_date:
            # Cerca dopo l'h4
            el = h4.find_next_sibling()
            for _ in range(5):
                if el is None:
                    break
                el_text = el.get_text(" ", strip=True) if hasattr(el, 'get_text') else ""
                dm = re.search(r"(\d{4}-\d{2}-\d{2})", el_text)
                if dm:
                    race_date = dm.group(1)
                    cat_context = el_text
                    break
                el = el.find_next_sibling()

        if not race_date or not race_date.startswith(str(CURRENT_YEAR)):
            continue

        # Trova la tabella successiva all'h4
        table = h4.find_next("table")
        if not table:
            # Cerca nel parent
            table = h4.parent.find("table") if h4.parent else None
        if not table:
            continue

        mult, tipo, is_cr, is_ci = get_mult(race_name, cat_context)
        gender = detect_gender(cat_name, race_name)
        gara_id = slug(race_name) + "_" + race_date

        # Parsa righe classifica
        for row in table.find_all("tr"):
            th = row.find("th")
            if not th:
                continue

            # Normalizza posizione: "1° " → "1", "1░" → "1"
            pos_raw = th.get_text(strip=True)
            pos_raw = pos_raw.replace("░", "").replace("°", "").replace(".", "").strip()
            if not pos_raw.isdigit():
                continue
            pos = int(pos_raw)
            if pos < 1 or pos > 10:
                continue

            tds = row.find_all("td")
            if not tds:
                continue

            # Cognome+Nome: primo td (formato "COGNOME NOME" o "COGNOME  NOME")
            # Gestione apostrifi via data-attributes
            cognome = ""
            nome = ""
            team = ""
            tempo = ""

            # Data attributes (apostrofi)
            for td in tds:
                if td.get("data-cognome"):
                    cognome = HTMLMOD.unescape(td["data-cognome"]).strip().upper()
                if td.get("data-nome"):
                    nome = HTMLMOD.unescape(td["data-nome"]).strip().upper()
                if td.get("data-team") or td.get("data-squadra"):
                    team = HTMLMOD.unescape(
                        td.get("data-team", "") or td.get("data-squadra", "")
                    ).strip().upper()

            # Fallback testo diretto
            if not cognome and tds:
                raw = HTMLMOD.unescape(tds[0].get_text(strip=True)).upper()
                raw = re.sub(r"\s{2,}", "  ", raw).strip()
                # Pattern FCI: COGNOME può avere 2 spazi prima del NOME
                if "  " in raw:
                    parts = raw.split("  ", 1)
                    cognome = parts[0].strip()
                    nome = parts[1].strip()
                else:
                    parts = raw.split()
                    cognome = parts[0] if parts else ""
                    nome = " ".join(parts[1:]) if len(parts) > 1 else ""

            # Team: secondo td
            if not team and len(tds) >= 2:
                team_txt = HTMLMOD.unescape(tds[1].get_text(strip=True)).upper()
                team_txt = re.sub(r"\s+", " ", team_txt).strip()
                if team_txt and len(team_txt) > 2:
                    team = team_txt

            # Distacco: terzo td (o ultimo)
            if len(tds) >= 3:
                tempo = HTMLMOD.unescape(tds[-1].get_text(strip=True))

            if not cognome:
                continue

            atleta_id = slug(f"{cognome}_{nome}") if nome else slug(cognome)
            team_id   = slug(team) if team else "SCONOSCIUTO"
            pts_base  = BASE_POINTS.get(pos, 0)
            pts_eff   = pts_base * mult

            results.append({
                "gara_id":   gara_id,
                "nome_gara": race_name,
                "data":      race_date,
                "categoria": cat_name,
                "genere":    gender,
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
                "punti_base":      pts_base,
                "punti_effettivi": pts_eff,
            })

    return results


def aggregate(results):
    athletes = {}
    teams = {}

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
                            "ELI_M" if r["genere"] == "M" else "ELI_F")

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

    all_codes = set(CAT_CODES.values())
    rankings = {c: [] for c in all_codes}

    for aid, a in athletes.items():
        cc = a["categoria"]
        if cc not in rankings:
            continue
        r_list = a["risultati"]
        vittorie = sum(1 for x in r_list if x["posizione"] == 1)
        podi     = sum(1 for x in r_list if x["posizione"] <= 3)
        top10    = len(r_list)
        best     = min((x["posizione"] for x in r_list), default=99)
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


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  FCI SCRAPER FINALE — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    all_results = []
    races_map   = {}

    for cat_name, url in CATEGORY_PAGES.items():
        print(f"\n[GARE] {cat_name}")
        soup = get_page(url)
        if not soup:
            print("  SKIP")
            continue
        results = parse_page(cat_name, soup)
        all_results.extend(results)

        for r in results:
            gid = r["gara_id"]
            if gid not in races_map:
                races_map[gid] = {
                    "id": gid, "nome": r["nome_gara"], "data": r["data"],
                    "mese": int(r["data"][5:7]) if r.get("data") else 0,
                    "anno": CURRENT_YEAR,
                    "categoria": r["categoria"], "genere": r["genere"],
                    "tipo": r["tipo"],
                    "campionato_regionale": r["campionato_regionale"],
                    "campionato_italiano":  r["campionato_italiano"],
                    "url": None,
                }

        # Riepilogo gare trovate
        from collections import Counter
        gare_counter = Counter(r["gara_id"] for r in results)
        for gid, cnt in gare_counter.most_common():
            nome = next((r["nome_gara"] for r in results if r["gara_id"]==gid), gid)
            data = next((r["data"] for r in results if r["gara_id"]==gid), "")
            print(f"  ✓ {data} | {nome[:50]:50s} | {cnt} risultati")

    # Calendario: le gare trovate nei risultati diventano il calendario
    calendar = sorted(races_map.values(), key=lambda g: g["data"], reverse=True)

    print(f"\n\n{'='*60}")
    print(f"  Gare totali:     {len(races_map)}")
    print(f"  Risultati:       {len(all_results)}")

    athletes, teams, rankings = aggregate(all_results)
    print(f"  Atleti:          {len(athletes)}")
    print(f"  Team:            {len(teams)}")

    # Scrittura JSON
    write_json(DATA_DIR / "results_raw.json", all_results)
    write_json(DATA_DIR / "calendar.json", calendar)
    write_json(DATA_DIR / "athletes.json", athletes)
    write_json(DATA_DIR / "teams.json", teams)
    for code, rows in rankings.items():
        write_json(DATA_DIR / f"rankings/{code}.json", rows)

    meta = {
        "last_update": datetime.now().isoformat(),
        "total_races": len(races_map),
        "total_results": len(all_results),
        "total_athletes": len(athletes),
        "total_teams": len(teams),
        "seed_mode": False,
    }
    write_json(DATA_DIR / "meta.json", meta)

    print(f"\n  ✓ Tutti i JSON scritti in data/")
    print(f"{'='*60}\n")

    # Anteprima top-3 Juniores
    if rankings.get("JUN_M"):
        print("TOP 3 JUNIORES M:")
        for r in rankings["JUN_M"][:3]:
            print(f"  {r['pos']}. {r['cognome']} {r['nome']} — {r['punti']} pt")


if __name__ == "__main__":
    main()
