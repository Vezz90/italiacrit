#!/usr/bin/env python
"""
Importer CICLOCROSS da federciclismo.it (sito pubblico, nessun login).

  - calendario: https://www.federciclismo.it/ricerca-gare/?site=ciclocross_it&mese=MM&anno2=YYYY
  - risultati:  pagina dettaglio-gara (classifiche in tabella HTML: Pos, Cat., Cod. FCI, Nome Atleta, Club)

Stagione ciclocross = a cavallo d'anno. Una data appartiene alla stagione che INIZIA nell'anno N
se cade tra il 1 luglio N e il 30 giugno N+1 (cartella "2026-27", etichetta "2026/27").

Categorie: stesse 10 della strada (ES1/ES2/AL/JUN/ELI, M e F). La categoria si ricava dal NOME DEL GRUPPO
di classifica (che e' gia' la categoria passata a ottobre), NON dalla colonna "Cat." (che e' la categoria
dell'anno prima). I gruppi OPEN valgono ELI. Giovanissimi, Master e altro restano fuori e finiscono in review.json.

Uscita (cartella data/ciclocross/<stagione>/):
  calendar.json   gare del calendario (ciclocross, team relay, gravel segnalato)
  results.json    una riga per piazzamento, con team DELLA GARA (non quello di strada)
  athletes.json   per codice FCI: atleta_id, genere, ultima categoria/club
  review.json     gruppi non mappati, omonimi (stesso nome, piu codici FCI), doppioni nella stessa gara

Uso:
  python scraper/cx_import.py                     stagione corrente, aggiorna data/ciclocross/
  python scraper/cx_import.py --season=2026       stagione 2026/27
  python scraper/cx_import.py --out=/percorso     scrive altrove (prove)
  python scraper/cx_import.py --refresh-days=14   riscarica i dettagli delle gare piu' recenti di N giorni
"""
import sys, re, json, time, datetime, unicodedata, collections
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://www.federciclismo.it/ricerca-gare/'
MESI = {'GENNAIO': 1, 'FEBBRAIO': 2, 'MARZO': 3, 'APRILE': 4, 'MAGGIO': 5, 'GIUGNO': 6, 'LUGLIO': 7, 'AGOSTO': 8,
        'SETTEMBRE': 9, 'OTTOBRE': 10, 'NOVEMBRE': 11, 'DICEMBRE': 12}

S = requests.Session()
S.headers['User-Agent'] = 'Mozilla/5.0 (compatible; italiacrit-cx-import)'


def get(url, tries=3):
    for i in range(tries):
        try:
            r = S.get(url, timeout=25)
            if r.status_code == 200:
                r.encoding = 'utf-8'
                return r.text
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    return None


def avanza(fase, fatto, totale):
    """Avanzamento per il pannello scraper (server/logs/, fuori da git)."""
    try:
        d = ROOT / 'server' / 'logs'; d.mkdir(parents=True, exist_ok=True)
        (d / 'avanzamento-cx_import.py.json').write_text(json.dumps({'fase': fase, 'fatto': fatto, 'totale': totale, 'quando': time.time()}), encoding='utf-8')
    except Exception:
        pass


# ── Stagione ─────────────────────────────────────────────────────────────────
def season_start(data_iso):
    y, m = int(data_iso[:4]), int(data_iso[5:7])
    return y if m >= 7 else y - 1


def season_key(start):
    return f'{start}-{str(start + 1)[2:]}'


# ── Normalizzazione ──────────────────────────────────────────────────────────
def norm_txt(s):
    s = unicodedata.normalize('NFD', (s or '').replace('�', '°')).encode('ascii', 'ignore').decode().upper()
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Z0-9 ]', ' ', s)).strip()


def atleta_id(nome):
    """Stessa regola delle schede esistenti: COGNOME NOME -> COGNOME_NOME (apostrofi e spazi -> _)."""
    s = unicodedata.normalize('NFD', nome or '').encode('ascii', 'ignore').decode().upper()
    return re.sub(r'[^A-Z0-9]+', '_', s).strip('_')


