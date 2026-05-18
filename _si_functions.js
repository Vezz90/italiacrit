
// siRivalryFinder — athletes with most direct race encounters
function siRivalryFinder(resultsRaw) {
  const pairs = {};
  const byRace = {};
  for (const r of resultsRaw) {
    if (!r.gara_id || !r.posizione || r.posizione > 8 || !r.data) continue;
    if (!byRace[r.gara_id]) byRace[r.gara_id] = [];
    byRace[r.gara_id].push(r);
  }
  for (const results of Object.values(byRace)) {
    const sorted = results.slice().sort((a,b) => a.posizione - b.posizione).slice(0, 6);
    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i+1; j < sorted.length && j <= i+4; j++) {
        const a = sorted[i], b = sorted[j];
        if (a.atleta_id === b.atleta_id) continue;
        const key = [a.atleta_id, b.atleta_id].sort().join('|');
        if (!pairs[key]) pairs[key] = {
          aId:a.atleta_id, bId:b.atleta_id,
          aCog:a.cognome, aNom:a.nome, aTeam:a.team, aTeamId:a.team_id,
          bCog:b.cognome, bNom:b.nome, bTeam:b.team, bTeamId:b.team_id,
          code: getRankingFileCode(a)||'', encounters:0, aWins:0, bWins:0
        };
        pairs[key].encounters++;
        if (a.posizione < b.posizione) pairs[key].aWins++;
        else pairs[key].bWins++;
      }
    }
  }
  return Object.values(pairs)
    .filter(p => p.encounters >= 3)
    .sort((a,b) => {
      const aClose = Math.min(a.aWins, a.bWins) / Math.max(a.encounters,1);
      const bClose = Math.min(b.aWins, b.bWins) / Math.max(b.encounters,1);
      return (b.encounters*(1+bClose)) - (a.encounters*(1+aClose));
    })
    .slice(0, 5);
}

