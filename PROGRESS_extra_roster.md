# Stato lavoro — Import roster 2026 (extra_roster.json)

## Decisioni utente
- Scope: **tutti i team** (inclusi giovanili → MINORENNI: importare SOLO nome+cognome, niente foto/date)
- Metodo: **file committato** `data/extra_roster.json` (sopravvive alle sync del bot)
- Rispondere SEMPRE in italiano.

## FATTO e committato (commit b53551d e precedenti già pushati)
1. Tasto modifica foto (matita) quando foto presente — app.js photoAreaHtml. ✅ pushato
2. Editor ritaglio foto (zoom+drag) — _openPhotoCropper/_uploadPhotoBlob + CSS .crop-* ✅ pushato
3. Login atleta che si lega a team: ESISTE GIÀ (ruolo "atleta" → dashboard "Collega il tuo profilo atleta", cerca cognome, eredita team). Spiegato all'utente.

## FATTO ma NON ancora committato (in working tree, app.js)
- loadAll(): aggiunto `extraRoster` in Promise.all (fetch `data/extra_roster.json`)
- loadAll(): blocco merge PRIMA di "Converti Set in array" (~riga 1491): crea team se manca, aggiunge atleti con punti_totali 0, flag `roster_only:true`, NON sovrascrive esistenti. atleta_id = slug(cognome+' '+nome).toUpperCase()
- node --check app.js = OK
- renderTeam (10254) e renderAtleta (9706) gestiscono già atleti 0-punti → ok

## DA FARE (riprendere qui)
1. Creare `data/extra_roster.json`. Formato:
   ```json
   { "TEAM_ID": { "nome":"Nome Team", "atleti":[ {"nome":"Marco","cognome":"Rossi","categoria":"Elite","genere":"M"} ] } }
   ```
   - Team ID es: BARDIANI_CSF_7_SABER (vedi data/teams.json chiavi)
   - PCS url `bardiani-csf-faizane-2026` NON disponibile. Provare procyclingstats team page senza anno, o firstcycling, o sito ufficiale. Verificare che sia roster 2026.
2. Aggiungere a `.gitignore` l'eccezione: `!data/extra_roster.json`
3. Bump: index.html app.js?v=271 (attuale 270), sw.js CACHE v67 (attuale v66)
4. node --check, commit, `git pull --rebase origin main`, `git push origin main` (push come comando SEPARATO o nella stessa riga con && — ha funzionato con &&)
5. Per giovanili/minorenni: importare solo nome+cognome. Non scrapare foto né date di nascita.

## Note tecniche ricorrenti
- Cartella git: cd /c/Users/vezza/.gemini/antigravity/scratch/italiacrit (i comandi Bash partono da gpx-viewer, serve cd)
- Versioni attuali: app.js?v=270, design.css?v=119, sw v66
- Commit msg: Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
- entity_socials.json pattern già usato per merge statico (getEntityOverrides)