# Esclusioni "forti" (valgono sempre) e "deboli" (sigle tipo F1/M2, valide SOLO se il gruppo non nomina
# una categoria giovanile: "Allievi M1", "Esordienti F2" sono categorie vere, non Master).
FUORI_FORTE_RE = re.compile(r'MASTER|FASCIA|GIOVANISSIM|\bG[1-6]\b|G6|WOMEN|WOMAN|\bW\d\b|\bMW\b|\bMF\d\b|SUPERGENTLEMEN|ELMT|JMT|EWS|JWS|GENERALE|MISTA|COPPIA|STAFFETTA|RELAY|HANDBIKE|DISABIL|PARACIC|AMATORI|CICLOAMATORI|CICLOTURIST')
FUORI_DEBOLE_RE = re.compile(r'\bF\d\b|\bM\d{1,2}\b|\bM\d-M\d')
CAT_PAROLA_RE = re.compile(r'ESORDIENT|\bESO\b|\bED\d|\bES\d|ALLIEV|\bAL\d?\b|\bDA\d?\b|\bAM\d|\bALL\b|JUNIOR|\bJUN?\b|\bDJ\b|\bJM\b|OPEN|\bOPM\b|\bOPF\b|\bOM\b|\bOF\b|ELITE|UNDER')
FEMM_GRUPPO_RE = re.compile(r'DONN|FEMM|\bWJ\b|\bOPW\b|\bDUN\b|\bDJU\b|^ESD$|\bAD\d\b|CLASSIFICA ED$|^OP F$|^ES ?\d.* F$|\bED\d?\b|\bDA\d?\b|\bDJ\b|\bDU\b|\bDE\b|\bOPF\b|\bOF\b|\bAF\d?\b|\bEF\d?\b|\bJF\b|(ESORDIENTI|ALLIEVI|JUNIOR\w*|OPEN|ELITE|UNDER 23|ESO|ALL) ?F\b')
FEMM_CAT = {'DA', 'DJ', 'DU', 'DE', 'ED', 'G6F', 'G5F', 'G4F', 'G3F', 'G2F', 'G1F'}


def genere(gruppo_n, cat):
    # Gruppi con sigla compatta (ES1, ES2, ED1, ED2): in alcune gare la FCI scambia le sigle del 2° anno (es. Legnago: "ED2" con
    # soli maschi, "ES2" con sole donne). Qui il genere lo dice la colonna Cat. (ED / G6F... = donne, ES / G6M... = uomini).
    if re.fullmatch(r'E[DS]\d?', (gruppo_n or '').strip()) and (cat or '').strip():
        return 'F' if (cat or '').upper() in FEMM_CAT else 'M'
    if FEMM_GRUPPO_RE.search(gruppo_n):
        return 'F'
    if (cat or '').upper() in FEMM_CAT:
        return 'F'
    return 'M'


