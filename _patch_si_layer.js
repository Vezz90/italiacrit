#!/usr/bin/env node
/**
 * Sports Intelligence Layer patch
 */
const fs = require('fs');
const path = require('path');

const appFile  = path.join(__dirname, 'app.js');
const siFuncs  = fs.readFileSync(path.join(__dirname, '_si_functions.js'), 'utf8');
let src = fs.readFileSync(appFile, 'utf8');

let ok = 0, fail = 0;
function replace(tag, oldStr, newStr) {
  if (src.includes(oldStr)) { src = src.replace(oldStr, newStr); console.log('✓', tag); ok++; }
  else { console.error('✗', tag, '— marker not found'); fail++; }
}

// ── 1. Insert new SI functions before "// ── HOME" ─────────────
const HOME_MARKER = '// ── HOME ──────────────────────────────────────────────────────';
replace('SI functions', HOME_MARKER, siFuncs + '\n' + HOME_MARKER);

// ── 2. Homepage — rivalry-finder powered versus + newsroom feed ─

replace('versus-section',
  `  // ── 3. SFIDA DELLA SETTIMANA ──────────────────────────────────
  const vsIdx = allRankings[1]?.length >= 2 ? 1 : (allRankings[0]?.length >= 2 ? 0 : -1);
  const vsRk = vsIdx >= 0 ? allRankings[vsIdx] : null;
  const vsCode = vsIdx >= 0 ? catOrder[vsIdx] : '';
  const vsA = vsRk?.[0], vsB = vsRk?.[1];
  const versusHtml = (vsA && vsB) ? \`<section class="em-versus">
    <div class="em-versus-label">⚔ SFIDA DELLA SETTIMANA · \${catLabel(vsCode)}</div>
    <div class="em-versus-ring">
      <div class="em-vs-side em-vs-a">
        <div class="em-vs-pos">1°</div>
        <a href="#/atleta/\${encodeURIComponent(vsA.atleta_id)}" class="em-vs-name">\${esc(vsA.cognome)}<br><small>\${esc(vsA.nome)}</small></a>
        <div class="em-vs-pts">\${vsA.punti} <span>pt</span></div>
        <div class="em-vs-team">\${esc(vsA.team_attuale||vsA.team||'')}</div>
      </div>
      <div class="em-vs-center">
        <div class="em-vs-vs">VS</div>
        <div class="em-vs-gap">+\${vsA.punti - vsB.punti} pt</div>
      </div>
      <div class="em-vs-side em-vs-b">
        <div class="em-vs-pos">2°</div>
        <a href="#/atleta/\${encodeURIComponent(vsB.atleta_id)}" class="em-vs-name">\${esc(vsB.cognome)}<br><small>\${esc(vsB.nome)}</small></a>
        <div class="em-vs-pts">\${vsB.punti} <span>pt</span></div>
        <div class="em-vs-team">\${esc(vsB.team_attuale||vsB.team||'')}</div>
      </div>
    </div>
  </section>\` : '';`,

  `  // ── 3. RIVALITÀ + NEWSROOM ───────────────────────────────────
  // Use actual encounter data for rivalry card
  const rivalries = siRivalryFinder(resultsRaw);
  const rv = rivalries[0];
  const vsIdx = allRankings[1]?.length >= 2 ? 1 : (allRankings[0]?.length >= 2 ? 0 : -1);
  const vsRk = vsIdx >= 0 ? allRankings[vsIdx] : null;
  const vsCode = vsIdx >= 0 ? catOrder[vsIdx] : '';
  const vsA = vsRk?.[0], vsB = vsRk?.[1];

  const makeVsSide = (id, cog, nom, team, winsLabel, extraClass) =>
    '<div class="em-vs-side ' + (extraClass||'') + '">' +
    '<div class="em-vs-pos">' + winsLabel + '</div>' +
    '<a href="#/atleta/' + encodeURIComponent(id) + '" class="em-vs-name">' + esc(cog) + '<br><small>' + esc(nom) + '</small></a>' +
    '<div class="em-vs-team">' + esc(team||'') + '</div></div>';

  const versusHtml = rv
    ? '<section class="em-versus">' +
        '<div class="em-versus-label">⚔ RIVALITÀ DI STAGIONE · ' + catLabel(rv.code) + ' · ' + rv.encounters + ' scontri diretti</div>' +
        '<div class="em-versus-ring">' +
          makeVsSide(rv.aId, rv.aCog, rv.aNom, rv.aTeam, rv.aWins + 'V', 'em-vs-a') +
          '<div class="em-vs-center"><div class="em-vs-vs">VS</div><div class="em-vs-gap">' + rv.encounters + ' sfide</div>' +
          '<div style="font-size:0.6rem;color:rgba(255,255,255,0.4);margin-top:4px">HEAD TO HEAD</div></div>' +
          makeVsSide(rv.bId, rv.bCog, rv.bNom, rv.bTeam, rv.bWins + 'V', 'em-vs-b') +
        '</div></section>'
    : (vsA && vsB)
      ? '<section class="em-versus">' +
          '<div class="em-versus-label">⚔ SFIDA IN CLASSIFICA · ' + catLabel(vsCode) + '</div>' +
          '<div class="em-versus-ring">' +
            '<div class="em-vs-side em-vs-a"><div class="em-vs-pos">1°</div>' +
            '<a href="#/atleta/' + encodeURIComponent(vsA.atleta_id) + '" class="em-vs-name">' + esc(vsA.cognome) + '<br><small>' + esc(vsA.nome) + '</small></a>' +
            '<div class="em-vs-pts">' + vsA.punti + ' <span>pt</span></div>' +
            '<div class="em-vs-team">' + esc(vsA.team_attuale||vsA.team||'') + '</div></div>' +
            '<div class="em-vs-center"><div class="em-vs-vs">VS</div><div class="em-vs-gap">+' + (vsA.punti - vsB.punti) + ' pt</div></div>' +
            '<div class="em-vs-side em-vs-b"><div class="em-vs-pos">2°</div>' +
            '<a href="#/atleta/' + encodeURIComponent(vsB.atleta_id) + '" class="em-vs-name">' + esc(vsB.cognome) + '<br><small>' + esc(vsB.nome) + '</small></a>' +
            '<div class="em-vs-pts">' + vsB.punti + ' <span>pt</span></div>' +
            '<div class="em-vs-team">' + esc(vsB.team_attuale||vsB.team||'') + '</div></div>' +
          '</div></section>'
      : '';

  // Newsroom feed
  const newsroomItems = siNewsroomFeed(resultsRaw, allRankings, catOrder, topScalatori, teamDom);
  const newsroomHtml = newsroomItems.length
    ? '<section class="em-newsroom">' +
        '<div class="em-newsroom-header">' +
          '<span class="em-newsroom-badge">📡 COSA STA SUCCEDENDO</span>' +
          '<a href="#/risultati" class="em-newsroom-all">Tutti i risultati →</a>' +
        '</div>' +
        '<div class="em-newsroom-feed">' +
          newsroomItems.map(function(item) {
            const clickAttr = item.atleta_id ? ' onclick="location.hash=\'#/atleta/' + item.atleta_id + '\'"'
              : item.team_id ? ' onclick="location.hash=\'#/team/' + item.team_id + '\'"' : '';
            return '<div class="em-news-item em-news-' + item.type + '"' + clickAttr + '>' +
              '<span class="em-news-icon">' + item.icon + '</span>' +
              '<div class="em-news-text">' + item.text + '</div>' +
              ((item.atleta_id || item.team_id) ? '<span class="em-news-arrow">→</span>' : '') +
            '</div>';
          }).join('') +
        '</div></section>'
    : '';`
);

