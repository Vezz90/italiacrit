#!/usr/bin/env node
// _patch_intelligence.js — Sport Intelligence Layer patch script

const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, 'app.js');
const DESIGN_CSS = path.join(__dirname, 'design.css');
const INDEX_HTML = path.join(__dirname, 'index.html');

let appJs = fs.readFileSync(APP_JS, 'utf8');
let designCss = fs.readFileSync(DESIGN_CSS, 'utf8');
let indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');

const results = [];

function tryReplace(label, src, oldStr, newStr) {
  if (src.includes(oldStr)) {
    results.push(`✅ ${label}`);
    return src.replace(oldStr, newStr);
  } else {
    results.push(`⚠️  SKIPPED (not found): ${label}`);
    return src;
  }
}

// ─────────────────────────────────────────────────────────────────
// STEP 1: Insert Sport Intelligence Engine before // ── HOME
// ─────────────────────────────────────────────────────────────────

const siEngineCode = `// ── SPORT INTELLIGENCE ENGINE ──────────────────────────────

function siStreak(athleteId, resultsRaw) {
  // Count consecutive podiums from most recent result backward
  const sorted = resultsRaw
    .filter(r => r.atleta_id === athleteId && r.data && r.posizione)
    .sort((a, b) => b.data.localeCompare(a.data));
  let podioStreak = 0, winStreak = 0;
  for (const r of sorted) {
    if (r.posizione <= 3) { podioStreak++; if (r.posizione === 1) winStreak++; else if (winStreak > 0) break; }
    else break;
  }
  let wStreak = 0;
  for (const r of sorted) { if (r.posizione === 1) wStreak++; else break; }
  return { podioStreak, winStreak: wStreak };
}

function siMomentum(athleteId, resultsRaw, lastRaceDate) {
  const cut14 = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const cut28 = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const r14 = resultsRaw.filter(r => r.atleta_id === athleteId && r.data >= cut14);
  const r28 = resultsRaw.filter(r => r.atleta_id === athleteId && r.data >= cut28 && r.data < cut14);
  const pts14 = r14.reduce((s, r) => s + (r.punti_effettivi||0), 0);
  const pts28 = r28.reduce((s, r) => s + (r.punti_effettivi||0), 0);
  const gare14 = r14.length, podio14 = r14.filter(r=>r.posizione<=3).length, vittorie14 = r14.filter(r=>r.posizione===1).length;
  let label, trend, color;
  if (pts28 === 0 && pts14 > 0) { label = '🔥 In Grande Forma'; trend = 'up'; color = '#E11D48'; }
  else if (pts28 === 0) { label = '⏸ Dati insufficienti'; trend = 'neutral'; color = 'rgba(255,255,255,0.4)'; }
  else {
    const ratio = pts14 / pts28;
    if (ratio >= 1.8)      { label = '🔥 In Forma Straordinaria'; trend = 'up';      color = '#E11D48'; }
    else if (ratio >= 1.2) { label = '📈 In Crescita';             trend = 'up';      color = '#22c55e'; }
    else if (ratio >= 0.8) { label = '⚖ Stabile';                  trend = 'neutral'; color = 'rgba(255,255,255,0.5)'; }
    else if (ratio >= 0.5) { label = '📉 In Rallentamento';         trend = 'down';    color = '#f59e0b'; }
    else                   { label = '⚠ Momento Difficile';         trend = 'down';    color = '#ef4444'; }
  }
  return { label, trend, color, pts14, pts28, gare14, podio14, vittorie14 };
}

function siRivals(athleteId, resultsRaw, catCode) {
  // Find athletes who appear most in the same races as athleteId
  const myRaces = new Set(
    resultsRaw.filter(r => r.atleta_id === athleteId && (!catCode || getRankingFileCode(r) === catCode)).map(r => r.gara_id)
  );
  const counts = {};
  for (const r of resultsRaw) {
    if (r.atleta_id === athleteId || !myRaces.has(r.gara_id)) continue;
    if (catCode && getRankingFileCode(r) !== catCode) continue;
    const k = r.atleta_id;
    if (!counts[k]) counts[k] = { atleta_id:k, cognome:r.cognome, nome:r.nome, team:r.team, team_id:r.team_id, encounters:0, wins:0 };
    counts[k].encounters++;
    if (r.posizione === 1) counts[k].wins++;
  }
  return Object.values(counts).sort((a,b) => b.encounters-a.encounters).slice(0,3);
}

function siTeamDominance(resultsRaw, catOrder, cutStr) {
  // Which team has the most wins per category in the last period
  const teamWins = {};
  for (const r of resultsRaw) {
    if (!r.data || r.data < cutStr || r.posizione !== 1) continue;
    const code = getRankingFileCode(r);
    if (!code) continue;
    const k = \`\${code}|\${r.team_id}\`;
    if (!teamWins[k]) teamWins[k] = { code, team:r.team, team_id:r.team_id, wins:0, pts:0 };
    teamWins[k].wins++;
    teamWins[k].pts += r.punti_effettivi||0;
  }
  // Per category, find top team
  const result = {};
  for (const code of catOrder) {
    const top = Object.values(teamWins).filter(x=>x.code===code).sort((a,b)=>b.wins-a.wins)[0];
    if (top) result[code] = top;
  }
  return result;
}

function siCategoryCompetitiveness(resultsRaw, catOrder) {
  // For each category, compute standard deviation of winning margins (proxy for competitiveness)
  const gaps = {};
  for (const r of resultsRaw) {
    const code = getRankingFileCode(r);
    if (!code || !r.data) continue;
    if (r.posizione === 1 || r.posizione === 2) {
      if (!gaps[code]) gaps[code] = { gids:{} };
      if (!gaps[code].gids[r.gara_id]) gaps[code].gids[r.gara_id] = {};
      gaps[code].gids[r.gara_id][r.posizione] = r.punti_effettivi||0;
    }
  }
  const result = {};
  for (const code of catOrder) {
    if (!gaps[code]) continue;
    const diffs = Object.values(gaps[code].gids)
      .filter(g => g[1] && g[2])
      .map(g => g[1] - g[2]);
    if (diffs.length < 3) continue;
    const avg = diffs.reduce((s,v)=>s+v,0) / diffs.length;
    result[code] = { avgGap: Math.round(avg), races: diffs.length };
  }
  return result;
}

`;

