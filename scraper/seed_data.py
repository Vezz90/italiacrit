"""
seed_data.py — Genera dati demo realistici per ItaliacritResultati
Atleti, gare e risultati verosimili del ciclismo italiano 2026
"""
import random
from datetime import datetime, timedelta

CURRENT_YEAR = datetime.now().year

# Nomi e cognomi italiani realistici
COGNOMI_M = [
    "ROSSI", "FERRARI", "BIANCHI", "CONTI", "ESPOSITO", "RUSSO", "COLOMBO",
    "RICCI", "MARINO", "GRECO", "BRUNO", "GALLO", "CONTE", "SERGI", "MARTINI",
    "COSTA", "GIORDANO", "MANCINI", "RIZZO", "LOMBARDI", "MORETTI", "BARBIERI",
    "FONTANA", "SANTORO", "MARINI", "RINALDI", "CARUSO", "FERRETTI", "PAGANO",
    "D'ANGELO", "DELL'AGNELLO", "DALL'ARA", "DE LUCA", "DE ROSA", "DI MAIO",
    "GALLI", "LEONE", "LONGO", "MONTI", "NERI", "POLI", "SALA", "TOSI",
    "VITALE", "ZANI", "SORDI", "MAGNI", "BARTALI", "COPPI", "MOSER",
]

COGNOMI_F = [
    "ROSSI", "FERRARI", "BIANCHI", "CONTI", "ESPOSITO", "ROMANO", "COLOMBO",
    "RICCI", "MARINO", "GRECO", "BRUNO", "GALLO", "CONTE", "SARTO", "MARTINI",
    "COSTA", "GIORDANO", "MANCINI", "RIZZO", "LOMBARDI", "MORETTI", "BARBIERI",
    "FONTANA", "SANTORO", "MARINI", "RINALDI", "CARUSO", "FERRETTI", "PAGANO",
    "GALLI", "LEONE", "LONGA", "MONTI", "NERI", "POLI", "SALA", "TOSI",
    "VITALE", "ZANI", "LONGO", "BRONZINI", "GUARISCHI", "PALADIN", "BALSAMO",
]

NOMI_M = [
    "MARCO", "LUCA", "ANDREA", "MATTEO", "GIOVANNI", "FEDERICO", "DAVIDE",
    "SIMONE", "FILIPPO", "ROBERTO", "ANTONIO", "GIUSEPPE", "RICCARDO", "MARIO",
    "ALEX", "NICOLA", "STEFANO", "DIEGO", "OMAR", "SAMUELE", "EDOARDO",
    "LORENZO", "ALESSIO", "DANIELE", "EMANUELE", "GIULIO", "IVAN", "JACOPO",
    "KEVIN", "LEONARDO", "MASSIMO", "NICOLAS", "OSCAR", "PAOLO", "QUIRINO",
]

NOMI_F = [
    "ELENA", "SOFIA", "GIULIA", "MARTINA", "VALENTINA", "ALICE", "SARA",
    "LAURA", "CHIARA", "ANNA", "MARIA", "ROSA", "LUCIA", "EMMA", "GIORGIA",
    "FRANCESCA", "ALESSIA", "SILVIA", "BEATRICE", "CAMILLA", "DIANA", "ELISA",
    "FEDERICA", "GIOVANNA", "ILARIA", "JESSICA", "KATIA", "LINDA", "MARTA",
]

TEAMS_M = [
    "ASD CICLISTICA TOSCANA", "UC VALDARNO", "GS MUGELLO TEAM", "TEAM SARDINIA CYCLING",
    "ASD VELOSPORT LOMBARDIA", "GS EMILIA ROMAGNA", "UC VENETO BICI", "TEAM SICILIA CORSE",
    "ASD LAZIO CYCLING CLUB", "GS CAMPANIA STRADA", "POLISPORTIVA PIEMONTE",
    "ASD FRIULI VELOCE", "UC LIGURIA MARE", "GS MARCHE BIKE", "TEAM ABRUZZO CORSE",
    "ASD UMBRIA CYCLING", "GS BASILICATA STRADA", "TEAM CALABRIA VELOCE",
    "CYCLING ACADEMY TOSCANA", "VELOCLUB NORD EST", "MATRIX CYCLING TEAM",
    "ASD JUVENES CYCLING", "PALLONCINO AZZURRO BIKE", "GS OLIMPIA CICLISMO",
]

