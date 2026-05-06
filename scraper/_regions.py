
# Lista delle regioni italiane usate per normalizzare la stringa "REGIONE CITTA'" -> "REGIONE"
ITALIAN_REGIONS = [
    "ABRUZZO", "BASILICATA", "CALABRIA", "CAMPANIA", "EMILIA ROMAGNA",
    "FRIULI VENEZIA GIULIA", "LAZIO", "LIGURIA", "LOMBARDIA", "MARCHE",
    "MOLISE", "PIEMONTE", "PUGLIA", "SARDEGNA", "SICILIA",
    "TOSCANA", "TRENTINO ALTO ADIGE", "UMBRIA", "VALLE D AOSTA",
    "VENETO", "BOLZANO", "TRENTO"
]

def extract_region(text):
    """Estrae la regione italiana da una stringa tipo 'ABRUZZO TOSSICIA' -> 'ABRUZZO'"""
    if not text:
        return ""
    t = text.upper().strip()
    # Ordina per lunghezza discendente per matchare prima le più lunghe (es EMILIA ROMAGNA prima di EMILIA)
    for reg in sorted(ITALIAN_REGIONS, key=len, reverse=True):
        if t.startswith(reg):
            return reg
    return t  # fallback: restituisci tutto
