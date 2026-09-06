import asyncio, requests, json, re, sys, time, unicodedata, html as HTMLMOD, argparse, logging, os
from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime
from difflib import SequenceMatcher
try:
    from .calendar_scraper import scrape_calendar_fci
    from ._regions import extract_region, extract_region_from_location, is_foreign_location
except (ImportError, ValueError):
    from calendar_scraper import scrape_calendar_fci
    from _regions import extract_region, extract_region_from_location, is_foreign_location

# La stagione coincide con l'anno solare (finisce il 31/12): il rollover è
# automatico a Capodanno. Si può forzare un anno specifico con ITC_SEASON
# (utile per fare il backfill di stagioni passate dalla FCI).
CURRENT_YEAR = int(os.environ.get("ITC_SEASON") or datetime.now().year)
DATA_DIR = Path(__file__).parent.parent / "data"

# ═══════════════════════════════════════════════════════════════
# UTILITY
# ═══════════════════════════════════════════════════════════════
def setup_unmatched_log():
    log_path = DATA_DIR / "unmatched_races.log"
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)
    logging.basicConfig(
        filename=log_path,
        level=logging.INFO,
        format='%(message)s',
        encoding='utf-8',
        force=True
    )

def robust_norm(s):
    """Normalizzazione base per generare slug stabili."""
    if not s: return ""
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def match_norm(s):
    """Normalizzazione estesa per il matching scraper<->excel (include GP alias)."""
    s = robust_norm(s)
    s = re.sub(r"\bgran premio\b", "gp", s)
    s = re.sub(r"\bg p\b", "gp", s)
    # Rimuovi stop words per il matching e la deduplicazione
    stop_words = {"di", "del", "della", "dei", "degli", "le", "la", "il", "a", "e", "da", "in", "con"}
    words = s.split()
    return " ".join([w for w in words if w not in stop_words]).strip()

def slug(s):
    if not s: return "SCONOSCIUTO"
    s = robust_norm(s)
    # Sostituisci tutto ciò che non è lettera o numero con uno SPAZIO
    s = re.sub(r"[^a-z0-9]", " ", s.lower())
    # Collassa spazi e trasforma in underscore
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

# Alcuni club compaiono nei risultati FCI con nomi leggermente diversi da gara
# a gara (abbreviazioni, sigle della sezione femminile, punteggiatura diversa).
# Senza normalizzazione, ogni variante genera un team_id diverso e "spacca" il
# roster reale in due o più team fantasma (es. una sola atleta risultava in un
# team a parte solo perché una gara riportava "AR MONEX WMN PRO CYCLING TEAM"
# invece di "A.R.MONEX PRO CYCLING TEAM"). Chiave = nome normalizzato (robust_norm),
# valore = nome canonico da usare per team e team_id.
TEAM_NAME_ALIASES = {
    robust_norm("AR MONEX WMN PRO CYCLING TEAM"): "A.R.MONEX PRO CYCLING TEAM",
    robust_norm("CASANO"): "ASD PEDALE CASALESE ARMOFER",
}

def canonical_team_name(team):
    """Applica TEAM_NAME_ALIASES per unificare varianti dello stesso club."""
    if not team:
        return team
    return TEAM_NAME_ALIASES.get(robust_norm(team), team)

# Nelle gare "GARA UNICA" (tipico delle categorie giovanili: Esordienti,
# Allievi) la FCI NON separa uomini e donne in due sezioni/tabelle — gareggiano
# nello stesso ordine di arrivo, senza alcun campo che indichi il genere per
# singola riga (verificato sul sorgente live: es. "FESTIVAL DEL CICLISMO
# COPPA SICILIA ESORDIENTI GARA UNICA", posizione 8 = MARRONE MATILDE tra due
# uomini). L'unico segnale utilizzabile per queste righe è il nome di
# battesimo. Usato SOLO come correzione quando la sezione non ha già un
# segnale esplicito di genere (tag "DONNE" o "femm" nel nome gara, che restano
# affidabili e non passano da qui) — elenco non esaustivo di nomi italiani
# (più alcuni stranieri comuni nel ciclismo giovanile) inequivocabilmente
# femminili, quindi mai un downgrade rispetto al comportamento precedente.
FEMALE_FIRST_NAMES = {
    "MATILDE","FEDERICA","ELENA","SARAH","ANGELINA","MADDALENA","MAGGIE","KATARZYNA",
    "GAIA","GIULIA","SOFIA","AURORA","ALICE","EMMA","GRETA","NOEMI",
    "ANNA","MARTINA","CHIARA","SARA","BEATRICE","VIOLA","NICOLE","MEGAN","REBECCA",
    "ALESSIA","VALENTINA","FRANCESCA","GINEVRA","VITTORIA","AURELIA","ARIANNA","EMILY",
    "CATERINA","LUCIA","LAURA","SILVIA","ELISA","ILARIA","IRENE",
    "MARIA","MARIA GRAZIA","ROSA","GRAZIA","PAOLA","BARBARA","CRISTINA","MONICA","SIMONA",
    "STEFANIA","DANIELA","ROBERTA","ELEONORA","LETIZIA","SERENA","VERONICA","CAMILLA",
    "GIORGIA","GLORIA","MELISSA","JASMINE","DESIREE","ANNALISA",
    "MICOL","ASIA","BIANCA","LUNA","LIVIA","AGNESE","CECILIA","COSTANZA","DIANA",
    "NATALIA","NATALIE","ANDREINA","ANGELA","ANTONELLA","ASSUNTA","CONCETTA","CARMELA",
    "SALVATRICE","GIUSEPPINA","VINCENZA","FILOMENA","IMMACOLATA","PATRIZIA","LOREDANA",
    "MICHELA","MANUELA","SAMANTHA","JESSICA","VANESSA","DENISE","ERIKA","MELANIA",
    "GIADA","REGINA","VALERIA","VIRGINIA","CINZIA","TATIANA","KATIA","ILENIA",
    "SABRINA","TIZIANA","WILMA","ZAIRA","YLENIA","NADIA","MIRIAM","ELISABETTA","FIORELLA",
}