TEAMS_F = [
    "ASD DONNE IN BICI TOSCANA", "UC VALDARNO WOMEN", "TEAM FEMMINILE SARDINIA",
    "GS LOMBARDIA DONNE", "ASD VENETO WOMEN CYCLING", "TEAM SICILIA DONNE",
    "POLISPORTIVA PIEMONTE DONNE", "UC LIGURIA WOMEN", "GS EMILIA DONNE",
    "ASD LAZIO WOMEN CYCLING", "TEAM UMBRIA FEMMINILE", "GS MARCHE WOMEN",
    "VELOCLUB WOMEN NORD EST", "CYCLING ACADEMY DONNE", "MATRIX WOMEN TEAM",
]

GARE_REGIONALI = [
    "GP CITTÀ DI FIRENZE", "TROFEO VALDARNO", "GRAN PREMIO MUGELLO",
    "COPPA CITTA DI PISA", "GP VERSILIA", "TROFEO AMIATA",
    "GP CITTÀ DI SIENA", "TROFEO CHIANTI CLASSICO", "COPPA MAREMMA",
    "GP LIVORNO", "TROFEO GARFAGNANA", "COPPA PIETRASANTA",
    "GP CORTONA", "TROFEO AREZZO", "COPPA CASENTINO",
    "GP VALTIBERINA", "TROFEO VALDELSA", "GP EMPOLI",
    "TROFEO VALDARNO SUPERIORE", "COPPA MONTECATINI",
    "GP FIUGGI", "TROFEO LAZIO BICI", "COPPA ROMA CICLISMO",
    "GP NAPOLI STRADA", "TROFEO CAMPANIA CORSE", "GP PALERMO VELOCE",
    "COPPA SARDEGNA BICI", "GP VENEZIA CICLISMO", "TROFEO VENETO",
    "COPPA LOMBARDIA CLASSICA", "GP MILANO APENNINO",
]

GARE_NAZIONALI = [
    "GRAN PREMIO INDUSTRIA E ARTIGIANATO", "TROFEO KARLSBERG",
    "COPPA CITTÀ DI ASTI", "GP CAPODARCO", "TROFEO LAIGUEGLIA",
    "GIRO DELLA TOSCANA JUNIORES", "CAMPIONATO REGIONALE TOSCANA JUNIORES",
    "CAMPIONATO REGIONALE LOMBARDIA JUNIORES", "CAMPIONATO REGIONALE VENETO",
    "GP PALIO DEL RECIOTO", "FRECCIA DEI VINI", "GIRO DEL MENDRISIOTTO",
    "COPPA AGOSTONI JUNIORES", "GRAN PREMIO SOMMA", "TROFEO EDIL C JUNIORES",
]

GARE_INTERNAZIONALI = [
    "CAMPIONATI ITALIANI JUNIORES", "CAMPIONATO ITALIANO ELITE-U23",
    "CAMPIONATI ITALIANI ALLIEVI", "CAMPIONATI ITALIANI ESORDIENTI",
    "GRAND PRIX PALIO DEL RECIOTO", "GIRO DEL MEDIO BRENTA",
    "COPPA SAN GEO", "TROFEO BUFFONI",
]

CATEGORIE = [
    ("ES1_M", "Esordienti", "M", [2013]),
    ("ES2_M", "Esordienti", "M", [2012]),
    ("AL1_M", "Allievi", "M", [2011]),
    ("AL2_M", "Allievi", "M", [2010]),
    ("JUN_M", "Juniores", "M", [2009, 2008]),
    ("U23_M", "Elite-Under23", "M", [2007, 2006, 2005, 2004]),
    ("ELI_M", "Elite-Under23", "M", [2003, 2002, 2001, 2000, 1999, 1998]),
    ("ES1_F", "Esordienti", "F", [2013]),
    ("ES2_F", "Esordienti", "F", [2012]),
    ("AL1_F", "Allievi", "F", [2011]),
    ("AL2_F", "Allievi", "F", [2010]),
    ("JUN_F", "Juniores", "F", [2009, 2008]),
    ("ELI_F", "Donne", "F", [2007, 2006, 2005, 2004, 2003, 2002, 2001, 2000]),
]

TIPO_MAP = {
    "regionale": 1,
    "nazionale": 2,
    "internazionale": 3,
}


def slugify(s: str) -> str:
    import re, unicodedata
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", "_", s).strip("_").upper()


