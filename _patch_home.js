'use strict';

const fs = require('fs');
const path = require('path');

const APP_JS  = path.join(__dirname, 'app.js');
const CSS_FILE = path.join(__dirname, 'design.css');

// ── Read app.js ────────────────────────────────────────────────
let src = fs.readFileSync(APP_JS, 'utf8');

// Detect line ending
const CRLF = src.includes('\r\n');
const NL   = CRLF ? '\r\n' : '\n';

// Helper: normalise a literal string to use the file's actual NL
function nl(s) {
  // s is written with \n; convert to file's NL
  return CRLF ? s.replace(/\n/g, '\r\n') : s;
}

// ── 1. Strip the pre-existing MONTHS_SHORT declaration that sits
//       just before the HTML SECTIONS marker (it will be
//       re-declared inside the new replacement block).
// ────────────────────────────────────────────────────────────────
const MONTHS_LINE_RE = /[ \t]*const MONTHS_SHORT = \[.*?\];[ \t]*[\r\n]+/;
src = src.replace(MONTHS_LINE_RE, '');

// ── 2. Replace the HTML SECTIONS block ─────────────────────────
const START_MARKER = nl("  // ── HTML SECTIONS ─────────────────────────────────────────────");
const END_MARKER   = nl("  // Hero carousel controller");

const startIdx = src.indexOf(START_MARKER);
if (startIdx === -1) throw new Error('START_MARKER not found in app.js');

const endIdx = src.indexOf(END_MARKER, startIdx);
if (endIdx === -1) throw new Error('END_MARKER not found in app.js');

