#!/usr/bin/env python
"""
Controllo settimanale del calendario STRADA contro members.federciclismo.it (pubblico, senza login).

  - AGGIUNGE le gare che su Members ci sono e da noi no
  - TOGLIE le gare che da noi ci sono ma su Members non ci sono piu' (cancellate dalla FCI), se non hanno risultati
  - TOGLIE le gare che Members segna come annullate / rinviate / sospese (e le mette in data/calendar_exclude.json)
  - non tocca mai una gara che ha gia' risultati

Pensato per girare il giovedi da Task Scheduler (run-members-calendar.ps1).

  python scripts/members_calendar_sync.py            anteprima (non scrive nulla)
  python scripts/members_calendar_sync.py --apply    scrive calendar.json, calendar_exclude.json e fa commit + push

Prima di applicare controlla che la scansione sia credibile (stesso ordine di grandezza del calendario nella finestra),
altrimenti non rimuove nulla: meglio una gara in piu' che una gara persa per un errore di lettura.
"""
import sys, re, json, html, time, datetime, subprocess, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
sys.path.insert(0, str(ROOT / 'scraper'))
from calendar_scraper import slug, parse_date  # noqa: E402

APPLY = '--apply' in sys.argv
BASE = 'https://members.federciclismo.it'
STATE_RE = re.compile(r'ANNULLAT|RINVIAT|SOSPES|SLITTAT|NON\s+SI\s+DISPUTA|ANNULLATA', re.I)
UA = {'User-Agent': 'Mozilla/5.0'}


def get(url, tries=3):
    # curl invece di requests: il certificato di Members non ha l'intermedio e Python lo rifiuta (curl/Node no)
    for i in range(tries):
        try:
            r = subprocess.run(['curl', '-s', '-L', '-m', '40', '-A', 'Mozilla/5.0', url], capture_output=True)
            if r.returncode == 0 and r.stdout:
                return r.stdout.decode('utf-8', 'replace')
        except Exception:
            pass
        time.sleep(1.5 * (i + 1))
    return ''


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').upper())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^A-Z0-9]+', ' ', s).strip()
    return re.sub(r'^\d+\s*', '', s)


STAGE_RE = re.compile(r'(PROLOGO|CLASSIFICA GENERALE|(PRIMA|SECONDA|TERZA|QUARTA|QUINTA|SESTA|SETTIMA|OTTAVA|NONA|DECIMA|[0-9]+)[ ]+(SEMI)?TAPPA)')


def core(s):
    # nome senza edizione e senza parole di tappa: "74 COPPA DEL MOBILIO PRIMA TAPPA" == "74 COPPA DEL MOBILIO"
    return re.sub(r'\s+', ' ', STAGE_RE.sub(' ', norm(s))).strip()


GENERIC = {'GRAN','PREMIO','TROFEO','COPPA','MEMORIAL','GP','CITTA','DI','DEL','DELLA','DEI','DEGLI','DELLE','E','A','AL','IL','LA','LO','PROVA','CHALLENGE','MEM','TR','CAV','UFF','COMUNE','CICLISTICA'}


def toks(s):
    return {w for w in core(s).split() if len(w) > 2 and w not in GENERIC and not w.isdigit()}


def same_race(c, m):
    # stessa data e: nome uguale, oppure almeno 2 parole distintive in comune, oppure stesso luogo e una parola in comune
    if c['data'] != m['data']:
        return False
    if core(c['nome']) == core(m['nome']):
        return True
    a, b = toks(c['nome']), toks(m['nome'])
    common = a & b
    lc, lm = norm(c.get('luogo')), norm(m.get('luogo'))
    luogo_ok = bool(lc) and bool(lm) and (lc in lm or lm in lc)
    if lc and lm and not luogo_ok:
        return False                      # nomi di serie condivisi (es. "Giro di Puglia Challenge"): servono luoghi uguali
    if len(common) >= 2:
        return True
    return bool(common) and luogo_ok


