"""Genera le pagine statiche delle sezioni del sito (albo.html, atleti.html, team.html, ...).

GitHub Pages risponde 404 a /atleti, /albo, /team ecc. perche' non esiste un file con quel nome
(solo /risultati, /classifica, /calendario, /media passano dal Worker Cloudflare). Google riceve
quindi un vero 404 sulle pagine piu' importanti. Ogni sezione diventa una copia di index.html con
titolo, descrizione e canonical propri: GitHub Pages la serve con status 200 su /<sezione>.

DA RILANCIARE ogni volta che index.html cambia (versioni ?v=NNN): lo fa anche l'hook pre-commit
(.git/hooks/pre-commit) quando index.html e' tra i file in commit.
"""
import os, re, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://italiacyclingstats.com'

PAGES = {
    'albo':        ("Albo d'Oro del ciclismo giovanile italiano | ICS", "L'albo d'oro delle gare e dei campioni del ciclismo agonistico italiano: vincitori di ogni edizione, per categoria."),
    'atleti':      ("Atleti del ciclismo agonistico italiano | ICS", "Tutti gli atleti di Esordienti, Allievi, Juniores, Under 23 ed Elite: punti, risultati e profili."),
    'team':        ("Team e società ciclistiche | ICS", "Le squadre e le società del ciclismo agonistico italiano: classifiche, corridori e storia dei club."),
    'gare':        ("Archivio gare del ciclismo giovanile | ICS", "Archivio alfabetico delle gare del ciclismo agonistico italiano con risultati e albo d'oro."),
    'statistiche': ("Statistiche del ciclismo agonistico italiano | ICS", "Statistiche, tendenze e numeri della stagione del ciclismo agonistico italiano su strada."),
    'comparatore': ("Comparatore atleti e team | ICS", "Confronta due atleti o due team del ciclismo agonistico italiano: punti, vittorie, podi e risultati."),
    'regolamento': ("Regolamento punteggi e classifiche | ICS", "Come vengono calcolati i punti e le classifiche di Italia Cycling Stats."),
    'record':      ("Record e primati del ciclismo agonistico italiano | ICS", "I record e i primati di atleti e team del ciclismo agonistico italiano."),
}


def sub(pattern, repl, text, flags=0):
    new, n = re.subn(pattern, lambda m: repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'pattern non trovato in index.html: {pattern}')
    return new


def main():
    src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in src else '\n'
    base = src.replace('\r\n', '\n')
    changed = 0
    for slug, (title, desc) in PAGES.items():
        t, d, url = html.escape(title, quote=True), html.escape(desc, quote=True), f'{SITE}/{slug}'
        out = base
        out = sub(r'<title>.*?</title>', f'<title>{t}</title>', out, re.S)
        out = sub(r'<meta name="description" content=".*?" />', f'<meta name="description" content="{d}" />', out, re.S)
        out = sub(r'<link rel="canonical" href=".*?" />', f'<link rel="canonical" href="{url}" />', out)
        out = sub(r'<meta property="og:url" content=".*?" />', f'<meta property="og:url" content="{url}" />', out)
        out = sub(r'<meta property="og:title" content=".*?" />', f'<meta property="og:title" content="{t}" />', out)
        out = sub(r'<meta property="og:description" content=".*?" />', f'<meta property="og:description" content="{d}" />', out)
        out = sub(r'<meta name="twitter:title" content=".*?" />', f'<meta name="twitter:title" content="{t}" />', out)
        out = sub(r'<meta name="twitter:description" content=".*?" />', f'<meta name="twitter:description" content="{d}" />', out)
        out = out.replace('\n', nl)
        path = os.path.join(ROOT, slug + '.html')
        old = open(path, encoding='utf-8', newline='').read() if os.path.exists(path) else None
        if old != out:
            open(path, 'w', encoding='utf-8', newline='').write(out)
            changed += 1
    # statistiche per regione: /statistiche/regione/<regione> (una pagina per regione, stessa logica delle sezioni)
    import json
    n_reg = 0
    idx_path = os.path.join(ROOT, 'data', 'almanacco_regioni', 'index.json')
    reg_files = []
    if os.path.exists(idx_path):
        regs = json.load(open(idx_path, encoding='utf-8')).get('regions', [])
        out_dir = os.path.join(ROOT, 'statistiche', 'regione')
        os.makedirs(out_dir, exist_ok=True)
        keep = set()
        for r in regs:
            slug = r['slug'].lower().replace('_', '-')
            name = r['name'].title()          # "VALLE D'AOSTA" -> "Valle D'Aosta"
            title = f"Statistiche del ciclismo giovanile in {name}: record, campioni e squadre | ICS"
            desc = f"Chi ha vinto di più, le squadre più forti e l'albo anno per anno nelle gare disputate in {name}, dal 2007."
            t, d, url = html.escape(title, quote=True), html.escape(desc, quote=True), f'{SITE}/statistiche/regione/{slug}'
            out = base
            out = sub(r'<title>.*?</title>', f'<title>{t}</title>', out, re.S)
            out = sub(r'<meta name="description" content=".*?" />', f'<meta name="description" content="{d}" />', out, re.S)
            out = sub(r'<link rel="canonical" href=".*?" />', f'<link rel="canonical" href="{url}" />', out)
            out = sub(r'<meta property="og:url" content=".*?" />', f'<meta property="og:url" content="{url}" />', out)
            out = sub(r'<meta property="og:title" content=".*?" />', f'<meta property="og:title" content="{t}" />', out)
            out = sub(r'<meta property="og:description" content=".*?" />', f'<meta property="og:description" content="{d}" />', out)
            out = sub(r'<meta name="twitter:title" content=".*?" />', f'<meta name="twitter:title" content="{t}" />', out)
            out = sub(r'<meta name="twitter:description" content=".*?" />', f'<meta name="twitter:description" content="{d}" />', out)
            out = out.replace('\n', nl)
            path = os.path.join(out_dir, slug + '.html')
            keep.add(slug + '.html')
            old = open(path, encoding='utf-8', newline='').read() if os.path.exists(path) else None
            if old != out:
                open(path, 'w', encoding='utf-8', newline='').write(out)
                n_reg += 1
            reg_files.append(f'statistiche/regione/{slug}.html')
        for fn in os.listdir(out_dir):
            if fn.endswith('.html') and fn not in keep:
                os.remove(os.path.join(out_dir, fn))
    print(f'sync_route_pages: {changed} file aggiornati su {len(PAGES)}; regioni: {n_reg} su {len(reg_files)}')
    return [s + '.html' for s in PAGES] + reg_files


if __name__ == '__main__':
    main()