const NEW_HTML_BLOCK = nl(
`  // ── HTML SECTIONS ─────────────────────────────────────────────

  const MONTHS_SHORT = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];

  // ══ 1. CINEMATIC HERO ═══════════════════════════════════════════
  const ciSlides = heroRaces.slice(0, 6).map((lr, idx) => {
    const sorted = (lr.results||[]).slice().sort((a,b)=>a.posizione-b.posizione);
    const winner = sorted[0];
    const p2 = sorted[1];
    const p3 = sorted[2];
    const mult = lr.mult || 1;
    const wPts = winner ? (winner.punti_effettivi || (BASEPTS[1]||0)*mult) : 0;
    const p2Pts = p2 ? (p2.punti_effettivi || (BASEPTS[2]||0)*mult) : 0;
    const p3Pts = p3 ? (p3.punti_effettivi || (BASEPTS[3]||0)*mult) : 0;
    return \`<div class="ci-slide\${idx===0?' ci-slide-active':''}" id="ci-slide-\${idx}">
      <div class="ci-slide-meta">
        \${badgeMult(mult, lr.tipo, lr.isCR, lr.isCI)}
        \${lr.genere==='F'?'<span class="badge-cat badge-genere-f">♀</span>':''}
        <span class="ci-slide-cat">\${esc(catLabel(lr.categoria)||'')}</span>
        <span class="ci-slide-sep">·</span>
        <span class="ci-slide-date">\${fmtDate(lr.data)}</span>
        \${lr.regione ? \`<span class="ci-slide-sep">·</span><span class="ci-slide-reg">\${esc(lr.regione)}</span>\` : ''}
      </div>
      <h2 class="ci-slide-race"><a href="#/gara/\${esc(lr.id)}" style="color:inherit;text-decoration:none">\${esc(lr.nome)}</a></h2>
      \${winner ? \`<div class="ci-winner-block">
        <div class="ci-winner-label">🥇 VINCITORE</div>
        <div class="ci-winner-name">
          <a href="#/atleta/\${esc(winner.atleta_id)}" style="color:inherit;text-decoration:none">
            \${esc(winner.cognome)} <span class="ci-winner-first">\${esc(winner.nome)}</span>
          </a>
        </div>
        <div class="ci-winner-sub">
          <a href="#/team/\${esc(winner.team_id)}" style="color:rgba(255,255,255,.5);text-decoration:none">\${esc(winner.team)}</a>
          <span style="color:var(--red-hot);font-weight:700;margin-left:10px">\${wPts} pt</span>
        </div>
      </div>\` : ''}
      <div class="ci-podio">
        \${p2 ? \`<div class="ci-podio-row"><span class="ci-p2">2°</span><a href="#/atleta/\${esc(p2.atleta_id)}" class="ci-podio-name">\${esc(p2.cognome)} \${esc(p2.nome)}</a><span class="ci-podio-pts">\${p2Pts}pt</span></div>\` : ''}
        \${p3 ? \`<div class="ci-podio-row"><span class="ci-p3">3°</span><a href="#/atleta/\${esc(p3.atleta_id)}" class="ci-podio-name">\${esc(p3.cognome)} \${esc(p3.nome)}</a><span class="ci-podio-pts">\${p3Pts}pt</span></div>\` : ''}
      </div>
    </div>\`;
  }).join('');

  const ciDotsHtml = heroRaces.length > 1
    ? heroRaces.slice(0,6).map((_,i) => \`<button class="ci-dot\${i===0?' ci-dot-active':''}" id="ci-dot-\${i}" onclick="window.heroGoTo(\${i})" aria-label="Gara \${i+1}"></button>\`).join('')
    : '';

  const ciHeroHtml = \`
    <section class="ci-hero">
      <div class="ci-hero-bg"></div>
      <div class="ci-hero-left">
        <div class="ci-hero-eyebrow">IL PORTALE DEL CICLISMO AGONISTICO ITALIANO</div>
        <h1 class="ci-hero-title">ITALIA<span class="ci-hero-accent">CRIT</span></h1>
        <p class="ci-hero-desc">Classifiche · Risultati · Storie · Statistiche</p>
        <div class="ci-hero-actions">
          <a href="#/classifica" class="ci-btn-primary">Classifiche</a>
          <a href="#/risultati" class="ci-btn-ghost">Risultati</a>
        </div>
      </div>
      <div class="ci-hero-right">
        <div class="ci-results-label">ULTIMI RISULTATI</div>
        <div class="ci-slides-wrap">
          \${ciSlides}
        </div>
        \${heroRaces.length > 1 ? \`<div class="ci-hero-nav">
          <button class="ci-nav-btn" onclick="window.heroPrev()" aria-label="Precedente">←</button>
          <div class="ci-dots">\${ciDotsHtml}</div>
          <button class="ci-nav-btn" onclick="window.heroNext()" aria-label="Successivo">→</button>
        </div>\` : ''}
      </div>
    </section>\`;

  // ══ 2. LIVE TICKER ══════════════════════════════════════════════
  const tickerHtml = tickerItems.length ? \`
    <div class="ci-ticker">
      <div class="ci-ticker-badge">LIVE</div>
      <div class="ci-ticker-outer"><div class="ci-ticker-track">
        \${[...tickerItems,...tickerItems].map(t=>\`<span class="ci-ticker-item">\${t}</span>\`).join('<span class="ci-ticker-sep" aria-hidden="true">·</span>')}
      </div></div>
    </div>\` : '';

  // ══ 3. CORRIDORE IN EVIDENZA ════════════════════════════════════
  const riderOfWeek = topScalatori[0] || formaBest[0] || null;
  let rowHtml = '';
  if (riderOfWeek) {
    const isScal = !!topScalatori[0];
    const rf = riderOfWeek;
    const wins14 = isScal ? 0 : (formaBest[0]?.vittorie||0);
    const podio14 = isScal ? 0 : (formaBest[0]?.podio||0);
    rowHtml = \`
      <section class="ci-row-section">
        <div class="ci-row-label-outer">CORRIDORE IN EVIDENZA</div>
        <div class="ci-row-inner">
          <div class="ci-row-left">
            <div class="ci-row-badge">\${badgeCat(rf.code)}</div>
            <div class="ci-row-surname">\${esc(rf.cognome)}</div>
            <div class="ci-row-firstname">\${esc(rf.nome)}</div>
            <a href="#/team/\${esc(rf.team_id)}" class="ci-row-team">\${esc(rf.team)}</a>
          </div>
          <div class="ci-row-stats">
            \${isScal ? \`
              <div class="ci-stat-block ci-stat-hot"><div class="ci-stat-num">+\${rf.gain}</div><div class="ci-stat-lbl">posizioni guadagnate</div></div>
              <div class="ci-stat-block"><div class="ci-stat-num">\${rf.newPos}°</div><div class="ci-stat-lbl">posizione attuale</div></div>
              <div class="ci-stat-block"><div class="ci-stat-num">\${rf.recentPts}</div><div class="ci-stat-lbl">pt settimana</div></div>
            \` : \`
              <div class="ci-stat-block ci-stat-hot"><div class="ci-stat-num">\${rf.pts}</div><div class="ci-stat-lbl">punti (14 gg)</div></div>
              <div class="ci-stat-block"><div class="ci-stat-num">\${wins14}</div><div class="ci-stat-lbl">vittorie</div></div>
              <div class="ci-stat-block"><div class="ci-stat-num">\${podio14}</div><div class="ci-stat-lbl">podi</div></div>
            \`}
            <a href="#/atleta/\${esc(rf.atleta_id)}" class="ci-row-cta">Scheda Atleta →</a>
          </div>
        </div>
      </section>\`;
  }

  // ══ 4. PROSSIME GARE ════════════════════════════════════════════
  const upcomingCiHtml = upcoming.length ? \`
    <section class="ci-light-section ci-upcoming-section">
      <div class="ci-section-hd">
        <span class="ci-section-title">PROSSIME GARE</span>
        <a href="#/calendario" class="ci-section-link">Calendario →</a>
      </div>
      <div class="ci-upcoming-list">
        \${upcoming.map(g => {
          const d = new Date(g.data);
          const daysTo = Math.round((d - new Date(todayStr))/86400000);
          const label = daysTo===0?'OGGI':daysTo===1?'DOMANI':\`+\${daysTo}g\`;
          const urgClass = daysTo===0?'ci-up-today':daysTo<=3?'ci-up-soon':'';
          return \`<a href="#/gara/\${esc(g.id)}" class="ci-upcoming-row \${urgClass}">
            <div class="ci-up-date">
              <span class="ci-up-day">\${d.getDate()}</span>
              <span class="ci-up-mon">\${MONTHS_SHORT[d.getMonth()]}</span>
            </div>
            <div class="ci-up-info">
              <div class="ci-up-name">\${esc(g.nome)}</div>
              <div class="ci-up-loc">\${[g.luogo,g.regione].filter(Boolean).join(' · ')}</div>
            </div>
            <div class="ci-up-right">
              <span class="ci-up-label">\${label}</span>
              \${badgeMult(g.moltiplicatore, g.tipo, g.campionato_regionale, g.campionato_italiano)}
            </div>
          </a>\`;
        }).join('')}
      </div>
    </section>\` : '';

  // ══ 5. CHI SALE ═════════════════════════════════════════════════
  const chiSaleHtml = topScalatori.length ? \`
    <section class="ci-dark-section">
      <div class="ci-section-hd ci-section-hd-dark">
        <span class="ci-section-title">⬆ CHI SALE</span>
        <span class="ci-section-sub">Maggiori guadagni di posizione nell'ultima settimana</span>
      </div>
      <div class="ci-scalatori-scroll">
        \${topScalatori.slice(0,8).map((a,i) => \`
          <a href="#/atleta/\${esc(a.atleta_id)}" class="ci-scalatore-card">
            <div class="ci-sc-rank">\${String(i+1).padStart(2,'0')}</div>
            <div class="ci-sc-cat">\${badgeCat(a.code)}</div>
            <div class="ci-sc-surname">\${esc(a.cognome)}</div>
            <div class="ci-sc-firstname">\${esc(a.nome)}</div>
            <div class="ci-sc-team">\${esc(a.team)}</div>
            <div class="ci-sc-gain">+\${a.gain}<span class="ci-sc-gainlbl"> pos</span></div>
            <div class="ci-sc-arrow">\${a.oldPos}° <span class="ci-sc-arrowglyph">→</span> <strong class="ci-sc-newpos">\${a.newPos}°</strong></div>
          </a>\`).join('')}
      </div>
    </section>\` : '';

  // ══ 6. SFIDA DELLA SETTIMANA ════════════════════════════════════
  let matchupHtml = '';
  if (topScalatori.length >= 2) {
    const s1 = topScalatori[0];
    const s2 = topScalatori.find(a => a.atleta_id !== s1.atleta_id && a.code === s1.code) || topScalatori[1];
    if (s1 && s2 && s1.atleta_id !== s2.atleta_id) {
      matchupHtml = \`
        <section class="ci-light-section ci-matchup-section">
          <div class="ci-section-hd">
            <span class="ci-section-title">SFIDA DELLA SETTIMANA</span>
            <span class="ci-section-sub" style="color:var(--text-secondary)">\${catLabel(s1.code)}</span>
          </div>
          <div class="ci-matchup">
            <a href="#/atleta/\${esc(s1.atleta_id)}" class="ci-mu-athlete ci-mu-left">
              <div class="ci-mu-pos">\${s1.newPos}°</div>
              <div class="ci-mu-surname">\${esc(s1.cognome)}</div>
              <div class="ci-mu-firstname">\${esc(s1.nome)}</div>
              <div class="ci-mu-team">\${esc(s1.team)}</div>
              <div class="ci-mu-stat"><span class="ci-mu-gain">+\${s1.gain}</span> pos · +\${s1.recentPts}pt</div>
            </a>
            <div class="ci-mu-vs">
              <div class="ci-vs-text">VS</div>
              <div class="ci-vs-cat">\${badgeCat(s1.code)}</div>
            </div>
            <a href="#/atleta/\${esc(s2.atleta_id)}" class="ci-mu-athlete ci-mu-right">
              <div class="ci-mu-pos">\${s2.newPos}°</div>
              <div class="ci-mu-surname">\${esc(s2.cognome)}</div>
              <div class="ci-mu-firstname">\${esc(s2.nome)}</div>
              <div class="ci-mu-team">\${esc(s2.team)}</div>
              <div class="ci-mu-stat"><span class="ci-mu-gain">+\${s2.gain}</span> pos · +\${s2.recentPts}pt</div>
            </a>
          </div>
        </section>\`;
    }
  }

  // ══ 7. INSIGHTS EDITORIALI ══════════════════════════════════════
  const insightsList = [];
  if (formaBest[0]) insightsList.push(\`<strong>\${esc(formaBest[0].cognome)} \${esc(formaBest[0].nome)}</strong> domina la categoria \${catLabel(formaBest[0].code)} con \${formaBest[0].pts} punti e \${formaBest[0].vittorie} vittori\${formaBest[0].vittorie===1?'a':'e'} negli ultimi 14 giorni.\`);
  if (topScalatori[0]) insightsList.push(\`<strong>\${esc(topScalatori[0].cognome)} \${esc(topScalatori[0].nome)}</strong> è l'atleta in ascesa della settimana: +\${topScalatori[0].gain} posizioni in \${catLabel(topScalatori[0].code)}, passando dal \${topScalatori[0].oldPos}° al \${topScalatori[0].newPos}° posto.\`);
  if (topTeamTicker) insightsList.push(\`<strong>\${esc(topTeamTicker.team)}</strong> è il team più in forma con \${topTeamTicker.pts} punti e \${topTeamTicker.vittorie} vittori\${topTeamTicker.vittorie===1?'a':'e'} recenti.\`);
  if (heroRaces[0]) { const w = heroRaces[0].results?.find(r=>r.posizione===1); if (w) insightsList.push(\`Vittoria di <strong>\${esc(w.cognome)} \${esc(w.nome)}</strong> alla \${esc(heroRaces[0].nome)}: un risultato che consolida la sua posizione in classifica.\`); }
  const critici = rischioPerCat.flatMap(c=>c.top5.filter(p=>p.risk==='critico')).slice(0,1);
  critici.forEach(p => insightsList.push(\`La posizione di <strong>\${esc(p.cognome)} \${esc(p.nome)}</strong> è a rischio critico: distacco di soli \${p.gapBelow}pt con chi insegue in forma migliore.\`));

  const insightsHtml = insightsList.length ? \`
    <section class="ci-dark-section">
      <div class="ci-section-hd ci-section-hd-dark">
        <span class="ci-section-title">📰 INSIGHTS</span>
        <span class="ci-section-sub">Analisi automatica dai dati più recenti</span>
      </div>
      <div class="ci-insights-grid">
        \${insightsList.slice(0,4).map((txt,i) => \`
          <div class="ci-insight-card">
            <div class="ci-insight-num">0\${i+1}</div>
            <p class="ci-insight-text">\${txt}</p>
          </div>\`).join('')}
      </div>
    </section>\` : '';

  // ══ 8. FORMA DEL MOMENTO ════════════════════════════════════════
  const formaCiHtml = formaBest.length ? \`
    <section class="ci-light-section ci-forma-section">
      <div class="ci-section-hd">
        <span class="ci-section-title">FORMA DEL MOMENTO</span>
        <span class="ci-section-sub">Miglior atleta per categoria · ultimi 14 giorni · clicca per la lista</span>
      </div>
      <div class="ci-forma-scroll">
        \${formaBest.map(item => \`
          <a href="#/forma/\${esc(item.code)}" class="ci-forma-card">
            <div class="ci-forma-cat">\${badgeCat(item.code)}</div>
            <div class="ci-forma-surname">\${esc(item.cognome)}</div>
            <div class="ci-forma-firstname">\${esc(item.nome)}</div>
            <div class="ci-forma-team">\${esc(item.team)}</div>
            <div class="ci-forma-pts">\${item.pts}<span class="ci-forma-pt-lbl">pt</span></div>
            <div class="ci-forma-sub">\${item.vittorie}V · \${item.podio}P · \${item.gare}G</div>
          </a>\`).join('')}
      </div>
    </section>\` : '';

  // ══ 9. POSIZIONI A RISCHIO ══════════════════════════════════════
  const rischioNewHtml = rischioPerCat.length ? \`
    <section class="ci-dark-section">
      <div class="ci-section-hd ci-section-hd-dark">
        <span class="ci-section-title">🎯 POSIZIONI A RISCHIO</span>
        <span class="ci-section-sub">Dinamiche calcolate su forma 28 giorni e distacco</span>
      </div>
      <div class="ci-rischio-scroll">
        \${rischioPerCat.map(({code, top5}) => \`
          <div class="ci-rischio-card">
            <div class="ci-rischio-head">\${badgeCat(code)}</div>
            \${top5.map(p => {
              const col = p.pos===1?'var(--gold)':p.pos===2?'var(--silver)':p.pos===3?'var(--bronze)':'rgba(255,255,255,.35)';
              const ri = p.risk==='critico'?'🔴':p.risk==='alto'?'🟠':p.risk==='medio'?'🟡':'🟢';
              return \`<div class="ci-rischio-row">
                <span style="color:\${col};font-weight:700;min-width:22px">\${p.pos}°</span>
                <a href="#/atleta/\${esc(p.atleta_id)}" class="ci-rischio-name">\${esc(p.cognome)} \${esc(p.nome)}</a>
                <span class="ci-rischio-pts">\${p.punti}</span>
                <span>\${ri}</span>
              </div>\`;
            }).join('')}
          </div>\`).join('')}
      </div>
    </section>\` : '';

  // ══ ASSEMBLE ════════════════════════════════════════════════════
  setPage(\`
    \${ciHeroHtml}
    \${tickerHtml}
    \${rowHtml}
    \${upcomingCiHtml}
    \${chiSaleHtml}
    \${matchupHtml}
    \${insightsHtml}
    \${formaCiHtml}
    \${rischioNewHtml}
  \`);

  // Hero carousel controller
`);

