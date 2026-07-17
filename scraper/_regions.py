
# Lista delle regioni italiane usate per normalizzare la stringa "REGIONE CITTA'" -> "REGIONE"
ITALIAN_REGIONS = [
    "ABRUZZO", "BASILICATA", "CALABRIA", "CAMPANIA", "EMILIA ROMAGNA",
    "FRIULI VENEZIA GIULIA", "LAZIO", "LIGURIA", "LOMBARDIA", "MARCHE",
    "MOLISE", "PIEMONTE", "PUGLIA", "SARDEGNA", "SICILIA",
    "TOSCANA", "TRENTINO ALTO ADIGE", "UMBRIA", "VALLE D AOSTA",
    "VENETO", "BOLZANO", "TRENTO"
]

# Il calendario (Excel curato a mano) usa a volte una grafia abbreviata
# diversa da quella canonica sopra (es. "VAL D AOSTA" invece di "VALLE D
# AOSTA") — senza normalizzarle, filtri/mappa le trattano come due regioni
# diverse per lo stesso posto. Stessa lista usata lato frontend (app.js).
REGION_ALIASES = {"VAL D AOSTA": "VALLE D AOSTA", "VAL DAOSTA": "VALLE D AOSTA"}

def extract_region(text):
    """Estrae la regione italiana da una stringa tipo 'ABRUZZO TOSSICIA' -> 'ABRUZZO'"""
    if not text:
        return ""
    t = text.upper().strip().replace("'", "")
    if t in REGION_ALIASES:
        return REGION_ALIASES[t]
    # Ordina per lunghezza discendente per matchare prima le più lunghe (es EMILIA ROMAGNA prima di EMILIA)
    for reg in sorted(ITALIAN_REGIONS, key=len, reverse=True):
        if t.startswith(reg):
            return reg
    return t  # fallback: restituisci tutto

# ── Sigla provincia → regione ────────────────────────────────────────────
# Fonte più affidabile della regione di una gara: la pagina FCI riporta la
# località nel formato "COMUNE - COMUNE (XX)" dove XX è la sigla automobilistica
# della provincia (es. "HONE - BARD (AO)" -> Valle d'Aosta). A differenza del
# fuzzy-match sul nome gara contro il calendario Excel (facile da confondere
# tra gare con nomi simili, o categorie/anni scambiati per regioni), la sigla
# provincia è un dato strutturato e univoco pubblicato direttamente dalla FCI.
PROVINCIA_TO_REGIONE = {
    # Abruzzo
    "AQ": "ABRUZZO", "CH": "ABRUZZO", "PE": "ABRUZZO", "TE": "ABRUZZO",
    # Basilicata
    "MT": "BASILICATA", "PZ": "BASILICATA",
    # Calabria
    "CZ": "CALABRIA", "CS": "CALABRIA", "KR": "CALABRIA", "RC": "CALABRIA", "VV": "CALABRIA",
    # Campania
    "AV": "CAMPANIA", "BN": "CAMPANIA", "CE": "CAMPANIA", "NA": "CAMPANIA", "SA": "CAMPANIA",
    # Emilia Romagna
    "BO": "EMILIA ROMAGNA", "FC": "EMILIA ROMAGNA", "FE": "EMILIA ROMAGNA", "MO": "EMILIA ROMAGNA",
    "PR": "EMILIA ROMAGNA", "PC": "EMILIA ROMAGNA", "RA": "EMILIA ROMAGNA", "RE": "EMILIA ROMAGNA",
    "RN": "EMILIA ROMAGNA",
    # Friuli Venezia Giulia
    "GO": "FRIULI VENEZIA GIULIA", "PN": "FRIULI VENEZIA GIULIA", "TS": "FRIULI VENEZIA GIULIA",
    "UD": "FRIULI VENEZIA GIULIA",
    # Lazio
    "FR": "LAZIO", "LT": "LAZIO", "RI": "LAZIO", "RM": "LAZIO", "VT": "LAZIO",
    # Liguria
    "GE": "LIGURIA", "IM": "LIGURIA", "SP": "LIGURIA", "SV": "LIGURIA",
    # Lombardia
    "BG": "LOMBARDIA", "BS": "LOMBARDIA", "CO": "LOMBARDIA", "CR": "LOMBARDIA", "LC": "LOMBARDIA",
    "LO": "LOMBARDIA", "MN": "LOMBARDIA", "MI": "LOMBARDIA", "MB": "LOMBARDIA", "PV": "LOMBARDIA",
    "SO": "LOMBARDIA", "VA": "LOMBARDIA",
    # Marche
    "AN": "MARCHE", "AP": "MARCHE", "FM": "MARCHE", "MC": "MARCHE", "PU": "MARCHE",
    # Molise
    "CB": "MOLISE", "IS": "MOLISE",
    # Piemonte
    "AL": "PIEMONTE", "AT": "PIEMONTE", "BI": "PIEMONTE", "CN": "PIEMONTE", "NO": "PIEMONTE",
    "TO": "PIEMONTE", "VB": "PIEMONTE", "VC": "PIEMONTE",
    # Puglia
    "BA": "PUGLIA", "BT": "PUGLIA", "BR": "PUGLIA", "FG": "PUGLIA", "LE": "PUGLIA", "TA": "PUGLIA",
    # Sardegna
    "CA": "SARDEGNA", "NU": "SARDEGNA", "OR": "SARDEGNA", "SS": "SARDEGNA", "SU": "SARDEGNA",
    "OG": "SARDEGNA", "OT": "SARDEGNA", "VS": "SARDEGNA",  # sigle storiche pre-2016, ancora in uso in alcuni elenchi
    # Sicilia
    "AG": "SICILIA", "CL": "SICILIA", "CT": "SICILIA", "EN": "SICILIA", "ME": "SICILIA",
    "PA": "SICILIA", "RG": "SICILIA", "SR": "SICILIA", "TP": "SICILIA",
    # Toscana
    "AR": "TOSCANA", "FI": "TOSCANA", "GR": "TOSCANA", "LI": "TOSCANA", "LU": "TOSCANA",
    "MS": "TOSCANA", "PI": "TOSCANA", "PT": "TOSCANA", "PO": "TOSCANA", "SI": "TOSCANA",
    # Trentino Alto Adige (le due province autonome restano distinte, come già
    # usato altrove nell'app: es. filtri/mappa mostrano "BOLZANO"/"TRENTO")
    "BZ": "BOLZANO", "TN": "TRENTO",
    # Umbria
    "PG": "UMBRIA", "TR": "UMBRIA",
    # Valle d'Aosta
    "AO": "VALLE D AOSTA",
    # Veneto
    "BL": "VENETO", "PD": "VENETO", "RO": "VENETO", "TV": "VENETO", "VE": "VENETO",
    "VI": "VENETO", "VR": "VENETO",
}

