"""
points_calculator.py — Calcola punti, classifiche atleti e team
"""
import re
import unicodedata
from datetime import datetime

CURRENT_YEAR = datetime.now().year

# Tabella base punti top 10
BASE_POINTS = {1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1}

# Moltiplicatori per tipo gara + flag speciali
MULTIPLIERS = {
    "regionale": 1,
    "nazionale": 2,
    "internazionale": 3,
}

# Mappatura categoria FCI → codice interno
CATEGORY_CODES = {
    # UOMINI
    ("Esordienti", "M", "1"): "ES1_M",
    ("Esordienti", "M", "2"): "ES2_M",
    ("Allievi", "M", "1"):    "AL1_M",
    ("Allievi", "M", "2"):    "AL2_M",
    ("Juniores", "M", "1"):   "JUN_M",
    ("Juniores", "M", "2"):   "JUN_M",
    ("Under23", "M", ""):     "U23_M",
    ("Elite", "M", ""):       "ELI_M",
    ("Elite-Under23", "M", ""): "ELI_M",
    # DONNE
    ("Esordienti", "F", "1"): "ES1_F",
    ("Esordienti", "F", "2"): "ES2_F",
    ("Allievi", "F", "1"):    "AL1_F",
    ("Allievi", "F", "2"):    "AL2_F",
    ("Juniores", "F", "1"):   "JUN_F",
    ("Juniores", "F", "2"):   "JUN_F",
    ("Donne", "F", ""):       "ELI_F",
    ("Elite", "F", ""):       "ELI_F",
}

BIRTH_YEAR_RANGES = {
    # UOMINI (anno corrente come riferimento)
    "ES1_M": lambda y: (CURRENT_YEAR - y) == 13,
    "ES2_M": lambda y: (CURRENT_YEAR - y) == 14,
    "AL1_M": lambda y: (CURRENT_YEAR - y) == 15,
    "AL2_M": lambda y: (CURRENT_YEAR - y) == 16,
    "JUN_M": lambda y: (CURRENT_YEAR - y) in (17, 18),
    "U23_M": lambda y: (CURRENT_YEAR - y) in range(19, 23),
    "ELI_M": lambda y: (CURRENT_YEAR - y) >= 19,
    # DONNE
    "ES1_F": lambda y: (CURRENT_YEAR - y) == 13,
    "ES2_F": lambda y: (CURRENT_YEAR - y) == 14,
    "AL1_F": lambda y: (CURRENT_YEAR - y) == 15,
    "AL2_F": lambda y: (CURRENT_YEAR - y) == 16,
    "JUN_F": lambda y: (CURRENT_YEAR - y) in (17, 18),
    "ELI_F": lambda y: (CURRENT_YEAR - y) >= 19,
}