// Perform the replacement: from START_MARKER up to (not including) END_MARKER
src = src.slice(0, startIdx) + NEW_HTML_BLOCK + src.slice(endIdx);

// ── 3. Replace the OLD carousel controller with the NEW one ────
const OLD_CAROUSEL = nl(
`  // Hero carousel controller
  if (heroRaces.length > 1) {
    let current = 0;
    const total = heroRaces.length;
    const goTo = (idx) => {
      document.getElementById(\`hero-slide-\${current}\`)?.classList.remove('active');
      document.getElementById(\`hero-dot-\${current}\`)?.classList.remove('active');
      current = (idx + total) % total;
      document.getElementById(\`hero-slide-\${current}\`)?.classList.add('active');
      document.getElementById(\`hero-dot-\${current}\`)?.classList.add('active');
    };
    window.heroGoTo = goTo;
    window.heroNext = () => { clearInterval(window.homeHeroInterval); goTo(current+1); window.homeHeroInterval = setInterval(()=>goTo(current+1), 6000); };
    window.heroPrev = () => { clearInterval(window.homeHeroInterval); goTo(current-1); window.homeHeroInterval = setInterval(()=>goTo(current+1), 6000); };
    window.homeHeroInterval = setInterval(() => goTo(current+1), 6000);
  }`);

