# ItaliacritResultati

> Classifiche, risultati e statistiche del ciclismo agonistico italiano su strada.
> Esordienti → Elite, Uomini & Donne. Dati da FCI — aggiornamento automatico ogni 30 minuti (mar–ott).

---

## Stack

| Layer | Tecnologia |
|---|---|
| Scraper | Python 3.11 + Playwright (Chromium headless) |
| Storage | JSON flat-file (nessun database) |
| Frontend | HTML / CSS / JS Vanilla — SPA con routing hash |
| Deploy | GitHub Pages |
| CI/CD | GitHub Actions (cron `*/30 * * 3-10 *`) |

---

## Struttura

```
italiacrit/
├── .github/workflows/scrape.yml   ← Pipeline CI/CD
├── scraper/
│   ├── main.py                    ← Orchestratore
│   ├── calendar_scraper.py        ← Calendario FCI (geo_category 1/2/3)
│   ├── results_scraper.py         ← Risultati gare (Playwright)
│   ├── points_calculator.py       ← Sistema punti + moltiplicatori
│   ├── json_builder.py            ← Scrittura JSON
│   └── seed_data.py               ← Dati demo realistici
├── data/
│   ├── meta.json                  ← Timestamp ultimo aggiornamento
│   ├── calendar.json              ← Calendario completo
│   ├── results_raw.json           ← Risultati grezzi
│   ├── athletes.json              ← Schede atleti
│   ├── teams.json                 ← Schede team
│   └── rankings/
│       ├── ES1_M.json … ELI_M.json
│       └── ES1_F.json … ELI_F.json
├── index.html                     ← SPA shell
├── style.css                      ← Design system completo
├── app.js                         ← Router hash + renderer
├── requirements.txt
└── setup.bat                      ← Setup rapido Windows
```

---

## Setup Locale (Windows)

### Prerequisiti
- Python 3.11+
- pip

### Installazione rapida
```bat
setup.bat
```

### Manuale
```bash
pip install -r requirements.txt
playwright install chromium

# Genera dati demo (senza internet / FCI)
python scraper/main.py --seed

# Scraping reale
python scraper/main.py
```

Poi apri `index.html` nel browser (file:// funziona, o usa un server locale).

---

## Sistema Punteggi

| Posizione | Punti Base |
|-----------|-----------|
| 1° | 15 |
| 2° | 12 |
| 3° | 10 |
| 4° | 8 |
| 5° | 6 |
| 6° | 5 |
| 7° | 4 |
| 8° | 3 |
| 9° | 2 |
| 10° | 1 |

**Moltiplicatori:**
- `×1` Gare regionali
- `×2` Gare nazionali / Campionati Regionali
- `×3` Gare internazionali / Campionati Italiani

---

## Note Tecniche FCI

- **Encoding**: `ISO-8859-1` — tutte le response FCI usano questo charset
- **Posizione in `<th>`**: il numero di gara è nel `<th>`, non nel `<td>`
- **Apostrofi**: letti da `data-nome` / `data-cognome` attributes
- **Rate limiting**: 2 secondi tra ogni richiesta
- **Anno corrente**: solo gare dell'anno in corso vengono elaborate

---

## Deploy su GitHub Pages

1. Crea un repository GitHub
2. Push di tutto il contenuto di `italiacrit/` nella branch `main`
3. Abilita GitHub Pages → Source: `main` / `root`
4. Aggiungi secret `GITHUB_TOKEN` (già disponibile di default)
5. La pipeline si attiva automaticamente ogni 30 minuti (mar–ott) e con `workflow_dispatch`

---

## Categorie

| Codice | Descrizione | Genere |
|--------|-------------|--------|
| ES1_M | Esordienti 1° Anno | M |
| ES2_M | Esordienti 2° Anno | M |
| AL1_M | Allievi 1° Anno | M |
| AL2_M | Allievi 2° Anno | M |
| JUN_M | Juniores | M |
| U23_M | Under 23 | M |
| ELI_M | Elite | M |
| ES1_F | Esordienti 1° Anno | F |
| ES2_F | Esordienti 2° Anno | F |
| AL1_F | Allieve 1° Anno | F |
| AL2_F | Allieve 2° Anno | F |
| JUN_F | Juniores Donne | F |
| ELI_F | Donne Elite | F |

---

*Non affiliato a FCI — Progetto indipendente*