// Update setPage assembly to include newsroomHtml
replace('home-assemble',
  `  // ══ ASSEMBLE ═════════════════════════════════════════════════
  setPage(\`
    \${heroHtml}
    \${spotlightHtml}
    \${emBandHtml}
    \${versusHtml}
    \${volandoHtml}
    \${upcomingHtml}
  \`);`,
  `  // ══ ASSEMBLE ═════════════════════════════════════════════════
  setPage(
    heroHtml +
    spotlightHtml +
    newsroomHtml +
    emBandHtml +
    versusHtml +
    volandoHtml +
    upcomingHtml
  );`
);

// ── 3. Risultati — race narrative per card ──────────────────────
replace('risultati-narrative',
  `          <div class="hero-label" style="font-size:0.6rem">RISULTATI GARA</div>
            <div class="hero-race-name"><a href="#/gara/\${esc(race.id)}">\${esc(race.nome)}</a></div>`,
  `          <div class="hero-label" style="font-size:0.6rem">RISULTATI GARA</div>
            <div class="hero-race-name"><a href="#/gara/\${esc(race.id)}">\${esc(race.nome)}</a></div>
            \${(function(){ const firstCatId=(Object.values(race.byCategory||{})[0]||{}).gara_id||race.id; const narr=siRaceNarrative(firstCatId,resultsRaw); return narr?'<div class="ris-race-narrative">'+narr+'</div>':''; })()}`
);