const NEW_CAROUSEL = nl(
`  // Hero carousel controller
  if (heroRaces.length > 1) {
    let current = 0;
    const total = Math.min(heroRaces.length, 6);
    const goTo = (idx) => {
      document.getElementById(\`ci-slide-\${current}\`)?.classList.remove('ci-slide-active');
      document.getElementById(\`ci-dot-\${current}\`)?.classList.remove('ci-dot-active');
      current = (idx + total) % total;
      document.getElementById(\`ci-slide-\${current}\`)?.classList.add('ci-slide-active');
      document.getElementById(\`ci-dot-\${current}\`)?.classList.add('ci-dot-active');
    };
    window.heroGoTo = goTo;
    window.heroNext = () => { clearInterval(window.homeHeroInterval); goTo(current+1); window.homeHeroInterval = setInterval(()=>goTo(current+1), 7000); };
    window.heroPrev = () => { clearInterval(window.homeHeroInterval); goTo(current-1); window.homeHeroInterval = setInterval(()=>goTo(current+1), 7000); };
    window.homeHeroInterval = setInterval(() => goTo(current+1), 7000);
  }`);

if (!src.includes(OLD_CAROUSEL)) {
  // Try with LF regardless of detection (the file may be mixed)
  const altOld = OLD_CAROUSEL.replace(/\r\n/g, '\n');
  if (src.includes(altOld)) {
    src = src.replace(altOld, NEW_CAROUSEL.replace(/\r\n/g, '\n'));
    console.log('Carousel replaced (LF fallback).');
  } else {
    // Last resort: replace only the discriminating line (total = heroRaces.length)
    const OLD_TOTAL = `    const total = heroRaces.length;`;
    const NEW_TOTAL = `    const total = Math.min(heroRaces.length, 6);`;
    if (!src.includes(OLD_TOTAL)) throw new Error('Cannot find carousel controller in app.js');
    src = src.replace(OLD_TOTAL, NEW_TOTAL);

    // Replace old class names in carousel
    src = src.replace(/`hero-slide-\${current}`\)?\?\.classList\.remove\('active'\)/g,
      "`ci-slide-${current}`)?.classList.remove('ci-slide-active')");
    src = src.replace(/`hero-dot-\${current}`\)?\?\.classList\.remove\('active'\)/g,
      "`ci-dot-${current}`)?.classList.remove('ci-dot-active')");
    src = src.replace(/`hero-slide-\${current}`\)?\?\.classList\.add\('active'\)/g,
      "`ci-slide-${current}`)?.classList.add('ci-slide-active')");
    src = src.replace(/`hero-dot-\${current}`\)?\?\.classList\.add\('active'\)/g,
      "`ci-dot-${current}`)?.classList.add('ci-dot-active')");
    // Replace intervals 6000 → 7000
    src = src.replace(/setInterval\(\(\)=>goTo\(current\+1\), 6000\)/g,
      'setInterval(()=>goTo(current+1), 7000)');
    console.log('Carousel replaced (pattern fallback).');
  }
} else {
  src = src.replace(OLD_CAROUSEL, NEW_CAROUSEL);
  console.log('Carousel replaced (exact match).');
}