def mappa_categoria(gruppo, cat):
    """-> (codice a 10 categorie | None se fuori, nota). nota: 'anno_incerto' | 'non_riconosciuto' | None"""
    g = norm_txt(gruppo)
    if FUORI_FORTE_RE.search(g):
        return None, None
    if FUORI_DEBOLE_RE.search(g) and not CAT_PAROLA_RE.search(g):
        return None, None
    s = genere(g, cat)
    if re.search(r'ESORDIENT|\bESO\b|\bED ?\d|\bES ?\d|^E[SD]D?$|CLASSIFICA E[SD]$', g):
        y = None
        if re.search(r'\b1\s*E\s*2\b|\bI\s*E\s*II\b', g):
            return f'ES1_{s}', 'anno_incerto'  # un solo gruppo per entrambi gli anni: non separabile
        m = (re.search(r'(?:ES|ED|ESO|ESORDIENT[IE]?)\s*[MF]?\s*([12])\b', g) or re.search(r'\b([12])\s*ANNO', g)
             or re.search(r'\b[MF]([12])\b', g) or re.search(r'\b(?:DONNA|DONNE|FEMMINILE|MASCHILE)\s*([12])\b', g))
        if m:
            y = int(m.group(1))
        elif re.search(r'\bII\b', g):
            y = 2
        elif re.search(r'\bI\b', g):
            y = 1
        if y is None:
            return f'ES1_{s}', 'anno_incerto'
        return f'ES{y}_{s}', None
    if re.search(r'ALLIEV|\bAL\d?\b|\bDA\d?\b|\bAM\d|\bALL\d?\b|\bAD\d\b', g):
        return f'AL_{s}', None
    if re.search(r'JUNIOR|\bJUN?\b|\bDJ\b|\bJM\b|\bMJ\b|\bWJ\b|\bDJU\b|^J (UOMINI|DONNE)$', g):
        return f'JUN_{s}', None
    if re.search(r'OPEN|\bOPM\b|\bOPF\b|\bOM\b|\bOF\b|ELITE|UNDER|\bDU\b|\bDE\b|\bDONNE\b|\bEL\b|\bUN\b|\bOP [MF]\b|\bD?UN ?23\b|\bU23\b|\bDUN\b|\bOPEM\b|\bOPW\b', g):
        return f'ELI_{s}', None
    return None, 'non_riconosciuto'


# ── Calendario ───────────────────────────────────────────────────────────────
def calendario_mese(anno, mese):
    out = {}
    for pagina in range(1, 40):
        t = get(f'{BASE}?site=ciclocross_it&mese={mese:02d}&anno2={anno}&pagina={pagina}')
        if not t:
            break
        soup = BeautifulSoup(t, 'html.parser')
        cards = soup.select('a.wp-race-info')
        if not cards:
            break
        for c in cards:
            m = re.search(r'raceid=(\d+)', c.get('href', ''))
            if not m:
                continue
            rid = m.group(1)
            g = lambda sel: (c.select_one(sel).get_text(' ', strip=True) if c.select_one(sel) else '')
            mon = g('.fci-race-month').upper()
            if mon not in MESI or not g('.fci-race-day').isdigit() or not g('.fci-race-year').isdigit():
                continue
            data = f"{g('.fci-race-year')}-{MESI[mon]:02d}-{int(g('.fci-race-day')):02d}"
            cls = re.search(r'Classe:\s*(.*)', g('.wp-race-id-class'))
            out[rid] = {'fci_id': rid, 'data': data, 'nome': g('.wp-race-details'),
                        'classe': cls.group(1).strip() if cls else '',
                        'regione': g('.wp-race-location strong'), 'luogo': g('.wp-race-location span')}
        # il sito ripete l'ultima pagina oltre la fine: ci si ferma a "Pagina X di X"
        summ = soup.select_one('.fci-race-summary')
        mp = re.search(r'Pagina\s+(\d+)\s+di\s+(\d+)', summ.get_text(' ', strip=True)) if summ else None
        if mp and int(mp.group(1)) >= int(mp.group(2)):
            break
        time.sleep(0.4)
    return out