appJs = tryReplace(
  'STEP 1: Insert SI Engine before // ── HOME',
  appJs,
  '// ── HOME ──────────────────────────────────────────────────────',
  siEngineCode + '// ── HOME ──────────────────────────────────────────────────────'
);

// ─────────────────────────────────────────────────────────────────
// STEP 2a: Replace ticker generation
// ─────────────────────────────────────────────────────────────────

const tickerOld = `  // Smart insights ticker
  const tickerItems = [];
  if (formaBest[0]) tickerItems.push(\`🔥 <strong>IN FORMA:</strong> \${formaBest[0].cognome} \${formaBest[0].nome} — \${formaBest[0].pts} pt · \${catLabel(formaBest[0].code)}\`);
  if (topTeamTicker) tickerItems.push(\`🏆 <strong>TEAM HOT:</strong> \${topTeamTicker.team} — \${topTeamTicker.pts} pt · \${topTeamTicker.vittorie} vitt. recenti\`);
  if (heroRaces[0]) { const w = heroRaces[0].results?.find(r=>r.posizione===1); if (w) tickerItems.push(\`🥇 <strong>ULTIMA VITTORIA:</strong> \${w.cognome} \${w.nome} · \${heroRaces[0].nome}\`); }
  if (topScalatori[0]) tickerItems.push(\`⬆ <strong>CHI SCALA:</strong> \${topScalatori[0].cognome} \${topScalatori[0].nome} +\${topScalatori[0].gain} pos. in \${catLabel(topScalatori[0].code)}\`);
  if (upcoming[0]) { const d = Math.round((new Date(upcoming[0].data)-new Date(todayStr))/86400000); tickerItems.push(\`📅 <strong>PROSSIMA GARA\${d===0?' OGGI':d===1?' DOMANI':''}:</strong> \${upcoming[0].nome}\`); }
  if (formaBest.length > 1) { const f = formaBest[1]; tickerItems.push(\`⬆ <strong>EMERGENTE:</strong> \${f.cognome} \${f.nome} — \${f.pts} pt · \${catLabel(f.code)}\`); }`;