// ── 4. Write app.js ────────────────────────────────────────────
fs.writeFileSync(APP_JS, src, 'utf8');
console.log('app.js written successfully.');

// ── 5. Append CSS to design.css ────────────────────────────────
const CSS_BLOCK = `
/* ══════════════════════════════════════════════════════════════════
   CINEMATIC HOME REDESIGN
   ══════════════════════════════════════════════════════════════════ */

/* ── CINEMATIC HERO ─────────────────────────────────────────────── */
.ci-hero {
  position: relative;
  min-height: 100vh;
  background: #0F172A;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 0;
  overflow: hidden;
}
.ci-hero-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 80% at 80% 40%, rgba(255,107,0,.10) 0%, transparent 60%),
    radial-gradient(ellipse 40% 60% at 10% 70%, rgba(255,107,0,.06) 0%, transparent 50%),
    linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%);
  pointer-events: none;
}
.ci-hero-bg::after {
  content: 'ITALIACRIT';
  position: absolute;
  bottom: -40px;
  right: -20px;
  font-size: clamp(80px, 15vw, 200px);
  font-weight: 900;
  color: rgba(255,255,255,.02);
  font-family: var(--font-heading);
  letter-spacing: -0.05em;
  line-height: 1;
  pointer-events: none;
  user-select: none;
}
.ci-hero-left {
  position: relative;
  z-index: 2;
  padding: clamp(60px, 8vw, 120px) clamp(24px, 5vw, 72px);
}
.ci-hero-eyebrow {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  color: var(--red-hot);
  text-transform: uppercase;
  margin-bottom: 20px;
}
.ci-hero-title {
  font-family: var(--font-heading);
  font-size: clamp(3.5rem, 7vw, 7rem);
  font-weight: 900;
  line-height: 0.92;
  color: #fff;
  letter-spacing: -0.03em;
  margin: 0 0 16px;
}
.ci-hero-accent { color: var(--red-hot); }
.ci-hero-desc {
  font-size: 0.85rem;
  color: rgba(255,255,255,.45);
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
  margin: 0 0 36px;
}
.ci-hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.ci-btn-primary {
  display: inline-block;
  padding: 12px 28px;
  background: var(--red-hot);
  color: #fff;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-decoration: none;
  text-transform: uppercase;
  border-radius: var(--r-sm);
  transition: background .2s, transform .15s;
}
.ci-btn-primary:hover { background: #e05500; transform: translateY(-1px); }
.ci-btn-ghost {
  display: inline-block;
  padding: 12px 28px;
  background: rgba(255,255,255,.07);
  color: rgba(255,255,255,.8);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-decoration: none;
  text-transform: uppercase;
  border-radius: var(--r-sm);
  border: 1px solid rgba(255,255,255,.12);
  transition: background .2s;
}
.ci-btn-ghost:hover { background: rgba(255,255,255,.12); }
.ci-hero-right {
  position: relative;
  z-index: 2;
  padding: clamp(40px, 6vw, 80px) clamp(24px, 5vw, 64px) clamp(40px, 6vw, 80px) 0;
  border-left: 1px solid rgba(255,255,255,.06);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
}
.ci-results-label {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  color: rgba(255,255,255,.35);
  text-transform: uppercase;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.ci-slides-wrap { position: relative; flex: 1; }
.ci-slide { display: none; animation: ci-fade-in .4s ease; }
.ci-slide.ci-slide-active { display: block; }
@keyframes ci-fade-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
.ci-slide-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.ci-slide-cat { font-family: var(--font-mono); font-size: 0.7rem; color: rgba(255,255,255,.5); }
.ci-slide-sep { color: rgba(255,255,255,.2); }
.ci-slide-date { font-family: var(--font-mono); font-size: 0.7rem; color: rgba(255,255,255,.4); }
.ci-slide-reg { font-family: var(--font-mono); font-size: 0.7rem; color: rgba(255,255,255,.3); }
.ci-slide-race {
  font-family: var(--font-heading);
  font-size: clamp(1.4rem, 2.5vw, 2.2rem);
  font-weight: 800;
  color: #fff;
  line-height: 1.1;
  margin: 0 0 20px;
  letter-spacing: -0.02em;
}
.ci-winner-block { margin-bottom: 16px; }
.ci-winner-label {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.15em;
  color: var(--red-hot);
  margin-bottom: 6px;
}
.ci-winner-name {
  font-family: var(--font-heading);
  font-size: clamp(1.5rem, 3vw, 2.5rem);
  font-weight: 900;
  color: #fff;
  line-height: 1;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}
.ci-winner-first { color: var(--red-hot); }
.ci-winner-sub { font-size: 0.82rem; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.ci-podio { display: flex; flex-direction: column; gap: 6px; }
.ci-podio-row { display: flex; align-items: center; gap: 10px; }
.ci-p2 { color: #C0C0C0; font-weight: 700; font-size: 0.8rem; min-width: 22px; }
.ci-p3 { color: #CD7F32; font-weight: 700; font-size: 0.8rem; min-width: 22px; }
.ci-podio-name { color: rgba(255,255,255,.6); font-size: 0.82rem; text-decoration: none; flex: 1; }
.ci-podio-name:hover { color: #fff; }
.ci-podio-pts { font-size: 0.72rem; color: rgba(255,255,255,.3); font-family: var(--font-mono); }
.ci-hero-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid rgba(255,255,255,.07);
}
.ci-nav-btn {
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.6);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .2s, color .2s;
}
.ci-nav-btn:hover { background: rgba(255,255,255,.15); color: #fff; }
.ci-dots { display: flex; gap: 6px; flex: 1; }
.ci-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: rgba(255,255,255,.2);
  border: none; cursor: pointer;
  transition: background .2s, transform .2s;
  padding: 0;
}
.ci-dot.ci-dot-active { background: var(--red-hot); transform: scale(1.3); }

/* ── TICKER ─────────────────────────────────────────────────────── */
.ci-ticker {
  display: flex;
  align-items: center;
  background: var(--red-hot);
  overflow: hidden;
  height: 38px;
}
.ci-ticker-badge {
  background: #fff;
  color: var(--red-hot);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  padding: 0 12px;
  height: 100%;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.ci-ticker-outer { flex: 1; overflow: hidden; }
.ci-ticker-track {
  display: flex;
  align-items: center;
  white-space: nowrap;
  animation: ci-ticker 40s linear infinite;
  gap: 0;
}
.ci-ticker-item {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: #fff;
  padding: 0 24px;
  letter-spacing: 0.02em;
}
.ci-ticker-sep { color: rgba(255,255,255,.4); font-size: 1rem; padding: 0 4px; }
@keyframes ci-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.ci-ticker:hover .ci-ticker-track { animation-play-state: paused; }

/* ── CORRIDORE IN EVIDENZA ──────────────────────────────────────── */
.ci-row-section {
  background: #F5F7FA;
  padding: clamp(40px, 6vw, 72px) clamp(20px, 5vw, 64px);
}
.ci-row-label-outer {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  color: var(--red-hot);
  text-transform: uppercase;
  margin-bottom: 28px;
}
.ci-row-inner {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(24px, 5vw, 64px);
  align-items: center;
}
.ci-row-badge { margin-bottom: 12px; }
.ci-row-surname {
  font-family: var(--font-heading);
  font-size: clamp(2.5rem, 6vw, 5rem);
  font-weight: 900;
  color: #111827;
  line-height: 0.9;
  letter-spacing: -0.04em;
  text-transform: uppercase;
}
.ci-row-firstname {
  font-family: var(--font-heading);
  font-size: clamp(1.2rem, 3vw, 2rem);
  font-weight: 400;
  color: var(--red-hot);
  letter-spacing: -0.01em;
  margin-top: 4px;
  margin-bottom: 10px;
}
.ci-row-team {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
  text-decoration: none;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.ci-row-stats {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.ci-stat-block {
  border-left: 3px solid var(--border-subtle);
  padding-left: 16px;
}
.ci-stat-block.ci-stat-hot { border-left-color: var(--red-hot); }
.ci-stat-num {
  font-family: var(--font-heading);
  font-size: clamp(2rem, 4vw, 3.5rem);
  font-weight: 900;
  color: #111827;
  line-height: 1;
  letter-spacing: -0.03em;
}
.ci-stat-hot .ci-stat-num { color: var(--red-hot); }
.ci-stat-lbl {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-top: 2px;
}
.ci-row-cta {
  display: inline-block;
  margin-top: 8px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--red-hot);
  text-decoration: none;
  letter-spacing: 0.05em;
  font-weight: 700;
  border-bottom: 1px solid var(--red-hot);
  padding-bottom: 2px;
  transition: opacity .2s;
}
.ci-row-cta:hover { opacity: .7; }

/* ── SECTION SHARED UTILS ──────────────────────────────────────── */
.ci-section-hd {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}
.ci-section-hd-dark .ci-section-title { color: #fff; }
.ci-section-hd-dark .ci-section-sub { color: rgba(255,255,255,.4); }
.ci-section-title {
  font-family: var(--font-heading);
  font-size: clamp(1rem, 2vw, 1.4rem);
  font-weight: 900;
  color: #111827;
  letter-spacing: -0.01em;
  text-transform: uppercase;
}
.ci-section-sub {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  flex: 1;
}
.ci-section-link {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--red-hot);
  text-decoration: none;
  letter-spacing: 0.05em;
  font-weight: 700;
  white-space: nowrap;
  margin-left: auto;
}
.ci-section-link:hover { text-decoration: underline; }
.ci-light-section {
  padding: clamp(40px, 6vw, 72px) clamp(20px, 5vw, 64px);
  background: #F5F7FA;
}
.ci-dark-section {
  padding: clamp(40px, 6vw, 72px) clamp(20px, 5vw, 64px);
  background: #0F172A;
}

/* ── PROSSIME GARE ─────────────────────────────────────────────── */
.ci-upcoming-list { display: flex; flex-direction: column; gap: 2px; }
.ci-upcoming-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: #fff;
  border-radius: var(--r-sm);
  text-decoration: none;
  color: inherit;
  border-left: 3px solid transparent;
  transition: border-color .2s, background .2s;
}
.ci-upcoming-row:hover { border-left-color: var(--red-hot); background: #fafafa; }
.ci-up-today { border-left-color: var(--red-hot) !important; background: rgba(255,107,0,.04) !important; }
.ci-up-soon { border-left-color: var(--yellow-race); }
.ci-up-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 36px;
  flex-shrink: 0;
}
.ci-up-day { font-family: var(--font-heading); font-weight: 900; font-size: 1.3rem; color: #111827; line-height: 1; }
.ci-up-mon { font-family: var(--font-mono); font-size: 0.55rem; color: var(--text-muted); letter-spacing: 0.08em; }
.ci-up-info { flex: 1; min-width: 0; }
.ci-up-name { font-family: var(--font-heading); font-weight: 700; font-size: 0.88rem; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ci-up-loc { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); margin-top: 2px; }
.ci-up-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.ci-up-label {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 3px 7px;
  background: var(--bg-elevated);
  border-radius: 3px;
  color: var(--text-muted);
}
.ci-up-today .ci-up-label { background: var(--red-hot); color: #fff; }
.ci-up-soon .ci-up-label { background: var(--yellow-race); color: #111; }

/* ── CHI SALE ──────────────────────────────────────────────────── */
.ci-scalatori-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.15) transparent;
}
.ci-scalatore-card {
  flex-shrink: 0;
  width: 160px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: var(--r-md);
  padding: 16px;
  text-decoration: none;
  color: #fff;
  transition: background .2s, border-color .2s, transform .15s;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ci-scalatore-card:hover { background: rgba(255,255,255,.08); border-color: var(--red-hot); transform: translateY(-2px); }
.ci-sc-rank { font-family: var(--font-mono); font-size: 0.6rem; color: rgba(255,255,255,.25); letter-spacing: 0.1em; margin-bottom: 4px; }
.ci-sc-cat { margin-bottom: 8px; }
.ci-sc-surname { font-family: var(--font-heading); font-weight: 800; font-size: 1rem; line-height: 1.1; }
.ci-sc-firstname { font-size: 0.75rem; color: rgba(255,255,255,.55); margin-bottom: 4px; }
.ci-sc-team { font-family: var(--font-mono); font-size: 0.6rem; color: rgba(255,255,255,.3); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ci-sc-gain { font-family: var(--font-heading); font-weight: 900; font-size: 1.8rem; color: var(--red-hot); line-height: 1; letter-spacing: -0.02em; }
.ci-sc-gainlbl { font-size: 0.65rem; color: rgba(255,107,0,.6); font-family: var(--font-mono); font-weight: 400; }
.ci-sc-arrow { font-size: 0.72rem; color: rgba(255,255,255,.4); margin-top: 4px; }
.ci-sc-arrowglyph { color: rgba(255,255,255,.2); }
.ci-sc-newpos { color: #fff; }

/* ── SFIDA DELLA SETTIMANA ─────────────────────────────────────── */
.ci-matchup-section { }
.ci-matchup {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 24px;
  align-items: center;
}
.ci-mu-athlete {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-decoration: none;
  color: inherit;
  padding: 24px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  background: #fff;
  transition: border-color .2s, transform .15s, box-shadow .2s;
}
.ci-mu-athlete:hover { border-color: var(--red-hot); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.08); }
.ci-mu-right { text-align: right; }
.ci-mu-pos { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); letter-spacing: 0.08em; }
.ci-mu-surname { font-family: var(--font-heading); font-weight: 900; font-size: clamp(1.5rem, 3vw, 2.5rem); color: #111827; line-height: 1; letter-spacing: -0.03em; text-transform: uppercase; }
.ci-mu-firstname { font-family: var(--font-heading); font-size: 0.9rem; font-weight: 400; color: var(--red-hot); }
.ci-mu-team { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); }
.ci-mu-stat { font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px; }
.ci-mu-gain { font-family: var(--font-heading); font-weight: 800; color: var(--red-hot); }
.ci-mu-vs {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ci-vs-text {
  font-family: var(--font-heading);
  font-size: 2.5rem;
  font-weight: 900;
  color: #111827;
  letter-spacing: -0.05em;
  line-height: 1;
}
.ci-vs-cat { display: flex; }

/* ── INSIGHTS ──────────────────────────────────────────────────── */
.ci-insights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.ci-insight-card {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: var(--r-md);
  padding: 20px;
}
.ci-insight-num {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--red-hot);
  letter-spacing: 0.12em;
  margin-bottom: 10px;
}
.ci-insight-text {
  font-size: 0.88rem;
  color: rgba(255,255,255,.7);
  line-height: 1.6;
  margin: 0;
}
.ci-insight-text strong { color: #fff; }

/* ── FORMA DEL MOMENTO ─────────────────────────────────────────── */
.ci-forma-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,.1) transparent;
}
.ci-forma-card {
  flex-shrink: 0;
  width: 160px;
  background: #fff;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  padding: 16px;
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: border-color .2s, transform .15s, box-shadow .2s;
}
.ci-forma-card:hover { border-color: var(--red-hot); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,.07); }
.ci-forma-cat { margin-bottom: 6px; }
.ci-forma-surname { font-family: var(--font-heading); font-weight: 800; font-size: 1rem; color: #111827; line-height: 1.1; }
.ci-forma-firstname { font-size: 0.75rem; color: var(--red-hot); }
.ci-forma-team { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ci-forma-pts { font-family: var(--font-heading); font-weight: 900; font-size: 2rem; color: #111827; line-height: 1; letter-spacing: -0.02em; }
.ci-forma-pt-lbl { font-size: 0.65rem; color: var(--text-muted); font-family: var(--font-mono); font-weight: 400; margin-left: 3px; }
.ci-forma-sub { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-muted); margin-top: 4px; }

/* ── POSIZIONI A RISCHIO ───────────────────────────────────────── */
.ci-rischio-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.15) transparent;
}
.ci-rischio-card {
  flex-shrink: 0;
  min-width: 220px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: var(--r-md);
  padding: 16px;
}
.ci-rischio-head { margin-bottom: 12px; }
.ci-rischio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,.04);
}
.ci-rischio-row:last-child { border-bottom: none; }
.ci-rischio-name { flex: 1; color: rgba(255,255,255,.75); text-decoration: none; font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ci-rischio-name:hover { color: #fff; }
.ci-rischio-pts { font-family: var(--font-mono); font-size: 0.65rem; color: rgba(255,255,255,.3); }

/* ── MOBILE ────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .ci-hero { grid-template-columns: 1fr; min-height: auto; }
  .ci-hero-right {
    border-left: none;
    border-top: 1px solid rgba(255,255,255,.06);
    min-height: auto;
    padding: 32px 20px 40px;
  }
  .ci-hero-left { padding: 60px 20px 32px; }
  .ci-row-inner { grid-template-columns: 1fr; gap: 28px; }
  .ci-matchup { grid-template-columns: 1fr; gap: 16px; }
  .ci-mu-vs { flex-direction: row; }
  .ci-vs-text { font-size: 1.5rem; }
  .ci-mu-right { text-align: left; }
  .ci-insights-grid { grid-template-columns: 1fr; }
  .ci-scalatori-scroll, .ci-forma-scroll, .ci-rischio-scroll { gap: 10px; }
  .ci-scalatore-card, .ci-forma-card { width: 140px; }
  .ci-rischio-card { min-width: 200px; }
  .ci-light-section, .ci-dark-section { padding: 36px 20px; }
  .ci-row-section { padding: 36px 20px; }
}
`;