def normalize_str(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def slugify(s: str) -> str:
    s = normalize_str(s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", "_", s).upper()


def get_multiplier(cal_entry: dict | None, tipo_fallback: str = "regionale") -> int:
    if cal_entry is None:
        return MULTIPLIERS.get(tipo_fallback, 1)
    tipo = cal_entry.get("tipo", tipo_fallback)
    if cal_entry.get("campionato_italiano"):
        return 3
    if cal_entry.get("campionato_regionale"):
        return 2
    return MULTIPLIERS.get(tipo, 1)


def infer_category_code(fci_category: str, gender: str, birth_year: int | None) -> str:
    """Inferisce il codice categoria da categoria FCI + genere + anno nascita."""
    cat = fci_category.strip()
    g = "F" if gender == "F" else "M"

    age = (CURRENT_YEAR - birth_year) if birth_year else None
    year_str = ""

    if age is not None:
        if age in (13, 15, 17):
            year_str = "1"
        elif age in (14, 16, 18):
            year_str = "2"

    # Prova mapping diretto
    key = (cat, g, year_str)
    if key in CATEGORY_CODES:
        return CATEGORY_CODES[key]

    # Fallback senza anno
    key2 = (cat, g, "")
    if key2 in CATEGORY_CODES:
        return CATEGORY_CODES[key2]

    # Ultima spiaggia per categoria "Donne"
    if "donne" in cat.lower() or g == "F":
        return "ELI_F"

    return "ELI_M"


def infer_gender_from_category(category: str) -> str:
    if any(kw in category.lower() for kw in ["donne", "femm", "allieve", "donna"]):
        return "F"
    return "M"


def calculate_all(calendar: list, results_raw: list) -> tuple[dict, dict, dict]:
    """
    Calcola atleti, team e classifiche da calendario + risultati grezzi.
    Ritorna: (athletes, teams, rankings)
    """
    # Indicizza calendario per id gara
    cal_by_id = {g["id"]: g for g in calendar}

    athletes: dict[str, dict] = {}
    teams: dict[str, dict] = {}

    for r in results_raw:
        # Solo anno corrente
        if not str(r.get("data", "")).startswith(str(CURRENT_YEAR)):
            continue

        pos = r.get("posizione", 99)
        if pos > 10 or pos < 1:
            continue

        gara_id = r.get("gara_id", "")
        cal_entry = cal_by_id.get(gara_id)
        category_raw = r.get("categoria", "Varie")
        gender = r.get("genere") or infer_gender_from_category(category_raw)

        mult = get_multiplier(cal_entry, r.get("tipo", "regionale"))
        punti_base = BASE_POINTS.get(pos, 0)
        punti_effettivi = punti_base * mult

        atleta_id = r.get("atleta_id") or f"{slugify(r.get('cognome',''))}_{slugify(r.get('nome',''))}"
        team_id = r.get("team_id") or slugify(r.get("team", "TEAM_SCONOSCIUTO"))

        # Usa categoria_code dal calendario (seed) se disponibile, altrimenti infersci
        birth_year = r.get("birth_year")
        cat_code = (
            cal_entry.get("categoria_code")
            if cal_entry and cal_entry.get("categoria_code")
            else infer_category_code(category_raw, gender, birth_year)
        )

        # ── ATLETA ──────────────────────────────────────────────
        if atleta_id not in athletes:
            athletes[atleta_id] = {
                "id": atleta_id,
                "nome": r.get("nome", ""),
                "cognome": r.get("cognome", ""),
                "team_attuale": r.get("team", ""),
                "team_id": team_id,
                "categoria": cat_code,
                "genere": gender,
                "punti_totali": 0,
                "risultati": [],
            }

        athletes[atleta_id]["punti_totali"] += punti_effettivi
        athletes[atleta_id]["team_attuale"] = r.get("team", athletes[atleta_id]["team_attuale"])
        athletes[atleta_id]["team_id"] = team_id
        athletes[atleta_id]["risultati"].append({
            "gara_id": gara_id,
            "nome_gara": r.get("nome_gara", ""),
            "data": r.get("data", ""),
            "posizione": pos,
            "tipo_gara": cal_entry["tipo"] if cal_entry else "regionale",
            "moltiplicatore": mult,
            "punti_base": punti_base,
            "punti_effettivi": punti_effettivi,
            "team": r.get("team", ""),
        })

        # ── TEAM ────────────────────────────────────────────────
        if team_id not in teams:
            teams[team_id] = {
                "id": team_id,
                "nome": r.get("team", ""),
                "punti_totali": 0,
                "atleti": [],
                "risultati": [],
            }

        teams[team_id]["punti_totali"] += punti_effettivi
        if atleta_id not in teams[team_id]["atleti"]:
            teams[team_id]["atleti"].append(atleta_id)
        teams[team_id]["risultati"].append({
            "gara_id": gara_id,
            "nome_gara": r.get("nome_gara", ""),
            "data": r.get("data", ""),
            "atleta_id": atleta_id,
            "atleta_cognome": r.get("cognome", ""),
            "atleta_nome": r.get("nome", ""),
            "posizione": pos,
            "punti_base": punti_base,
            "punti_effettivi": punti_effettivi,
        })

    # ── CLASSIFICHE per categoria ────────────────────────────────
    rankings: dict[str, list] = {code: [] for code in set(CATEGORY_CODES.values())}

    for atleta_id, a in athletes.items():
        cat_code = a.get("categoria", "ELI_M")
        if cat_code in rankings:
            # Stats derivate
            vittorie = sum(1 for r in a["risultati"] if r["posizione"] == 1)
            podi = sum(1 for r in a["risultati"] if r["posizione"] <= 3)
            top10 = len(a["risultati"])
            best = min((r["posizione"] for r in a["risultati"]), default=99)

            rankings[cat_code].append({
                "atleta_id": atleta_id,
                "cognome": a["cognome"],
                "nome": a["nome"],
                "team_id": a["team_id"],
                "team_nome": a["team_attuale"],
                "punti": a["punti_totali"],
                "gare": top10,
                "vittorie": vittorie,
                "podi": podi,
                "top10": top10,
                "migliore": best,
            })

    # Ordina per punti → vittorie → podi
    for cat_code in rankings:
        rankings[cat_code].sort(
            key=lambda x: (-x["punti"], -x["vittorie"], -x["podi"])
        )
        for i, row in enumerate(rankings[cat_code]):
            row["pos"] = i + 1

    return athletes, teams, rankings