const tickerNew = `  // Smart insights ticker — Sport Intelligence narratives
  window._siResultsRaw = resultsRaw;
  const trendCut28Str = (() => { const d = new Date(lastRaceDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const teamDom = siTeamDominance(resultsRaw, catOrder, trendCut28Str);
  const tickerItems = [];
  // Streaks
  if (formaBest[0]) {
    const { podioStreak, winStreak } = siStreak(formaBest[0].atleta_id, resultsRaw);
    if (winStreak >= 2) tickerItems.push(\`👑 <strong>\${formaBest[0].cognome.toUpperCase()}</strong> — \${winStreak} vittorie di fila in \${catLabel(formaBest[0].code)}\`);
    else if (podioStreak >= 3) tickerItems.push(\`🔥 <strong>\${formaBest[0].cognome.toUpperCase()}</strong> — \${podioStreak} podi consecutivi in \${catLabel(formaBest[0].code)}\`);
    else tickerItems.push(\`🔥 <strong>IN FORMA:</strong> \${formaBest[0].cognome} \${formaBest[0].nome} — \${formaBest[0].pts} pt · \${catLabel(formaBest[0].code)}\`);
  }
  for (const r of heroRaces.slice(0,3)) { const w = r.results?.find(x=>x.posizione===1); if (w) tickerItems.push(\`🥇 <strong>\${w.cognome.toUpperCase()}</strong> vince \${r.nome}\`); }
  if (topScalatori[0]) tickerItems.push(\`📈 <strong>SALE:</strong> \${topScalatori[0].cognome} \${topScalatori[0].nome} +\${topScalatori[0].gain} posizioni in \${catLabel(topScalatori[0].code)}\`);
  if (topScalatori[1]) tickerItems.push(\`📈 <strong>SALE:</strong> \${topScalatori[1].cognome} \${topScalatori[1].nome} +\${topScalatori[1].gain} posizioni in \${catLabel(topScalatori[1].code)}\`);
  const tdTop = Object.values(teamDom)[0];
  if (tdTop) tickerItems.push(\`🏆 <strong>DOMINA:</strong> \${tdTop.team} — \${tdTop.wins} vittorie in \${catLabel(tdTop.code)}\`);
  if (topTeamTicker) tickerItems.push(\`🏆 <strong>TEAM HOT:</strong> \${topTeamTicker.team} — \${topTeamTicker.pts} pt · \${topTeamTicker.vittorie} vitt.\`);
  if (upcoming[0]) { const d = Math.round((new Date(upcoming[0].data)-new Date(todayStr))/86400000); tickerItems.push(\`📅 <strong>PROSSIMA GARA\${d===0?' OGGI':d===1?' DOMANI':''}:</strong> \${upcoming[0].nome}\`); }
  if (formaBest.length > 1) { const f = formaBest[1]; const { podioStreak:ps } = siStreak(f.atleta_id, resultsRaw); tickerItems.push(ps>=2?\`🚀 <strong>EMERGENTE:</strong> \${f.cognome} \${f.nome} — \${ps} podi in \${catLabel(f.code)}\`:\`📈 <strong>EMERGENTE:</strong> \${f.cognome} \${f.nome} — \${f.pts} pt · \${catLabel(f.code)}\`); }`;

appJs = tryReplace('STEP 2a: Replace ticker generation', appJs, tickerOld, tickerNew);

// ─────────────────────────────────────────────────────────────────
// STEP 2b: Add starStreak + starMomentum after const star = formaBest[0];
// ─────────────────────────────────────────────────────────────────

appJs = tryReplace(
  'STEP 2b: Add starStreak/starMomentum after star assignment',
  appJs,
  `  const star = formaBest[0];
  const spotlightHtml = star ? \`<section class="em-spotlight">`,
  `  const star = formaBest[0];
  const starStreak = star ? siStreak(star.atleta_id, resultsRaw) : null;
  const starMomentum = star ? siMomentum(star.atleta_id, resultsRaw, lastRaceDate) : null;
  const spotlightHtml = star ? \`<section class="em-spotlight">`
);

// ─────────────────────────────────────────────────────────────────
// STEP 2c: Add streak badge inside spotlightHtml after em-spot-cat span
// ─────────────────────────────────────────────────────────────────

appJs = tryReplace(
  'STEP 2c: Add streak badge after em-spot-cat',
  appJs,
  `        <span class="em-spot-cat">\${catLabel(star.code)}</span>
      </div>`,
  `        <span class="em-spot-cat">\${catLabel(star.code)}</span>
        \${starStreak && starStreak.podioStreak >= 2 ? \`<div class="si-streak-badge">\${starStreak.winStreak>=2?'👑':'🔥'} \${starStreak.winStreak>=2?starStreak.winStreak+' vittorie':''+starStreak.podioStreak+' podi'} consecutivi</div>\` : ''}
      </div>`
);