def is_female_name(nome: str) -> bool:
    """True se il nome di battesimo (primo termine, gestisce anche nomi
    composti tipo 'ALESSIO FORTUNATO' o 'MARIA GRAZIA') è inequivocabilmente
    femminile secondo FEMALE_FIRST_NAMES. Falso se sconosciuto — nessun
    cambiamento rispetto al comportamento precedente per i nomi non elencati."""
    n = (nome or "").strip().upper()
    if not n:
        return False
    if n in FEMALE_FIRST_NAMES:
        return True
    return n.split(" ", 1)[0] in FEMALE_FIRST_NAMES

# La fonte FCI riporta a volte lo stesso atleta con cognomi diversi tra una gara
# e l'altra (refusi di inserimento lato federazione: es. "Peneda" invece di
# "Pineda"). Senza normalizzazione questo spacca i risultati della stessa
# persona su due atleta_id diversi, e un fix fatto a mano su results_raw.json
# verrebbe cancellato al giro di scraping successivo (i dati vengono rigenerati
# dalla fonte). Chiave = "COGNOME NOME" normalizzato (robust_norm) come appare
# nella fonte FCI, valore = (cognome_corretto, nome_corretto).
ATHLETE_NAME_ALIASES = {
    robust_norm("PENEDA SOTO NATALIA"): ("PINEDA SOTO", "NATALIA"),
    # "DI ROSA" (particella cognome) veniva spezzato in cognome="DI",
    # nome="ROSA CHRISTIAN": is_female_name() leggeva "ROSA" come primo
    # termine del nome e lo classificava erroneamente come atleta donna in
    # ogni gara mista Allievi a cui partecipava (8 gare). Qui il cognome
    # composto viene ricostruito PRIMA del controllo genere, cosi' non
    # scatta piu' ne' la divisione ne' la riga fantasma nella classifica F.
    robust_norm("DI ROSA CHRISTIAN"): ("DI ROSA", "CHRISTIAN"),
    # Stesso bug, stesso meccanismo: cognome="DI", nome="LUCIA NICCOLO'" ->
    # "LUCIA" (primo termine del nome) e' un nome femminile, isolava
    # l'atleta (maschio, cognome reale "DI LUCIA") in 11 gare Esordienti.
    robust_norm("DI LUCIA NICCOLO'"): ("DI LUCIA", "NICCOLO'"),
}

def canonical_athlete_name(cognome, nome):
    """Applica ATHLETE_NAME_ALIASES per unificare varianti/refusi dello stesso atleta."""
    key = robust_norm(f"{cognome} {nome}")
    alias = ATHLETE_NAME_ALIASES.get(key)
    if alias:
        return alias
    return cognome, nome

# Caricamento Overrides da JSON (per Admin Dashboard)
def load_user_overrides():
    path = DATA_DIR / "user_overrides.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except: return {}
    return {}

def resolve_multiplier(race_name_raw, race_date, cal_map):
    """Matching gerarchico: Overrides -> Exact -> Fuzzy -> Keywords."""
    
    # 0. Check User Overrides (Priorità massima)
    overrides = load_user_overrides()
    # Cerchiamo per slug del nome + data
    o_key = slug(race_name_raw) + "_" + race_date
    if o_key in overrides:
        o = overrides[o_key]
        return (o.get("mult", 1), o.get("tipo", "regionale"), 
                o.get("is_cr", False), o.get("is_ci", False), 
                o.get("reg", ""), "user_override")

    scraped_norm = match_norm(race_name_raw)
    candidates = cal_map.get(race_date, [])
    
    m, t, cr, ci, reg, reason = 1, "regionale", False, False, "", "keyword_match"
    best_match = None

    # 1. Exact Match
    for entry in candidates:
        if scraped_norm == match_norm(entry["nome"]):
            best_match = entry
            reason = "exact_match"
            break

    # 2. Fuzzy Match (>= 70%) or Substring Match
    if not best_match:
        max_ratio = 0
        for entry in candidates:
            excel_norm = match_norm(entry["nome"])
            ratio = SequenceMatcher(None, scraped_norm, excel_norm).ratio()
            if scraped_norm in excel_norm or excel_norm in scraped_norm:
                ratio = 1.0 # Force exact match if it's a perfect substring
            if ratio >= 0.70 and ratio > max_ratio:
                max_ratio = ratio
                best_match = entry
        if best_match:
            reason = "fuzzy_match"

    if best_match:
        m = best_match["moltiplicatore"]
        t = best_match["tipo"]
        cr = best_match.get("campionato_regionale", False)
        ci = best_match.get("campionato_italiano", False)
        reg = best_match.get("regione", "")
    else:
        # 3. Keyword Match (Fallback)
        n = scraped_norm
        if any(k in n for k in ["internazionale", "world", "uci", "giro d italia", "saxo", "classic", "proseries", "worldtour"]):
            m, t = 3, "internazionale"
        elif any(k in n for k in ["campionato italiano", "coppa italia"]):
            m, t, ci = 3, "nazionale", True
        elif any(k in n for k in ["nazionale", "giro d abruzzo"]):
            m, t = 2, "nazionale"
        elif any(k in n for k in ["campionato regionale", "camp reg"]):
            m, t, cr = 2, "regionale", True
        elif "regionale" in n:
            m, t = 1, "regionale"
        else:
            reason = "no_match"

    # 4. EXPLICIT OVERRIDES (Overrides Excel if Excel was wrong/default)
    n = race_name_raw.lower()
    if any(k in n for k in ["campionato regionale", "camp reg", "prova valida campionato", "valida campionato", "campione regionale", "titolo regionale"]):
        if not cr or m < 2:
            m = max(m, 2)
            t = "regionale"
            cr = True
            reason += "+cr_override"
            
    if "giro d abruzzo" in n or "tappa" in n:
        if m < 2:
            m = 2
            t = "nazionale"
            reason += "+nazionale_override"

    # 5. CLASSIFICA GENERALE MODIFIER
    if any(k in n for k in ["classifica generale", "classifica finale"]):
        m += 1
        reason += "+classifica_finale"

    logging.info(f"{race_name_raw} | {race_date} | x{m} | {reason}")
    return m, t, cr, ci, reg, reason

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


