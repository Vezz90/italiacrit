const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'app.js');
const cssPath = path.join(__dirname, 'design.css');

// ── Patch app.js ──────────────────────────────────────────────
let src = fs.readFileSync(appJsPath, 'utf8');

const startAnchor = '  // ── HTML SECTIONS ─────────────────────────────────────────────';
const endAnchorPattern = /\}\r?\n\r?\n\/\/ ── FORMA DEL MOMENTO/;

const startIdx = src.indexOf(startAnchor);
if (startIdx === -1) {
  console.error('ERROR: start anchor not found!');
  process.exit(1);
}

// Find the closing } before \n\n// ── FORMA DEL MOMENTO
const searchFrom = startIdx;
const match = endAnchorPattern.exec(src.slice(searchFrom));
if (!match) {
  console.error('ERROR: end anchor not found!');
  process.exit(1);
}

// match.index is relative to searchFrom; match[0] is "}\n\n// ── FORMA DEL MOMENTO"
// We want to replace from startIdx up to and including the "}" character
const endIdx = searchFrom + match.index + 1; // +1 to include the "}"

const before = src.slice(0, startIdx);
const after = src.slice(endIdx); // starts with "\n\n// ── FORMA DEL MOMENTO"

const newSection = `  // ── HTML SECTIONS (editorial v2) ──────────────────────────────
  const MONTHS_SHORT = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];

  // ── 1. HERO ──────────────────────────────────────────────────
  const latestRace = heroRaces[0];
  const latestWinner = latestRace?.results?.find(r => r.posizione === 1);

  const recentRacesHtml = heroRaces.slice(0, 6).map((r, i) => {
    const w = r.results?.find(x => x.posizione === 1);
    const d = r.data ? new Date(r.data) : null;
    const dateStr = d ? \`\${d.getDate()} \${MONTHS_SHORT[d.getMonth()]}\` : '';
    const rcCode = getRankingFileCode({categoria:r.categoria, genere:r.genere, tipo:r.tipo});
    return \`<div class="em-race-row\${i===0?' em-race-row--latest':''}" onclick="location.hash='#/risultati/\${encodeURIComponent(r.id)}'">
      <span class="em-race-date">\${dateStr}</span>
      <div class="em-race-info">
        <span class="em-race-name">\${esc(r.nome)}</span>
        <span class="em-race-cat">\${catLabel(rcCode||'')}</span>
      </div>
      \${w ? \`<span class="em-race-winner">🥇 \${esc(w.cognome)}</span>\` : ''}
    </div>\`;
  }).join('');

  const heroHtml = \`<section class="em-hero">
    <div class="em-hero-content">
      <div class="em-hero-left">
        <div class="em-eyebrow">IL CICLISMO AGONISTICO ITALIANO</div>
        <h1 class="em-title">ITALIA<span class="em-title-red">CRIT</span></h1>
        <p class="em-subtitle">Classifiche · Risultati · Storie · Statistiche</p>
        \${latestWinner ? \`<div class="em-hero-winner">
          <span class="em-winner-label">ULTIMA VITTORIA</span>
          <span class="em-winner-name">\${esc(latestWinner.cognome)} \${esc(latestWinner.nome)}</span>
          <span class="em-winner-race">\${esc(latestRace.nome)}</span>
        </div>\` : ''}
        <div class="em-hero-ctas">
          <a href="#/classifica" class="em-btn-primary">Classifiche</a>
          <a href="#/risultati" class="em-btn-ghost">Risultati</a>
        </div>
      </div>
      <div class="em-hero-right">
        <div class="em-right-label">ULTIMI RISULTATI</div>
        <div class="em-race-feed">\${recentRacesHtml}</div>
        <a href="#/risultati" class="em-all-link">Tutti i risultati →</a>
      </div>
    </div>
    \${tickerItems.length ? \`<div class="em-ticker-bar"><div class="em-ticker-inner"><span class="em-ticker-track">\${[...tickerItems,...tickerItems].join(' &nbsp;·&nbsp; ')}</span></div></div>\` : ''}
  </section>\`;

  // ── 2. UOMO DEL MOMENTO ───────────────────────────────────────
  const star = formaBest[0];
  const spotlightHtml = star ? \`<section class="em-spotlight">
    <div class="em-spotlight-bg-name">\${esc(star.cognome)}</div>
    <div class="em-spotlight-body">
      <div class="em-spot-meta">
        <span class="em-spot-badge">🔥 UOMO DEL MOMENTO</span>
        <span class="em-spot-cat">\${catLabel(star.code)}</span>
      </div>
      <h2 class="em-spot-name">\${esc(star.cognome)}<br><span class="em-spot-firstname">\${esc(star.nome)}</span></h2>
      <a href="#/team/\${encodeURIComponent(star.team_id)}" class="em-spot-team">\${esc(star.team||'')}</a>
      <div class="em-spot-stats">
        <div class="em-stat"><span class="em-stat-val">\${star.pts}</span><span class="em-stat-lbl">punti 14gg</span></div>
        <div class="em-stat"><span class="em-stat-val">\${star.vittorie}</span><span class="em-stat-lbl">vittorie</span></div>
        <div class="em-stat"><span class="em-stat-val">\${star.podio}</span><span class="em-stat-lbl">podi</span></div>
        <div class="em-stat"><span class="em-stat-val">\${star.gare}</span><span class="em-stat-lbl">gare</span></div>
      </div>
      <a href="#/atleta/\${encodeURIComponent(star.atleta_id)}" class="em-spot-cta">Scheda atleta →</a>
    </div>
  </section>\` : '';

  // ── 3. SFIDA DELLA SETTIMANA ──────────────────────────────────
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
  </section>\` : '';

  // ── 4. CHI STA VOLANDO ────────────────────────────────────────
  const volandoHtml = topScalatori.length ? \`<section class="em-volando">
    <div class="em-section-header">
      <span class="em-section-badge">📈 CHI STA VOLANDO</span>
      <span class="em-section-sub">Guadagni di posizione nell'ultima settimana</span>
    </div>
    <div class="em-volando-scroll">
      \${topScalatori.map(a => \`<div class="em-vol-card" onclick="location.hash='#/atleta/\${encodeURIComponent(a.atleta_id)}'">
        <div class="em-vol-gain">+\${a.gain}</div>
        <div class="em-vol-name">\${esc(a.cognome)} \${esc(a.nome)}</div>
        <div class="em-vol-team">\${esc(a.team||'')}</div>
        <div class="em-vol-cat">\${catLabel(a.code)}</div>
        <div class="em-vol-pts">\${a.recentPts} pt</div>
      </div>\`).join('')}
    </div>
  </section>\` : '';

  // ── 5. PROSSIME GARE ─────────────────────────────────────────
  const upcomingHtml = upcoming.length ? \`<section class="em-upcoming">
    <div class="em-section-header">
      <span class="em-section-badge">🗓 PROSSIME GARE</span>
    </div>
    <div class="em-upcoming-list">
      \${upcoming.map(g => {
        const d = new Date(g.data);
        const days = Math.round((d - new Date(todayStr)) / 86400000);
        const daysStr = days === 0 ? 'OGGI' : days === 1 ? 'DOMANI' : \`fra \${days}gg\`;
        return \`<div class="em-ug-row" onclick="location.hash='#/calendario/\${encodeURIComponent(g.id)}'">
          <span class="em-ug-days\${days===0?' em-ug-oggi':''}">\${daysStr}</span>
          <span class="em-ug-date">\${d.getDate()} \${MONTHS_SHORT[d.getMonth()]}</span>
          <span class="em-ug-name">\${esc(g.nome)}</span>
          <span class="em-ug-cat">\${esc(g.categoria||'')}</span>
        </div>\`;
      }).join('')}
    </div>
  </section>\` : '';

  // ══ ASSEMBLE ═════════════════════════════════════════════════
  setPage(\`
    \${heroHtml}
    \${spotlightHtml}
    \${versusHtml}
    \${volandoHtml}
    \${upcomingHtml}
  \`);
}`;