// ─────────────────────────────────────────────────────────────────
// STEP 3: Enhance renderAtleta — insert SI panel before RISULTATI STAGIONE
// ─────────────────────────────────────────────────────────────────

// Find the unique anchor: the setPage call with headerHtml and then the section-header for RISULTATI STAGIONE
// We'll insert intelligence computations before setPage, and inject the panel in the HTML

const atletaBeforeSetPage = `  window._shareAtletaData = {cognome:a.cognome,nome:a.nome,cat:catLabel(a.categoria),team:a.team_attuale||'',punti:a.punti_totali,pos:globalPos,p1:p1,p2:p2,p3:p3,gare:top10};
  setPage(\``;

const atletaBeforeSetPageNew = `  window._shareAtletaData = {cognome:a.cognome,nome:a.nome,cat:catLabel(a.categoria),team:a.team_attuale||'',punti:a.punti_totali,pos:globalPos,p1:p1,p2:p2,p3:p3,gare:top10};

  // Sport Intelligence computations
  const { resultsRaw: _siRaw } = globalData;
  const _siLastDate = _siRaw.reduce((max, r) => (r.data||'') > max ? r.data : max, '');
  const aiStreak = siStreak(atleta_id, _siRaw);
  const aiMomentum = siMomentum(atleta_id, _siRaw, _siLastDate);
  const aiRivals = siRivals(atleta_id, _siRaw, rCode);

  const siIntelPanelHtml = \`<div class="si-intel-panel">
    <div class="si-intel-momentum" style="--si-color:\${aiMomentum.color}">
      <span class="si-intel-label">\${aiMomentum.label}</span>
      \${aiMomentum.gare14>0 ? \`<span class="si-intel-sub">\${aiMomentum.gare14} gare · \${aiMomentum.vittorie14} vitt. · \${aiMomentum.podio14} podi (ultimi 14gg)</span>\` : ''}
    </div>
    \${aiStreak.podioStreak >= 2 ? \`<div class="si-intel-streak">
      \${aiStreak.winStreak>=2?'👑':'🔥'} <strong>\${aiStreak.winStreak>=2?aiStreak.winStreak+' vittorie':aiStreak.podioStreak+' podi'} consecutivi</strong>
    </div>\` : ''}
    \${aiRivals.length>0 ? \`<div class="si-intel-rivals">
      <span class="si-intel-rivals-label">Rivali frequenti</span>
      \${aiRivals.map(r=>\`<a href="#/atleta/\${encodeURIComponent(r.atleta_id)}" class="si-rival-chip">\${esc(r.cognome)} \${esc(r.nome[0])}. <small>\${r.encounters} scontri</small></a>\`).join('')}
    </div>\` : ''}
  </div>\`;

  setPage(\``;

appJs = tryReplace('STEP 3a: Add SI computations before setPage in renderAtleta', appJs, atletaBeforeSetPage, atletaBeforeSetPageNew);

// Now inject the panel HTML before the RISULTATI STAGIONE section-header
const atletaSectionHeader = `    <div class="section-header" style="margin-top:24px">
      <span class="section-title">RISULTATI STAGIONE</span>
      <span class="section-line"></span>
    </div>`;

const atletaSectionHeaderNew = `    \${siIntelPanelHtml}
    <div class="section-header" style="margin-top:24px">
      <span class="section-title">RISULTATI STAGIONE</span>
      <span class="section-line"></span>
    </div>`;

appJs = tryReplace('STEP 3b: Inject SI panel before RISULTATI STAGIONE', appJs, atletaSectionHeader, atletaSectionHeaderNew);

// ─────────────────────────────────────────────────────────────────
// STEP 4: Enhance renderGara — add race intel before results-table-wrap
// ─────────────────────────────────────────────────────────────────

// Compute momentum for top 5 finishers and add race intel section
// We insert the SI race intel computation before window._currentGaraId = gara_id
const garaBeforeSetPage = `  window._shareGaraData = {name:name,date:fmtDate(data),cat:catLabel(cat),mult:mult,tipo:tipo,results:results.slice(0,10).map(r=>({cognome:r.cognome,nome:r.nome,team:r.team,punti_effettivi:r.punti_effettivi}))};
  window._currentGaraId = gara_id;
  setPage(\``;