# ── Dettaglio gara ───────────────────────────────────────────────────────────
def dettaglio(rid):
    t = get(f'{BASE}dettaglio-gara/?raceid={rid}&site=ciclocross_it')
    if not t:
        return None
    soup = BeautifulSoup(t, 'html.parser')
    txt = soup.get_text('\n', strip=True)
    info = {}
    for k in ['Categoria', 'Categorie Ammesse', 'Categoria Geografica', 'Tipo di Gara']:
        m = re.search(re.escape(k) + r':\s*\n?([^\n]+)', txt)
        info[k] = m.group(1).strip() if m else None
    classifiche = []
    for b in soup.find_all('button', class_='race-accordion'):
        panel = b.find_next_sibling()
        tb = panel.find('table') if panel else None
        if not tb:
            continue
        heads = [h.get_text(strip=True) for h in tb.select('thead th')]
        if 'Nome Atleta' not in heads:
            continue
        rows = []
        for tr in tb.select('tbody tr'):
            c = [td.get_text(' ', strip=True) for td in tr.find_all('td')]
            if len(c) >= 5:
                rows.append({'pos': c[0], 'cat_fci': c[1], 'cod_fci': c[2], 'nome': c[3], 'club': c[4]})
        classifiche.append({'gruppo': b.get_text(strip=True), 'righe': rows})
    return {'info': info, 'classifiche': classifiche}


