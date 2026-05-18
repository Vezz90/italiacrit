#!/usr/bin/env node
/**
 * Sports Intelligence Layer — patch v3 (CRLF-safe)
 */
const fs = require('fs');
const path = require('path');

const appFile = path.join(__dirname, 'app.js');
let src = fs.readFileSync(appFile, 'utf8');

// Normalize CRLF → LF so template-literal markers match
src = src.replace(/\r\n/g, '\n');

let ok = 0, fail = 0;
function replace(tag, oldStr, newStr) {
  if (src.includes(oldStr)) {
    src = src.replace(oldStr, newStr);
    console.log('✓', tag);
    ok++;
  } else {
    console.error('✗', tag, '— marker not found');
    fail++;
  }
}

// ── 1. Homepage — rivalry-finder VS block + newsroom feed ──────────
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
  const rivalries = siRivalryFinder(resultsRaw);
  const rv = rivalries[0];
  const vsIdx = allRankings[1]?.length >= 2 ? 1 : (allRankings[0]?.length >= 2 ? 0 : -1);
  const vsRk = vsIdx >= 0 ? allRankings[vsIdx] : null;
  const vsCode = vsIdx >= 0 ? catOrder[vsIdx] : '';
  const vsA = vsRk?.[0], vsB = vsRk?.[1];

  const versusHtml = rv
    ? '<section class="em-versus">' +
        '<div class="em-versus-label">⚔ RIVALITÀ DI STAGIONE · ' + catLabel(rv.code) + ' · ' + rv.encounters + ' scontri diretti</div>' +
        '<div class="em-versus-ring">' +
          '<div class="em-vs-side em-vs-a">' +
            '<div class="em-vs-pos">' + rv.aWins + 'V</div>' +
            '<a href="#/atleta/' + encodeURIComponent(rv.aId) + '" class="em-vs-name">' + esc(rv.aCog) + '<br><small>' + esc(rv.aNom) + '</small></a>' +
            '<div class="em-vs-team">' + esc(rv.aTeam||'') + '</div>' +
          '</div>' +
          '<div class="em-vs-center"><div class="em-vs-vs">VS</div><div class="em-vs-gap">' + rv.encounters + ' sfide</div>' +
          '<div style="font-size:0.6rem;color:rgba(255,255,255,0.4);margin-top:4px">HEAD TO HEAD</div></div>' +
          '<div class="em-vs-side em-vs-b">' +
            '<div class="em-vs-pos">' + rv.bWins + 'V</div>' +
            '<a href="#/atleta/' + encodeURIComponent(rv.bId) + '" class="em-vs-name">' + esc(rv.bCog) + '<br><small>' + esc(rv.bNom) + '</small></a>' +
            '<div class="em-vs-team">' + esc(rv.bTeam||'') + '</div>' +
          '</div>' +
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
            const clickAttr = item.atleta_id
              ? ' onclick="location.hash=\'#/atleta/' + item.atleta_id + '\'"'
              : item.team_id
                ? ' onclick="location.hash=\'#/team/' + item.team_id + '\'"'
                : '';
            return '<div class="em-news-item em-news-' + item.type + '"' + clickAttr + '>' +
              '<span class="em-news-icon">' + item.icon + '</span>' +
              '<div class="em-news-text">' + item.text + '</div>' +
              ((item.atleta_id || item.team_id) ? '<span class="em-news-arrow">→</span>' : '') +
            '</div>';
          }).join('') +
        '</div></section>'
    : '';`
);

// ── 2. Homepage — assemble with newsroomHtml ───────────────────────
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

// ── 3. Risultati — race narrative per card ─────────────────────────
replace('risultati-narrative',
`            <div class="hero-race-name"><a href="#/gara/\${esc(race.id)}">\${esc(race.nome)}</a></div>
            <div class="hero-race-meta" style="margin-bottom:16px;">`,
`            <div class="hero-race-name"><a href="#/gara/\${esc(race.id)}">\${esc(race.nome)}</a></div>
            \${(()=>{ const _rn=siRaceNarrative(race.id,resultsRaw); return _rn?'<div class="ris-race-narrative">'+_rn+'</div>':''; })()}
            <div class="hero-race-meta" style="margin-bottom:16px;">`
);

// ── 4. Classifica — intelligence strip ────────────────────────────
replace('classifica-intel',
`  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">🏆 CLASSIFICA UFFICIALE</div>
      <h1 class="pg-title">CLASSIFICHE</h1>
    </div>

    <div class="ranking-controls">`,
`  const _rkLastDate = globalData.resultsRaw.reduce((mx,r) => (r.data||'')>mx?r.data:mx, '');
  const _rk28cut = (()=>{ const d=new Date(_rkLastDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const _rkTeamDom = siTeamDominance(globalData.resultsRaw, currentCats, _rk28cut);
  const _rkWin28 = {};
  for (const r of globalData.resultsRaw.filter(x => x.data >= _rk28cut && x.posizione === 1)) {
    const code = getRankingFileCode(r); if (!code || !currentCats.includes(code)) continue;
    if (!_rkWin28[r.atleta_id]) _rkWin28[r.atleta_id] = { atleta_id:r.atleta_id, cognome:r.cognome, nome:r.nome, code, wins:0 };
    _rkWin28[r.atleta_id].wins++;
  }
  const _rkTopWinner = Object.values(_rkWin28).sort((a,b)=>b.wins-a.wins)[0]||null;
  const _rkTopDom    = Object.values(_rkTeamDom).sort((a,b)=>b.wins-a.wins)[0]||null;
  const _rkIntelHtml = (_rkTopWinner||_rkTopDom)
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

// ── 5. Atleta — story badge above SI panel ─────────────────────────
replace('atleta-story-badge',
`  const aiRivals = siRivals(atleta_id, _siRaw, rCode);

  const siIntelPanelHtml = \`<div class="si-intel-panel">`,
`  const aiRivals = siRivals(atleta_id, _siRaw, rCode);
  const _aiStory = siAthleteStory(atleta_id, _siRaw);

  const siIntelPanelHtml = (_aiStory ? '<div class="si-athlete-story-badge">' + _aiStory + '</div>' : '') + \`<div class="si-intel-panel">`
);

// ── 6. Team — narrative definition (definition of teamNarrHtml) ────
replace('team-narrative-def',
`  const catTabsHtml = teamCats.length > 1 ? \`
    <div class="tab-group" role="tablist" style="margin-top:24px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
      \${teamCats.map(c => \`
        <button class="tab-btn \${teamViewCat===c?'active-cat':''}" onclick="setTeamDetailCat('\${c}')">\${catLabel(c)}</button>
      \`).join('')}
    </div>
  \` : '';

  // Atleti con punti`,
`  const catTabsHtml = teamCats.length > 1 ? \`
    <div class="tab-group" role="tablist" style="margin-top:24px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
      \${teamCats.map(c => \`
        <button class="tab-btn \${teamViewCat===c?'active-cat':''}" onclick="setTeamDetailCat('\${c}')">\${catLabel(c)}</button>
      \`).join('')}
    </div>
  \` : '';
  const _teamNarr = siTeamNarrative(team_id, globalData.resultsRaw);
  const teamNarrHtml = _teamNarr ? '<div class="si-team-narrative">' + _teamNarr + '</div>' : '';

  // Atleti con punti`
);

// ── 7. Calendario — upcoming hype strip ────────────────────────────
replace('calendario-hype',
`  setPage(\`
    <div class="pg-header">
      <div class="pg-eyebrow">📅 STAGIONE 2025-2026</div>
      <h1 class="pg-title">CALENDARIO</h1>
    </div>
    <div class="calendar-controls">`,
`  const _todayStr2 = new Date().toISOString().split('T')[0];
  const _nextRaces = calendar.filter(g => g.data >= _todayStr2).sort((a,b) => a.data.localeCompare(b.data)).slice(0,3);
  let _calHypeHtml = '';
  if (_nextRaces.length) {
    const _nr = _nextRaces[0];
    const _daysTo = Math.round((new Date(_nr.data) - new Date(_todayStr2)) / 86400000);
    const _daysLabel = _daysTo === 0 ? 'OGGI' : _daysTo === 1 ? 'DOMANI' : 'fra ' + _daysTo + ' giorni';
    _calHypeHtml = '<div class="cal-hype-strip">' +
      '<div class="cal-hype-race">' +
        '<div class="cal-hype-label">🏁 PROSSIMA GARA</div>' +
        '<div class="cal-hype-name" onclick="location.hash=\'#/calendario/' + encodeURIComponent(_nr.id) + '\'">' + esc(_nr.nome) + '</div>' +
        '<div class="cal-hype-meta">' + _daysLabel +
          (_nr.regione ? ' · ' + esc(_nr.regione) : '') +
          (_nr.categoria ? ' · ' + esc(_nr.categoria) : '') +
        '</div>' +
      '</div>' +
      _nextRaces.slice(1,3).map(function(g) {
        const d2 = Math.round((new Date(g.data) - new Date(_todayStr2)) / 86400000);
        return '<div class="cal-hype-next" onclick="location.hash=\'#/calendario/' + encodeURIComponent(g.id) + '\'">' +
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

// ── 8. Comparatore — duel narrative ────────────────────────────────
replace('comparatore-duel',
`      \${buildH2H(aRes, bRes, nA, nB)}
      \${buildRadar(sA, sB, nA, nB)}
      \${buildInsights(sA, sB, nA, nB)}\`;`,
`      \${(()=>{
        const _stA = siAthleteStory(compA, resultsRaw)||'';
        const _stB = siAthleteStory(compB, resultsRaw)||'';
        const _mA = siMomentum(compA, resultsRaw, resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,''));
        const _mB = siMomentum(compB, resultsRaw, resultsRaw.reduce((mx,r)=>(r.data||'')>mx?r.data:mx,''));
        const _rivals = siRivalryFinder(resultsRaw).find(p=>(p.aId===compA&&p.bId===compB)||(p.aId===compB&&p.bId===compA));
        const _h2hStr = _rivals
          ? esc(nA)+' '+_rivals.aWins+'V – '+_rivals.bWins+'V '+esc(nB)+' ('+_rivals.encounters+' scontri diretti)'
          : 'Nessun incontro diretto registrato';
        return '<div class="comp-duel-banner">' +
          '<div class="comp-duel-h2h">⚔ HEAD TO HEAD · ' + _h2hStr + '</div>' +
          '<div class="comp-duel-narratives">' +
            (_stA ? '<div class="comp-duel-story comp-duel-story-a">' + _stA + '</div>' : '') +
            (_stB ? '<div class="comp-duel-story comp-duel-story-b">' + _stB + '</div>' : '') +
          '</div>' +
          '<div class="comp-duel-momentum">' +
            '<span style="color:' + _mA.color + '">' + esc(nA.split(' ')[0]) + ': ' + _mA.label + '</span>' +
            ' &nbsp;·&nbsp; ' +
            '<span style="color:' + _mB.color + '">' + esc(nB.split(' ')[0]) + ': ' + _mB.label + '</span>' +
          '</div>' +
        '</div>';
      })()}
      \${buildH2H(aRes, bRes, nA, nB)}
      \${buildRadar(sA, sB, nA, nB)}
      \${buildInsights(sA, sB, nA, nB)}\`;`
);

fs.writeFileSync(appFile, src, 'utf8');
console.log('\n' + (fail ? '⚠' : '✅') + ' ' + ok + ' ok, ' + fail + ' failed — app.js updated');
