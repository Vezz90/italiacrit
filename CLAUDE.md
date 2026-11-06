# italiacyclingstats.com (progetto italiacrit)

Risultati, classifiche e statistiche del ciclismo giovanile e dilettanti italiano. Il proprietario è l'admin del sito: **rispondere sempre in italiano**.

## Come è fatto
- **Frontend statico** (GitHub Pages + Cloudflare): `index.html` + `app.js` (~36.000 righe, una SPA con router a hash) + script collegati (`home.js`, `risultati.js`, `almanacco.js`, `carriere.js`, `titoli.js`, `redazione.js`…). Altre pagine html nella radice e `statistiche/regione/*.html` sono copie generate da `scripts/sync_route_pages.py`.
- **Backend** `server/server.js` (Express, ~760 KB) su Render, con Supabase. Si avvia in locale con `node server.js` dalla cartella `server/` (porta 8002 senza `DATABASE_URL`).
- **Dati**: `data/*.json` (serviti dal sito) + tabelle Supabase (`ciclismo_athletes`, `ciclismo_results`, `pcs_*`, `entity_overrides`, `manual_athletes`, `kv_store`…).
- **Rilascio**: ogni push su `main` fa partire il deploy di Render e svuota la cache Cloudflare (`.github/workflows/deploy.yml`).

## Due cartelle di lavoro (non confonderle)
- `scratch/ic-fix`: checkout per modificare, committare e pushare. Senza `node_modules` né `.env.local`.
- `scratch/italiacrit`: checkout con `server/.env.local` e `node_modules`, usato solo per provare in locale. Un'attività pianificata di Windows (`italiacrit-auto-sync`, script `auto-sync.ps1`) fa **commit e push automatici ogni 30 minuti** di tutto ciò che trova lì: non lasciarci file temporanei né modifiche a metà, e rimettere tutto a posto dopo ogni prova.

## Regole da non dimenticare
1. **A ogni modifica del frontend** aumentare `app.js?v=NNN` in tutte le pagine html (compreso il caricatore degli script in `index.html`) **e** `CACHE_NAME` in `sw.js`. Senza, i visitatori possono restare bloccati a lungo sul vecchio `app.js`. Se cambia `index.html`, rigenerare con `sync_route_pages.py` le pagine derivate.
2. `logo.png` resta per `og:image` e per la grafica di condivisione; navbar, loader e login usano `assets/logo-nav.png`.
3. Google Accedi e Google Traduci si caricano su richiesta (`_loadGsi`, `_loadGoogleTranslate` in `app.js`): non rimetterli nell'html.
4. **Omonimi**: l'id semplice va alla persona più recente; gli altri sono `ID_AAAA` (anno di nascita) e non si fondono né si ridividono mai negli script. Differenza di anno ≤1 = stessa persona. La verifica e la separazione si fanno dal pannello admin, sezione "Omonimi" (`server/omonimi-analisi.js`).
5. **Albo d'oro**: serie precalcolate da `scripts/build_race_series.py` in `data/albo/`, divise per categoria e sesso. Le fusioni decise a mano stanno in `kv_store` chiave `albo_manual` (con copia `albo_manual_backup_*`). In dubbio non fondere.
6. **Squadre**: i collegamenti storici stanno in `team_lineage`, da confermare uno a uno dal pannello "Storico Team".
7. Non aggirare i limiti dei siti esterni: ciclismo.info permette circa 50 schede al giorno per IP, ProCyclingStats blocca gli IP.
8. Nessun segreto nel repo: le chiavi stanno in `server/.env.local` (mai da leggere o stampare) e nei secret di GitHub/Render.

## Dove cercare nel codice
Le sezioni hanno un'intestazione `// ── Titolo ──`: `grep -n '^// ── ' app.js` (183 sezioni) o `server/server.js` (58).
- `app.js`, righe indicative: costanti 9; home e hub 5488; classifica 10950; **pannello admin** `renderAdmin` 12451 (sezioni elencate in `ADMIN_SECTIONS`); video 14585; profili atleta 17056; media e foto 22637-30565; statistiche 27518; Accedi con Google 33487; carosello Instagram 32901.
- `server/server.js`: email 29; Open Graph 763; titoli campione 2984; foto gara 3510; video 4060; profili media 9687; Instagram 10586 e 12850.
- Importatori e script una tantum: `server/*.js` (86 file, molti usati una volta sola) e `scripts/`.

## Prove in locale
Il server locale in `scratch/italiacrit/server` risponde su 8002 con i dati reali. Il browser incorporato basta per le prove; non lasciare token o dati di prova nel browser.