const newSrc = before + newSection + after;

const origLines = src.split('\n').length;
const newLines = newSrc.split('\n').length;

fs.writeFileSync(appJsPath, newSrc, 'utf8');
console.log(`app.js: ${origLines} lines → ${newLines} lines (diff: ${newLines - origLines})`);

// Verify
const verify = fs.readFileSync(appJsPath, 'utf8');
console.log('em-hero in app.js:', verify.includes('em-hero'));
console.log('HTML SECTIONS anchor replaced:', verify.includes('HTML SECTIONS (editorial v2)'));

// ── Append to design.css ──────────────────────────────────────
const newCss = `
/* ═══════════════════════════════════════════════════════════════
   EDITORIAL HOME v2 — em- prefix (editorial media)
   Cycling atmosphere, not dashboard
═══════════════════════════════════════════════════════════════ */

/* HERO */
.em-hero {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  background-image:
    linear-gradient(to right, rgba(15,23,42,0.96) 0%, rgba(15,23,42,0.85) 55%, rgba(15,23,42,0.55) 100%),
    url('https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1920&q=80');
  background-size: cover;
  background-position: center 30%;
  display: flex;
  flex-direction: column;
  padding-top: 56px;
}
.em-hero-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding: 72px 48px 48px;
  align-items: center;
  gap: 0;
}
.em-eyebrow {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: rgba(255,255,255,0.42);
  text-transform: uppercase;
  margin-bottom: 14px;
}
.em-title {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(4rem, 9vw, 9rem);
  font-weight: 900;
  line-height: 0.88;
  color: #fff;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  margin: 0 0 14px;
}
.em-title-red { color: #E11D48; }
.em-subtitle {
  font-size: 0.78rem;
  color: rgba(255,255,255,0.38);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin: 0 0 36px;
}
.em-hero-winner {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 18px 0;
  border-top: 1px solid rgba(255,255,255,0.1);
  border-bottom: 1px solid rgba(255,255,255,0.1);
  margin-bottom: 28px;
}
.em-winner-label {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  color: #E11D48;
  text-transform: uppercase;
}
.em-winner-name {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: 1.6rem;
  font-weight: 800;
  color: #fff;
  line-height: 1.1;
}
.em-winner-race {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.42);
}
.em-hero-ctas { display: flex; gap: 12px; }
.em-btn-primary {
  background: #E11D48;
  color: #fff;
  padding: 13px 30px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  border-radius: 2px;
  transition: background 0.2s;
}
.em-btn-primary:hover { background: #be123c; }
.em-btn-ghost {
  border: 1px solid rgba(255,255,255,0.28);
  color: rgba(255,255,255,0.65);
  padding: 13px 30px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  border-radius: 2px;
  transition: all 0.2s;
}
.em-btn-ghost:hover { border-color: #fff; color: #fff; }
.em-hero-right {
  padding-left: 52px;
  border-left: 1px solid rgba(255,255,255,0.1);
}
.em-right-label {
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  color: rgba(255,255,255,0.32);
  text-transform: uppercase;
  margin-bottom: 16px;
}
.em-race-feed { display: flex; flex-direction: column; }
.em-race-row {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 3px;
}
.em-race-row:hover { background: rgba(255,255,255,0.05); }
.em-race-row--latest { border-bottom-color: rgba(225,29,72,0.25); }
.em-race-date {
  font-size: 0.62rem;
  font-weight: 700;
  color: rgba(255,255,255,0.32);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.em-race-info { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.em-race-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.em-race-cat {
  font-size: 0.58rem;
  color: rgba(255,255,255,0.32);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.em-race-winner {
  font-size: 0.68rem;
  color: #fbbf24;
  white-space: nowrap;
  font-weight: 600;
}
.em-all-link {
  display: block;
  margin-top: 18px;
  font-size: 0.68rem;
  color: rgba(255,255,255,0.3);
  text-decoration: none;
  letter-spacing: 0.06em;
  transition: color 0.2s;
}
.em-all-link:hover { color: #E11D48; }

/* Ticker */
.em-ticker-bar {
  background: #E11D48;
  overflow: hidden;
  height: 36px;
  display: flex;
  align-items: center;
}
.em-ticker-inner { overflow: hidden; white-space: nowrap; width: 100%; display: flex; align-items: center; }
.em-ticker-track {
  display: inline-block;
  white-space: nowrap;
  animation: em-tick 70s linear infinite;
  font-size: 0.7rem;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.04em;
  padding-left: 100%;
}
.em-ticker-track strong { font-weight: 900; }
@keyframes em-tick { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* SPOTLIGHT */
.em-spotlight {
  position: relative;
  background: #0F172A;
  padding: 88px 48px;
  overflow: hidden;
  min-height: 380px;
  display: flex;
  align-items: center;
}
.em-spotlight-bg-name {
  position: absolute;
  right: -1%;
  top: 50%;
  transform: translateY(-50%);
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(8rem, 20vw, 22rem);
  font-weight: 900;
  color: rgba(255,255,255,0.025);
  text-transform: uppercase;
  letter-spacing: -0.06em;
  line-height: 1;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
}
.em-spotlight-body {
  position: relative;
  z-index: 1;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}
.em-spot-meta { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.em-spot-badge {
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  color: #E11D48;
  text-transform: uppercase;
}
.em-spot-cat {
  font-size: 0.62rem;
  font-weight: 600;
  color: rgba(255,255,255,0.32);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid rgba(255,255,255,0.14);
  padding: 2px 8px;
  border-radius: 2px;
}
.em-spot-name {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(3rem, 7vw, 7.5rem);
  font-weight: 900;
  color: #fff;
  line-height: 0.93;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  margin: 0 0 8px;
}
.em-spot-firstname {
  font-size: 0.52em;
  color: rgba(255,255,255,0.45);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.em-spot-team {
  display: block;
  font-size: 0.78rem;
  color: rgba(255,255,255,0.36);
  text-decoration: none;
  margin: 12px 0 28px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: color 0.2s;
}
.em-spot-team:hover { color: #fff; }
.em-spot-stats { display: flex; gap: 36px; margin-bottom: 36px; }
.em-stat { display: flex; flex-direction: column; gap: 3px; }
.em-stat-val {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: 2.6rem;
  font-weight: 900;
  color: #fff;
  line-height: 1;
}
.em-stat-lbl {
  font-size: 0.58rem;
  color: rgba(255,255,255,0.32);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.em-spot-cta {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 800;
  color: #E11D48;
  text-decoration: none;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 1px solid #E11D48;
  padding-bottom: 2px;
  transition: opacity 0.2s;
}
.em-spot-cta:hover { opacity: 0.65; }

/* VERSUS */
.em-versus {
  background-image:
    linear-gradient(rgba(9,15,30,0.9), rgba(9,15,30,0.9)),
    url('https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=1920&q=80');
  background-size: cover;
  background-position: center;
  padding: 88px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 48px;
}
.em-versus-label {
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.22em;
  color: rgba(255,255,255,0.42);
  text-transform: uppercase;
  text-align: center;
}
.em-versus-ring {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 48px;
  align-items: center;
  width: 100%;
  max-width: 960px;
}
.em-vs-side { display: flex; flex-direction: column; gap: 10px; }
.em-vs-a { text-align: right; align-items: flex-end; }
.em-vs-b { text-align: left; align-items: flex-start; }
.em-vs-pos {
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
}
.em-vs-name {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(1.8rem, 4vw, 3.8rem);
  font-weight: 900;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: -0.03em;
  line-height: 0.92;
  text-decoration: none;
  transition: color 0.2s;
}
.em-vs-name:hover { color: #E11D48; }
.em-vs-name small { font-size: 0.42em; color: rgba(255,255,255,0.38); font-weight: 400; display: block; letter-spacing: 0.06em; }
.em-vs-pts {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: 2.2rem;
  font-weight: 900;
  color: #fbbf24;
  line-height: 1;
}
.em-vs-pts span { font-size: 0.75rem; color: rgba(255,255,255,0.38); font-weight: 400; }
.em-vs-team {
  font-size: 0.68rem;
  color: rgba(255,255,255,0.32);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.em-vs-center { text-align: center; flex-shrink: 0; }
.em-vs-vs {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(3.5rem, 9vw, 8rem);
  font-weight: 900;
  color: #E11D48;
  letter-spacing: -0.06em;
  line-height: 1;
}
.em-vs-gap {
  font-size: 0.68rem;
  color: rgba(255,255,255,0.32);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-top: 4px;
}

/* CHI STA VOLANDO */
.em-volando {
  background: #F5F7FA;
  padding: 72px 48px;
}
[data-theme="dark"] .em-volando { background: #1e293b; }
.em-section-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
.em-section-badge {
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.16em;
  color: var(--text-primary);
  text-transform: uppercase;
}
.em-section-sub { font-size: 0.68rem; color: var(--text-muted); }
.em-volando-scroll {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 8px;
  -webkit-overflow-scrolling: touch;
}
.em-volando-scroll::-webkit-scrollbar { display: none; }
.em-vol-card {
  flex: 0 0 auto;
  background: #fff;
  border-radius: 6px;
  padding: 20px 18px;
  min-width: 154px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 1px solid rgba(0,0,0,0.06);
}
[data-theme="dark"] .em-vol-card { background: #0f172a; border-color: rgba(255,255,255,0.08); }
.em-vol-card:hover { transform: translateY(-4px); box-shadow: 0 10px 28px rgba(0,0,0,0.12); }
.em-vol-gain {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: 2.2rem;
  font-weight: 900;
  color: #16a34a;
  line-height: 1;
  margin-bottom: 10px;
}
.em-vol-name { font-size: 0.8rem; font-weight: 700; color: var(--text-primary); line-height: 1.2; margin-bottom: 3px; }
.em-vol-team { font-size: 0.62rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; }
.em-vol-cat { font-size: 0.58rem; font-weight: 800; color: #E11D48; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.em-vol-pts { font-size: 0.68rem; font-weight: 600; color: var(--text-muted); }

/* UPCOMING */
.em-upcoming { background: #0F172A; padding: 72px 48px; }
.em-upcoming .em-section-badge { color: rgba(255,255,255,0.75); }
.em-upcoming-list { max-width: 860px; }
.em-ug-row {
  display: grid;
  grid-template-columns: 80px 56px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 14px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
}
.em-ug-row:hover { background: rgba(255,255,255,0.05); }
.em-ug-days {
  font-size: 0.62rem;
  font-weight: 900;
  color: rgba(255,255,255,0.32);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.em-ug-oggi { color: #22c55e !important; }
.em-ug-date { font-size: 0.68rem; font-weight: 700; color: rgba(255,255,255,0.38); }
.em-ug-name { font-size: 0.875rem; font-weight: 600; color: #fff; }
.em-ug-cat { font-size: 0.62rem; color: rgba(255,255,255,0.28); text-transform: uppercase; white-space: nowrap; }

/* ─── MOBILE ─────────────────────────────────────────────── */
@media (max-width: 768px) {
  .em-hero-content {
    grid-template-columns: 1fr;
    padding: 36px 20px 24px;
    gap: 32px;
  }
  .em-hero {
    background-image:
      linear-gradient(rgba(15,23,42,0.94), rgba(15,23,42,0.9)),
      url('https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1200&q=80');
  }
  .em-hero-right {
    padding-left: 0;
    border-left: none;
    border-top: 1px solid rgba(255,255,255,0.1);
    padding-top: 24px;
  }
  .em-title { font-size: clamp(3.2rem, 16vw, 5rem); }
  .em-spotlight { padding: 56px 20px; }
  .em-spot-stats { gap: 20px; flex-wrap: wrap; }
  .em-spot-name { font-size: clamp(2.5rem, 12vw, 4rem); }
  .em-versus { padding: 56px 20px; gap: 32px; }
  .em-versus-ring { grid-template-columns: 1fr; gap: 24px; text-align: center; }
  .em-vs-a, .em-vs-b { text-align: center; align-items: center; }
  .em-vs-center { order: -1; }
  .em-volando { padding: 56px 20px; }
  .em-upcoming { padding: 56px 20px; }
  .em-ug-row { grid-template-columns: 68px 1fr; gap: 10px; }
  .em-ug-date, .em-ug-cat { display: none; }
}
`;

const existingCss = fs.readFileSync(cssPath, 'utf8');
// Avoid double-appending if re-run
if (existingCss.includes('EDITORIAL HOME v2')) {
  console.log('CSS block already present — skipping append');
} else {
  fs.writeFileSync(cssPath, existingCss + newCss, 'utf8');
  console.log('design.css: CSS block appended');
}

const cssVerify = fs.readFileSync(cssPath, 'utf8');
console.log('em-vs-vs in design.css:', cssVerify.includes('.em-vs-vs'));
console.log('Done.');
