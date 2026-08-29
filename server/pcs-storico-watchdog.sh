#!/bin/bash
# Watchdog per pcs-athlete-import-storico.js — lo rilancia da solo se il
# processo muore (crash, timeout DB, ecc.) invece di restare fermo finché
# qualcuno non se ne accorge e lo riavvia a mano. Riprendibile per natura
# (--skip-complete + i marcatori pcs_slug/pcs_not_found persistiti su
# Supabase), quindi un riavvio non perde mai il lavoro già fatto.
#
# Si ferma da solo quando lo script segnala "0 da processare" (tutto fatto),
# invece di continuare a rilanciarlo all'infinito per niente.
#
# Uso: ./pcs-storico-watchdog.sh   (da dentro server/, in background)

cd "$(dirname "$0")"
LOG=pcs_storico_full.log

while true; do
  echo "--- avvio $(date '+%Y-%m-%d %H:%M:%S') ---" >> "$LOG"
  node pcs-athlete-import-storico.js --skip-complete >> "$LOG" 2>&1
  code=$?
  echo "--- uscito con codice $code alle $(date '+%Y-%m-%d %H:%M:%S') ---" >> "$LOG"

  if grep -q "Dopo --skip-complete: 0 da processare" "$LOG"; then
    echo "--- tutto fatto (0 da processare), watchdog si ferma ---" >> "$LOG"
    break
  fi

  sleep 10
done