fs.appendFileSync(CSS_FILE, CSS_BLOCK, 'utf8');
console.log('design.css appended successfully.');

// ── 6. Verification ────────────────────────────────────────────
const verify = fs.readFileSync(APP_JS, 'utf8');
const checks = [
  ['ci-slide-active class in HTML',  verify.includes('ci-slide-active')],
  ['ci-dot-active class in HTML',    verify.includes('ci-dot-active')],
  ['ci-hero section',                verify.includes('ci-hero')],
  ['ci-ticker section',              verify.includes('ci-ticker')],
  ['ci-dark-section',                verify.includes('ci-dark-section')],
  ['carousel total clamped',         verify.includes('Math.min(heroRaces.length, 6)')],
  ['carousel interval 7000',         verify.includes('7000')],
  ['old hero-slide class gone',      !verify.includes("classList.remove('active')")],
  ['old total = heroRaces.length',   !verify.includes('const total = heroRaces.length')],
  ['MONTHS_SHORT not duplicated',    (verify.match(/const MONTHS_SHORT/g)||[]).length === 1],
];

let allOk = true;
for (const [label, ok] of checks) {
  const icon = ok ? 'OK' : 'FAIL';
  if (!ok) allOk = false;
  console.log(`  [${icon}] ${label}`);
}
if (allOk) {
  console.log('\nAll checks passed.');
} else {
  console.error('\nSome checks failed — review the output above.');
  process.exit(1);
}