def moved_to(c, items):
    # la stessa gara con un'altra data: stesso nome, oppure stesso luogo e almeno una parola distintiva in comune
    for x in items:
        if x['data'] == c['data']:
            continue
        if core(x['nome']) == core(c['nome']):
            return x
        lc, lm = norm(c.get('luogo')), norm(x.get('luogo'))
        if lc and lm and (lc in lm or lm in lc) and (toks(c['nome']) & toks(x['nome'])):
            return x
    return None


def days(a, b):
    try:
        return abs((datetime.date.fromisoformat(a) - datetime.date.fromisoformat(b)).days)
    except Exception:
        return 999


def clean(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def scan_members(frm, to):
    """Gare del settore Strada (sectorId=1) tra due date (datetime.date)."""
    items = {}
    f, t = frm.strftime('%d%%2F%m%%2F%Y'), to.strftime('%d%%2F%m%%2F%Y')
    for page in range(1, 200):
        txt = get(f'{BASE}/race?sectorId=1&StartDt={f}&EndDt={t}&page={page}')
        ms = list(re.finditer(r'<li>\s*<a href="/race/detail/(\d+)/">([\s\S]*?)</a>\s*<div class="btnGare', txt))
        if not ms:
            break
        new = 0
        for m in ms:
            rid, inner = m.group(1), m.group(2)
            if rid in items:
                continue
            new += 1
            data = clean((re.search(r'<span class="calData">([^<]*)</span>', inner) or [None, ''])[1])
            h3 = clean((re.search(r'<h3>([\s\S]*?)</h3>', inner) or [None, ''])[1])
            h4 = clean((re.search(r'<h4>([\s\S]*?)</h4>', inner) or [None, ''])[1])
            spans = [clean(x) for x in re.findall(r'<span>([\s\S]*?)</span>', inner)]
            nome = re.sub(r'^[^-]+-\s*', '', h3).strip()
            cl = re.search(r'Classe:\s*(?:\([^)]+\))?\s*(.*)$', h4)
            items[rid] = {
                'id': rid, 'data': parse_date(data), 'nome': nome,
                'categoria': (cl.group(1).strip() if cl else ''),
                'luogo': spans[0] if spans else '', 'livello': (spans[1] if len(spans) > 1 else '').split('-')[0].strip(),
            }
        if not new:
            break
        time.sleep(0.3)
    return items


def detail(rid):
    t = get(f'{BASE}/race/detail/{rid}/')
    txt = clean(re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', '', t))
    reg = (re.search(r'Regione:\s*([A-Z\' ]+?)\s+Luogo:', txt) or [None, ''])[1].strip()
    luogo = (re.search(r'Luogo:\s*(.*?)\s+Classe:', txt) or [None, ''])[1].strip()
    return reg.upper(), luogo


def main():
    today = datetime.date.today()
    frm, to = today - datetime.timedelta(days=14), datetime.date(today.year, 12, 31)
    cal_path, ex_path = DATA / 'calendar.json', DATA / 'calendar_exclude.json'
    if APPLY:
        subprocess.run(['git', 'pull', '--rebase', '-q'], cwd=ROOT)
    cal = json.load(open(cal_path, encoding='utf-8'))
    ex = json.load(open(ex_path, encoding='utf-8')) if ex_path.exists() else {'ids': {}, 'fci_ids': {}}
    ex.setdefault('ids', {}); ex.setdefault('fci_ids', {})
    try:
        res = json.load(open(DATA / 'results_raw.json', encoding='utf-8'))
    except Exception:
        res = []

    print(f'Scansione Members (Strada) {frm} -> {to} ...')
    mem = scan_members(frm, to)
    print(f'  gare su Members: {len(mem)}')

    iso_from, iso_to = frm.isoformat(), to.isoformat()
    window = [c for c in cal if iso_from <= (c.get('data') or '') <= iso_to]
    with_fci = [c for c in window if c.get('fci_id')]
    print(f'  righe del calendario nella finestra: {len(window)} (con ID FCI: {len(with_fci)})')

    # controllo di sanita' della scansione
    seen_fci = sum(1 for c in with_fci if str(c['fci_id']) in mem)
    credible = len(mem) >= 50 and (not with_fci or seen_fci / len(with_fci) >= 0.8)
    print(f'  righe con ID FCI ritrovate su Members: {seen_fci}/{len(with_fci)} -> scansione {"credibile" if credible else "NON credibile: nessuna rimozione"}')

    # risultati per data: nomi normalizzati
    res_names = {}
    for r in res:
        g = str(r.get('gara_id', ''))
        d = r.get('data', '')
        if d:
            res_names.setdefault(d, set()).add(norm(re.sub(r'_\d{4}-\d{2}-\d{2}.*$', '', g).replace('_', ' ')))

    def has_results(c):
        n = norm(c['nome'])
        for rn in res_names.get(c['data'], ()):
            if n and rn and (n in rn or rn in n or n[:20] == rn[:20]):
                return True
        return False

    mem_by_core = {}
    for m in mem.values():
        mem_by_core.setdefault(core(m['nome']), []).append(m)
    mem_by_date_name = {}
    for m in mem.values():
        mem_by_date_name.setdefault((m['data'], norm(m['nome'])), []).append(m)

    report = {'quando': datetime.datetime.now().isoformat(timespec='minutes'), 'rimosse': [], 'annullate': [], 'aggiunte': [], 'da_controllare': [], 'collegate': []}
    to_remove = set()

    # 1) righe del nostro calendario
    for c in window:
        fid = str(c.get('fci_id') or '')
        m = mem.get(fid) if fid else None
        if not m:
            cand = mem_by_date_name.get((c['data'], norm(c['nome']))) or [x for x in mem.values() if same_race(c, x)]
            if cand:
                m = cand[0]
                if not fid and APPLY:
                    c['fci_id'] = m['id']          # collega la riga vecchia al suo ID Gara
                report['collegate'].append(c['id'])
        if m and STATE_RE.search(m['nome']):
            if has_results(c):
                report['da_controllare'].append({'id': c['id'], 'motivo': f'Members: {m["nome"]} ma ha risultati'})
            else:
                to_remove.add(c['id']); ex['ids'][c['id']] = f'Members: {m["nome"]}'
                report['annullate'].append({'id': c['id'], 'members': m['nome']})
            continue
        if not m:
            if not credible:
                report['da_controllare'].append({'id': c['id'], 'motivo': 'non su Members (scansione non credibile)'})
            elif has_results(c):
                report['da_controllare'].append({'id': c['id'], 'motivo': 'non su Members ma ha risultati'})
            elif (c.get('tipo') or '') == 'internazionale' and not fid:
                report['da_controllare'].append({'id': c['id'], 'motivo': 'internazionale senza ID FCI, non su Members'})
            else:
                same = [x for x in mem_by_core.get(core(c['nome']), [])]
                near = [x for x in same if days(x['data'], c['data']) <= 10]
                if near:
                    continue                                    # gara a tappe (Members ha una riga sola) o data di poco diversa: la teniamo
                mv = moved_to(c, mem.values())
                if mv:
                    to_remove.add(c['id']); ex['ids'][c['id']] = f"sparita: spostata su Members al {mv['data']}"
                    report['rimosse'].append({'id': c['id'], 'nome': c['nome'], 'data': c['data'], 'spostata_al': mv['data']})
                    continue
                to_remove.add(c['id']); ex['ids'][c['id']] = 'sparita da Members (cancellata dalla FCI)'
                report['rimosse'].append({'id': c['id'], 'nome': c['nome'], 'data': c['data']})

    # sicurezza: troppe rimozioni = probabile errore di lettura
    if len(to_remove) > max(25, 0.15 * len(window)):
        print(f'ATTENZIONE: {len(to_remove)} rimozioni su {len(window)} righe: troppe, non rimuovo nulla.')
        report['da_controllare'] += [{'id': i, 'motivo': 'troppe rimozioni insieme'} for i in to_remove]
        report['rimosse'], report['annullate'] = [], []
        to_remove.clear()

    # 2) gare su Members che da noi non ci sono
    have_fci = {str(c.get('fci_id')) for c in cal if c.get('fci_id')}
    have_dn = {(c['data'], norm(c['nome'])) for c in cal}
    cal_core = {}
    for c in cal:
        cal_core.setdefault(core(c['nome']), []).append(c['data'])
    new_rows = []
    for m in mem.values():
        if m['id'] in have_fci or m['id'] in ex['fci_ids'] or not m['data']:
            continue
        if (m['data'], norm(m['nome'])) in have_dn and not any(str(c.get('fci_id') or '') == '' and c['data'] == m['data'] and norm(c['nome']) == norm(m['nome']) for c in cal):
            pass
        if STATE_RE.search(m['nome']):
            continue                                                # annullata/rinviata: non si aggiunge
        if any(days(d, m['data']) <= 10 for d in cal_core.get(core(m['nome']), [])):
            continue                                                # gara a tappe gia' presente con le sue tappe
        idb = f"{slug(m['nome'])}_{m['data']}"
        if idb in ex['ids']:
            if str(ex['ids'][idb]).startswith('sparita'):
                del ex['ids'][idb]                          # era sparita e ora Members la elenca di nuovo: si rimette
            else:
                continue
        reg, luogo = detail(m['id']) if APPLY or len(new_rows) < 40 else ('', m['luogo'])
        lvl = m['livello'].lower()
        tipo, mult = ('internazionale', 3) if lvl.startswith('inter') else (('nazionale', 2) if lvl.startswith('nazion') else ('regionale', 1))
        nm = m['nome']
        row = {
            'id': idb, 'nome': nm, 'data': m['data'], 'tipo': tipo, 'moltiplicatore': mult,
            'campionato_regionale': 'campionato regionale' in nm.lower(), 'campionato_italiano': 'campionato italiano' in nm.lower(),
            'regione': reg, 'categoria': m['categoria'], 'luogo': (luogo or m['luogo']), 'fci_id': m['id'],
        }
        # stesso nome+data gia' presente con un'altra categoria: si distingue con la categoria
        if any(c['id'] == idb for c in cal) or any(r['id'] == idb for r in new_rows):
            row['id'] = f"{idb}_{slug(m['categoria'])}"
        new_rows.append(row)
        report['aggiunte'].append({'id': row['id'], 'nome': nm, 'data': m['data'], 'categoria': m['categoria'], 'regione': reg})
        time.sleep(0.2)

    print(f"\nRISULTATO: da aggiungere {len(new_rows)} | da togliere {len(to_remove)} (di cui annullate/rinviate {len(report['annullate'])}) | da controllare {len(report['da_controllare'])}")
    for k in ('rimosse', 'annullate', 'aggiunte', 'da_controllare'):
        for x in report[k][:40]:
            print(f'  [{k}] {x}')

    if not APPLY:
        print('\nAnteprima: nulla scritto. Aggiungi --apply.')
        return
    if not (to_remove or new_rows or report['collegate']):
        print('Nessuna modifica.')
    else:
        cal = [c for c in cal if c['id'] not in to_remove] + new_rows
        cal.sort(key=lambda c: (c.get('data') or '', c['id']))
        open(cal_path, 'w', encoding='utf-8', newline='\n').write(json.dumps(cal, indent=2, ensure_ascii=False))
        open(ex_path, 'w', encoding='utf-8', newline='\n').write(json.dumps(ex, indent=2, ensure_ascii=False))
    open(DATA / 'calendar_members_report.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(report, indent=2, ensure_ascii=False))
    subprocess.run(['git', 'add', 'data/calendar.json', 'data/calendar_exclude.json', 'data/calendar_members_report.json'], cwd=ROOT)
    msg = f"calendario: controllo Members (+{len(new_rows)} / -{len(to_remove)})"
    if subprocess.run(['git', 'diff', '--staged', '--quiet'], cwd=ROOT).returncode != 0:
        subprocess.run(['git', 'commit', '-q', '-m', msg], cwd=ROOT)
        for _ in range(4):
            subprocess.run(['git', 'pull', '--rebase', '-q'], cwd=ROOT)
            if subprocess.run(['git', 'push', '-q'], cwd=ROOT).returncode == 0:
                print('Pubblicato.')
                break
            time.sleep(3)


if __name__ == '__main__':
    main()