// ── 4. Classifica — intelligence strip below pg-header ──────────
replace('classifica-intel',
  `  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">🏆 CLASSIFICA UFFICIALE</div>
      <h1 class="pg-title">CLASSIFICHE</h1>
    </div>

    <div class="ranking-controls">`,
  `  // Intelligence strip
  const _rkLastDate = globalData.resultsRaw.reduce((mx,r) => (r.data||'')>mx?r.data:mx, '');
  const _rk28cut = (() => { const d=new Date(_rkLastDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const _rkTeamDom = siTeamDominance(globalData.resultsRaw, currentCats, _rk28cut);
  const _rkWin28 = {};
  for (const r of globalData.resultsRaw.filter(x => x.data >= _rk28cut && x.posizione === 1)) {
    const code = getRankingFileCode(r); if (!code || !currentCats.includes(code)) continue;
    const k = r.atleta_id;
    if (!_rkWin28[k]) _rkWin28[k] = { atleta_id:k, cognome:r.cognome, nome:r.nome, code, wins:0 };
    _rkWin28[k].wins++;
  }
  const _rkTopWinner = Object.values(_rkWin28).sort((a,b) => b.wins-a.wins)[0] || null;
  const _rkTopDom    = Object.values(_rkTeamDom).sort((a,b) => b.wins-a.wins)[0] || null;
  const _rkIntelHtml = (_rkTopWinner || _rkTopDom)
    ? '<div class="rk-intel-strip">' +
        (_rkTopWinner
          ? '<div class="rk-intel-chip" onclick="location.hash=\'#/atleta/' + encodeURIComponent(_rkTopWinner.atleta_id) + '\'">' +
              '<span class="rk-intel-icon">🔥</span>' +
              '<div><div class="rk-intel-label">RIDER ON FIRE</div>' +
              '<div class="rk-intel-val">' + esc(_rkTopWinner.cognome) + ' — ' + _rkTopWinner.wins + ' vittorie in 28gg</div></div></div>'
          : '') +
        (_rkTopDom
          ? '<div class="rk-intel-chip" onclick="location.hash=\'#/team/' + encodeURIComponent(_rkTopDom.team_id) + '\'">' +
              '<span class="rk-intel-icon">🏆</span>' +
              '<div><div class="rk-intel-label">TEAM DOMINANTE</div>' +
              '<div class="rk-intel-val">' + esc(_rkTopDom.team) + ' — ' + _rkTopDom.wins + ' vitt · ' + catLabel(_rkTopDom.code) + '</div></div></div>'
          : '') +
      '</div>'
    : '';

  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">🏆 CLASSIFICA UFFICIALE</div>
      <h1 class="pg-title">CLASSIFICHE</h1>
    </div>
    \${_rkIntelHtml}

    <div class="ranking-controls">`
);

// ── 5. Atleta — story badge above SI panel ──────────────────────
replace('atleta-story-badge',
  `  const aiRivals = siRivals(atleta_id, _siRaw, rCode);

  const siIntelPanelHtml = \`<div class="si-intel-panel">`,
  `  const aiRivals = siRivals(atleta_id, _siRaw, rCode);
  const _aiStory = siAthleteStory(atleta_id, _siRaw);

  const siIntelPanelHtml = (_aiStory ? '<div class="si-athlete-story-badge">' + _aiStory + '</div>' : '') +
    \`<div class="si-intel-panel">`
);

// ── 6. Team — narrative banner after catTabsHtml definition ─────
replace('team-narrative',
  `  const catTabsHtml = teamCats.length > 1 ? \`
    <div class="tab-group" role="tablist" style="margin-top:24px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
      \${teamCats.map(c => \`
        <button class="tab-btn \${teamViewCat===c?'active-cat':''}" onclick="setTeamDetailCat('\${c}')">\${catLabel(c)}</button>
      \`).join('')}
    </div>
  \` : '';`,
  `  const catTabsHtml = teamCats.length > 1 ? \`
    <div class="tab-group" role="tablist" style="margin-top:24px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
      \${teamCats.map(c => \`
        <button class="tab-btn \${teamViewCat===c?'active-cat':''}" onclick="setTeamDetailCat('\${c}')">\${catLabel(c)}</button>
      \`).join('')}
    </div>
  \` : '';
  const _teamNarr = siTeamNarrative(team_id, globalData.resultsRaw);
  const teamNarrHtml = _teamNarr ? '<div class="si-team-narrative">' + _teamNarr + '</div>' : '';`
);

