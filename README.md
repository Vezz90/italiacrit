# ICS — Italia Cycling Stats

> Risultati, classifiche, statistiche e storia del ciclismo agonistico italiano su strada e su pista,
> dagli Esordienti agli Elite/Under 23, uomini e donne.
> **Sito:** [italiacyclingstats.com](https://www.italiacyclingstats.com)

*Progetto indipendente, non affiliato alla Federazione Ciclistica Italiana.*

---

## Cosa offre il sito

| Sezione | Contenuto |
|---|---|
| **Home** | ultime gare, prossimi appuntamenti, atleti in forma, articoli |
| **Risultati e calendario** | ordini d'arrivo delle gare italiane, calendario della stagione, gare professionistiche in Italia |
| **Classifiche** | classifica a punti per atleti e squadre, per categoria e per regione; classifica pista |
| **Profili atleta** | stagioni, piazzamenti, squadre, titoli di campione, medaglie internazionali, carriera da dilettante e da professionista, foto e video |
| **Profili squadra** | rosa, vittorie, storico anno per anno con i cambi di nome |
| **Statistiche e Almanacco** | numeri dal 2007 a oggi, nazionali e per regione: record, più vincenti, dinastie di squadra, stagioni migliori |
| **Albo d'oro** | vincitori delle gare edizione per edizione, divisi per categoria |
| **Comparatore** | due o più atleti messi a confronto sulla carriera |
| **Media** | foto e video delle gare |
| **Articoli** | cronache, analisi e ritratti della Redazione |
| **Area utenti** | iscrizione (anche con Google), profilo personale, messaggi, notifiche |
| **Pannello admin** | moderazione, correzioni dei dati, omonimi, storico squadre, Redazione, Instagram |

### Categorie

| Codice | Categoria |
|---|---|
| `ES1_M` / `ES1_F` | Esordienti 1° anno, uomini / donne |
| `ES2_M` / `ES2_F` | Esordienti 2° anno, uomini / donne |
| `AL_M` / `AL_F` | Allievi / Allieve |
| `JUN_M` / `JUN_F` | Juniores, uomini / donne |
| `ELI_M` / `ELI_F` | Elite e Under 23 / Donne Elite |

### Sistema a punti

| Posizione | 1° | 2° | 3° | 4° | 5° | 6° | 7° | 8° | 9° | 10° |
|---|---|---|---|---|---|---|---|---|---|---|
| Punti base | 15 | 12 | 10 | 8 | 6 | 5 | 4 | 3 | 2 | 1 |

I punti base si moltiplicano per il peso della gara:

| Moltiplicatore | Gare |
|---|---|
| ×1 | gare regionali |
| ×2 | gare nazionali e Campionati Regionali |
| ×3 | gare internazionali, Campionati Italiani ed Europei |
| ×4 | Campionati del Mondo |

Il regolamento completo è nella pagina `regolamento.html` del sito.

---

## Come è fatto

```
 Fonti esterne                  Raccolta                     Archivio                   Pubblicazione
 ─────────────                  ────────                     ────────                   ─────────────
 Risultati FCI ───────┐
 ciclismo.info ───────┤         scraper Python  ──┐          data/*.json  ──────────►  sito statico
 ProCyclingStats ─────┼───────► importatori Node ─┼────────► (classifiche,             (GitHub Pages
 YouTube, foto ───────┘         (server/, scripts/)│          almanacco, albo…)          + Cloudflare)
                                                   └───────► Supabase (Postgres) ──►  API Express
                                                              (atleti, risultati        su Render
                                                               storici, utenti, media)
```

| Livello | Tecnologia |
|---|---|
| **Frontend** | HTML, CSS e JavaScript senza framework. Una SPA con router a hash (`index.html` + `app.js`) più script dedicati alle singole sezioni |
| **Backend** | Node.js + Express (`server/server.js`), ospitato su Render |
| **Database** | Supabase (Postgres) per atleti, risultati storici, utenti, foto, video, articoli e impostazioni |
| **Dati pubblici** | file JSON in `data/`, serviti direttamente dal sito |
| **Raccolta dati** | scraper Python 3.11 (Playwright e BeautifulSoup) e importatori Node |
| **CDN** | Cloudflare davanti al dominio, con un Worker per le anteprime di condivisione |
| **Automazioni** | GitHub Actions per deploy, risultati e keep-alive |
| **AI** | API Anthropic (Claude) per la Redazione |

---

## Struttura del repository

```
.
├── index.html, app.js            SPA principale (router a hash)
├── home.js, risultati.js …       script delle singole sezioni, caricati dall'index
├── almanacco.js, carriere.js     Statistiche, Almanacco e Comparatore
├── titoli.js, procorse.js        titoli di campione, gare professionistiche
├── articoli.js, redazione.js     articoli pubblici e pannello della Redazione
├── palazzo.js                    vista 3D della Redazione (Three.js)
├── style.css, design.css         stili (tema scuro e chiaro)
├── sw.js, manifest.json          service worker e PWA
├── albo.html, atleti.html …      pagine statiche indicizzabili, generate da scripts/sync_route_pages.py
├── statistiche/regione/*.html    pagine statistiche per regione (generate)
├── data/                         dati pubblici in JSON
│   ├── calendar.json             calendario della stagione
│   ├── results_raw.json          risultati della stagione
│   ├── athletes.json, teams.json schede atleti e squadre
│   ├── rankings/, team_rankings/ classifiche per categoria
│   ├── almanacco.json            statistiche 2007-oggi (più almanacco_regioni/)
│   ├── carriere.json             carriere per il Comparatore
│   ├── ciclismo-storico/<anno>/  gare e classifiche delle stagioni passate
│   ├── albo/                     serie storiche delle gare (albo d'oro)
│   ├── race_details_*.json       schede federali delle gare (percorso, km, orari)
│   ├── medaglie_internazionali.json
│   └── titoli_campione.json
├── scraper/                      scraper Python dei risultati e del calendario FCI
├── scripts/                      generatori dei dati derivati (almanacco, albo, titoli, medaglie, pagine statiche)
├── server/                       backend Express, importatori e script di manutenzione
│   ├── server.js                 API: autenticazione, profili, media, admin, sincronizzazioni
│   ├── db.js                     connessione a Supabase/Postgres
│   ├── redazione*.js             Redazione AI (vedi sotto)
│   ├── rete-sicura.js            download protetto dagli URL esterni
│   ├── pcs-*.js, ciclismo-*.js   importatori ProCyclingStats e ciclismo.info
│   ├── pista-*.js                importazione delle gare su pista
│   ├── omonimi-analisi.js        riconoscimento delle schede doppie
│   └── test-*.js                 test automatici (node --test)
├── .github/workflows/            deploy, scraping e keep-alive
├── CLAUDE.md                     note di lavoro per chi sviluppa con Claude Code
└── requirements.txt              dipendenze Python degli scraper
```

---

## Da dove arrivano i dati

| Fonte | Cosa fornisce | Come |
|---|---|---|
| **Risultati federali FCI** | risultati e calendario della stagione | `scraper/fci_complete_scraper.py`, ogni 30 minuti da marzo a ottobre |
| **ciclismo.info** | archivio storico dal 2007, foto e racconti delle gare | importatori `server/ciclismo-*.js`; circa 50 schede al giorno per IP |
| **ProCyclingStats** | carriere dei professionisti, squadre, Mondiali ed Europei | script locali (`server/pcs-*.js`, `scripts/pcs_archivio.js`), perché i server vengono bloccati |
| **YouTube e social** | video e profili delle squadre | `server/youtube-scraper.js` e strumenti admin |
| **Correzioni manuali** | squadre, omonimi, titoli, gare aggiunte | pannello admin, salvate su Supabase |

I dati derivati (almanacco, carriere, albo d'oro, titoli, medaglie) si rigenerano con gli script in `scripts/`:

```bash
python scripts/build_almanacco.py
python scripts/build_race_series.py
python scripts/build_titoli.py
python scripts/build_medaglie.py
python scripts/sync_route_pages.py     # dopo ogni modifica di index.html
```

---

## Redazione AI

Il sito ha una redazione giornalistica che scrive articoli partendo dai dati del sito.

- **Solo su richiesta.** È l'amministratore a chiedere un articolo. Il giro automatico e le proposte spontanee restano spenti.
- **Articoli disponibili:** cronaca di una gara, ritratto di un atleta, punto della settimana, bilancio di fine stagione per categoria, analisi delle squadre, e richieste libere scritte a parole.
- **Accesso agli archivi.** La Redazione può consultare:
  - la stagione in corso;
  - l'archivio storico nazionale e regionale dal 2007;
  - la storia delle squadre;
  - le carriere complete degli atleti;
  - le schede federali delle gare (solo percorso, km e orari; i contatti degli organizzatori vengono tolti);
  - il calendario, le gare professionistiche e le medaglie internazionali.
- **Tre tempi, come in una redazione vera:**
  1. *riunione*: si sceglie il genere, l'angolo della storia, gli agganci al passato e la scaletta;
  2. *scrittura*: segue una guida di stile;
  3. *revisione*: controlli automatici sui fatti, frase per frase.
- **Tutela dei minori.** Per Esordienti, Allievi e Juniores non si fanno ricerche sul web.
- **Nessuna fonte visibile.** Le fonti consultate restano interne e visibili solo all'amministratore.
- **Pubblicazione controllata.** Un articolo si pubblica solo dopo l'approvazione e si cancella solo dopo il ritiro.
- **Costi sotto controllo.** Ogni chiamata all'AI viene registrata, con un limite di spesa mensile.

Il codice sta in `server/redazione.js`, con `redazione-dati.js` (dati e controlli) e `redazione-archivio.js` (archivi storici). Il pannello è in `redazione.js` e la vista 3D in `palazzo.js`.

---

## Sviluppo in locale

### Frontend
È un sito statico: basta servire la cartella principale con un server qualsiasi.

```bash
python -m http.server 8080
```

### Backend
```bash
cd server
npm install
node server.js
```

Le variabili d'ambiente (database, chiavi delle API, email, Google) vanno in `server/.env.local`, che non viene mai salvato nel repository. Senza `DATABASE_URL` il server parte sulla porta 8002 con funzioni ridotte. `server/local-proxy.js` permette di provare il sito in locale usando i dati di produzione.

### Scraper
```bash
pip install -r requirements.txt
python -m playwright install chromium
python scraper/fci_complete_scraper.py
```

### Test
```bash
cd server
node --test test-redazione-dati.js test-redazione-archivio.js test-redazione-ricerca.js test-redazione-stati.js test-rete-sicura.js
```

---

## Pubblicazione

Ogni push su `main` fa partire `.github/workflows/deploy.yml`, che:
1. avvia il deploy del backend su Render (il servizio si riavvia in 1-3 minuti);
2. svuota la cache di Cloudflare.

Il frontend viene pubblicato con GitHub Pages sul dominio indicato in `CNAME`.

**Prima di ogni rilascio che tocca il frontend:**
- aumentare `?v=NNN` degli script in tutte le pagine html, compresa la lista del caricatore in `index.html`;
- aumentare `CACHE_NAME` in `sw.js`.

Senza questi due passaggi i visitatori possono restare a lungo sulla versione vecchia.

### Automazioni

| Workflow | Quando | Cosa fa |
|---|---|---|
| `deploy.yml` | a ogni push su `main` | deploy su Render e pulizia della cache Cloudflare |
| `scrape.yml` | ogni 30 minuti, marzo-ottobre | risultati e classifiche dalla FCI |
| `keepalive.yml` | ogni 10 minuti | tiene sveglio Render e avvia le sincronizzazioni programmate |

Le chiavi (Render, Cloudflare, Supabase, Anthropic, Brevo, Instagram) stanno solo nei secret di GitHub e di Render.

---

## Note tecniche

- **Pagine FCI:** codifica `ISO-8859-1`; il numero di posizione sta nel `<th>`; i nomi con apostrofo si leggono dagli attributi `data-nome` e `data-cognome`; due secondi di attesa tra una richiesta e l'altra.
- **Omonimi:** la scheda con l'id semplice appartiene alla persona più recente; le altre hanno l'anno di nascita in coda (`ID_AAAA`). Le verifiche si fanno dal pannello admin.
- **Storico squadre:** i collegamenti tra un nome e l'altro (`team_lineage`) si confermano uno per uno dall'amministratore.
- **Carriera dilettante e professionista:** si distinguono in base alla classificazione della gara (UCI WorldTour, HC, Pro), non in base alla squadra.
- **Limiti dei siti esterni:** vanno rispettati, senza aggirarli.

---

*ICS — Italia Cycling Stats · progetto indipendente di appassionati di ciclismo*