def make_calendar() -> list:
    """Genera un calendario realistico 2026."""
    rng = random.Random(42)
    calendar = []

    # Genera date distribuite da gennaio a ottobre
    start = datetime(CURRENT_YEAR, 1, 15)
    end = datetime(CURRENT_YEAR, 10, 31)
    delta = end - start

    gare_reg = [(g, "regionale") for g in GARE_REGIONALI]
    gare_naz = [(g, "nazionale") for g in GARE_NAZIONALI]
    gare_int = [(g, "internazionale") for g in GARE_INTERNAZIONALI]
    all_gare = gare_reg + gare_naz + gare_int

    for cat_code, fci_cat, gender, _ in CATEGORIE:
        # 8-16 gare per categoria
        n_gare = rng.randint(8, 16)
        used_dates = set()

        for _ in range(n_gare):
            nome_gara, tipo = rng.choice(all_gare)

            # Genera data casuale unica per categoria
            for _ in range(20):
                days_offset = rng.randint(0, delta.days)
                # Solo weekend (sabato=5, domenica=6)
                d = start + timedelta(days=days_offset)
                if d.weekday() not in (5, 6):
                    d += timedelta(days=(5 - d.weekday()) % 7)
                date_iso = d.strftime("%Y-%m-%d")
                if date_iso not in used_dates:
                    used_dates.add(date_iso)
                    break

            # Nomi femminili aggiustati
            if gender == "F" and "DONNE" not in nome_gara:
                nome_display = f"{nome_gara} DONNE"
            else:
                nome_display = nome_gara

            is_cr = "CAMPIONATO REGIONALE" in nome_gara.upper()
            is_ci = "CAMPIONATI ITALIANI" in nome_gara.upper() or "CAMPIONATO ITALIANO" in nome_gara.upper()

            if is_ci:
                tipo = "internazionale"
            elif is_cr:
                tipo = "nazionale"

            gara_id = f"{slugify(nome_display)}_{date_iso}"
            calendar.append({
                "id": gara_id,
                "nome": nome_display,
                "data": date_iso,
                "mese": int(date_iso[5:7]),
                "anno": CURRENT_YEAR,
                "categoria": fci_cat,
                "categoria_code": cat_code,
                "genere": gender,
                "tipo": tipo,
                "campionato_regionale": is_cr,
                "campionato_italiano": is_ci,
                "url": None,
            })

    return calendar


def make_results_raw(calendar: list) -> list:
    """Genera risultati realistici per ogni gara del calendario."""
    rng = random.Random(99)

    # Pool atleti per categoria
    athlete_pool = {}
    for cat_code, fci_cat, gender, birth_years in CATEGORIE:
        pool = []
        cognomi = COGNOMI_F if gender == "F" else COGNOMI_M
        nomi = NOMI_F if gender == "F" else NOMI_M
        teams = TEAMS_F if gender == "F" else TEAMS_M
        n_atleti = rng.randint(20, 35)
        used_ids = set()
        for _ in range(n_atleti):
            cognome = rng.choice(cognomi)
            nome = rng.choice(nomi)
            atleta_id = f"{slugify(cognome)}_{slugify(nome)}"
            if atleta_id in used_ids:
                # aggiunge un suffisso per dedup
                atleta_id = f"{atleta_id}_{rng.randint(1,99)}"
            used_ids.add(atleta_id)
            team = rng.choice(teams)
            pool.append({
                "atleta_id": atleta_id,
                "nome": nome,
                "cognome": cognome,
                "team": team,
                "team_id": slugify(team),
                "birth_year": rng.choice(birth_years),
            })
        athlete_pool[cat_code] = pool

    results_raw = []
    for gara in calendar:
        cat_code = gara.get("categoria_code", "ELI_M")
        pool = athlete_pool.get(cat_code, [])
        if not pool:
            continue

        # Mescola pool e prendi top 10
        partecipanti = rng.sample(pool, min(len(pool), rng.randint(10, min(len(pool), 20))))

        for pos, atleta in enumerate(partecipanti[:10], 1):
            gara_id = gara["id"]
            results_raw.append({
                "gara_id": gara_id,
                "nome_gara": gara["nome"],
                "data": gara["data"],
                "categoria": gara["categoria"],
                "genere": gara["genere"],
                "posizione": pos,
                "nome": atleta["nome"],
                "cognome": atleta["cognome"],
                "atleta_id": atleta["atleta_id"],
                "team": atleta["team"],
                "team_id": atleta["team_id"],
                "birth_year": atleta["birth_year"],
                "tempo": "S.T." if pos == 1 else f"+{rng.randint(1, 180)}\"",
                "tipo": gara["tipo"],
            })

    return results_raw