// Insert teamNarrHtml into setPage output (first occurrence after catTabsHtml definition)
{
  const insertPoint = '    ${catTabsHtml}';
  const idx = src.indexOf(insertPoint);
  if (idx > -1) {
    src = src.slice(0, idx) + '    ${teamNarrHtml}\n' + insertPoint + src.slice(idx + insertPoint.length);
    console.log('✓ team-narrative-render'); ok++;
  } else {
    console.error('✗ team-narrative-render — ${catTabsHtml} not found'); fail++;
  }
}

// ── 7. Calendario — upcoming hype strip ─────────────────────────
replace('calendario-hype',
  `  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">📅 STAGIONE 2025-2026</div>
      <h1 class="pg-title">CALENDARIO</h1>
    </div>
    <div class="calendar-controls">`,
  `  // Upcoming hype strip
  const _todayStr2 = new Date().toISOString().split('T')[0];
  const _nextRaces = calendar.filter(g => g.data >= _todayStr2).sort((a,b) => a.data.localeCompare(b.data)).slice(0,3);
  let _calHypeHtml = '';
  if (_nextRaces.length) {
    const _nr = _nextRaces[0];
    const _daysTo = Math.round((new Date(_nr.data) - new Date(_todayStr2)) / 86400000);
    const _daysLabel = _daysTo === 0 ? 'OGGI' : _daysTo === 1 ? 'DOMANI' : 'fra ' + _daysTo + ' giorni';
    _calHypeHtml = '<div class="cal-hype-strip">' +
      '<div class="cal-hype-race">' +
        '<div class="cal-hype-label">🏁 PROSSIMA GARA</div>' +
        '<div class="cal-hype-name">' + esc(_nr.nome) + '</div>' +
        '<div class="cal-hype-meta">' + _daysLabel +
          (_nr.regione ? ' · ' + esc(_nr.regione) : '') +
          (_nr.categoria ? ' · ' + esc(_nr.categoria) : '') +
        '</div>' +
      '</div>' +
      _nextRaces.slice(1,3).map(function(g) {
        const d2 = Math.round((new Date(g.data) - new Date(_todayStr2)) / 86400000);
        return '<div class="cal-hype-next">' +
          '<span class="cal-hype-next-days">' + d2 + 'gg</span>' +
          '<span class="cal-hype-next-name">' + esc(g.nome) + '</span>' +
          '</div>';
      }).join('') +
    '</div>';
  }

  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">📅 STAGIONE 2025-2026</div>
      <h1 class="pg-title">CALENDARIO</h1>
    </div>
    \${_calHypeHtml}
    <div class="calendar-controls">`
);