import re as _re
_PROVINCIA_RE = _re.compile(r"\(([A-Z]{2})\)\s*$")
# La FCI marca la località di una gara estera con il nome del paese per
# esteso tra parentesi, SEGUITO IMMEDIATAMENTE da una seconda coppia di
# parentesi VUOTE dove normalmente ci sarebbe la sigla provincia, es.
# "HARELBEKE (BELGIO)  ()" o "TEREZIN (REPUBBLICA CECA)  ()". Il pattern è
# ancorato a "parentesi con 3+ lettere" + "parentesi vuote in fondo alla
# stringa" apposta: alcune gare italiane hanno una frazione/sub-località tra
# parentesi PRIMA della sigla provincia vera (es. "SULMONA - PIAN DELLE MELE
# (GUARDIAGRELE) (AQ)") — lì la parentesi finale NON è vuota (contiene la
# sigla), quindi il pattern qui sotto correttamente non scatta.
_FOREIGN_LOC_RE = _re.compile(r"\([A-Za-zÀ-ſ ]{3,}\)\s*\(\s*\)\s*$")

def is_foreign_location(location_text):
    """True se la riga di località FCI indica una gara disputata all'estero."""
    if not location_text:
        return False
    return bool(_FOREIGN_LOC_RE.search(location_text.strip()))

def extract_region_from_location(location_text):
    """Estrae la regione dalla riga di località FCI, es. 'HONE - BARD (AO)'.
    Cerca la sigla provincia tra parentesi in fondo alla stringa e la mappa a
    una regione tramite PROVINCIA_TO_REGIONE. Ritorna '' se non trovata (gara
    estera, formato inatteso, o mancante) — i chiamanti ricadono sul
    fuzzy-match calendario esistente in quel caso."""
    if not location_text:
        return ""
    m = _PROVINCIA_RE.search(location_text.strip())
    if not m:
        return ""
    return PROVINCIA_TO_REGIONE.get(m.group(1), "")