# Versione normalizzata per matching sicuro
def norm_cat(s):
    if not s: return ""
    return robust_norm(s).upper()

# Mapping categoria normalizzata + genere → codice interno
CAT_CODES_RAW = {
    ("ELITE UNDER23","M"): "ELI_M", ("JUNIORES","M"): "JUN_M", ("ALLIEVI","M"): "AL_M", 
    ("ESORDIENTI","M"): "ES1_M", ("ESORDIENTI 1 ANNO","M"): "ES1_M", ("ESORDIENTI 2 ANNO","M"): "ES2_M",
    ("ALLIEVI 1 ANNO","M"): "AL_M", ("ALLIEVI 2 ANNO","M"): "AL_M",
    ("DONNE","F"): "ELI_F", ("ELITE UNDER23","F"): "ELI_F", ("JUNIORES","F"): "JUN_F", 
    ("ALLIEVI","F"): "AL_F", ("ESORDIENTI","F"): "ES1_F",
    ("ESORDIENTI 1 ANNO","F"): "ES1_F", ("ESORDIENTI 2 ANNO","F"): "ES2_F", 
    ("ALLIEVI 1 ANNO","F"): "AL_F", ("ALLIEVI 2 ANNO","F"): "AL_F",
    # Alias comuni
    ("ALLIEVI","M"): "AL_M", ("ALLIEVI","F"): "AL_F",
    ("JUNIORES","M"): "JUN_M", ("JUNIORES","F"): "JUN_F",
}
# Costruiamo il dizionario con chiavi normalizzate
CAT_CODES = { (norm_cat(k), g): v for (k, g), v in CAT_CODES_RAW.items() }
ALL_CODES = ["ELI_M","JUN_M","AL_M","ES1_M","ES2_M","ELI_F","JUN_F","AL_F","ES1_F","ES2_F"]

