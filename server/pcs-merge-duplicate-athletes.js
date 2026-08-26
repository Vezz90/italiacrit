'use strict';
// Unisce profili PCS duplicati per la stessa persona reale (stesso corridore,
// atleta_id diverso per come lo scraper ha spezzato un cognome composto o
// gestito un carattere accentato in giri diversi) — trovato confrontando
// nome+gara+posizione+data su pcs_results (vedi sessione 26/08). Tiene come
// canonico il profilo con più gare già registrate, sposta tutte le righe
// dell'altro lì (saltando quelle già presenti per evitare conflitti sul
// vincolo atleta_id+season+pcs_race_slug), poi elimina il profilo vuoto.
//
// Uso: node pcs-merge-duplicate-athletes.js [--dry-run]

const path = require('path');
(function loadEnv() {
  const fs = require('fs');
  const p = path.join(__dirname, '.env.local');
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const SUPABASE_URL = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const DRY_RUN = process.argv.includes('--dry-run');

// Coppie confermate (nome+gara+posizione+data coincidenti) — le coppie
// "falso positivo" (compagni di squadra reali in un crono a squadre estero,
// cognome condiviso per caso) sono già escluse.
const PAIRS = [
  ['AYALA_ARELLANO_EDUARD_EMANUEL', 'AYALA_EDUARD_EMANUEL'],
  ['BANI_DESIRE', 'BANI_DESIREE'],
  ['BLASI_CAIROL_PAULA', 'BLASI_PAULA'],
  ['BRAVO_HENRIQUE', 'RIBEIRO_BRAVO_HENRIQUE'],
  ['CANCHON_GIL_JUAN_ESTEBAN', 'CANCHON_JUAN_ESTEBAN'],
  ['CHYZHYKOV_HEORHII', 'CHYZHYKOV_HMORHII'],
  ['COATES_BEN', 'COATES_BENJAMIN'],
  ['COSTA_STARICCO_GIULIA', 'COSTA_STARRICO_GIULIA'],
  ['CUBILLAS_JAVIER', 'CUBILLAS_SALVADOR_JAVIER'],
  ['DOMINGUEZ_NEIRA_ALEJANDRA', 'NEIRA_ALEJANDRA'],
  ['ESTUPINAN_KEVIN_ANDRES', 'ESTUPINAN_VARGAS_KEVIN'],
  ['FARAZ_KHATIEB', 'KHATIEB_FARAZ'],
  ['FERNANDEZ_JORGE', 'FERNANDEZ_RUIZ_JORGE_LUIS'],
  ['HERNANDEZ_JAN', 'HERNANDEZ_REILHE_JAN'],
  ['HINOJOSA_CRUZ_ROMINA', 'HINOJOSA_ROMINA'],
  ['IAKOVLEV_MATVEI', 'IAKOVLEV_MATVEL'],
  ['KUNTARIC_VANJA', 'KUNTARIC_ZIBERT_VANJA'],
  ['LOVER_MEDEOT_TOMAZ', 'MEDEOT_TOMAZ'],
  ['MAJNIC_MAKS', 'MAJNIK_MAKS'],
  ['MARTINEZ_AITOR', 'MARTINEZ_GROSET_AITOR'],
  ['MILAKI_ARGIRO', 'MILAKI_ARGYRO'],
  ['MISHANKOV_MAKSIM', 'MISHANKOV_MAXIM'],
  ['MORENO_DANIEL', 'MORENO_GARCIA_DANIEL_SANTIAGO'],
  ['NIEWIADOMA_KASIA', 'NIEWIADOMA_KATARZYNA'],
  ['NOVAL_BENJAMIN', 'NOVAL_SUAREZ_BENJAMIN'],
  ['NOVOLODSKAIA_ANGELINA', 'NOVOLODSKAYA_ANGELINA'],
  ['ORHOLM_L_NSETH_SINDRE', 'ORHOLM_LONSETH_SIND'],
  ['PARETA_ROGER', 'PARETA_SALA_ROGER'],
  ['PENALVER_ANIORTE_MANUEL', 'PENALVER_MANUEL'],
  ['POLIUSHKO_OLEKSANDER', 'POLIUSHKO_OLEKSANDR'],
  ['POSADA_FRANCO_JOSE_MANUEL', 'POSADA_JOSE_MANUEL'],
  ['PRIETO_DE_LUNA_JOSE_JUAN', 'PRIETO_JOSE_JUAN'],
  ['PROSANDEEV_IAROSLAV', 'PROSANDEEV_YAROSLAV'],
  ['RAMIREZ_MATEO', 'RAMIREZ_TORRES_MATEO_PABLO'],
  ['RESTREPO_LOAIZA_OSCAR_IVAN', 'RESTREPO_OSCAR_IVAN'],
  ['RICCADONA_EDOARDO', 'RICCADONNA_EDOARDO'],
  ['RODRIGUEZ_DELGADO_JOSE_EMILIO', 'RODRIGUEZ_JOSE_EMILIO'],
  ['ROJAS_NARANJO_VICENTE_RODRIGO_ANTONIO', 'ROJAS_VICENTE'],
  ['RUBIO_EDWIN_FABIAN', 'RUBIO_SIERRA_EDWIN_FABIAN'],
  ['SANTIAGO_GARCIA_RICARDO', 'SANTIAGO_RICARDO'],
  ['SHANNON_HARRISON', 'SHANNON_HARRY'],
  ['SHTIN_VALERII', 'SHTIN_VALERY'],
  ['SOTO_ALEJANDRO', 'SOTO_CERVANTES_ALEJANDRO'],
  ['TAKACS_ZSOMBOR', 'TAKACS_ZSOMBOR_TAMAS'],
  ['UMBA_LOPEZ_ABNER_SANTIAGO', 'UMBA_SANTIAGO'],
  ['VAN_DEN_WIJNGAERT_MATTEO', 'VANDEN_WIJNGAERT_MATTEO'],
  ['VESHNIAKOV_DANIIL', 'VESHNYAKOV_DANIIL'],
  ['W_ODARCZYK_DOMINIKA', 'WLODARCZYK_DOMINIKA'],
  ['WIGGINS_BEN', 'WIGGINS_MICHEAL_BEN'],
  ['ZAMUDIO_GARCIA_MAYTE', 'ZAMUDIO_MAYTE'],
  ['ZAMUDIO_GIANLUIGI', 'ZAMUDIO_PEREZ_GIANLUIGI'],
  ['ZOZULIA_ANDRII', 'ZOZULIA_ANDRIY'],
];

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET, { realtime: { transport: ws } });

  let merged = 0, moved = 0, deleted = 0, skippedConflict = 0;

  for (const [a, b] of PAIRS) {
    const [ra, rb] = await Promise.all([
      sb.from('pcs_results').select('id, season, pcs_race_slug').eq('atleta_id', a),
      sb.from('pcs_results').select('id, season, pcs_race_slug').eq('atleta_id', b),
    ]);
    if (ra.error || rb.error) { console.error(`✗ ${a}/${b}: ${ra.error?.message || rb.error?.message}`); continue; }
    const rowsA = ra.data || [], rowsB = rb.data || [];
    if (!rowsA.length && !rowsB.length) { console.log(`- ${a} / ${b}: nessuna riga, salto`); continue; }

    const [keepId, dropId, keepRows, dropRows] = rowsA.length >= rowsB.length
      ? [a, b, rowsA, rowsB] : [b, a, rowsB, rowsA];
    const keepKeys = new Set(keepRows.map(r => `${r.season}|${r.pcs_race_slug}`));

    console.log(`${dropId} → ${keepId} (${keepRows.length} vs ${dropRows.length} righe)`);
    merged++;
    if (DRY_RUN) continue;

    for (const row of dropRows) {
      const key = `${row.season}|${row.pcs_race_slug}`;
      if (keepKeys.has(key)) {
        // già presente sul canonico per la stessa gara/stagione: elimina il doppione
        const { error } = await sb.from('pcs_results').delete().eq('id', row.id);
        if (error) console.error(`  ✗ delete id=${row.id}: ${error.message}`); else { deleted++; skippedConflict++; }
      } else {
        const { error } = await sb.from('pcs_results').update({ atleta_id: keepId }).eq('id', row.id);
        if (error) console.error(`  ✗ update id=${row.id}: ${error.message}`); else moved++;
      }
    }
  }

  console.log(`\n=== ${DRY_RUN ? 'Simulazione' : 'Completato'} ===`);
  console.log(`Coppie unite: ${merged}`);
  console.log(`Righe spostate: ${moved}`);
  console.log(`Righe doppione eliminate (già presenti sul canonico): ${deleted}`);
})();