// ── 8. Comparatore — duel narrative banner ──────────────────────
replace('comparatore-duel',
  `  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">⚔ CONFRONTO ATLETI</div>
      <h1 class="pg-title">COMPARATORE</h1>
    </div>`,
  `  // Duel narrative (computed before setPage so vars are in scope)
  let _compDuelHtml = '';
  if (idA && idB && stA && stB) {
    const _rrLastDate = resultsRaw.reduce((mx,r) => (r.data||'')>mx?r.data:mx, '');
    const mA = siMomentum(idA, resultsRaw, _rrLastDate);
    const mB = siMomentum(idB, resultsRaw, _rrLastDate);
    const strkA = siStreak(idA, resultsRaw);
    const strkB = siStreak(idB, resultsRaw);
    const sharedGaraIds = new Set(resultsRaw.filter(r => r.atleta_id === idA && r.posizione).map(r => r.gara_id));
    const h2hGares = [...sharedGaraIds].filter(gid => resultsRaw.some(r => r.atleta_id === idB && r.gara_id === gid && r.posizione));
    const h2hCount = h2hGares.length;
    let aH2Hwins = 0;
    for (const gid of h2hGares) {
      const aPos = (resultsRaw.find(r => r.atleta_id===idA && r.gara_id===gid)||{}).posizione||999;
      const bPos = (resultsRaw.find(r => r.atleta_id===idB && r.gara_id===gid)||{}).posizione||999;
      if (aPos < bPos) aH2Hwins++;
    }
    const bH2Hwins = h2hCount - aH2Hwins;
    const formLeader = mA.pts14 >= mB.pts14 ? nameA : nameB;
    let _narrative = '';
    if (strkA.winStreak >= 2) _narrative = nameA + ' arriva in striscia: ' + strkA.winStreak + ' vittorie consecutive.';
    else if (strkB.winStreak >= 2) _narrative = nameB + ' arriva in striscia: ' + strkB.winStreak + ' vittorie consecutive.';
    else if (h2hCount >= 3) _narrative = (aH2Hwins > bH2Hwins ? nameA : bH2Hwins > aH2Hwins ? nameB : 'Nessuno') + ' conduce nel testa a testa: ' + Math.max(aH2Hwins,bH2Hwins) + '-' + Math.min(aH2Hwins,bH2Hwins) + ' in ' + h2hCount + ' scontri.';
    else _narrative = formLeader + ' arriva con il miglior momento degli ultimi 14 giorni.';
    _compDuelHtml =
      '<div class="comp-duel-banner">' +
        '<div class="comp-duel-vs">' +
          '<div class="comp-duel-side">' +
            '<div class="comp-duel-name">' + esc(nameA) + '</div>' +
            '<div class="comp-duel-form" style="color:' + mA.color + '">' + mA.label + '</div>' +
            (strkA.winStreak>=2 ? '<div class="comp-duel-streak">👑 ' + strkA.winStreak + ' vitt. di fila</div>' :
             strkA.podioStreak>=3 ? '<div class="comp-duel-streak">🔥 ' + strkA.podioStreak + ' podi di fila</div>' : '') +
          '</div>' +
          '<div class="comp-duel-center">' +
            '<div class="comp-duel-vs-label">VS</div>' +
            (h2hCount >= 3 ? '<div class="comp-duel-h2h">' + aH2Hwins + '-' + bH2Hwins + '<br><span>head to head</span></div>' : '') +
          '</div>' +
          '<div class="comp-duel-side comp-duel-side-b">' +
            '<div class="comp-duel-name">' + esc(nameB) + '</div>' +
            '<div class="comp-duel-form" style="color:' + mB.color + '">' + mB.label + '</div>' +
            (strkB.winStreak>=2 ? '<div class="comp-duel-streak">👑 ' + strkB.winStreak + ' vitt. di fila</div>' :
             strkB.podioStreak>=3 ? '<div class="comp-duel-streak">🔥 ' + strkB.podioStreak + ' podi di fila</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="comp-duel-narrative">💬 ' + _narrative + '</div>' +
      '</div>';
  }

  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">⚔ CONFRONTO ATLETI</div>
      <h1 class="pg-title">COMPARATORE</h1>
    </div>`
);

// Insert _compDuelHtml in comparatore output (first occurrence of comp-athlete-selector)
{
  const insertPoint = '    <div class="comp-athlete-selector">';
  const idx = src.indexOf(insertPoint);
  if (idx > -1) {
    src = src.slice(0, idx) + '    \${_compDuelHtml}\n' + insertPoint + src.slice(idx + insertPoint.length);
    console.log('✓ comparatore-duel-render'); ok++;
  } else {
    console.error('✗ comparatore-duel-render — comp-athlete-selector not found'); fail++;
  }
}

// ── 9. Statistiche — intel bar below pg-header ─────────────────
replace('statistiche-intel',
  `    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>`,
  `    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>
    <div class="stat-intel-bar">
      <div class="stat-intel-item">
        <span class="stat-intel-icon">🏆</span>
        <div><div class="stat-intel-label">GARE DISPUTATE</div><div class="stat-intel-val">\${totalRaces}</div></div>
      </div>
      <div class="stat-intel-item">
        <span class="stat-intel-icon">👤</span>
        <div><div class="stat-intel-label">ATLETI ATTIVI</div><div class="stat-intel-val">\${totalAthletes}</div></div>
      </div>
      <div class="stat-intel-item">
        <span class="stat-intel-icon">📍</span>
        <div><div class="stat-intel-label">KM PERCORSI</div><div class="stat-intel-val">\${totalKm}</div></div>
      </div>
    </div>`
);

// ── Write output ────────────────────────────────────────────────
fs.writeFileSync(appFile, src, 'utf8');
console.log('\n' + (fail === 0 ? '✅ All patches applied' : '⚠ ' + ok + ' ok, ' + fail + ' failed') + ' — app.js updated');