const garaBeforeSetPageNew = `  window._shareGaraData = {name:name,date:fmtDate(data),cat:catLabel(cat),mult:mult,tipo:tipo,results:results.slice(0,10).map(r=>({cognome:r.cognome,nome:r.nome,team:r.team,punti_effettivi:r.punti_effettivi}))};

  // Sport Intelligence: race analysis
  const _garaLastDate = resultsRaw.reduce((max, r) => (r.data||'') > max ? r.data : max, '');
  const top5 = results.slice(0, 5);
  const participantCards = top5.map(r => {
    const mom = siMomentum(r.atleta_id, resultsRaw, _garaLastDate);
    const streak = siStreak(r.atleta_id, resultsRaw);
    const streakBadge = streak.winStreak >= 2 ? \`👑\${streak.winStreak}W\` : streak.podioStreak >= 2 ? \`🔥\${streak.podioStreak}P\` : '';
    return \`<div class="si-participant-card">
      <div class="si-participant-pos">\${r.posizione}° posto</div>
      <div class="si-participant-name"><a href="#/atleta/\${encodeURIComponent(r.atleta_id)}" style="color:inherit;text-decoration:none">\${esc(r.cognome)}<br><small style="font-weight:400">\${esc(r.nome)}</small></a></div>
      <div class="si-participant-form" style="color:\${mom.color}">\${mom.label.replace(/^[^ ]+ /,'')}\${streakBadge ? ' · '+streakBadge : ''}</div>
    </div>\`;
  }).join('');
  const siRaceIntelHtml = top5.length ? \`<div class="si-race-intel">
    <div class="si-race-intel-title">📊 ANALISI GARA — Forma dei protagonisti</div>
    <div class="si-race-participants">\${participantCards}</div>
  </div>\` : '';

  window._currentGaraId = gara_id;
  setPage(\``;

appJs = tryReplace('STEP 4a: Add race intel computation before renderGara setPage', appJs, garaBeforeSetPage, garaBeforeSetPageNew);

// Insert siRaceIntelHtml before results-table-wrap
const garaResultsWrap = `    <div class="results-table-wrap">
      <table class="results-table">`;

const garaResultsWrapNew = `    \${siRaceIntelHtml}
    <div class="results-table-wrap">
      <table class="results-table">`;

appJs = tryReplace('STEP 4b: Inject race intel HTML before results-table-wrap', appJs, garaResultsWrap, garaResultsWrapNew);

// ─────────────────────────────────────────────────────────────────
// STEP 5: Enhance renderStatistiche — add story cards after pg-header
// ─────────────────────────────────────────────────────────────────

const statsSetPageAnchor = `  let activeRegTab = 'M';
  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>

    <!-- KPI -->`;