# ═══════════════════════════════════════════════════════════════
# 2. RISULTATI GARE via requests (pagine statiche)
# ═══════════════════════════════════════════════════════════════
def parse_risultati_page(soup: BeautifulSoup, calendar_map: dict, existing_ids: set) -> tuple[list[dict], set[str]]:
    """Parsa la pagina radice dei risultati FCI.
    Estrae dinamicamente la categoria dal tag <font color="#1a8ad8"> sopra ogni h4.
    Ritorna (results, excluded_gara_ids): il secondo elenca i gara_id delle gare
    estere trovate su questa pagina, cosi' il chiamante puo' anche PURGARE
    eventuali righe residue di scrape precedenti (prima che l'esclusione
    esistesse) invece di limitarsi a non aggiungerne di nuove.
    """
    results = []
    excluded_gara_ids = set()
    new_races_count = 0

    h4_races = soup.find_all("h4")

    for h4 in h4_races:
        race_name_raw = HTMLMOD.unescape(h4.get_text(strip=True))
        if not race_name_raw or len(race_name_raw) < 3:
            continue

        # Trova la categoria (tag b > font color=#1a8ad8 sopra h4)
        cat_tag = h4.find_previous(["b", "font"], string=re.compile(r"ELITE|JUN|ALL|ESO|DONNE|GARA", re.I))
        cat_text = cat_tag.get_text() if cat_tag else "Elite-Under23"
        extracted_cat = _map_cat_from_tag(cat_text)

        # Refine Age Group based on title and category text
        c_text = (cat_text + " " + race_name_raw).upper()
        if extracted_cat == "Esordienti":
            if any(x in c_text for x in ["1°", "1 ^", "PRIMO ANNO", "ESORDIENTI1"]): extracted_cat = "Esordienti 1° Anno"
            elif any(x in c_text for x in ["2°", "2 ^", "SECONDO ANNO", "ESORDIENTI2"]): extracted_cat = "Esordienti 2° Anno"
        elif extracted_cat == "Allievi":
            if any(x in c_text for x in ["1°", "1 ^", "PRIMO ANNO", "ALLIEVI1"]): extracted_cat = "Allievi 1° Anno"
            elif any(x in c_text for x in ["2°", "2 ^", "SECONDO ANNO", "ALLIEVI2"]): extracted_cat = "Allievi 2° Anno"

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

        # ── Determina moltiplicatore base (Robust Matching con Calendario) ──
        mult, tipo, is_cr, is_ci, reg, match_type = resolve_multiplier(race_name_raw, race_date, calendar_map)

        # ── Regione: PRIMA fonte = sigla provincia pubblicata dalla FCI ──────
        # La FCI riporta la località della gara come terza riga del blocco
        # categoria/data/località (es. "ELITE-UNDER23 / 2026-07-17 - VALLE
        # D'AOSTA / HONE - BARD (AO)"): la sigla provincia tra parentesi è un
        # dato strutturato e univoco, molto più affidabile del fuzzy-match sul
        # nome gara contro il calendario Excel (resolve_multiplier sopra), che
        # può confondere gare con nomi simili o restituire per errore un nome
        # di categoria ("UNDER", "JUNIORES"...) invece di una regione reale.
        loc_div = h4.find_previous_sibling("div", class_=re.compile(r"fs-5|text-muted", re.I))
        if not loc_div and h4.parent:
            loc_div = h4.parent.find("div", class_=re.compile(r"fs-5|text-muted", re.I))
        loc_lines = loc_div.get_text("\n", strip=True).split("\n") if loc_div else []
        location_text = loc_lines[-1] if loc_lines else ""

        reg_from_provincia = extract_region_from_location(location_text)

        if reg_from_provincia:
            reg = reg_from_provincia
        else:
            # Fallback: regione dal calendario (fuzzy-match), poi dal testo di
            # contesto grezzo — solo se la provincia non è stata trovata
            # (gara estera, formato pagina inatteso, ecc.)
            reg = extract_region(reg)
            if not reg and context_text:
                m_reg = re.search(r"-\s*([A-Za-z\s\']+)", context_text)
                if m_reg: reg = extract_region(m_reg.group(1).strip())
            reg = reg or "ITALIA"

        race_gender = "F" if "DONNE" in (cat_tag.get_text().upper() if cat_tag else "") or any(k in race_name_raw.lower() for k in ["donne","femm"]) else "M"

        # ─── Detect CR/CI direttamente dal testo FCI (massima priorità) ────────
        n_fci = robust_norm(race_name_raw + " " + context_text)
        fci_is_cr = any(k in n_fci for k in [
            "campionato regionale", "camp reg", "camp reg",
            "prova valida campionato", "valida per il campionato",
            "prova valida per", "valida campionato"
        ])
        fci_is_ci = any(k in n_fci for k in [
            "campionato italiano", "campionati italiani", "camp ital"
        ])

        if fci_is_ci and not is_ci:
            mult, tipo, is_cr, is_ci = 3, "nazionale", False, True
            print(f"  [FCI-CI] {race_name_raw[:60]} -> Campionato Italiano forzato x3")
        elif fci_is_cr and not is_cr:
            mult, tipo, is_cr, is_ci = 2, "regionale", True, False
            print(f"  [FCI-CR] {race_name_raw[:60]} -> Campionato Regionale forzato x2")

        # Forza Esordienti e Allievi a x1 Regionale, tranne se provengono da Excel, Override o sono CR/CI
        if extracted_cat in ["Esordienti", "Allievi", "Esordienti 1° Anno", "Esordienti 2° Anno", "Allievi 1° Anno", "Allievi 2° Anno"]:
            is_excel_or_override = any(x in match_type for x in ["exact_match", "fuzzy_match", "user_override"])
            if not is_cr and not is_ci and not is_excel_or_override:
                mult, tipo = 1, "regionale"

        n_cat_key = norm_cat(extracted_cat)
        def _cat_code_for(gender):
            cc = CAT_CODES.get((n_cat_key, gender))
            if cc: return cc
            # Fallback secco per non perdere dati
            if "ELITE" in n_cat_key or "UNDER" in n_cat_key: return "ELI_M" if gender=="M" else "ELI_F"
            if "JUN" in n_cat_key: return "JUN_M" if gender=="M" else "JUN_F"
            if "ALL" in n_cat_key: return "AL_M" if gender=="M" else "AL_F"
            if "ESO" in n_cat_key: return "ES1_M" if gender=="M" else "ES1_F"
            return "ELI_M" if gender=="M" else "ELI_F"
        cat_code = _cat_code_for(race_gender)
        gara_id = slug(race_name_raw) + "_" + race_date + "_" + cat_code

        # ── Esclusione gare estere ───────────────────────────────────────
        # La FCI a volte importa gare disputate fuori Italia (es. E3 Saxo
        # Classic in Belgio, Corsa della Pace Juniores in Repubblica Ceca)
        # tra i risultati italiani: non vanno in classifica/punti perché
        # spesso vi corrono atleti nemmeno tesserati italiani. Le
        # riconosciamo dal nome del paese per esteso tra parentesi nella
        # località (vedi is_foreign_location). Eccezione: una tappa
        # all'estero di un giro a tappe ITALIANO (es. Giro Valle d'Aosta con
        # una tappa in Francia) resta valida — lo capiamo dal fatto che la
        # gara ha comunque trovato corrispondenza nel calendario curato a
        # mano (match_type exact/fuzzy), quindi la escludiamo solo se non è
        # nemmeno una gara che conosciamo come italiana. Il gara_id va
        # calcolato PRIMA di questo controllo (non dopo, come in origine) per
        # poterlo aggiungere a excluded_gara_ids e permettere al chiamante di
        # purgare anche eventuali righe residue di scrape precedenti.
        if is_foreign_location(location_text) and match_type not in ("exact_match", "fuzzy_match", "user_override"):
            excluded_gara_ids.add(gara_id)
            continue

        if gara_id in existing_ids:
            continue

        existing_ids.add(gara_id)

        new_races_count += 1
        print(f"  [Nuova Gara] {race_name_raw} ({cat_code}) -> x{mult}")

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

        # Parsa classifica — bufferizza in section_rows (ordine di arrivo
        # originale) invece di scrivere direttamente in results: quando la
        # sezione è "GARA UNICA" (genere non esplicito, vedi race_gender
        # sopra) serve prima capire quante/quali righe sono donne per poterle
        # dividere in una categoria propria con posizioni ricalcolate — non
        # si può saperlo prima di aver letto tutte le righe.
        # Gare "a squadre" (es. cronometro a squadre): la FCI pubblica UNA sola
        # riga di arrivo per team, senza elencare i corridori. Il parsing
        # normale sotto (pensato per righe individuali) interpreterebbe il
        # nome della squadra come un finto "atleta" (nome spezzato in
        # cognome/nome), che poi inquina classifiche/ricerca atleti come un
        # corridore vero. Per queste gare NON generiamo un atleta_id: la riga
        # conta solo per la classifica squadre (vedi aggregate() sotto). I
        # corridori reali vengono aggiunti a mano dall'admin sul sito.
        is_squadre = bool(re.search(r"A\s+SQUADRE", race_name_raw, re.I))

        section_rows = []
        seen_pos_1 = False  # ex-aequo pos 1: solo il primo corridore è il vincitore ufficiale
        for row in table.find_all("tr"):
            th = row.find("th")
            if not th: continue
            pos_raw = th.get_text(strip=True).replace("°","").replace(".","").strip()
            if not pos_raw.isdigit(): continue
            pos = int(pos_raw)
            if pos < 1 or pos > 10: continue
            # Ex-aequo a posizione 1: salta il secondo corridore (solo il principale vince)
            if pos == 1:
                if seen_pos_1:
                    continue
                seen_pos_1 = True

            tds = row.find_all("td")
            if len(tds) < 2: continue

            if is_squadre:
                # L'intera riga è il nome della squadra (tds[0]); un'eventuale
                # colonna extra (es. sigla nazione "ITA") NON è il team reale
                # e va ignorata — a differenza delle righe individuali, qui
                # tds[1] non è affidabile come nome team.
                team_raw = HTMLMOD.unescape(tds[0].get_text(strip=True)).upper().strip()
                team = canonical_team_name(team_raw)
                team_id = slug(team) if team else "SCONOSCIUTO"
                tempo = HTMLMOD.unescape(tds[-1].get_text(strip=True)) if len(tds) >= 3 else ""
                if not team: continue
                section_rows.append({
                    "cognome": "", "nome": "", "atleta_id": "",
                    "team": team, "team_id": team_id, "tempo": tempo,
                })
                continue

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
            team = canonical_team_name(team)
            if len(tds) >= 3:
                tempo = HTMLMOD.unescape(tds[-1].get_text(strip=True))

            if not cognome: continue

            # Pulizia ex-aequo: rimuove annotazioni tipo "(6° - EXEQUO)", "(1 - EX AEQUO)", ecc.
            _exaeq_re = re.compile(r'\(\s*\d+\s*°?\s*[-–]?\s*EX[\s\-]?AEQUO\s*\)', re.IGNORECASE)
            cognome = _exaeq_re.sub('', cognome).strip()
            nome    = _exaeq_re.sub('', nome).strip()
            cognome, nome = canonical_athlete_name(cognome, nome)

            atleta_id = slug(f"{cognome}_{nome}")
            team_id   = slug(team) if team else "SCONOSCIUTO"

            section_rows.append({
                "cognome": cognome, "nome": nome, "atleta_id": atleta_id,
                "team": team, "team_id": team_id, "tempo": tempo,
            })

        # ── Divisione per genere + ricalcolo posizioni ──────────────────
        # race_gender=="F" è già un segnale esplicito (tag "DONNE"/"femm"):
        # nessuna divisione necessaria, tutta la sezione è femminile com'era.
        # race_gender=="M" è il default per sezioni ambigue: qui isoliamo le
        # righe riconosciute come femminili (nome di battesimo) e le
        # spostiamo in una categoria propria, rinumerando le posizioni DI
        # ENTRAMBI i gruppi in base al solo ordine di arrivo del proprio
        # genere — altrimenti Matilde resterebbe "8ª" (posizione nel campo
        # misto) invece che nella sua reale posizione tra le sole donne, e i
        # suoi punti sarebbero calcolati sulla posizione sbagliata.
        if race_gender == "M":
            male_rows   = [r for r in section_rows if not is_female_name(r["nome"])]
            female_rows = [r for r in section_rows if is_female_name(r["nome"])]
        else:
            male_rows, female_rows = [], section_rows

        if race_gender == "M" and female_rows:
            print(f"  [genere] {race_name_raw[:60]} ({extracted_cat}): {len(female_rows)} atleta/e femminile/i isolata/e dal campo misto")

        for gender, rows, gid, cc in (
            ("M", male_rows, gara_id, cat_code),
            ("F", female_rows, (slug(race_name_raw) + "_" + race_date + "_" + _cat_code_for("F")) if female_rows else None, _cat_code_for("F")),
        ):
            for i, r in enumerate(rows, start=1):
                pts_base = BASE_PTS.get(i, 0)
                pts_eff  = pts_base * mult
                results.append({
                    "gara_id":   gid,
                    "nome_gara": race_name_raw,
                    "data":      race_date,
                    "categoria": extracted_cat,
                    "genere":    gender,
                    "tipo":      tipo,
                    "moltiplicatore":      mult,
                    "campionato_regionale": is_cr,
                    "campionato_italiano":  is_ci,
                    "regione": reg,
                    "posizione": i,
                    "cognome":   r["cognome"],
                    "nome":      r["nome"],
                    "atleta_id": r["atleta_id"],
                    "team":      r["team"],
                    "team_id":   r["team_id"],
                    "tempo":     r["tempo"],
                    "km":        km,
                    "media":     media,
                    "punti_base":      pts_base,
                    "punti_effettivi": pts_eff,
                })
            if rows and gid not in existing_ids:
                existing_ids.add(gid)

    return results, excluded_gara_ids