def disciplina_da_tipo(tipo):
    t = (tipo or '').lower()
    if 'gravel' in t:
        return 'gravel'
    if 'ciclocross' in t or 'relay' in t:
        return 'ciclocross'
    return 'altro'


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]
    opt = lambda k, d=None: next((a.split('=', 1)[1] for a in args if a.startswith(f'--{k}=')), d)
    oggi = datetime.date.today().isoformat()
    start = int(opt('season', season_start(oggi)))
    skey = season_key(start)
    outroot = Path(opt('out', ROOT / 'data' / 'ciclocross'))
    outdir = outroot / skey
    outdir.mkdir(parents=True, exist_ok=True)
    refresh_days = int(opt('refresh-days', 7))

    # cache delle gare gia' scaricate
    prev_results = {}
    f_res = outdir / 'results.json'
    if f_res.exists():
        for r in json.load(open(f_res, encoding='utf-8')):
            prev_results.setdefault(r['gara'], []).append(r)
    prev_cal = {}
    f_cal = outdir / 'calendar.json'
    if f_cal.exists():
        prev_cal = {r['fci_id']: r for r in json.load(open(f_cal, encoding='utf-8'))}

    # 1. calendario: luglio N .. giugno N+1
    mesi = [(start, m) for m in range(7, 13)] + [(start + 1, m) for m in range(1, 7)]
    gare = {}
    for n_mese, (anno, mese) in enumerate(mesi, 1):
        avanza('1 di 2 · lettura calendario', n_mese, len(mesi))
        c = calendario_mese(anno, mese)
        print(f'calendario {anno}-{mese:02d}: {len(c)} gare', flush=True)
        gare.update(c)
    if not gare:
        raise SystemExit('Nessuna gara letta dal calendario: markup cambiato? Nulla scritto.')

    # 2. dettagli
    limite = (datetime.date.today() - datetime.timedelta(days=refresh_days)).isoformat()
    results, review_gruppi_fuori, review_gruppi_incerti = [], collections.Counter(), collections.Counter()
    non_rec = collections.Counter()
    calendario = []
    scaricate = 0
    for n_gara, (rid, g) in enumerate(sorted(gare.items(), key=lambda kv: (kv[1]['data'], kv[0])), 1):
        avanza('2 di 2 · risultati gara per gara', n_gara, len(gare))
        old = prev_cal.get(rid)
        passata = g['data'] <= oggi
        riusa = bool(old) and rid in prev_results and g['data'] < limite and old.get('n_righe', 0) > 0
        if riusa:
            g.update({k: old[k] for k in ('tipo_gara', 'disciplina', 'geo', 'categorie_ammesse', 'n_righe') if k in old})
            results.extend(prev_results[rid])
            calendario.append(g)
            continue
        d = dettaglio(rid) if (passata or not old) else None
        time.sleep(0.4)
        if d:
            scaricate += 1
            tipo = d['info'].get('Tipo di Gara')
            g.update({'tipo_gara': tipo, 'disciplina': disciplina_da_tipo(tipo), 'geo': d['info'].get('Categoria Geografica'),
                      'categorie_ammesse': d['info'].get('Categorie Ammesse')})
        else:
            g.update({k: old[k] for k in ('tipo_gara', 'disciplina', 'geo', 'categorie_ammesse') if old and k in old})
            g.setdefault('disciplina', 'altro')
        n = 0
        if g.get('disciplina') != 'ciclocross':
            continue  # gravel e altro: hanno la loro stagione (anno solare) e il loro importer
        if d and g.get('disciplina') == 'ciclocross':
            visti = set()
            for c in d['classifiche']:
                for x in c['righe']:
                    cat, nota = mappa_categoria(c['gruppo'], x['cat_fci'])
                    if cat is None:
                        (non_rec if nota == 'non_riconosciuto' else review_gruppi_fuori)[c['gruppo']] += 1
                        continue
                    if nota == 'anno_incerto':
                        review_gruppi_incerti[c['gruppo']] += 1
                    riga = {'gara': rid, 'data': g['data'], 'cat': cat, 'gruppo': c['gruppo'], 'pos': x['pos'],
                            'cod_fci': x['cod_fci'], 'atleta_id': atleta_id(x['nome']), 'nome': x['nome'],
                            'club': x['club'], 'cat_fci': x['cat_fci']}
                    k = x['cod_fci']
                    if k in visti:
                        riga['doppio'] = True
                    visti.add(k)
                    results.append(riga)
                    n += 1
        g['n_righe'] = n
        calendario.append(g)
        if scaricate % 20 == 0 and scaricate:
            print(f'  dettagli scaricati: {scaricate}', flush=True)

    # schede doppie gia' unite (data/atleti_alias.json: vecchio id -> id vero)
    try:
        alias = json.load(open(ROOT / 'data' / 'atleti_alias.json', encoding='utf-8'))
    except Exception:
        alias = {}
    for r in results:
        r['atleta_id'] = alias.get(r['atleta_id'], r['atleta_id'])

    # 3. atleti per codice FCI + omonimi
    atleti, per_nome = {}, collections.defaultdict(set)
    for r in sorted(results, key=lambda r: r['data']):
        a = atleti.setdefault(r['cod_fci'], {'atleta_id': r['atleta_id'], 'nome': r['nome'], 'n_gare': 0})
        a.update({'genere': r['cat'][-1], 'categoria': r['cat'], 'club': r['club']})
        a['n_gare'] += 1
        per_nome[r['atleta_id']].add(r['cod_fci'])
    omonimi = {k: sorted(v) for k, v in per_nome.items() if len(v) > 1}
    doppi = sum(1 for r in results if r.get('doppio'))

    review = {'gruppi_fuori_classifica': dict(review_gruppi_fuori.most_common()),
              'gruppi_non_riconosciuti': dict(non_rec.most_common()),
              'gruppi_anno_incerto': dict(review_gruppi_incerti.most_common()),
              'omonimi_stesso_nome_codici_diversi': omonimi, 'righe_doppie_nella_stessa_gara': doppi}

    def dump(name, obj):
        json.dump(obj, open(outdir / name, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    dump('calendar.json', calendario)
    dump('results.json', results)
    dump('athletes.json', atleti)
    json.dump(review, open(outdir / 'review.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    idx = outroot / 'index.json'
    seasons = sorted({p.name for p in outroot.iterdir() if p.is_dir()})
    json.dump({'current': skey, 'seasons': seasons, 'updated': datetime.datetime.now().isoformat(timespec='seconds')},
              open(idx, 'w', encoding='utf-8'), indent=1)
    print(f'FINITO {skey}: {len(calendario)} gare, {len(results)} piazzamenti, {len(atleti)} atleti, '
          f'{len(omonimi)} omonimi, {doppi} righe doppie, {sum(review_gruppi_fuori.values())} righe fuori categoria, '
          f'{sum(non_rec.values())} non riconosciute -> {outdir}')


if __name__ == '__main__':
    main()