const statsSetPageNew = `  // Sport Intelligence: season narratives
  const siWinCounts = {};
  const siPodioCounts = {};
  const siRaceCounts = {};
  const siMonthWins = {};
  const siCatRaceCounts = {};
  for (const r of resultsRaw) {
    if (!r.atleta_id || !r.data) continue;
    const id = r.atleta_id;
    siRaceCounts[id] = (siRaceCounts[id]||0) + 1;
    if (r.posizione <= 3) siPodioCounts[id] = (siPodioCounts[id]||0) + 1;
    if (r.posizione === 1) {
      siWinCounts[id] = (siWinCounts[id]||0) + 1;
      const month = r.data.slice(0,7);
      siMonthWins[month] = (siMonthWins[month]||0) + 1;
    }
    const catKey = catLabel(getRankingFileCode(r)||r.categoria)||r.categoria;
    siCatRaceCounts[catKey] = (siCatRaceCounts[catKey]||0) + 1;
  }
  // Most wins
  const siTopWinner = Object.entries(siWinCounts).sort((a,b)=>b[1]-a[1])[0];
  const siTopWinnerAtleta = siTopWinner ? athletes[siTopWinner[0]] : null;
  const siTopWinnerName = siTopWinnerAtleta ? \`\${siTopWinnerAtleta.cognome} \${siTopWinnerAtleta.nome}\` : '';
  // Most consistent (best podio %)
  const siConsistency = Object.entries(siRaceCounts)
    .filter(([id, g]) => g >= 5)
    .map(([id, g]) => ({ id, pct: Math.round(((siPodioCounts[id]||0)/g)*100), g }))
    .sort((a,b) => b.pct - a.pct)[0];
  const siConsistentAtleta = siConsistency ? athletes[siConsistency.id] : null;
  const siConsistentName = siConsistentAtleta ? \`\${siConsistentAtleta.cognome} \${siConsistentAtleta.nome}\` : '';
  // Hottest month
  const siHottestMonth = Object.entries(siMonthWins).sort((a,b)=>b[1]-a[1])[0];
  const siMonthLabel = siHottestMonth ? siHottestMonth[0].replace(/-(\d+)$/, (m,mm) => {
    const MESI = ['','GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
    return ' ' + (MESI[parseInt(mm)]||mm);
  }) : '';
  // Category with most races
  const siTopCat = Object.entries(siCatRaceCounts).sort((a,b)=>b[1]-a[1])[0];

  const siStoryCardsHtml = \`<div class="si-stories-grid">
    \${siTopWinnerName ? \`<div class="si-story-card">
      <div class="si-story-icon">👑</div>
      <div class="si-story-label">Dominatore della Stagione</div>
      <div class="si-story-value">\${esc(siTopWinnerName)}</div>
      <div class="si-story-sub">\${siTopWinner[1]} vittorie totali</div>
    </div>\` : ''}
    \${siConsistentName ? \`<div class="si-story-card">
      <div class="si-story-icon">🎯</div>
      <div class="si-story-label">Atleta più Costante</div>
      <div class="si-story-value">\${esc(siConsistentName)}</div>
      <div class="si-story-sub">\${siConsistency.pct}% podi su \${siConsistency.g} gare</div>
    </div>\` : ''}
    \${siHottestMonth ? \`<div class="si-story-card">
      <div class="si-story-icon">🔥</div>
      <div class="si-story-label">Mese più Caldo</div>
      <div class="si-story-value">\${siMonthLabel}</div>
      <div class="si-story-sub">\${siHottestMonth[1]} vittorie registrate</div>
    </div>\` : ''}
    \${siTopCat ? \`<div class="si-story-card">
      <div class="si-story-icon">📊</div>
      <div class="si-story-label">Categoria più Attiva</div>
      <div class="si-story-value" style="font-size:clamp(1rem,2.5vw,1.4rem)">\${esc(siTopCat[0])}</div>
      <div class="si-story-sub">\${siTopCat[1]} partecipazioni totali</div>
    </div>\` : ''}
  </div>\`;

  let activeRegTab = 'M';
  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>

    <!-- SPORT INTELLIGENCE NARRATIVES -->
    \${siStoryCardsHtml}

    <!-- KPI -->`;

appJs = tryReplace('STEP 5: Add season narrative story cards to renderStatistiche', appJs, statsSetPageAnchor, statsSetPageNew);

// ─────────────────────────────────────────────────────────────────
// Write app.js
// ─────────────────────────────────────────────────────────────────
fs.writeFileSync(APP_JS, appJs, 'utf8');
results.push('✅ app.js written');

// ─────────────────────────────────────────────────────────────────
// STEP 6: Append CSS to design.css
// ─────────────────────────────────────────────────────────────────