# ═══════════════════════════════════════════════════════════════
# 3. AGGREGAZIONE con classifiche team per categoria
# ═══════════════════════════════════════════════════════════════

def aggregate(results: list[dict]) -> tuple[dict, dict, dict, dict]:
    athletes, teams = {}, {}
    team_by_cat: dict[str, dict[str, dict]] = {c: {} for c in ALL_CODES}
    
    # Deduplicazione: data + slug_nome_base + categoria + atleta_id
    seen_results = set()
    unique_results = []
    for r in results:
        # Generiamo una chiave di deduplicazione robusta
        # Usiamo match_norm per ignorare stop words (di, a, il...) e differenze "GP" vs "Gran Premio"
        nome_key = match_norm(r["nome_gara"])
        
        # Normalizziamo anche la categoria per la chiave di deduplicazione
        cat_val = r["categoria"]
        if cat_val in ALL_CODES:
            cc_key = cat_val
        else:
            cc_key = CAT_CODES.get((norm_cat(cat_val), r["genere"]), "ELI_M" if r["genere"]=="M" else "ELI_F")
            
        # Normalizziamo l'atleta_id per la chiave (gestione apostrofi/doppi underscore).
        # Righe "a squadre" (vedi is_squadre sopra) non hanno atleta_id: usiamo il
        # team_id come disambiguante, altrimenti TUTTE le posizioni di una stessa
        # gara a squadre avrebbero la stessa chiave vuota e si deduplicherebbero
        # a vicenda, facendo sparire tutte le posizioni tranne una.
        aid_key = r["atleta_id"].replace("__", "_").strip("_") or r.get("team_id", "")

        key = (r["data"], nome_key, cc_key, aid_key)
        
        if key in seen_results:
            continue
        seen_results.add(key)
        unique_results.append(r)
    
    results = unique_results

    # 1. Trova il team principale per ogni atleta (escludendo le nazionali/rappresentative)
    def is_national(t_name):
        t_up = str(t_name).upper()
        keywords = ["ITALIA", "NAZIONALE", "RAPPRESENTATIVA", "COMITATO", "SELEZIONE", "REPUBBLICA", "SVIZZERA", "FRANCIA", "GERMANIA", "SPAGNA", "SLOVENIA", "AUSTRIA", "BELGIO", "OLANDA", "DANIMARCA", "GRAN BRETAGNA", "POLONIA", "UCRAINA"]
        for k in keywords:
            if k in t_up: return True
        return False

    athlete_teams_freq = {}
    for r in results:
        aid = r["atleta_id"]
        if not aid: continue  # riga "a squadre" senza corridore, vedi is_squadre sopra
        t = r["team"]
        tid = r["team_id"]
        if aid not in athlete_teams_freq:
            athlete_teams_freq[aid] = {"all": {}}
        if tid not in athlete_teams_freq[aid]["all"]:
            athlete_teams_freq[aid]["all"][tid] = {"count": 0, "name": t}
        athlete_teams_freq[aid]["all"][tid]["count"] += 1

    for aid, data in athlete_teams_freq.items():
        valid_tids = [tid for tid in data["all"].keys() if not is_national(data["all"][tid]["name"])]
        if valid_tids:
            primary_tid = max(valid_tids, key=lambda tid: data["all"][tid]["count"])
        else:
            primary_tid = max(data["all"].keys(), key=lambda tid: data["all"][tid]["count"])
        data["primary_tid"] = primary_tid
        data["primary_name"] = data["all"][primary_tid]["name"]

    # 2. Sostituisci il team con il team principale se l'attuale è una nazionale
    for r in results:
        aid = r["atleta_id"]
        if not aid: continue  # riga "a squadre" senza corridore
        if is_national(r["team"]):
            p_tid = athlete_teams_freq[aid].get("primary_tid")
            p_name = athlete_teams_freq[aid].get("primary_name")
            if p_tid and p_tid != r["team_id"]:
                r["team"] = p_name
                r["team_id"] = p_tid

    for r in results:
        if not str(r["data"]).startswith(str(CURRENT_YEAR)): continue
        aid, tid, pts, pos = r["atleta_id"], r["team_id"], r["punti_effettivi"], r["posizione"]
        
        # Gestione categoria: se è già un codice (es. ELI_M) lo usiamo, altrimenti mappiamo
        cat_val = r["categoria"]
        if cat_val in ALL_CODES:
            cc = cat_val
        else:
            cc = CAT_CODES.get((norm_cat(cat_val), r["genere"]), "ELI_M" if r["genere"]=="M" else "ELI_F")

        # ── Atleta — SOLO se la riga ha un vero atleta_id. Le righe "a
        # squadre" (gara a cronometro a squadre ecc., vedi is_squadre più
        # sopra) non elencano corridori: contano solo per la squadra qui
        # sotto, così non generano un "atleta" finto in classifica/ricerca.
        if aid:
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
                "moltiplicatore": r.get("moltiplicatore", 1),
                "tipo": r.get("tipo", "regionale"),
                "regione": r.get("regione", "ITALIA"),
                "km": r.get("km", ""), "media": r.get("media", "")
            })

        # ── Team globale
        if tid not in teams:
            teams[tid] = {
                "id": tid, "nome": r["team"],
                "punti_totali": 0, "atleti": [],
                "risultati": [], "punti_per_cat": {},
            }
        teams[tid]["punti_totali"] += pts
        if aid and aid not in teams[tid]["atleti"]:
            teams[tid]["atleti"].append(aid)
        teams[tid]["risultati"].append({
            "gara_id": r["gara_id"], "nome_gara": r["nome_gara"], "data": r["data"], "atleta_id": aid,
            "atleta_cognome": r["cognome"], "atleta_nome": r["nome"],
            "posizione": pos, "punti_effettivi": pts,
            "moltiplicatore": r.get("moltiplicatore", 1),
            "tipo": r.get("tipo", "regionale"),
            "regione": r.get("regione", "ITALIA"),
            "km": r.get("km", ""), "media": r.get("media", "")
        })
        teams[tid]["punti_per_cat"][cc] = teams[tid]["punti_per_cat"].get(cc, 0) + pts

        # ── Team per categoria
        if cc in team_by_cat:
            if tid not in team_by_cat[cc]:
                team_by_cat[cc][tid] = {
                    "team_id": tid, "team_nome": r["team"],
                    "punti": 0, "p1": 0, "p2": 0, "p3": 0, "pout": 0, "atleti": set(),
                }
            team_by_cat[cc][tid]["punti"] += pts
            if pos == 1: team_by_cat[cc][tid]["p1"] += 1
            elif pos == 2: team_by_cat[cc][tid]["p2"] += 1
            elif pos == 3: team_by_cat[cc][tid]["p3"] += 1
            elif 4 <= pos <= 10: team_by_cat[cc][tid]["pout"] += 1
            if aid: team_by_cat[cc][tid]["atleti"].add(aid)

    # ── Classifiche
    athlete_rankings: dict[str, list] = {c: [] for c in ALL_CODES}
    for aid, a in athletes.items():
        cc  = a["categoria"]
        v1 = sum(1 for x in a["risultati"] if x["posizione"]==1)
        v2 = sum(1 for x in a["risultati"] if x["posizione"]==2)
        v3 = sum(1 for x in a["risultati"] if x["posizione"]==3)
        vout = sum(1 for x in a["risultati"] if 4 <= x["posizione"]<=10)
        gare = len(a["risultati"])
        if cc in athlete_rankings:
            athlete_rankings[cc].append({
                "atleta_id": aid, "cognome": a["cognome"], "nome": a["nome"],
                "team_id": a["team_id"], "team_nome": a["team_attuale"],
                "punti": a["punti_totali"], "vittorie": v1, "gare": gare,
                "p1": v1, "p2": v2, "p3": v3, "pout": vout
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
                "punti": t["punti"], "vittorie": t["p1"],
                "p1": t["p1"], "p2": t["p2"], "p3": t["p3"], "pout": t["pout"],
                "n_atleti": len(t["atleti"])
            })
        rows.sort(key=lambda x: (-x["punti"], -x["vittorie"]))
        for i, row in enumerate(rows): row["pos"] = i+1
        team_rankings[cc] = rows

    return athletes, teams, athlete_rankings, team_rankings, unique_results