// siNewsroomFeed — auto-generate editorial narrative bullets from data
function siNewsroomFeed(resultsRaw, allRankings, catOrder, topScalatori, teamDom) {
  const items = [];
  const lastDate = resultsRaw.reduce((mx,r) => (r.data||'') > mx ? r.data : mx, '');
  const cut7 = (() => { const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();
  // Recent winners
  const byRace = {};
  for (const r of resultsRaw.filter(r => r.data >= cut7 && r.posizione <= 3)) {
    if (!byRace[r.gara_id]) byRace[r.gara_id] = { nome:r.nome_gara, data:r.data, results:[], code:getRankingFileCode(r)||'' };
    byRace[r.gara_id].results.push(r);
  }
  for (const race of Object.values(byRace).sort((a,b) => b.data.localeCompare(a.data)).slice(0,3)) {
    const w = race.results.find(r => r.posizione === 1);
    if (w) items.push({ icon:'🥇', text:'<strong>' + esc(w.cognome) + ' ' + esc(w.nome) + '</strong> vince <em>' + esc(race.nome) + '</em> in ' + catLabel(race.code), type:'victory', atleta_id:w.atleta_id });
  }
  // Streak detections
  const checkedA = new Set();
  for (const r of resultsRaw.filter(x => x.data >= cut7 && x.posizione === 1).sort((a,b) => b.data.localeCompare(a.data)).slice(0,6)) {
    if (checkedA.has(r.atleta_id)) continue; checkedA.add(r.atleta_id);
    const { winStreak, podioStreak } = siStreak(r.atleta_id, resultsRaw);
    if (winStreak >= 2) items.push({ icon:'👑', text:'<strong>' + esc(r.cognome) + '</strong> in striscia: <strong>' + winStreak + ' vittorie consecutive</strong>', type:'streak', atleta_id:r.atleta_id });
    else if (podioStreak >= 3) items.push({ icon:'🔥', text:'<strong>' + esc(r.cognome) + '</strong> — <strong>' + podioStreak + ' podi consecutivi</strong>', type:'streak', atleta_id:r.atleta_id });
  }
  // Biggest movers
  if (topScalatori[0]) items.push({ icon:'📈', text:'<strong>' + esc(topScalatori[0].cognome) + ' ' + esc(topScalatori[0].nome) + '</strong> sale di <strong>+' + topScalatori[0].gain + ' posizioni</strong> in ' + catLabel(topScalatori[0].code), type:'mover', atleta_id:topScalatori[0].atleta_id });
  if (topScalatori[2]) items.push({ icon:'📈', text:'<strong>' + esc(topScalatori[2].cognome) + ' ' + esc(topScalatori[2].nome) + '</strong> — ora ' + topScalatori[2].newPos + '° in ' + catLabel(topScalatori[2].code), type:'mover', atleta_id:topScalatori[2].atleta_id });
  // Team dominance
  for (const [code, td] of Object.entries(teamDom).slice(0,2)) {
    items.push({ icon:'🏆', text:'<strong>' + esc(td.team) + '</strong> domina in ' + catLabel(code) + ': <strong>' + td.wins + ' vittorie</strong> nell\'ultimo mese', type:'team', team_id:td.team_id });
  }
  // Close battles
  for (let i=0; i < Math.min(allRankings.length, catOrder.length); i++) {
    const rk = allRankings[i]; if (!rk || rk.length < 2) continue;
    const gap = rk[0].punti - rk[1].punti;
    if (gap <= 15) { items.push({ icon:'⚔', text:'Solo <strong>' + gap + ' punti</strong> separano <strong>' + esc(rk[0].cognome) + '</strong> e <strong>' + esc(rk[1].cognome) + '</strong> in ' + catLabel(catOrder[i]), type:'battle' }); break; }
  }
  return items.slice(0, 8);
}

// siRaceNarrative — auto-generate story string for a race
function siRaceNarrative(raceId, resultsRaw) {
  const results = resultsRaw.filter(r => r.gara_id === raceId && r.posizione).sort((a,b) => a.posizione - b.posizione);
  if (!results.length) return null;
  const w = results[0], p2 = results[1];
  const { winStreak, podioStreak } = siStreak(w.atleta_id, resultsRaw);
  if (winStreak >= 3) return '👑 ' + esc(w.cognome) + ' è in striscia: ' + winStreak + 'ª vittoria di fila.';
  if (winStreak >= 2) return '🔥 ' + esc(w.cognome) + ' non si ferma: ' + winStreak + ' vittorie consecutive.';
  if (podioStreak >= 4) return '📈 ' + esc(w.cognome) + ' inarrestabile — ' + podioStreak + ' podi di fila.';
  if (p2 && Math.abs((w.punti_effettivi||0)-(p2.punti_effettivi||0)) <= 2) return '⚡ Duello al limite: ' + esc(w.cognome) + ' batte ' + esc(p2.cognome) + ' per pochissimi punti.';
  return '🥇 Vince ' + esc(w.cognome) + ' ' + esc(w.nome) + (p2 ? ' davanti a ' + esc(p2.cognome) : '') + '.';
}

// siClosestBattle — find the tightest ranking gap across categories
function siClosestBattle(allRankings, catOrder) {
  let best = null, bestGap = Infinity;
  for (let i = 0; i < Math.min(allRankings.length, catOrder.length); i++) {
    const rk = allRankings[i]; if (!rk || rk.length < 2) continue;
    const gap = rk[0].punti - rk[1].punti;
    if (gap < bestGap) { bestGap = gap; best = { a:rk[0], b:rk[1], code:catOrder[i], gap }; }
  }
  return best;
}

// siTeamNarrative — generate team storyline text
function siTeamNarrative(teamId, resultsRaw) {
  const teamRes = resultsRaw.filter(r => r.team_id === teamId && r.posizione && r.data);
  if (!teamRes.length) return null;
  const lastDate = teamRes.reduce((mx,r) => r.data > mx ? r.data : mx, '');
  const cut28 = (() => { const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-28); return d.toISOString().split('T')[0]; })();
  const recent = teamRes.filter(r => r.data >= cut28);
  const wins28 = recent.filter(r => r.posizione === 1).length;
  const podi28 = recent.filter(r => r.posizione <= 3).length;
  const gare28 = new Set(recent.map(r => r.gara_id)).size;
  const wByAtl = {};
  for (const r of recent.filter(x => x.posizione === 1)) {
    if (!wByAtl[r.atleta_id]) wByAtl[r.atleta_id] = { cognome:r.cognome, wins:0 };
    wByAtl[r.atleta_id].wins++;
  }
  const topWinner = Object.values(wByAtl).sort((a,b) => b.wins-a.wins)[0] || null;
  const cats28 = [...new Set(recent.map(r => getRankingFileCode(r)||r.categoria).filter(Boolean))];
  if (wins28 === 0 && podi28 === 0) return gare28 + ' gare nell\'ultimo mese. In cerca di conferme.';
  if (wins28 >= 5) return '🔥 Squadra dominante — ' + wins28 + ' vittorie in ' + gare28 + ' gare (ultimi 28gg).';
  if (topWinner && topWinner.wins >= 2) return '👑 ' + esc(topWinner.cognome) + ' trascina il team: ' + topWinner.wins + ' vittorie. ' + podi28 + ' podi totali su ' + gare28 + ' gare.';
  if (podi28 > 0) return '📈 ' + podi28 + ' podi in ' + gare28 + ' gare nell\'ultimo mese' + (cats28.length > 1 ? ' in ' + cats28.length + ' categorie' : '') + '.';
  return gare28 + ' gare, ' + podi28 + ' podi nell\'ultimo mese.';
}

// siAthleteStory — generate season narrative label for athlete
function siAthleteStory(athleteId, resultsRaw) {
  const myRes = resultsRaw.filter(r => r.atleta_id === athleteId && r.posizione && r.data).sort((a,b) => b.data.localeCompare(a.data));
  if (!myRes.length) return null;
  const lastDate = myRes[0].data;
  const cut30 = (() => { const d=new Date(lastDate||new Date()); d.setDate(d.getDate()-30); return d.toISOString().split('T')[0]; })();
  const r30 = myRes.filter(r => r.data >= cut30);
  const wins30 = r30.filter(r => r.posizione === 1).length;
  const podi30 = r30.filter(r => r.posizione <= 3).length;
  const { winStreak, podioStreak } = siStreak(athleteId, resultsRaw);
  if (winStreak >= 3) return '👑 DOMINATORE — ' + winStreak + ' vittorie di fila';
  if (winStreak >= 2) return '🔥 IN STRISCIA — ' + winStreak + ' vittorie consecutive';
  if (podioStreak >= 4) return '🔥 FORMA STRAORDINARIA — ' + podioStreak + ' podi di fila';
  if (wins30 >= 3) return '📈 STAGIONE ECCEZIONALE — ' + wins30 + ' vittorie nell\'ultimo mese';
  if (podi30 >= 4) return '📈 MOLTO IN FORMA — ' + podi30 + ' podi in 30 giorni';
  if (wins30 === 0 && r30.length > 2) return '⏳ In cerca di forma — ' + podi30 + ' podi in ' + r30.length + ' gare';
  return null;
}