const siCSS = `
/* ═══════════════════════════════════════════════════════════════
   SPORT INTELLIGENCE LAYER — si- prefix
═══════════════════════════════════════════════════════════════ */

/* Streak badge in spotlight */
.si-streak-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(225,29,72,0.15);
  border: 1px solid rgba(225,29,72,0.3);
  color: #fca5a5;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 4px 12px;
  border-radius: 2px;
  text-transform: uppercase;
  margin-top: 8px;
}

/* Intelligence panel on athlete page */
.si-intel-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 20px clamp(16px, 3vw, 32px);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-light);
  margin-bottom: 24px;
}
.si-intel-momentum {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 16px;
  background: rgba(0,0,0,0.04);
  border-left: 3px solid var(--si-color, #E11D48);
  border-radius: 0 4px 4px 0;
  flex: 1;
  min-width: 200px;
}
[data-theme="dark"] .si-intel-momentum { background: rgba(255,255,255,0.04); }
.si-intel-label {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: 0.05em;
}
.si-intel-sub {
  font-size: 0.65rem;
  color: var(--text-muted);
  letter-spacing: 0.03em;
}
.si-intel-streak {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: rgba(225,29,72,0.06);
  border: 1px solid rgba(225,29,72,0.2);
  border-radius: 4px;
  font-size: 0.78rem;
  color: var(--text-primary);
  gap: 8px;
}
.si-intel-rivals {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 0;
}
.si-intel-rivals-label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  text-transform: uppercase;
  white-space: nowrap;
}
.si-rival-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: var(--bg-secondary, rgba(0,0,0,0.05));
  border: 1px solid var(--border-light);
  border-radius: 20px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-primary);
  text-decoration: none;
  transition: border-color 0.2s, background 0.2s;
}
.si-rival-chip:hover { border-color: #E11D48; color: #E11D48; }
.si-rival-chip small { font-size: 0.6em; color: var(--text-muted); font-weight: 400; }

/* Race intelligence section */
.si-race-intel {
  padding: 16px 0 8px;
  margin-bottom: 16px;
}
.si-race-intel-title {
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 12px;
  border-left: 3px solid #E11D48;
  padding-left: 10px;
}
.si-race-participants {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 4px;
}
.si-race-participants::-webkit-scrollbar { display: none; }
.si-participant-card {
  flex: 0 0 auto;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  min-width: 130px;
}
.si-participant-pos {
  font-size: 0.6rem;
  font-weight: 800;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.si-participant-name {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 4px 0 2px;
  line-height: 1.2;
}
.si-participant-form {
  font-size: 0.62rem;
  color: var(--text-muted);
}

/* Story cards for statistiche */
.si-stories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}
.si-story-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}
.si-story-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
.si-story-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(to right, #E11D48, transparent);
}
.si-story-icon { font-size: 1.4rem; margin-bottom: 8px; }
.si-story-label {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: #E11D48;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.si-story-value {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(1.4rem, 3vw, 2rem);
  font-weight: 900;
  color: var(--text-primary);
  line-height: 1;
  margin-bottom: 4px;
}
.si-story-sub {
  font-size: 0.7rem;
  color: var(--text-muted);
  line-height: 1.4;
}

@media (max-width: 768px) {
  .si-intel-panel { padding: 16px; }
  .si-intel-momentum { min-width: 100%; }
  .si-stories-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
}
@media (max-width: 480px) {
  .si-stories-grid { grid-template-columns: 1fr; }
}
`;

designCss += siCSS;
fs.writeFileSync(DESIGN_CSS, designCss, 'utf8');
results.push('✅ design.css — SI CSS appended');

// ─────────────────────────────────────────────────────────────────
// STEP 7: Bump versions in index.html
// ─────────────────────────────────────────────────────────────────
indexHtml = tryReplace('STEP 7a: Bump app.js v72→v73', indexHtml, 'app.js?v=72', 'app.js?v=73');
indexHtml = tryReplace('STEP 7b: Bump design.css v24→v25', indexHtml, 'design.css?v=24', 'design.css?v=25');
fs.writeFileSync(INDEX_HTML, indexHtml, 'utf8');
results.push('✅ index.html versions bumped');

// ─────────────────────────────────────────────────────────────────
// Verify
// ─────────────────────────────────────────────────────────────────
const finalApp = fs.readFileSync(APP_JS, 'utf8');
results.push('');
results.push('── Verification ──');
results.push(`siStreak present: ${finalApp.includes('function siStreak')}`);
results.push(`siMomentum present: ${finalApp.includes('function siMomentum')}`);
results.push(`siRivals present: ${finalApp.includes('function siRivals')}`);
results.push(`siTeamDominance present: ${finalApp.includes('function siTeamDominance')}`);
results.push(`SI Engine section: ${finalApp.includes('SPORT INTELLIGENCE ENGINE')}`);
results.push(`starStreak present: ${finalApp.includes('const starStreak')}`);
results.push(`siIntelPanelHtml present: ${finalApp.includes('siIntelPanelHtml')}`);
results.push(`siRaceIntelHtml present: ${finalApp.includes('siRaceIntelHtml')}`);
results.push(`siStoryCardsHtml present: ${finalApp.includes('siStoryCardsHtml')}`);
results.push(`si-streak-badge in CSS: ${designCss.includes('si-streak-badge')}`);

console.log(results.join('\n'));