# ═══════════════════════════════════════════════════════════════
# MAIN / CYCLE
# ═══════════════════════════════════════════════════════════════
async def run_cycle():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rankings").mkdir(exist_ok=True)
    (DATA_DIR / "team_rankings").mkdir(exist_ok=True)

    print(f"\n--- SCRAPER COMPLETATO ---")
    setup_unmatched_log()
    # Caricamento calendario. PRIMA veniva scaricato dalla FCI una volta sola
    # (se calendar.json esisteva già, la cache locale restava per SEMPRE la
    # fonte, mai più aggiornata dalla FCI) — una gara aggiunta al calendario
    # FCI dopo quel primo scraping (last-minute, o semplicemente pubblicata
    # in ritardo) non compariva mai in Calendario sul sito, anche se poi i
    # suoi risultati venivano scrapati e importati normalmente (i due
    # scraping — calendario e risultati — sono indipendenti). Ora il
    # calendario viene ri-scaricato periodicamente (non ad ogni ciclo, che
    # gira ogni ~1.5h — troppo spesso per un giro completo di 12 mesi × 3
    # categorie geografiche) e le gare nuove trovate vengono AGGIUNTE senza
    # mai toccare/sovrascrivere quelle già presenti (comprese eventuali
    # correzioni fatte a mano ai dati, es. regione).
    calendar_file = DATA_DIR / "calendar.json"
    calendar_meta_file = DATA_DIR / "calendar_last_scrape.json"
    calendar = []
    if calendar_file.exists():
        with open(calendar_file, "r", encoding="utf-8") as f:
            calendar = json.load(f)

    should_rescrape = True
    if calendar and calendar_meta_file.exists():
        try:
            with open(calendar_meta_file, "r", encoding="utf-8") as f:
                last_scrape = datetime.fromisoformat(json.load(f)["last_scrape"])
            should_rescrape = (datetime.utcnow() - last_scrape).total_seconds() > 20 * 3600
        except Exception:
            should_rescrape = True

    if should_rescrape:
        print("Calendario da FCI: caricamento gare nuove..." if calendar else "Scaricamento calendario automatico dalla FCI...")
        fresh_calendar = scrape_calendar_fci(CURRENT_YEAR)
        existing_ids = {g["id"] for g in calendar}
        existing_by_fci = {g["fci_id"]: g for g in calendar if g.get("fci_id")}
        added = renamed = 0
        for g in fresh_calendar:
            if g["id"] in existing_ids:
                # Stesso id: se la riga già presente è vecchia (pre-fix, senza
                # fci_id) recupera comunque l'ID Gara FCI per poter sanare un
                # eventuale rename futuro.
                if g.get("fci_id"):
                    for old in calendar:
                        if old["id"] == g["id"] and not old.get("fci_id"):
                            old["fci_id"] = g["fci_id"]
                            existing_by_fci[g["fci_id"]] = old
                continue
            # Id nuovo (nome mai visto per questa data): se condivide lo
            # stesso ID Gara FCI di una riga già presente, non è una gara
            # diversa ma un RENAME — es. la FCI corregge il numero
            # d'edizione dopo la prima pubblicazione ("13° TROFEO A.
            # COMBERLATO" "In fase di approvazione" → "14° TROFEO A.
            # COMBERLATO" "Approvata", stesso ID Gara 179879, segnalato dal
            # vivo: la vecchia card restava per sempre "in attesa" mentre i
            # risultati veri finivano solo sotto il nome nuovo). Si aggiorna
            # la riga esistente sul posto invece di crearne una fantasma.
            old = existing_by_fci.get(g.get("fci_id")) if g.get("fci_id") else None
            if old:
                old.update(g)
                existing_ids.add(g["id"])
                if g.get("fci_id"): existing_by_fci[g["fci_id"]] = old
                renamed += 1
                continue
            calendar.append(g)
            existing_ids.add(g["id"])
            if g.get("fci_id"): existing_by_fci[g["fci_id"]] = g
            added += 1
        print(f"Calendario: {added} nuove gare aggiunte, {renamed} rinominate/aggiornate ({len(calendar)} totali).")
        with open(calendar_file, "w", encoding="utf-8") as f:
            json.dump(calendar, f, indent=4, ensure_ascii=False)
        with open(calendar_meta_file, "w", encoding="utf-8") as f:
            json.dump({"last_scrape": datetime.utcnow().isoformat()}, f)
    else:
        print("Caricamento calendario da cache locale (aggiornato di recente)...")

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
            # La stagione live contiene SOLO l'anno corrente. Al rollover (1° gennaio)
            # i risultati dell'anno precedente vengono esclusi dal set live: restano
            # comunque congelati in data/seasons/{anno}/. Così live = stagione in corso
            # e ogni archivio resta monostagione.
            _before = len(all_results)
            all_results = [r for r in all_results if str(r.get("data", "")).startswith(str(CURRENT_YEAR))]
            if len(all_results) != _before:
                print(f"Filtrati {_before - len(all_results)} risultati di stagioni precedenti (live = {CURRENT_YEAR}).")
            print(f"Caricati {len(all_results)} risultati {CURRENT_YEAR}. Ricalcolo moltiplicatori...")
            # Riapplica le regole di moltiplicatore e normalizza ID (unificazione doppioni)
            for r in all_results:
                # Pulizia ex-aequo dai dati storici (annotazioni tipo "(6° - EXEQUO)")
                _exaeq = re.compile(r'\(\s*\d+\s*°?\s*[-–]?\s*EX[\s\-]?AEQUO\s*\)', re.IGNORECASE)
                r["cognome"] = _exaeq.sub('', r.get("cognome","")).strip()
                r["nome"]    = _exaeq.sub('', r.get("nome","")).strip()
                r["cognome"], r["nome"] = canonical_athlete_name(r["cognome"], r["nome"])
                # Forza ricalcolo ID con la nuova logica stabile
                r["atleta_id"] = slug(r["cognome"] + " " + r["nome"])
                r["team"] = canonical_team_name(r["team"])
                r["team_id"] = slug(r["team"])
                if r["genere"] == "F": r["team_id"] += "_F" # preserva distinzione genere se presente
                
                m, t, cr, ci, reg, reason = resolve_multiplier(r["nome_gara"], r["data"], cal_by_date)
                if r.get("moltiplicatore") != m or r.get("tipo") != t:
                    r["moltiplicatore"] = m
                    r["tipo"] = t
                    r["punti_effettivi"] = r["punti_base"] * m
                # Normalizza regione nei risultati esistenti
                if r.get("regione"):
                    r["regione"] = extract_region(r["regione"])
        except Exception as e:
            print(f"Errore caricamento risultati: {e}, inizio da zero.")

    # NON riempiamo existing_ids con le vecchie gare, altrimenti le gare aggiornate verrebbero ignorate!
    existing_ids = set()
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

        new_results, excluded_gara_ids = parse_risultati_page(soup, cal_by_date, existing_ids)

        # Rimuove i vecchi risultati per le gare appena scaricate (così da aggiornare chi è stato inserito in un secondo momento)
        new_gara_ids = {r["gara_id"] for r in new_results}
        all_results = [r for r in all_results if r["gara_id"] not in new_gara_ids]

        # Purga anche i residui di gare estere scrapate PRIMA che l'esclusione
        # esistesse (es. "Corsa della Pace Juniores"): restavano bloccate in
        # data/results_raw.json per sempre, perché l'esclusione impediva solo
        # nuovi inserimenti, non rimuoveva quanto già presente. Qui invece,
        # per ogni gara estera ancora presente sulla pagina FCI live, la
        # rimuoviamo esplicitamente se già in archivio.
        if excluded_gara_ids:
            _before_purge = len(all_results)
            all_results = [r for r in all_results if r["gara_id"] not in excluded_gara_ids]
            _purged = _before_purge - len(all_results)
            if _purged:
                print(f"  [Purge estero] Rimossi {_purged} risultati residui di gare estere già in archivio.")

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
        if g["id"] not in races_map:
            m, t, cr, ci, reg, reason = resolve_multiplier(g["nome"], g["data"], cal_by_date)
            g["moltiplicatore"] = m
            g["tipo"] = t
            g["campionato_regionale"] = cr
            g["campionato_italiano"] = ci
            races_map[g["id"]] = g

    athletes, teams, a_rank, t_rank, clean_results = aggregate(all_results)
    
    def wj(path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    wj(DATA_DIR/"results_raw.json", clean_results)
    wj(DATA_DIR/"athletes.json", athletes)
    wj(DATA_DIR/"teams.json", teams)
    # ─── Calcolo Trend (confronto con classifiche precedenti) ───
    for code, rows in a_rank.items():
        old_path = DATA_DIR/f"rankings/{code}.json"
        old_map = {}
        if old_path.exists():
            try:
                with open(old_path, "r", encoding="utf-8") as f:
                    old_data = json.load(f)
                    for r_old in old_data:
                        if "atleta_id" in r_old:
                            old_map[r_old["atleta_id"]] = r_old.get("pos", 9999)
            except: pass
        
        for row in rows:
            aid = row["atleta_id"]
            new_pos = row["pos"]
            if aid in old_map:
                old_pos = old_map[aid]
                row["trend"] = old_pos - new_pos  # pos diminuita = trend positivo (sale)
            else:
                row["trend"] = None # NEW

    for code, rows in a_rank.items(): wj(DATA_DIR/f"rankings/{code}.json", rows)
    for code, rows in t_rank.items(): wj(DATA_DIR/f"team_rankings/{code}.json", rows)
    
    meta_info = {"last_update": datetime.now().isoformat()}
    wj(DATA_DIR/"meta.json", meta_info)

    # ─── ARCHIVIO STAGIONALE (storicità) ──────────────────────────────────
    # Oltre alla stagione "live" in data/, salviamo uno snapshot CONGELATO in
    # data/seasons/{CURRENT_YEAR}/. Così, quando l'anno prossimo lo scraper
    # riparte da capo (sovrascrivendo data/), i dati di questa stagione restano
    # disponibili in modo permanente per profili/classifiche/gare storiche.
    try:
        season_dir = DATA_DIR / "seasons" / str(CURRENT_YEAR)
        (season_dir / "rankings").mkdir(parents=True, exist_ok=True)
        (season_dir / "team_rankings").mkdir(parents=True, exist_ok=True)
        wj(season_dir / "results_raw.json", clean_results)
        wj(season_dir / "athletes.json", athletes)
        wj(season_dir / "teams.json", teams)
        wj(season_dir / "calendar.json", calendar)
        for code, rows in a_rank.items(): wj(season_dir / f"rankings/{code}.json", rows)
        for code, rows in t_rank.items(): wj(season_dir / f"team_rankings/{code}.json", rows)
        n_races = len({r.get("gara_id") for r in clean_results if r.get("gara_id")})
        wj(season_dir / "meta.json", {
            "season": CURRENT_YEAR,
            "last_update": meta_info["last_update"],
            "n_results": len(clean_results),
            "n_athletes": len(athletes),
            "n_teams": len(teams),
            "n_races": n_races,
        })
        # Indice delle stagioni disponibili (per il selettore stagione nel frontend)
        seasons_root = DATA_DIR / "seasons"
        available = sorted([p.name for p in seasons_root.iterdir() if p.is_dir() and p.name.isdigit()])
        wj(seasons_root / "index.json", {
            "current": CURRENT_YEAR,
            "seasons": available,
            "updated": meta_info["last_update"],
        })
        print(f"Snapshot stagione {CURRENT_YEAR} salvato in data/seasons/{CURRENT_YEAR}/ ({n_races} gare).")
    except Exception as e:
        print(f"[ARCHIVIO] Errore salvataggio snapshot stagionale: {e}")

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
