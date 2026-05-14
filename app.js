/* ============================================================
   ItaliacritResultati — app.js
   Hash Router + Page Renderers
   Legge i JSON statici da data/ via fetch()
   ============================================================ */

'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────
const BASEPTS = { 1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1 };

// ── REGION NORMALIZATION ───────────────────────────────────────
const ITALIAN_REGIONS = [
  "TRENTINO ALTO ADIGE", "FRIULI VENEZIA GIULIA", "VALLE D AOSTA", "EMILIA ROMAGNA",
  "ABRUZZO","BASILICATA","CALABRIA","CAMPANIA","LAZIO","LIGURIA","LOMBARDIA",
  "MARCHE","MOLISE","PIEMONTE","PUGLIA","SARDEGNA","SICILIA","TOSCANA",
  "UMBRIA","VENETO","BOLZANO","TRENTO"
];
function normalizeRegion(s) {
  if (!s) return '';
  const t = s.toUpperCase().trim();
  // Ordina per lunghezza discendente: le più lunghe prima (EMILIA ROMAGNA prima di EMILIA)
  for (const reg of ITALIAN_REGIONS) {
    if (t.startsWith(reg)) return reg;
  }
  return t;
}

// ── DATA CACHE ────────────────────────────────────────────────
const cache = {};
async function loadJson(path) {
  if (cache[path]) return cache[path];
  try {
    const ts = Date.now();
    const fetchPath = path.includes('?') ? `${path}&_t=${ts}` : `${path}?_t=${ts}`;
    const r = await fetch(fetchPath, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    cache[path] = data;
    return data;
  } catch (e) {
    console.warn(`loadJson(${path}):`, e);
    return null;
  }
}

// Preload tutto in parallelo
async function loadAll() {
  const [calendar, resultsRaw, athletes, teams, meta, raceDetails] = await Promise.all([
    loadJson('data/calendar.json'),
    loadJson('data/results_raw.json'),
    loadJson('data/athletes.json'),
    loadJson('data/teams.json'),
    loadJson('data/meta.json'),
    loadJson('data/race_details.json'),
  ]);

  // Indicizzazione per calcolo trend rapidi
  const resultsByAtleta = {};
  const resultsByTeam = {};
  (resultsRaw || []).forEach(r => {
    if (r.atleta_id) {
      if (!resultsByAtleta[r.atleta_id]) resultsByAtleta[r.atleta_id] = [];
      resultsByAtleta[r.atleta_id].push(r);
    }
    if (r.team_id) {
      if (!resultsByTeam[r.team_id]) resultsByTeam[r.team_id] = [];
      resultsByTeam[r.team_id].push(r);
    }
  });
  // Ordina per data decrescente
  Object.values(resultsByAtleta).forEach(list => {
    list.sort((a,b) => (b.data||'').localeCompare(a.data||''));
  });
  Object.values(resultsByTeam).forEach(list => {
    list.sort((a,b) => (b.data||'').localeCompare(a.data||''));
  });

  return { 
    calendar: calendar || [], 
    resultsRaw: resultsRaw || [], 
    athletes: athletes || {}, 
    teams: teams || {}, 
    meta: meta || {},
    raceDetails: raceDetails || {},
    resultsByAtleta,
    resultsByTeam
  };
}

const RANKING_CODES = [
  'ES1_M','ES2_M','AL_M','JUN_M','ELI_M',
  'ES1_F','ES2_F','AL_F','JUN_F','ELI_F'
];

async function loadRanking(code) {
  const data = await loadJson(`data/rankings/${code}.json`);
  return data || [];
}

async function loadTeamRanking(code) {
  const data = await loadJson(`data/team_rankings/${code}.json`);
  return data || [];
}

// ── UTILITY ───────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  const months = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const [,m,d] = iso.split('-');
  const months = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];
  return `${parseInt(d)} ${months[parseInt(m)-1]}`;
}

function badgeCat(code) {
  const label = catLabel(code);
  const cls = code.replace(/[^a-zA-Z]/g, '').toLowerCase(); // as a safe class name
  return `<span class="badge-cat badge-${cls}">${esc(label)}</span>`;
}

function badgeMult(m, tipo, isCR = false, isCI = false) {
  isCR = isCR || (tipo === 'campionato_regionale');
  isCI = isCI || (tipo === 'campionato_italiano');
  const isNat = (m === 2 || tipo === 'nazionale');
  const isInt = (m === 3 || tipo === 'internazionale');
  
  if (isCI) return `<span class="res-badge blue-badge">Campionato Italiano (x3)</span>`;
  if (isCR) return `<span class="res-badge orange-badge">Campionato Regionale (x2)</span>`;
  
  const cls = isInt ? 'blue-badge' : (isNat ? 'orange-badge' : 'gray-badge');
  const label = isInt ? 'Int.le' : (isNat ? 'Naz.le' : 'Reg.le');
  return `<span class="res-badge ${cls}">${label} (x${m})</span>`;
}

function catLabel(code) {
  const map = {
    ES_M: 'Esordienti M',
    ES1_M:'Esordienti 1° Anno', 
    ES2_M:'Esordienti 2° Anno', 
    AL_M: 'Allievi', 
    AL1_M:'Allievi 1° Anno', 
    AL2_M:'Allievi 2° Anno',
    JUN_M:'Juniores',        
    ELI_M:'Elite - U23',
    ES_F: 'Donne Esordienti', 
    ES1_F:'Donne Esordienti 1° Anno', 
    ES2_F:'Donne Esordienti 2° Anno', 
    AL_F: 'Donne Allieve', 
    AL1_F:'Donne Allieve 1° Anno', 
    AL2_F:'Donne Allieve 2° Anno',
    JUN_F:'Donne Juniores',      
    ELI_F:'Donne Elite - U23'
  };
  return map[code] || code;
}

function getRankingFileCode(obj) {
  if (!obj) return null;
  // If it's just a string like 'AL1_M' or 'JUN_M'
  if (typeof obj === 'string') {
    if (obj.startsWith('AL')) return 'AL_' + (obj.endsWith('_F') ? 'F' : 'M');
    return obj;
  }
  // If it's an object with gara_id
  if (obj.gara_id) {
    const m = obj.gara_id.match(/_([A-Z0-9]+_[MF])$/);
    if (m) {
      let code = m[1];
      if (code.startsWith('AL')) code = 'AL_' + (code.endsWith('_F') ? 'F' : 'M');
      return code;
    }
  }
  // If it already has the backend code
  if (obj.categoria && /^[A-Z0-9]+_[MF]$/.test(obj.categoria)) return obj.categoria;
  
  return null;
}

function renderTrend(r) {
  if (!r) return '';
  const t = r.trend;
  
  if (t === undefined || t === null) {
    // Se è la prima volta che appare (o non ha storico)
    return `<span class="trend-indicator trend-new">NEW</span>`;
  }
  
  if (t > 0) return `<span class="trend-indicator trend-up">▲${t}</span>`;
  if (t < 0) return `<span class="trend-indicator trend-down">▼${Math.abs(t)}</span>`;
  return `<span class="trend-indicator trend-stable">●</span>`;
}

function posClass(p) {
  if (p === 1) return 'p1';
  if (p === 2) return 'p2';
  if (p === 3) return 'p3';
  return '';
}

function flameSvg() {
  return `<svg class="flame-svg" viewBox="0 0 14 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M7 1C7 1 11 5 11 9C11 11.7614 9.20914 14 7 14C4.79086 14 3 11.7614 3 9C3 7 4 5.5 4 5.5C4 5.5 4.5 8 6 8C6 8 5 6 7 1Z" fill="#e8001d"/>
    <path d="M7 10C7 10 8.5 11.5 8.5 13C8.5 14.3807 7.82843 15.5 7 15.5C6.17157 15.5 5.5 14.3807 5.5 13C5.5 11.5 7 10 7 10Z" fill="#f5c400"/>
  </svg>`;
}

function multFromType(tipo, isCR, isCI) {
  if (isCI || tipo === 'internazionale') return 3;
  if (isCR || tipo === 'nazionale') return 2;
  return 1;
}

// ── THEME LOGIC ───────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('italiacrit-theme') || 'dark';
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.onclick = toggleTheme;
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('italiacrit-theme', isLight ? 'light' : 'dark');
}

// ── ROUTER ────────────────────────────────────────────────────
const app = document.getElementById('app');
const footer_update = document.getElementById('footer-update');

let globalData = null;

window.addEventListener('hashchange', route);
window.addEventListener('load', async () => {
  globalData = await loadAll();
  updateMetaUI();

  document.getElementById('initial-loader')?.remove();
  initTheme();
  route();
  initSearch();
  initMobileMenu();

  // --- Sistema di AUTO-POLLING ---
  setInterval(async () => {
    try {
      const r = await fetch('data/meta.json', { cache: 'no-store' });
      const newMeta = await r.json();
      if (newMeta && newMeta.last_update) {
        if (!globalData.meta || newMeta.last_update !== globalData.meta.last_update) {
          console.log("Novità dal backend! Ricarico i dati silenziosamente...");
          // Invalida cache in memoria
          for (let k in cache) delete cache[k];
          
          globalData = await loadAll();
          updateMetaUI();
          route(); // Ri-renderizza la dashboard corrente con i nuovi dati
        }
      }
    } catch (e) {
      console.warn("Auto-polling fallito:", e);
    }
  }, 180000); // 3 minuti
});

function updateMetaUI() {
  if (globalData.meta?.last_update) {
    const d = new Date(globalData.meta.last_update);
    if(footer_update) footer_update.textContent = d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    
    // Live badge se l'update è recente (< 2 ore)
    const ageMs = Date.now() - d.getTime();
    const badge = document.getElementById('badge-live');
    if (badge) {
      if (ageMs < 2 * 3600 * 1000) badge.classList.add('visible');
      else badge.classList.remove('visible');
    }
  }
}

function route() {
  const hash = window.location.hash || '#/';
  updateNavActive(hash);

  const match = (pattern) => {
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
    return hash.replace('#', '').match(re);
  };

  if (match('/')) return renderHome();
  if (match('/classifica')) return renderClassifica();
  if (match('/atleti')) return renderAtletiList();
  if (match('/team')) return renderTeamList();
  if (match('/risultati')) {
    risSearchQuery = ''; risQueryCat = ''; risQueryMonth = ''; risQueryRegion = ''; risQueryGenere = '';
    return renderRisultati();
  }
  if (match('/calendario')) return renderCalendario();
  if (match('/statistiche')) return renderStatistiche();
  if (match('/comparatore')) return renderComparatore();
  if (match('/regolamento')) return renderRegolamento();
  if (match('/admin')) return renderAdmin();
  const m_atleta = match('/atleta/:id');
  if (m_atleta) return renderAtleta(m_atleta[1]);
  const m_team = match('/team/:id');
  if (m_team) return renderTeam(m_team[1]);
  const m_gara = match('/gara/:id');
  if (m_gara) return renderGara(m_gara[1]);

  renderNotFound();
}

function updateNavActive(hash) {
  ['nav-home','nav-class','nav-atleti','nav-team','nav-cal','nav-risultati','nav-reg','nav-stats','nav-comp'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  if (hash === '#/' || hash === '#') document.getElementById('nav-home')?.classList.add('active');
  else if (hash.startsWith('#/classifica')) document.getElementById('nav-class')?.classList.add('active');
  else if (hash.startsWith('#/atleti')) document.getElementById('nav-atleti')?.classList.add('active');
  else if (hash.startsWith('#/team')) document.getElementById('nav-team')?.classList.add('active');
  else if (hash.startsWith('#/risultati')) document.getElementById('nav-risultati')?.classList.add('active');
  else if (hash.startsWith('#/statistiche')) document.getElementById('nav-stats')?.classList.add('active');
  else if (hash.startsWith('#/comparatore')) document.getElementById('nav-comp')?.classList.add('active');
  else if (hash.startsWith('#/admin')) document.getElementById('nav-admin')?.classList.add('active');
}

function setPage(html) {
  if (window.homeHeroInterval) {
    clearInterval(window.homeHeroInterval);
    window.homeHeroInterval = null;
  }
  app.innerHTML = `<main class="page page-enter">${html}</main>`;
}

// ── HOME ──────────────────────────────────────────────────────
async function renderHome() {
  if (!globalData) return;
  const { calendar, resultsRaw } = globalData;

  // Ultime 5 gare (per data desc)
  const raceMap = {};
  for (const r of resultsRaw) {
    if (!raceMap[r.gara_id]) raceMap[r.gara_id] = { id: r.gara_id, nome: r.nome_gara, data: r.data, categoria: r.categoria, genere: r.genere, tipo: r.tipo, isCR: r.campionato_regionale, isCI: r.campionato_italiano, mult: r.moltiplicatore, results: [] };
    raceMap[r.gara_id].results.push(r);
  }

  const races = Object.values(raceMap)
    .sort((a,b) => (b.data || '').localeCompare(a.data || ''))
    .slice(0, 20);

  // Ultime gare della "Settimana" (Ultimi 7 giorni a partire dall'ultima gara in assoluto)
  const lastDateStr = races[0]?.data || '';
  const lastDateTs = lastDateStr ? new Date(lastDateStr).getTime() : 0;
  
  const heroRaces = races.filter(r => {
    if (!r.data) return false;
    const rTs = new Date(r.data).getTime();
    return rTs >= (lastDateTs - 7 * 86400 * 1000);
  });

  let heroHtml = '';
  if (heroRaces.length > 0) {
    heroHtml = `
      <div id="hero-carousel-container" style="position:relative; width:100%;">
        ${heroRaces.map((lr, idx) => {
          const top3 = (lr.results || []).sort((a,b)=>a.posizione-b.posizione).slice(0,3);
          const mult = lr.mult || 1;
          return `
            <div class="hero-band hero-slide" id="hero-slide-${idx}" style="display: ${idx===0 ? 'block' : 'none'}; animation: fadeIn 0.5s;">
              <div class="hero-label">ULTIMI RISULTATI (${idx+1}/${heroRaces.length}) &nbsp; &mdash; &nbsp; ROTAZIONE AUTOMATICA</div>
              <div class="hero-race-name"><a href="#/gara/${esc(lr.id)}" style="color:var(--text-primary);text-decoration:none">${esc(lr.nome)}</a></div>
              <div class="hero-race-meta">
                <span>${fmtDate(lr.data)}</span>
                <span>${esc(catLabel(lr.categoria) || '')}</span>
                ${badgeMult(mult, lr.tipo, lr.isCR, lr.isCI)}
              </div>
              <div class="hero-divider"></div>
              <div class="hero-podio">
                ${top3.map((r,i) => {
                  const pClass = ['p1','p2','p3'][i];
                  const pts = (BASEPTS[r.posizione]||0) * mult;
                  return `<div class="hero-podio-row" style="animation-delay:${i*80}ms">
                    <div class="hero-pos ${pClass}">${i+1}°</div>
                    <div>
                      <div class="hero-name">
                        <a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a>
                      </div>
                      <div class="hero-team">
                        <a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team)}</a>
                      </div>
                    </div>
                    <div class="hero-pts">${pts} pt</div>
                  </div>`;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    
    // Attivazione carosello automatico
    if (heroRaces.length > 1) {
      setTimeout(() => {
        let currentSlide = 0;
        window.homeHeroInterval = setInterval(() => {
          const prev = document.getElementById(`hero-slide-${currentSlide}`);
          if (prev) prev.style.display = 'none';
          currentSlide = (currentSlide + 1) % heroRaces.length;
          const next = document.getElementById(`hero-slide-${currentSlide}`);
          if (next) next.style.display = 'block';
        }, 5000);
      }, 100);
    }
  }

  let carouselHtml = ''; // rimosso il carousel vecchio come da richiesta

  // Top 3 per categoria
  const catOrder = ['ELI_M','JUN_M','AL_M','ES2_M','ES1_M','ELI_F','JUN_F','AL_F','ES2_F','ES1_F'];
  const catCardsHtml = await (async () => {
    const cards = [];
    for (const code of catOrder) {
      const ranking = await loadRanking(code);
      const top3 = ranking.slice(0, 3);
      if (!top3.length) continue;
      const isF = code.endsWith('_F');
      cards.push(`
        <div class="cat-card">
          <div class="cat-card-header">
            ${badgeCat(code)}
            <span class="cat-card-title">${esc(catLabel(code))}</span>
            ${isF ? '<span class="badge-cat badge-genere-f">♀</span>' : ''}
          </div>
          <div class="cat-card-body">
            ${top3.map((r,i) => `
              <div class="cat-card-row">
                <span class="cat-pos ${posClass(i+1)}">${i+1}</span>
                <div>
                  <div class="cat-rider-name">
                    <a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a>
                    ${renderTrend(r)}
                  </div>
                  <div class="cat-rider-team">
                    <a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team_nome)}</a>
                  </div>
                </div>
                <span class="cat-pts">${r.punti}</span>
              </div>`).join('')}
          </div>
          <div style="padding: 10px 16px; border-top: 1px solid var(--border-subtle); background: var(--bg-secondary);">
             <a href="#/classifica" onclick="window.navigateToRank('${code}', '${isF ? 'F' : 'M'}')" class="btn-action full" style="font-size:0.7rem;">VAI ALLA CLASSIFICA &rarr;</a>
          </div>
        </div>`);
    }
    return cards.join('');
  })();

  setPage(`
    ${heroHtml}
    ${carouselHtml}
    <div class="section-header">
      <span class="section-title">CLASSIFICHE</span>
      <span class="section-line"></span>
      <span class="section-subtitle">Top 3 per categoria</span>
    </div>
    <div class="cat-grid">${catCardsHtml}</div>
  `);
}

// ── CLASSIFICA ────────────────────────────────────────────────
window.navigateToRank = (cat, gender) => {
  rankGender = gender;
  rankCat = cat;
  rankFilter = '';
};

let rankGender = 'M';
let rankCat    = 'ES1_M';
let rankFilter = '';
let rankView   = 'atleti'; // 'atleti' | 'team'
let rankRegion = '';
let rankMonth  = '';

async function renderClassifica() {
  if ((rankGender === 'M' && rankCat.endsWith('_F')) ||
      (rankGender === 'F' && !rankCat.endsWith('_F'))) {
    rankCat = rankGender === 'M' ? 'ES1_M' : 'ES1_F';
  }

  const catsMale   = ['ES1_M','ES2_M','AL_M','JUN_M','ELI_M'];
  const catsFemale = ['ES1_F','ES2_F','AL_F','JUN_F','ELI_F'];
  const currentCats = rankGender === 'M' ? catsMale : catsFemale;

  const genderTabs = ['M','F'].map(g => `
    <button class="tab-btn ${rankGender===g?'active-gender':''}" id="tab-gender-${g}" onclick="setRankGender('${g}')">${g==='M'?'UOMINI':'DONNE'}</button>
  `).join('');
  const catTabs = currentCats.map(c => `
    <button class="tab-btn ${rankCat===c?'active-cat':''}" id="tab-cat-${c}" onclick="setRankCat('${c}')">${catLabel(c)}</button>
  `).join('');
  const viewTabs = `
    <div class="tab-group" role="tablist" aria-label="Vista" style="margin-left:auto">
      <button class="tab-btn ${rankView==='atleti'?'active-cat':''}" onclick="setRankView('atleti')">👤 ATLETI</button>
      <button class="tab-btn ${rankView==='team'?'active-cat':''}" onclick="setRankView('team')">🏢 TEAM</button>
    </div>`;

  const regions = [...new Set(globalData.resultsRaw.map(r => normalizeRegion(r.regione)).filter(Boolean))].sort();
  const regionOptions = regions.map(r => `<option value="${r}" ${rankRegion===r?'selected':''}>${esc(r)}</option>`).join('');
  
  const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const monthOptions = monthNames.map((n, i) => {
    const v = String(i+1).padStart(2,'0');
    return `<option value="${v}" ${rankMonth===v?'selected':''}>${n}</option>`;
  }).join('');

  setPage(`
    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:28px">CLASSIFICHE</h1>

    <!-- Parallel Leaderboards Section -->
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:24px; margin-bottom:40px;">
      <div class="hero-band" style="padding:20px; background:var(--gradient-male)">
        <div class="hero-label">LEADER MENSILI</div>
        <div style="font-size:1.2rem; font-weight:700; color:var(--red-hot); margin-bottom:12px">Categorie Uomini</div>
        <div id="parallel-male-ranking"></div>
      </div>
      <div class="hero-band" style="padding:20px; background:var(--gradient-female)">
        <div class="hero-label">LEADER MENSILI</div>
        <div style="font-size:1.2rem; font-weight:700; color:var(--text-secondary); margin-bottom:12px">Categorie Donne</div>
        <div id="parallel-female-ranking"></div>
      </div>
    </div>

    <div class="ranking-controls">
      <div class="tab-group" role="tablist" aria-label="Seleziona genere">${genderTabs}</div>
      <div class="tab-group" role="tablist" aria-label="Seleziona categoria">${catTabs}</div>
      
      <div class="calendar-controls" style="margin-top:16px; margin-bottom:16px;">
        <select class="cal-filter-select" onchange="window.setRankRegion(this.value)" aria-label="Filtra per regione">
          <option value="">Tutte le Regioni</option>
          ${regionOptions}
        </select>
        <select class="cal-filter-select" onchange="window.setRankMonth(this.value)" aria-label="Filtra per mese">
          <option value="">Tutti i Mesi</option>
          ${monthOptions}
        </select>
        <div class="ranking-filter-bar" style="margin:0; flex-grow:1">
          <input type="search" id="ranking-search"
            placeholder="${rankView==='atleti'?'Filtra nome…':'Filtra team…'}"
            value="${esc(rankFilter)}"
            oninput="setRankFilter(this.value)"
            aria-label="Filtra classifica" />
        </div>
      </div>

      <div class="ranking-filter-bar" style="border-top:1px solid var(--border-subtle); padding-top:12px">
        <span class="ranking-count" id="rank-count-label">Caricamento...</span>
        ${viewTabs}
      </div>
    </div>
    <div class="ranking-table-wrap" id="rank-table-container"></div>
  `);

  renderParallelRankings();

  await updateRankTable();
}

async function updateRankTable() {
  const container = document.getElementById('rank-table-container');
  const countSpan = document.getElementById('rank-count-label');
  if (!container || !countSpan) return;

  let tableHtml = '';
  let countLabel = '';

  // Se i filtri regione/mese sono attivi, ricalcoliamo dinamicamente dai risultati raw
  const isFiltered = rankRegion || rankMonth;
  
  if (rankView === 'atleti') {
    let ranking = [];
    if (!isFiltered) {
      ranking = await loadRanking(rankCat);
    } else {
      // Calcolo dinamico
      const { resultsRaw } = globalData;
      const agg = {};
      // Precompute calendar mapping to resolve regions missing in resultsRaw
      const calMap = {};
      globalData.calendar.forEach(g => calMap[g.id] = g);

      resultsRaw.forEach(r => {
        if (r.genere !== rankGender) return;
        // Check categoria
        const rCat = getRankingFileCode(r); 
        if (rCat !== rankCat) return;

        const calEntry = calMap[r.gara_id];
        const resolvedRegion = normalizeRegion(r.regione || (calEntry ? calEntry.regione : ''));

        if (rankRegion && resolvedRegion !== rankRegion) return;
        if (rankMonth && r.data && r.data.split('-')[1] !== rankMonth) return;

        if (!agg[r.atleta_id]) {
          agg[r.atleta_id] = { 
            atleta_id: r.atleta_id, cognome: r.cognome, nome: r.nome, 
            team_id: r.team_id, team_nome: r.team, punti: 0, gare: 0, 
            p1:0, p2:0, p3:0, pout:0 
          };
        }
        agg[r.atleta_id].punti += (r.punti_effettivi || 0);
        agg[r.atleta_id].gare++;
        if (r.posizione === 1) agg[r.atleta_id].p1++;
        else if (r.posizione === 2) agg[r.atleta_id].p2++;
        else if (r.posizione === 3) agg[r.atleta_id].p3++;
        else agg[r.atleta_id].pout++;
      });
      ranking = Object.values(agg).sort((a,b) => b.punti - a.punti);
      ranking.forEach((r, i) => r.pos = i+1);
    }

    const filtered = ranking.filter(r => {
      if (!rankFilter) return true;
      const q = rankFilter.toLowerCase();
      return (r.cognome||'').toLowerCase().includes(q) ||
             (r.nome||'').toLowerCase().includes(q) ||
             (r.team_nome||'').toLowerCase().includes(q);
    });
    countLabel = `${filtered.length} atleti`;

    const rows = filtered.map((r, i) => {
      const pClass = posClass(r.pos);
      return `<tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${pClass}">${r.pos}</span></td>
        <td style="text-align:center;width:40px">${renderTrend(r)}</td>
        <td><span class="rank-name"><a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a></span></td>
        <td class="hide-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary);font-size:.85rem">${esc(r.team_nome)}</a></td>
        <td class="r"><span class="rank-pts">${r.punti}</span></td>
        <td class="r hide-mobile" style="color:var(--text-secondary);font-family:var(--font-mono);font-size:.85rem">${r.gare||0}</td>
        <td class="hide-mobile">
          <div class="td-p-wrap">
            <span class="td-p p1" title="Vittorie">${r.p1||0}</span>
            <span class="td-p p2" title="Secondi Posti">${r.p2||0}</span>
            <span class="td-p p3" title="Terzi Posti">${r.p3||0}</span>
            <span class="td-p pout" title="Piazzamenti 4-10">${r.pout||0}</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    tableHtml = `
      <table class="ranking-table">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th style="width:40px" title="Trend (Progressione in classifica)">↕</th>
          <th>ATLETA</th>
          <th class="hide-mobile">TEAM</th>
          <th class="r">PUNTI</th>
          <th class="r hide-mobile">GARE</th>
          <th class="hide-mobile">PODI / TOP10</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty-state">Nessun dato</td></tr>'}</tbody>
      </table>`;

  } else {
    // ── TEAM RANKING ───────────────────────────────────────────
    let teamRanking = [];
    if (!isFiltered) {
      teamRanking = await loadTeamRanking(rankCat);
    } else {
      // Calcolo dinamico team
      const { resultsRaw } = globalData;
      const agg = {};
      const calMap = {};
      globalData.calendar.forEach(g => calMap[g.id] = g);

      resultsRaw.forEach(r => {
        if (r.genere !== rankGender) return;
        const rCat = getRankingFileCode(r); 
        if (rCat !== rankCat) return;

        const calEntry = calMap[r.gara_id];
        const resolvedRegion = normalizeRegion(r.regione || (calEntry ? calEntry.regione : ''));

        if (rankRegion && resolvedRegion !== rankRegion) return;
        if (rankMonth && r.data && r.data.split('-')[1] !== rankMonth) return;

        if (!agg[r.team_id]) {
          agg[r.team_id] = { team_id: r.team_id, team_nome: r.team, punti: 0, p1:0, p2:0, p3:0, pout:0, atleti: new Set() };
        }
        agg[r.team_id].punti += (r.punti_effettivi || 0);
        agg[r.team_id].atleti.add(r.atleta_id);
        if (r.posizione === 1) agg[r.team_id].p1++;
        else if (r.posizione === 2) agg[r.team_id].p2++;
        else if (r.posizione === 3) agg[r.team_id].p3++;
        else agg[r.team_id].pout++;
      });
      teamRanking = Object.values(agg).sort((a,b) => b.punti - a.punti);
      teamRanking.forEach((t, i) => { t.pos = i+1; t.n_atleti = t.atleti.size; });
    }

    const filtered = teamRanking.filter(t => {
      if (!rankFilter) return true;
      return (t.team_nome||'').toLowerCase().includes(rankFilter.toLowerCase());
    });
    countLabel = `${filtered.length} team`;

    const rows = filtered.map((t, i) => {
      const pClass = posClass(t.pos);
      return `<tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${pClass}">${t.pos}</span></td>
        <td><span class="rank-name"><a href="#/team/${esc(t.team_id)}">${esc(t.team_nome)}</a></span></td>
        <td class="r"><span class="rank-pts">${t.punti}</span></td>
        <td class="hide-mobile">
          <div class="td-p-wrap">
            <span class="td-p p1">${t.p1||0}</span>
            <span class="td-p p2">${t.p2||0}</span>
            <span class="td-p p3">${t.p3||0}</span>
            <span class="td-p pout">${t.pout||0}</span>
          </div>
        </td>
        <td class="r hide-mobile" style="font-family:var(--font-mono);font-size:.85rem;color:var(--text-muted)">${t.n_atleti||0}</td>
      </tr>`;
    }).join('');

    tableHtml = `
      <table class="ranking-table">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th>TEAM</th>
          <th class="r">PUNTI</th>
          <th class="hide-mobile">PODI / TOP10</th>
          <th class="r hide-mobile">ATLETI</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty-state">Nessun dato</td></tr>'}</tbody>
      </table>`;
  }

  container.innerHTML = tableHtml;
  countSpan.textContent = countLabel;
}

// ── ADMIN DASHBOARD ──────────────────────────────────────────
async function renderAdmin() {
  if (!globalData) return;
  
  // Carichiamo gli override salvati
  const overrides = await loadJson('data/user_overrides.json') || {};
  const { resultsRaw } = globalData;
  
  // Raggruppa per GARA EVENTO (Nome + Data), ignorando la categoria
  const raceMap = {};
  resultsRaw.forEach(r => {
    const eventId = slug(r.nome_gara) + "_" + r.data;
    if (!raceMap[eventId]) {
      const ov = overrides[eventId] || {};
      raceMap[eventId] = { 
        id: eventId, // ID EVENTO (Usato per l'override)
        nome: r.nome_gara, 
        data: r.data, 
        mult: ov.mult || r.moltiplicatore, 
        tipo: ov.tipo || r.tipo,
        cats: new Set(),
        pos_base: r.posizione
      };
    }
    raceMap[eventId].cats.add(r.categoria);
  });
  
  const races = Object.values(raceMap).sort((a,b) => (b.data||'').localeCompare(a.data||''));

  setPage(`
    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:8px">ADMIN DASHBOARD</h1>
    <p style="color:var(--text-muted);margin-bottom:32px">Gestione centralizzata per evento (tutte le categorie della stessa gara).</p>

    <div class="ranking-controls" style="margin-bottom:24px">
      <div style="display:flex; gap:16px; align-items:center">
        <div class="ranking-filter-bar" style="margin:0; flex-grow:1">
          <input type="search" id="admin-search" placeholder="Cerca gara per nome..." oninput="filterAdminRaces(this.value)" />
        </div>
        <button class="btn-action" onclick="triggerSync()" id="btn-sync" style="background:var(--accent); color:white; border:none">
          🔄 SINCRONIZZA & RICALCOLA
        </button>
      </div>
    </div>

    <div id="admin-races-container">
      <table class="ranking-table">
        <thead>
          <tr>
            <th>DATA</th>
            <th>GARA</th>
            <th>CAT</th>
            <th class="r">PUNTI (Simulati)</th>
            <th class="r">MOLTIPLICATORE</th>
            <th>TIPO</th>
          </tr>
        </thead>
        <tbody id="admin-table-body">
          ${renderAdminRows(races.slice(0, 50))}
        </tbody>
      </table>
      ${races.length > 50 ? `<div style="text-align:center;padding:20px;color:var(--text-muted)">Filtra per vedere altre gare...</div>` : ''}
    </div>
  `);
}

function renderAdminRows(races) {
  return races.map(r => {
    const basePts = (r.pos_base === 1) ? 15 : (r.pos_base <= 10 ? (BASEPTS[r.pos_base] || 0) : 0);
    const simulatedPts = basePts * r.mult;
    const catList = Array.from(r.cats).map(c => badgeCat(c)).join(' ');
    
    return `
    <tr>
      <td style="font-family:var(--font-mono);font-size:0.8rem">${r.data}</td>
      <td>
        <div style="font-weight:700;font-size:0.9rem">${esc(r.nome)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted)">${r.id}</div>
      </td>
      <td><div style="display:flex; flex-wrap:wrap; gap:4px">${catList}</div></td>
      <td class="r">
        <span style="font-weight:800; color:var(--red-hot); font-size:1.1rem">${simulatedPts}</span>
        <div style="font-size:0.6rem; color:var(--text-muted)">(${basePts} x ${r.mult})</div>
      </td>
      <td class="r">
        <div class="tab-group" style="justify-content:flex-end">
          <button class="tab-btn ${r.mult===1?'active-cat':''}" onclick="setOverride('${r.id}', 1, '${r.tipo}')">x1</button>
          <button class="tab-btn ${r.mult===2?'active-cat':''}" onclick="setOverride('${r.id}', 2, '${r.tipo}')">x2</button>
          <button class="tab-btn ${r.mult===3?'active-cat':''}" onclick="setOverride('${r.id}', 3, '${r.tipo}')">x3</button>
        </div>
      </td>
      <td>
        <select class="cal-filter-select" style="padding:4px 8px;font-size:0.8rem" onchange="setOverride('${r.id}', null, this.value)">
          <option value="regionale" ${r.tipo==='regionale'?'selected':''}>Regionale</option>
          <option value="nazionale" ${r.tipo==='nazionale'?'selected':''}>Nazionale</option>
          <option value="internazionale" ${r.tipo==='internazionale'?'selected':''}>Internazionale</option>
          <option value="campionato_regionale" ${r.tipo==='campionato_regionale'?'selected':''}>Campionato Regionale (x2)</option>
          <option value="campionato_italiano" ${r.tipo==='campionato_italiano'?'selected':''}>Campionato Italiano (x3)</option>
        </select>
      </td>
    </tr>
  `}).join('');
}

window.filterAdminRaces = (val) => {
  const q = val.toLowerCase();
  const { resultsRaw } = globalData;
  const raceMap = {};
  
  resultsRaw.forEach(r => {
    const eventId = slug(r.nome_gara) + "_" + r.data;
    if (r.nome_gara.toLowerCase().includes(q) && !raceMap[eventId]) {
      raceMap[eventId] = { 
        id: eventId, 
        nome: r.nome_gara, 
        data: r.data, 
        mult: r.moltiplicatore, 
        tipo: r.tipo, 
        cats: new Set(),
        pos_base: r.posizione
      };
    }
    if (raceMap[eventId]) raceMap[eventId].cats.add(r.categoria);
  });
  
  const filtered = Object.values(raceMap).sort((a,b) => (b.data||'').localeCompare(a.data||'')).slice(0, 50);
  const container = document.getElementById('admin-table-body');
  if (container) container.innerHTML = renderAdminRows(filtered);
};

window.setOverride = async (id, mult, tipo) => {
  const btnSync = document.getElementById('btn-sync');
  const originalText = btnSync.textContent;
  btnSync.textContent = "💾 SALVATAGGIO...";
  
  // Se il moltiplicatore è null, lo determiniamo in base al tipo
  if (mult === null) {
    if (tipo === 'campionato_regionale') mult = 2;
    else if (tipo === 'campionato_italiano') mult = 3;
    else {
      // Cerca il record attuale nei dati globali
      const race = globalData.resultsRaw.find(rx => rx.gara_id === id);
      mult = race ? race.moltiplicatore : 1;
    }
  }

  console.log("Saving override:", id, mult, tipo);
  try {
    const response = await fetch('/api/save_override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, mult, tipo })
    });
    
    if (response.ok) {
      // Aggiorna UI locale per TUTTI i record che appartengono a questo evento
      globalData.resultsRaw.forEach(row => {
        const rowEventId = slug(row.nome_gara) + "_" + row.data;
        if (rowEventId === id) {
          row.moltiplicatore = mult;
          row.tipo = tipo;
        }
      });
      // Forza re-render della riga
      const q = document.getElementById('admin-search')?.value || '';
      window.filterAdminRaces(q);
      btnSync.textContent = "✅ SALVATO!";
      setTimeout(() => { btnSync.textContent = originalText; }, 2000);
    }
  } catch (e) {
    alert("Errore nel salvataggio: " + e.message);
    btnSync.textContent = originalText;
  }
};

window.triggerSync = async () => {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true;
  btn.textContent = "⌛ ELABORAZIONE IN CORSO...";
  try {
    const r = await fetch('/api/trigger_scraper', { method: 'POST' });
    if (r.ok) {
      alert("Sincronizzazione avviata! I dati si aggiorneranno tra circa 1-2 minuti.");
    }
  } catch (e) {
    alert("Errore: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 SINCRONIZZA & RICALCOLA";
  }
};

window.setRankGender = (g) => { rankGender = g; rankFilter = ''; rankRegion = ''; rankMonth = ''; renderClassifica(); };
window.setRankCat    = (c) => { rankCat = c; rankFilter = ''; rankRegion = ''; rankMonth = ''; renderClassifica(); };
window.setRankFilter = (v) => { rankFilter = v; updateRankTable(); };
window.setRankView   = (v) => { rankView = v; rankFilter = ''; rankRegion = ''; rankMonth = ''; renderClassifica(); };
window.setRankRegion = (v) => { rankRegion = v; updateRankTable(); };
window.setRankMonth  = (v) => { rankMonth = v; updateRankTable(); };

// ── PARALLEL RANKINGS ────────────────────────────────────────
async function renderParallelRankings() {
  const maleBox = document.getElementById('parallel-male-ranking');
  const femaleBox = document.getElementById('parallel-female-ranking');
  if (!maleBox || !femaleBox) return;

  const { resultsRaw } = globalData;
  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  
  const maleCats = ['ELI_M', 'JUN_M', 'AL_M', 'ES2_M', 'ES1_M'];
  const femaleCats = ['ELI_F', 'JUN_F', 'AL_F', 'ES2_F', 'ES1_F'];

  const getLeaders = (cats) => {
    const leaders = {};
    cats.forEach(c => leaders[c] = { athlete: null, pts: -1 });

    resultsRaw.forEach(r => {
      if (!r.data) return;
      const rMonth = r.data.split('-')[1];
      if (rMonth !== currentMonth) return;

      const catCode = getRankingFileCode(r);
      if (leaders[catCode]) {
        if (!leaders[catCode].agg) leaders[catCode].agg = {};
        const aid = r.atleta_id;
        if (!leaders[catCode].agg[aid]) leaders[catCode].agg[aid] = { name: `${r.cognome} ${r.nome}`, pts: 0 };
        leaders[catCode].agg[aid].pts += (r.punti_effettivi || 0);
      }
    });

    // In ogni categoria, trova chi ha più punti
    return cats.map(c => {
      const agg = leaders[c].agg || {};
      const sorted = Object.values(agg).sort((a,b) => b.pts - a.pts);
      return { 
        cat: c, 
        athlete: sorted[0] || null 
      };
    });
  };

  const maleLeaders = getLeaders(maleCats);
  const femaleLeaders = getLeaders(femaleCats);

  const renderList = (list) => {
    return `
      <div style="display:flex; flex-direction:column; gap:8px">
        ${list.map(item => `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; background:var(--bg-secondary); border:1px solid var(--border-subtle); border-radius:4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05)">
            <div style="width:110px">${badgeCat(item.cat)}</div>
            <div style="flex-grow:1; font-size:0.9rem; font-family:var(--font-heading); font-weight:600; text-transform:uppercase; color:var(--text-primary)">
              ${item.athlete ? `<a href="#/atleta/${esc(resultsRaw.find(r => `${r.cognome} ${r.nome}` === item.athlete.name)?.atleta_id)}">${esc(item.athlete.name)}</a>` : '<span style="color:var(--text-muted)">—</span>'}
            </div>
            <div class="rank-pts" style="font-size:1.1rem; min-width:35px; text-align:right">
              ${item.athlete ? item.athlete.pts : '0'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  };

  maleBox.innerHTML = renderList(maleLeaders);
  femaleBox.innerHTML = renderList(femaleLeaders);
}

// ── ATLETA ────────────────────────────────────────────────────
async function renderAtleta(atleta_id) {
  if (!globalData) return;
  const { athletes, calendar } = globalData;

  const a = athletes[atleta_id];
  if (!a) return renderNotFound();

  // Lookup moltiplicatori dal calendario
  const calMap = {};
  for (const g of calendar) calMap[g.id] = g;

  const risultati = (a.risultati || []).sort((x,y) => (y.data||'').localeCompare(x.data||''));

  // Stats
  const p1 = risultati.filter(r => r.posizione === 1).length;
  const p2 = risultati.filter(r => r.posizione === 2).length;
  const p3 = risultati.filter(r => r.posizione === 3).length;
  const pout = risultati.filter(r => r.posizione >= 4 && r.posizione <= 10).length;
  const top10 = risultati.length;
  const media = top10 ? Math.round(a.punti_totali / top10) : 0;

  // Sparkline
  const sparkPoints = risultati.slice(0,20).reverse().map(r => r.punti_effettivi || 0);

  // Recupero ranking asincrono per evitare crash
  const rCode = getRankingFileCode(a.categoria);
  const currentRanking = rCode ? await loadRanking(rCode) : [];
  const aRankObj = currentRanking.find(x => x.atleta_id === a.id);
  const globalPos = aRankObj ? aRankObj.pos : '-';

  const headerHtml = `
    <div class="athlete-header">
      <div class="athlete-header-top">
        ${badgeCat(a.categoria)}
        ${a.genere === 'F' ? '<span class="badge-cat badge-genere-f">♀</span>' : ''}
        ${a.team_id ? `<a href="#/team/${esc(a.team_id)}" style="font-family:var(--font-heading);font-size:.8rem;color:var(--text-secondary);border:1px solid var(--border-subtle);padding:2px 10px;border-radius:2px">${esc(a.team_attuale)} →</a>` : ''}
      </div>
      <div style="display:flex;gap:40px;align-items:flex-end;flex-wrap:wrap">
        <div class="athlete-header-name">
          <span class="athlete-cognome">${esc(a.cognome)}</span>
          <span class="athlete-nome">${esc(a.nome)}</span>
          <div class="athlete-pts-display">
            <div class="athlete-pts-dot"></div>
            <div>
              <div class="athlete-pts-value">${a.punti_totali}</div>
              <div class="athlete-pts-label">PUNTI STAGIONE</div>
            </div>
            ${globalPos !== '-' ? `
            <div class="athlete-pts-dot" style="background:var(--accent); margin-left:24px;"></div>
            <div>
              <div class="athlete-pts-value" style="color:var(--accent)">${globalPos}°</div>
              <div class="athlete-pts-label">CLASSIFICA GENERALE</div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="athlete-stats-bar">
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--gold)">${p1}</span>
          <span class="athlete-stat-label">1° Posto</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--silver)">${p2}</span>
          <span class="athlete-stat-label">2° Posto</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--bronze)">${p3}</span>
          <span class="athlete-stat-label">3° Posto</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--text-muted)">${pout}</span>
          <span class="athlete-stat-label">4°-10° Posti</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val">${top10}</span>
          <span class="athlete-stat-label">Tot. Gare</span>
        </div>
        <div class="athlete-stat">
          <span class="athlete-stat-val" style="color:var(--yellow-race)">${media}</span>
          <span class="athlete-stat-label">Media pt/gara</span>
        </div>
      </div>
    </div>`;

  const sparkHtml = sparkPoints.length ? buildSparkline(sparkPoints, risultati.slice(0,20).reverse()) : '';

  const tableRows = risultati.map(r => {
    const mult = r.moltiplicatore || 1;
    const pClass = posClass(r.posizione);
    // Recupero rank atleta dopo la gara (già calcolato dallo scraper con tie-break)
    const rankVal = r.rank_dopo_gara;
    
    return `<tr>
      <td class="td-date">${fmtDateShort(r.data)}</td>
      <td class="td-race"><a href="#/gara/${esc(r.gara_id)}">${esc(r.nome_gara)}</a></td>
      <td>${badgeCat(a.categoria)}</td>
      <td class="td-pos ${pClass} ${r.posizione===1?'win':''}">${r.posizione}°</td>
      <td>${badgeMult(mult, r.tipo)}</td>
      <td style="text-align:right">${esc(r.km || '—')}</td>
      <td style="text-align:right">${esc(r.media || '—')}</td>
      <td class="td-pts">${r.punti_effettivi||0}</td>
    </tr>`;
  }).join('');

  setPage(`
    ${headerHtml}
    ${sparkHtml ? `<div class="sparkline-wrap"><div class="sparkline-title">ANDAMENTO PUNTI — STAGIONE ${new Date().getFullYear()}</div>${sparkHtml}</div>` : ''}
    <div class="section-header" style="margin-top:24px">
      <span class="section-title">RISULTATI STAGIONE</span>
      <span class="section-line"></span>
    </div>
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr>
          <th>DATA</th><th>GARA</th><th>CAT</th><th>POS</th><th>MOLT</th><th style="text-align:right">KM</th><th style="text-align:right">MEDIA</th><th>PTS</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="8" class="empty-state">Nessun risultato</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

function buildSparkline(values, risultati) {
  if (!values.length) return '';
  const W = 800, H = 80, pad = 10;
  const max = Math.max(...values, 1);
  const min = 0;
  const n = values.length;
  const xs = values.map((_, i) => pad + (i / Math.max(n - 1, 1)) * (W - 2 * pad));
  const ys = values.map(v => H - pad - ((v - min) / (max - min)) * (H - 2 * pad));

  // Path principale
  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  // Area
  const areaD = `${pathD} L ${xs[n-1].toFixed(1)} ${H} L ${xs[0].toFixed(1)} ${H} Z`;

  // Cerchi interattivi
  const circles = xs.map((x, i) => {
    const r = risultati[i];
    const label = r ? `${r.nome_gara} — ${r.punti_effettivi} pt` : `${values[i]} pt`;
    return `<circle class="spark-dot" cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="4"
      fill="var(--bg-card)" stroke="var(--red-hot)" stroke-width="2"
      data-label="${esc(label)}"
      onmouseenter="showSparkTip(event,this)" onmouseleave="hideSparkTip()"
      style="cursor:pointer"/>`;
  }).join('');

  return `<div style="position:relative">
    <svg class="sparkline-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--red-hot)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--red-hot)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}"
        stroke="var(--border-subtle)" stroke-dasharray="4 4" stroke-width="1"/>
      <path d="${areaD}" fill="url(#spark-grad)"/>
      <path d="${pathD}" stroke="var(--red-hot)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      ${circles}
    </svg>
  </div>`;
}

window.showSparkTip = (evt, el) => {
  const tip = document.getElementById('sparkline-tooltip');
  tip.textContent = el.dataset.label;
  tip.style.display = 'block';
  tip.style.left = (evt.pageX + 10) + 'px';
  tip.style.top  = (evt.pageY - 28) + 'px';
};
window.hideSparkTip = () => {
  document.getElementById('sparkline-tooltip').style.display = 'none';
};

let teamViewCat = '';
let teamViewId = '';

// ── TEAM ──────────────────────────────────────────────────────
async function renderTeam(team_id) {
  if (!globalData) return;
  const { teams, athletes } = globalData;

  const t = teams[team_id];
  if (!t) return renderNotFound();

  // Reset category view if switching team
  if (teamViewId !== team_id) {
    teamViewId = team_id;
    teamViewCat = '';
  }

  // Find all distinct categories this team participated in
  const catPoints = {};
  (t.risultati||[]).forEach(r => {
    const c = getRankingFileCode(r) || r.categoria;
    if(c) catPoints[c] = (catPoints[c]||0) + (r.punti_effettivi||0);
  });
  const SORT_ORDER = ['ES1_M','ES1_F','ES2_M','ES2_F','AL_M','AL_F','JUN_M','JUN_F','ELI_M','ELI_F'];
  const teamCats = Object.keys(catPoints).sort((a,b) => {
    let ia = SORT_ORDER.indexOf(a);
    let ib = SORT_ORDER.indexOf(b);
    if(ia === -1) ia = 99;
    if(ib === -1) ib = 99;
    return ia - ib;
  });
  
  if (!teamViewCat || !teamCats.includes(teamViewCat)) {
    teamViewCat = teamCats[0] || '';
  }

  const catRisultati = (t.risultati||[]).filter(r => (getRankingFileCode(r) || r.categoria) === teamViewCat);
  const catPuntiTotali = catRisultati.reduce((sum, r) => sum + (r.punti_effettivi||0), 0);

  window.setTeamCat = (cat) => {
    teamViewCat = cat;
    renderTeam(team_id);
  };

  const catTabsHtml = teamCats.length > 1 ? `
    <div class="tab-group" role="tablist" style="margin-top:24px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
      ${teamCats.map(c => `
        <button class="tab-btn ${teamViewCat===c?'active-cat':''}" onclick="setTeamCat('${c}')">${catLabel(c)}</button>
      `).join('')}
    </div>
  ` : '';

  // Atleti con punti (nella categoria selezionata)
  const atletiMap = {};
  catRisultati.forEach(r => {
    if (!atletiMap[r.atleta_id]) {
      atletiMap[r.atleta_id] = { id: r.atleta_id, ...athletes[r.atleta_id], puntiCat: 0 };
    }
    atletiMap[r.atleta_id].puntiCat += (r.punti_effettivi||0);
  });
  const atletiList = Object.values(atletiMap)
    .filter(a => a.puntiCat > 0)
    .sort((a,b) => b.puntiCat - a.puntiCat);

  const p1 = catRisultati.filter(r=>r.posizione===1).length;
  const p2 = catRisultati.filter(r=>r.posizione===2).length;
  const p3 = catRisultati.filter(r=>r.posizione===3).length;
  const pout = catRisultati.filter(r=>r.posizione>=4 && r.posizione<=10).length;

  const atletiRows = atletiList.map((a,i) => `
    <div class="cat-card-row">
      <span class="cat-pos ${posClass(i+1)}">${i+1}</span>
      <div>
        <div class="cat-rider-name"><a href="#/atleta/${esc(a.id)}">${esc(a.cognome)} ${esc(a.nome)}</a></div>
        <div class="cat-rider-team">${catLabel(a.categoria||'')}</div>
      </div>
      <span class="cat-pts">${a.puntiCat||0}</span>
    </div>`).join('');

  const risultatiRows = catRisultati
    .sort((a,b) => (b.data||'').localeCompare(a.data||''))
    .slice(0, 30)
    .map(r => {
      // Per la scheda Team mostriamo il rank della squadra (con tie-break)
      const rankVal = r.team_rank_dopo_gara;
      return `<tr>
        <td class="td-date">${fmtDateShort(r.data)}</td>
        <td class="td-race"><a href="#/gara/${esc(r.gara_id)}">${esc(r.nome_gara)}</a></td>
        <td><a href="#/atleta/${esc(r.atleta_id)}" style="color:var(--text-primary);font-family:var(--font-heading);font-weight:700">${esc(r.atleta_cognome)} ${esc(r.atleta_nome)}</a></td>
        <td class="td-pos ${posClass(r.posizione)}">${r.posizione}°</td>
        <td style="text-align:center">${badgeMult(r.moltiplicatore || 1, r.tipo)}</td>
        <td style="text-align:right">${esc(r.km || '—')}</td>
        <td style="text-align:right">${esc(r.media || '—')}</td>
        <td style="text-align:right">${rankVal ? `<span class="rank-badge" style="font-size:0.75rem; font-weight:normal; color:var(--text-muted)">Team Rank: <span class="b-num">${rankVal}°</span></span>` : ''}</td>
        <td class="td-pts">${r.punti_effettivi||0}</td>
      </tr>`;
    }).join('');

  // Caricamento classifiche team per mostrare posizione generale
  const teamRankings = await Promise.all(RANKING_CODES.map(c => loadTeamRanking(c)));
  const tCatRanks = [];
  teamRankings.forEach((rlist, idx) => {
    const code = RANKING_CODES[idx];
    const rk = (rlist || []).find(x => x.team_id === team_id);
    if (rk) tCatRanks.push({ cat: code, pos: rk.pos, pts: rk.punti });
  });
  const topC = tCatRanks.sort((a,b)=>b.pts - a.pts)[0];

  // Header stats
  const currentRank = tCatRanks.find(rk => rk.cat === teamViewCat);
  const rankHtml = currentRank ? `
      <div class="team-stat" style="border-right:1px solid var(--border-subtle); padding-right:16px; margin-right:6px">
        <span class="team-stat-val" style="color:var(--accent)">${currentRank.pos}°</span>
        <span class="team-stat-label">Cl. Gen. ${catLabel(teamViewCat)}</span>
      </div>` : '';

  const headerStats = `
    <div class="team-stats-row">
      ${rankHtml}
      <div class="team-stat">
        <span class="team-stat-val">${catPuntiTotali}</span>
        <span class="team-stat-label">Punti Stagionali</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--gold)">${p1}</span>
        <span class="team-stat-label">1°</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--silver)">${p2}</span>
        <span class="team-stat-label">2°</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--bronze)">${p3}</span>
        <span class="team-stat-label">3°</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val" style="color:var(--text-muted)">${pout}</span>
        <span class="team-stat-label">4-10</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-val">${atletiList.length}</span>
        <span class="team-stat-label">Atleti</span>
      </div>
    </div>`;

  setPage(`
    <div class="team-header">
      <div>
        <div class="team-name-display">${esc(t.nome)}</div>
        ${headerStats}
      </div>
    </div>
    ${catTabsHtml}
    <div class="section-header">
      <span class="section-title">ATLETI</span>
      <span class="section-line"></span>
      <span class="section-subtitle">Per contributo punti</span>
    </div>
    <div class="cat-card" style="margin-bottom:32px;border-left:3px solid var(--yellow-race)">
      <div class="cat-card-body">${atletiRows || '<div class="empty-state">Nessun atleta</div>'}</div>
    </div>
    <div class="section-header">
      <span class="section-title">RISULTATI TEAM</span>
      <span class="section-line"></span>
    </div>
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr>
          <th>DATA</th><th>GARA</th><th>ATLETA</th><th>POS</th><th style="text-align:center">MOLT</th><th style="text-align:right">KM</th><th style="text-align:right">MEDIA</th><th style="text-align:right">RNK</th><th>PTS</th>
        </tr></thead>
        <tbody>${risultatiRows || '<tr><td colspan="9" class="empty-state">Nessun risultato</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

// ── GARA ──────────────────────────────────────────────────────
async function renderGara(gara_id) {
  if (!globalData) return;
  const { resultsRaw, calendar } = globalData;

  const calEntry = calendar.find(g => g.id === gara_id);
  const results = resultsRaw.filter(r => r.gara_id === gara_id).sort((a,b) => a.posizione - b.posizione);

  if (!results.length && !calEntry) return renderNotFound();

  const name = results[0]?.nome_gara || calEntry?.nome || gara_id;
  const data = results[0]?.data || calEntry?.data || '';
  const cat  = results[0]?.categoria || calEntry?.categoria || '';
  // Usa moltiplicatore già calcolato dal scraper se disponibile
  const mult = results[0]?.moltiplicatore ||
    calEntry?.moltiplicatore ||
    multFromType(
      calEntry?.tipo || results[0]?.tipo || 'regionale',
      calEntry?.campionato_regionale || false,
      calEntry?.campionato_italiano  || false
    );
  const tipo = results[0]?.tipo || calEntry?.tipo || 'regionale';

  const tableRows = results.map(r => {
    const pts = r.punti_effettivi || (BASEPTS[r.posizione]||0) * mult;
    const pClass = posClass(r.posizione);
    return `<tr>
      <td class="td-pos ${pClass} ${r.posizione===1?'win':''}" style="font-family:var(--font-display);font-size:1.5rem">${r.posizione}°</td>
      <td style="font-family:var(--font-heading);font-weight:700">
        <a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a>
      </td>
      <td><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team)}</a></td>
      <td class="td-time">${esc(r.tempo||'S.T.')}</td>
      <td style="text-align:right">${esc(r.km || '—')}</td>
      <td style="text-align:right">${esc(r.media || '—')}</td>
      <td class="td-pts">${pts > 0 ? pts : '—'}</td>
    </tr>`;
  }).join('');

  let detailsHtml = '';
  if (globalData.raceDetails && globalData.raceDetails[gara_id] && globalData.raceDetails[gara_id].info) {
    const infoBlocks = globalData.raceDetails[gara_id].info.map(t => {
      let ft = t
        .replace(/(INFORMAZIONI GENERALI)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:12px; margin-bottom:6px;">$1</strong>')
        .replace(/(ORGANIZZATORE)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:20px; margin-bottom:6px;">$1</strong>')
        .replace(/(ISCRIZIONI)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:20px; margin-bottom:6px;">$1</strong>')
        .replace(/(RITROVO PROVE( \d+)?|RITROVO)/g, '<strong style="color:var(--primary); font-size:1.05rem; display:block; margin-top:20px; margin-bottom:6px;">$1 E PERCORSO</strong>');
      return `<div style="margin-bottom:8px; font-size:0.9rem; color:var(--text-secondary); line-height:1.6;">${ft}</div>`;
    }).join('');
    detailsHtml = `
      <div class="card" style="margin-top:24px; padding:24px;">
        <h3 style="margin-top:0; margin-bottom:16px; font-size:1.1rem; color:var(--primary);">Informazioni e Dettagli Tecnici</h3>
        ${infoBlocks}
        <div style="margin-top:16px;">
          <a href="${esc(globalData.raceDetails[gara_id].fci_url)}" target="_blank" class="btn-action" style="font-size:0.8rem; display:inline-block;">VAI ALLA SCHEDA FCI &rarr;</a>
        </div>
      </div>
    `;
  }

  setPage(`
    <div class="race-header">
      <div class="race-name-display">${esc(name)}</div>
      <div class="race-meta-row">
        <span>${fmtDate(data)}</span>
        <span class="race-meta-sep">|</span>
        <span>${esc(catLabel(cat))}</span>
        <span class="race-meta-sep">|</span>
        <span style="text-transform:capitalize">${esc(tipo)}</span>
        <span class="race-meta-sep">|</span>
        ${badgeMult(mult, tipo, results[0]?.campionato_regionale || calEntry?.campionato_regionale, results[0]?.campionato_italiano || calEntry?.campionato_italiano)}
        ${results[0]?.km ? `<span class="race-meta-sep">|</span><span>${esc(results[0].km)} Km</span>` : ''}
        ${results[0]?.media ? `<span class="race-meta-sep">|</span><span>Media: ${esc(results[0].media)} Km/h</span>` : ''}
      </div>
    </div>
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr>
          <th>POS</th><th>ATLETA</th><th>TEAM</th><th>TEMPO</th><th style="text-align:right">KM</th><th style="text-align:right">MEDIA</th><th class="td-pts">PTS</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="7" class="empty-state">Nessuna classifica disponibile</td></tr>'}</tbody>
      </table>
    </div>
    ${detailsHtml}
  `);
}

let calQGenere = '';
let calQTipo   = '';
let calQSearch = '';
let calQCat    = '';
let calQMonth  = new Date().toISOString().slice(5, 7); // Default mese corrente = '04' ad es.
let calQRegione = '';

async function renderCalendario() {
  if (!globalData) return;
  const { calendar } = globalData;

  const allCats = [...new Set(calendar.map(g => g.categoria).filter(Boolean))].sort();
  const allRegions = [...new Set(calendar.map(g => g.regione).filter(Boolean))].sort();

  const render = () => {
    const today = new Date().toISOString().split('T')[0];

    let filtered = calendar
      .filter(g => !calQGenere || g.genere === calQGenere)
      .filter(g => !calQCat    || g.categoria === calQCat)
      .filter(g => !calQRegione || g.regione === calQRegione)
      .filter(g => {
         if (!calQTipo) return true;
         if (calQTipo === 'campionato_regionale') return g.campionato_regionale;
         if (calQTipo === 'campionato_italiano') return g.campionato_italiano;
         return g.tipo === calQTipo;
      })
      .filter(g => !calQSearch || (g.nome||'').toLowerCase().includes(calQSearch.toLowerCase()))
      .filter(g => {
         if (!calQMonth) return true;
         const gm = g.data ? g.data.split('-')[1] : '';
         return gm === calQMonth;
      });

    const future = filtered.filter(g => (g.data || '') >= today).sort((a,b) => (a.data||'').localeCompare(b.data||''));
    const past   = filtered.filter(g => (g.data || '') < today).sort((a,b) => (b.data||'').localeCompare(a.data||''));

    const renderItem = (g) => {
      const mult = g.moltiplicatore || multFromType(g.tipo, g.campionato_regionale, g.campionato_italiano);
      const day = g.data ? g.data.split('-')[2] : '—';
      const mon = g.data ? (['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'][parseInt(g.data.split('-')[1])-1]||'') : '';
      const isPast = (g.data || '') < today;
      return `<div class="cal-item ${isPast?'cal-item-past':''}">
        <div class="cal-date-block" style="${isPast?'opacity:0.6':''}">
          <div class="cal-day">${day}</div>
          <div class="cal-month">${mon}</div>
        </div>
        <div style="flex:1">
          <div class="cal-name"><a href="#/gara/${esc(g.id)}">${esc(g.nome)}</a></div>
          <div class="cal-cat">
            ${esc(catLabel(g.categoria)||'')} — <span style="text-transform:capitalize;color:var(--text-muted)">${esc(g.tipo)}</span>
            ${g.luogo || g.regione ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">📍 ${esc(g.luogo || '')} ${g.regione ? '('+esc(g.regione)+')' : ''}</div>` : ''}
          </div>
        </div>
        <div class="cal-badges" style="${isPast?'opacity:0.5':''}">
          ${badgeMult(mult, g.tipo, g.campionato_regionale, g.campionato_italiano)}
          ${g.genere==='F'?'<span class="badge-cat badge-genere-f">♀</span>':''}
          ${g.campionato_italiano?'<span class="badge-cat badge-mult-x3">CI</span>':''}
          ${g.campionato_regionale?'<span class="badge-cat badge-mult-x2">CR</span>':''}
        </div>
      </div>`;
    };

    let html = '';
    if (future.length > 0) {
      html += `<div class="category-divider" style="margin-top:0">Prossime Gare</div>`;
      html += future.map(renderItem).join('');
    }
    if (past.length > 0) {
      html += `<div class="category-divider" style="color:var(--text-muted); border-color:var(--text-muted); opacity:0.6">Gare Concluse</div>`;
      html += past.map(renderItem).join('');
    }

    document.getElementById('cal-list').innerHTML = html || '<div class="empty-state">Nessuna gara trovata</div>';
    document.getElementById('cal-count').textContent = `${filtered.length} gare`;
  };

  setPage(`
    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:28px">CALENDARIO</h1>
    <div class="calendar-controls">
      <select class="cal-filter-select" id="cal-month" onchange="window.calSetMonth(this.value)" aria-label="Filtra per mese">
        <option value="">Tutti i mesi</option>
        <option value="01" ${calQMonth==='01'?'selected':''}>Gennaio</option>
        <option value="02" ${calQMonth==='02'?'selected':''}>Febbraio</option>
        <option value="03" ${calQMonth==='03'?'selected':''}>Marzo</option>
        <option value="04" ${calQMonth==='04'?'selected':''}>Aprile</option>
        <option value="05" ${calQMonth==='05'?'selected':''}>Maggio</option>
        <option value="06" ${calQMonth==='06'?'selected':''}>Giugno</option>
        <option value="07" ${calQMonth==='07'?'selected':''}>Luglio</option>
        <option value="08" ${calQMonth==='08'?'selected':''}>Agosto</option>
        <option value="09" ${calQMonth==='09'?'selected':''}>Settembre</option>
        <option value="10" ${calQMonth==='10'?'selected':''}>Ottobre</option>
        <option value="11" ${calQMonth==='11'?'selected':''}>Novembre</option>
        <option value="12" ${calQMonth==='12'?'selected':''}>Dicembre</option>
      </select>
      <select class="cal-filter-select" id="cal-genere" onchange="calSetGenere(this.value)" aria-label="Filtra per genere">
        <option value="" ${calQGenere===''?'selected':''}>Tutti</option>
        <option value="M" ${calQGenere==='M'?'selected':''}>Uomini</option>
        <option value="F" ${calQGenere==='F'?'selected':''}>Donne</option>
      </select>
      <select class="cal-filter-select" id="cal-cat" onchange="calSetCat(this.value)" aria-label="Filtra per categoria">
        <option value="" ${calQCat===''?'selected':''}>Tutte Categorie</option>
        ${allCats.map(c => `<option value="${c}" ${c === calQCat ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}
      </select>
      <select class="cal-filter-select" id="cal-tipo" onchange="calSetTipo(this.value)" aria-label="Filtra per tipo gara">
        <option value="" ${calQTipo===''?'selected':''}>Tutti i tipi</option>
        <option value="regionale" ${calQTipo==='regionale'?'selected':''}>Regionali ×1</option>
        <option value="nazionale" ${calQTipo==='nazionale'?'selected':''}>Nazionali ×2</option>
        <option value="internazionale" ${calQTipo==='internazionale'?'selected':''}>Internazionali ×3</option>
        <option value="campionato_regionale" ${calQTipo==='campionato_regionale'?'selected':''}>Campionati Regionali</option>
        <option value="campionato_italiano" ${calQTipo==='campionato_italiano'?'selected':''}>Campionati Italiani</option>
      </select>
      <select class="cal-filter-select" id="cal-regione" onchange="calSetRegione(this.value)" aria-label="Filtra per regione">
        <option value="" ${calQRegione===''?'selected':''}>Tutte le Regioni</option>
        ${allRegions.map(r => `<option value="${r}" ${r === calQRegione ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      </select>
      <input type="search" class="cal-filter-select" id="cal-search" placeholder="Cerca gara…" oninput="calSetSearch(this.value)" aria-label="Cerca gara" style="width:200px" value="${calQSearch.replace(/"/g, '&quot;')}"/>
      <span class="ranking-count" id="cal-count">${calendar.length} gare</span>
    </div>
    <div class="calendar-list" id="cal-list"></div>
  `);

  window.calSetMonth  = (v) => { calQMonth = v; render(); };
  window.calSetGenere = (v) => { calQGenere = v; render(); };
  window.calSetCat    = (v) => { calQCat = v; render(); };
  window.calSetTipo   = (v) => { calQTipo = v; render(); };
  window.calSetSearch = (v) => { calQSearch = v; render(); };
  window.calSetRegione = (v) => { calQRegione = v; render(); };
  render();
}

// ── SEARCH GLOBALE ────────────────────────────────────────────
let atlGender = 'M';
let atlCat    = 'JUN_M';
let atlSearch = '';

let teamGender = 'M';
let teamCat    = 'JUN_M';
let teamSearch = '';

window.setAtlGender = (g) => { atlGender = g; renderAtletiList(); };
window.setAtlCat    = (c) => { atlCat = c; renderAtletiList(); };
window.setAtlSearch = (v) => { atlSearch = v; window.filterAtletiList(v); };

window.setTeamGender = (g) => { teamGender = g; renderTeamList(); };
window.setTeamCat    = (c) => { teamCat = c; renderTeamList(); };
window.setTeamSearch = (v) => { teamSearch = v; window.filterTeamList(v); };

async function renderAtletiList() {
  if (!globalData) return;
  const { athletes } = globalData;
  
  if ((atlGender === 'M' && atlCat.endsWith('_F')) || (atlGender === 'F' && !atlCat.endsWith('_F'))) {
    atlCat = atlGender === 'M' ? 'JUN_M' : 'ELI_F';
  }

  const catsM = ['ES1_M','ES2_M','AL_M','JUN_M','ELI_M'];
  const catsF = ['ES1_F','ES2_F','AL_F','JUN_F', 'ELI_F'];
  const currentCats = atlGender === 'M' ? catsM : catsF;

  const genderTabs = ['M','F'].map(g => `
    <button class="tab-btn ${atlGender===g?'active-gender':''}" onclick="setAtlGender('${g}')">${g==='M'?'UOMINI':'DONNE'}</button>
  `).join('');
  
  const catTabs = currentCats.map(c => `
    <button class="tab-btn ${atlCat===c?'active-cat':''}" onclick="setAtlCat('${c}')">${catLabel(c)}</button>
  `).join('');

  setPage(`
    <div class="content-wrapper">
      <div class="section-header">
        <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">DIRECTORY ATLETI</h1>
        <span class="section-line"></span>
      </div>

      <div class="ranking-controls" style="margin-bottom:24px">
        <div class="tab-group">${genderTabs}</div>
        <div class="tab-group" style="margin-top:8px">${catTabs}</div>
        
        <div class="ranking-filter-bar" style="margin-top:16px">
          <input type="search" id="atleti-list-search" 
            placeholder="Cerca atleta per nome o cognome…" 
            value="${esc(atlSearch)}"
            oninput="window.setAtlSearch(this.value)" aria-label="Cerca atleta" />
        </div>
      </div>

      <div id="atleti-list-container"></div>
    </div>
  `);

  window.filterAtletiList = (q) => {
    const container = document.getElementById('atleti-list-container');
    const athletesList = Object.values(athletes).filter(a => a.categoria === atlCat);
    const ql = q.toLowerCase();
    const filtered = athletesList.filter(a => `${a.cognome} ${a.nome}`.toLowerCase().includes(ql))
                                .sort((a,b) => (a.cognome || '').localeCompare(b.cognome || ''));

    container.innerHTML = `
      <div class="ranking-table-wrap" style="margin-bottom:32px">
        <table class="ranking-table">
          <thead><tr><th>ATLETA</th><th>TEAM ATTUALE</th><th class="r">PUNTI TOT</th></tr></thead>
          <tbody>
            ${filtered.slice(0, 100).map(a => `
              <tr class="ranking-row">
                <td><a href="#/atleta/${esc(a.id)}"><strong>${esc(a.cognome)} ${esc(a.nome)}</strong></a></td>
                <td><a href="#/team/${esc(a.team_id)}" style="color:var(--text-secondary)">${esc(a.team_attuale)}</a></td>
                <td class="r"><span class="rank-pts">${a.punti_totali}</span></td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="empty-state">Nessun atleta trovato in questa categoria</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };
  window.filterAtletiList(atlSearch);
}

async function renderTeamList() {
  if (!globalData) return;
  const { teams } = globalData;

  if ((teamGender === 'M' && teamCat.endsWith('_F')) || (teamGender === 'F' && !teamCat.endsWith('_F'))) {
    teamCat = teamGender === 'M' ? 'JUN_M' : 'ELI_F';
  }

  const catsM = ['ES1_M','ES2_M','AL_M','JUN_M','ELI_M'];
  const catsF = ['ES1_F','ES2_F','AL_F','JUN_F', 'ELI_F'];
  const currentCats = teamGender === 'M' ? catsM : catsF;

  const genderTabs = ['M','F'].map(g => `
    <button class="tab-btn ${teamGender===g?'active-gender':''}" onclick="setTeamGender('${g}')">${g==='M'?'UOMINI':'DONNE'}</button>
  `).join('');
  
  const catTabs = currentCats.map(c => `
    <button class="tab-btn ${teamCat===c?'active-cat':''}" onclick="setTeamCat('${c}')">${catLabel(c)}</button>
  `).join('');

  setPage(`
    <div class="content-wrapper">
      <div class="section-header">
        <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">DIRECTORY TEAM</h1>
        <span class="section-line"></span>
      </div>

      <div class="ranking-controls" style="margin-bottom:24px">
        <div class="tab-group">${genderTabs}</div>
        <div class="tab-group" style="margin-top:8px">${catTabs}</div>
        
        <div class="ranking-filter-bar" style="margin-top:16px">
          <input type="search" id="team-list-search" 
            placeholder="Cerca team per nome…" 
            value="${esc(teamSearch)}"
            oninput="window.setTeamSearch(this.value)" aria-label="Cerca team" />
        </div>
      </div>

      <div id="team-list-container"></div>
    </div>
  `);

  window.filterTeamList = (q) => {
    const container = document.getElementById('team-list-container');
    // Filter teams that have results in the selected category via punti_per_cat
    const teamsList = Object.values(teams).filter(t => t.punti_per_cat && t.punti_per_cat[teamCat]);
    const ql = q.toLowerCase();
    const filtered = teamsList
      .filter(t => (t.nome || '').toLowerCase().includes(ql))
      .sort((a,b) => (b.punti_per_cat[teamCat] || 0) - (a.punti_per_cat[teamCat] || 0));

    container.innerHTML = `
      <div class="ranking-table-wrap">
        <table class="ranking-table">
          <thead><tr>
            <th>TEAM</th>
            <th class="r" style="width:80px">ATLETI</th>
            <th class="r" style="width:120px">PUNTI ${catLabel(teamCat)}</th>
          </tr></thead>
          <tbody>
            ${filtered.slice(0, 150).map((t, i) => `
              <tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
                <td><a href="#/team/${esc(t.id)}"><strong>${esc(t.nome)}</strong></a></td>
                <td class="r" style="color:var(--text-muted);font-size:0.85rem">${t.atleti ? t.atleti.length : 0}</td>
                <td class="r"><span class="rank-pts">${t.punti_per_cat[teamCat] || 0}</span></td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="empty-state">Nessun team in questa categoria</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };
  window.filterTeamList(teamSearch);
}

// ── UTILITY ──────────────────────────────────────────────────
const CAT_NOISE = new Set(['JUNIORES','ALLIEVE','ALLIEVI','ESORDIENTI','UNDER','DONNE','ELITE','HARELBEKE']);
function isRealRegion(reg) {
  if (!reg) return false;
  const u = reg.toUpperCase().trim();
  if (CAT_NOISE.has(u)) return false;
  if (u === 'ITALIA') return false;
  return normalizeRegion(u).length > 2;
}

const CAT_ORDER = [
  ['Elite-Under23','M'], ['Elite-Under23','F'],
  ['Juniores','M'], ['Juniores','F'],
  ['Allievi','M'], ['Allievi','F'],
  ['Esordienti 1° Anno','M'], ['Esordienti 1° Anno','F'],
  ['Esordienti 2° Anno','M'], ['Esordienti 2° Anno','F'],
];
function catGenLabel(cat, gen) {
  const g = gen === 'M' ? '♂' : '♀';
  return `${g} ${cat}`;
}

// ── STATISTICHE PAGE ─────────────────────────────────────────
async function renderStatistiche() {
  if (!globalData) return;
  const { resultsRaw, athletes, calendar } = globalData;

  // KPI globali (ridotto)
  const totalRaces = new Set(resultsRaw.map(r => r.gara_id)).size;
  const totalAthletes = Object.keys(athletes).length;
  const totalKm = Math.round(resultsRaw.reduce((s,r) => s+(parseFloat(r.km)||0), 0)).toLocaleString('it-IT');

  // Top per categoria/genere (vincitori e marcatori)
  const catBest = {}; // key = "cat|gen" -> { winner, scorer }
  resultsRaw.forEach(r => {
    const key = `${r.categoria}|${r.genere}`;
    if (!catBest[key]) catBest[key] = { wins:{}, pts:{} };
    const id = r.atleta_id;
    if (r.posizione === 1) { catBest[key].wins[id] = (catBest[key].wins[id]||0)+1; }
    catBest[key].pts[id] = (catBest[key].pts[id]||0)+(r.punti_effettivi||0);
  });

  // Gare per categoria/genere
  const garePerCat = {};
  resultsRaw.forEach(r => {
    const key = `${r.categoria}|${r.genere}`;
    if (!garePerCat[key]) garePerCat[key] = new Set();
    garePerCat[key].add(r.gara_id);
  });

  // Regioni M e F (solo regioni vere)
  const regM = {}, regF = {};
  const calByReg = {};
  calendar.forEach(g => {
    const reg = normalizeRegion(g.regione||'');
    if (isRealRegion(reg)) calByReg[reg] = (calByReg[reg]||0)+1;
  });
  resultsRaw.forEach(r => {
    const reg = normalizeRegion(r.regione||'');
    if (!isRealRegion(reg)) return;
    if (r.genere === 'M') { if (!regM[reg]) regM[reg]=new Set(); regM[reg].add(r.gara_id); }
    else { if (!regF[reg]) regF[reg]=new Set(); regF[reg].add(r.gara_id); }
  });

  const topRegM = Object.entries(regM).map(([r,s])=>({r,scraped:s.size,cal:calByReg[r]||0})).sort((a,b)=>b.scraped-a.scraped).slice(0,12);
  const topRegF = Object.entries(regF).map(([r,s])=>({r,scraped:s.size,cal:calByReg[r]||0})).sort((a,b)=>b.scraped-a.scraped).slice(0,12);

  const getName = (id) => {
    const a = athletes[id];
    return a ? `${a.cognome} ${a.nome}` : id.replace(/_/g,' ');
  };

  // Render top vincitori e marcatori per categoria
  const renderTopTable = (type) => {
    const cats = [...new Set(resultsRaw.map(r => `${r.categoria}|${r.genere}`))].sort();
    return cats.map(key => {
      const [cat, gen] = key.split('|');
      const d = catBest[key];
      if (!d) return '';
      const map = type === 'wins' ? d.wins : d.pts;
      const sorted = Object.entries(map).sort((a,b)=>b[1]-a[1]);
      if (!sorted.length) return '';
      const [id, val] = sorted[0];
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border-subtle);transition:background 0.12s" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''">
          <div style="min-width:160px;font-size:0.75rem;font-family:var(--font-heading);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">${catGenLabel(cat,gen)}</div>
          <div style="flex:1;font-family:var(--font-heading);font-weight:700;font-size:0.95rem">
            <a href="#/atleta/${esc(id)}" style="text-transform:uppercase">${esc(getName(id))}</a>
          </div>
          <div style="font-family:var(--font-display);font-size:1.4rem;color:${type==='wins'?'var(--yellow-race)':'var(--red-hot)'}">${val}${type==='wins'?'🏆':' pt'}</div>
        </div>`;
    }).join('');
  };

  // Render gare per categoria
  const gareTableHtml = [...new Set(resultsRaw.map(r=>`${r.categoria}|${r.genere}`))].sort().map(key => {
    const [cat,gen] = key.split('|');
    const n = garePerCat[key]?.size || 0;
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border-subtle)">
        <div style="min-width:180px;font-family:var(--font-heading);font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">${catGenLabel(cat,gen)}</div>
        <div style="flex:1;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.round(n/Math.max(...Object.values(garePerCat).map(s=>s.size))*100)}%;background:linear-gradient(90deg,var(--cat-juniores),var(--cat-u23));border-radius:4px"></div>
        </div>
        <div style="min-width:60px;text-align:right;font-family:var(--font-display);font-size:1.3rem;color:var(--text-primary)">${n}</div>
      </div>`;
  }).join('');

  const regBar = (arr, label) => arr.map(({r,scraped,cal}) => {
    const pctS = cal ? Math.round(scraped/cal*100) : 100;
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle)">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-family:var(--font-heading);font-weight:700;font-size:0.9rem">${esc(r)}</span>
          <span style="font-size:0.75rem;color:var(--text-muted)">${scraped}/${cal||'?'} gare (${pctS}%)</span>
        </div>
        <div style="height:10px;background:var(--bg-elevated);border-radius:5px;overflow:hidden;position:relative">
          <div style="height:100%;width:100%;background:rgba(255,255,255,0.08);position:absolute"></div>
          <div style="height:100%;width:${pctS}%;background:linear-gradient(90deg,var(--red-hot),var(--yellow-race));border-radius:5px;position:relative;transition:width 0.6s"></div>
        </div>
      </div>`;
  }).join('');

  let activeRegTab = 'M';
  setPage(`
    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:8px">STATISTICHE</h1>
    <p style="color:var(--text-muted);margin-bottom:28px">Stagione 2026</p>

    <!-- KPI -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:40px">
      ${[['🏁',totalRaces,'Gare Scrapate'],['👤',totalAthletes,'Atleti'],['🛣️',totalKm,'Km Totali'],['📅',calendar.length,'Gare in Calendario']].map(([icon,val,label])=>`
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:20px;text-align:center">
          <div style="font-size:1.8rem;margin-bottom:6px">${icon}</div>
          <div style="font-family:var(--font-display);font-size:2rem;color:var(--red-hot);line-height:1">${val}</div>
          <div style="font-family:var(--font-heading);font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;margin-top:6px">${label}</div>
        </div>`).join('')}
    </div>

    <!-- TOP VINCITORI + TOP MARCATORI -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px;margin-bottom:40px">
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
        <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">🥇 Top Vincitore per Categoria</div>
        ${renderTopTable('wins')}
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
        <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">🔥 Top Marcatore per Categoria</div>
        ${renderTopTable('pts')}
      </div>
    </div>

    <!-- GARE PER CATEGORIA -->
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;margin-bottom:40px">
      <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">📊 Gare Disputate per Categoria</div>
      ${gareTableHtml}
    </div>

    <!-- ATTIVITA' PER REGIONE (tab M/F) -->
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;margin-bottom:40px">
      <div style="padding:14px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between">
        <span style="font-family:var(--font-heading);font-weight:700;text-transform:uppercase;letter-spacing:0.08em">📍 Attività per Regione</span>
        <div style="display:flex;gap:6px">
          <button id="reg-tab-M" onclick="window.switchRegTab('M')" style="font-family:var(--font-heading);font-weight:700;font-size:0.8rem;padding:4px 14px;border-radius:20px;border:1px solid var(--red-hot);background:var(--red-hot);color:#fff;cursor:pointer">♂ Uomini</button>
          <button id="reg-tab-F" onclick="window.switchRegTab('F')" style="font-family:var(--font-heading);font-weight:700;font-size:0.8rem;padding:4px 14px;border-radius:20px;border:1px solid var(--border-subtle);background:none;color:var(--text-muted);cursor:pointer">♀ Donne</button>
        </div>
      </div>
      <div style="padding:16px">
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px">La barra mostra le gare scrapate rispetto al totale nel calendario. Formato: <strong>scrapate/calendario (% copertura)</strong></div>
        <div id="reg-content-M">${regBar(topRegM,'M')}</div>
        <div id="reg-content-F" style="display:none">${regBar(topRegF,'F')}</div>
      </div>
    </div>
  `);

  window.switchRegTab = (tab) => {
    document.getElementById('reg-content-M').style.display = tab==='M'?'':'none';
    document.getElementById('reg-content-F').style.display = tab==='F'?'':'none';
    const bM = document.getElementById('reg-tab-M');
    const bF = document.getElementById('reg-tab-F');
    bM.style.background = tab==='M'?'var(--red-hot)':'none';
    bM.style.color = tab==='M'?'#fff':'var(--text-muted)';
    bM.style.borderColor = tab==='M'?'var(--red-hot)':'var(--border-subtle)';
    bF.style.background = tab==='F'?'var(--cat-donne)':'none';
    bF.style.color = tab==='F'?'#fff':'var(--text-muted)';
    bF.style.borderColor = tab==='F'?'var(--cat-donne)':'var(--border-subtle)';
  };
}

// ── COMPARATORE ───────────────────────────────────────────────
let compA = '', compB = '', compMode = 'atleta', compCat = '', compGender = 'M';

async function renderComparatore() {
  if (!globalData) return;
  const { resultsRaw, athletes, teams } = globalData;

  // Categorie disponibili per il genere selezionato
  const availCats = [...new Set(
    resultsRaw.filter(r => r.genere === compGender).map(r => r.categoria)
  )].sort();

  const catOpts = availCats.map(c =>
    `<option value="${esc(c)}" ${c === compCat ? 'selected' : ''}>${esc(c)}</option>`
  ).join('');

  // ── ATLETI ──────────────────────────────────────────────────
  const buildAthleteResult = () => {
    // Filtra atleti per categoria e genere (usa i risultati per match)
    const validIds = new Set(
      resultsRaw
        .filter(r => r.genere === compGender && (!compCat || r.categoria === compCat))
        .map(r => r.atleta_id)
    );
    const filteredAthletes = Object.values(athletes)
      .filter(a => validIds.has(a.id))
      .sort((a, b) => (a.cognome || '').localeCompare(b.cognome || ''));

    const aOpts = filteredAthletes.map(a =>
      `<option value="${a.id}" ${a.id === compA ? 'selected' : ''}>${esc(a.cognome)} ${esc(a.nome)}</option>`
    ).join('');
    const bOpts = filteredAthletes.map(a =>
      `<option value="${a.id}" ${a.id === compB ? 'selected' : ''}>${esc(a.cognome)} ${esc(a.nome)}</option>`
    ).join('');

    let resultHtml = '';
    if (compA && compB && compA !== compB) {
      const aData = athletes[compA], bData = athletes[compB];
      if (aData && bData) {
        const catFilter = r => r.genere === compGender && (!compCat || r.categoria === compCat);
        const aRes = resultsRaw.filter(r => r.atleta_id === compA && catFilter(r));
        const bRes = resultsRaw.filter(r => r.atleta_id === compB && catFilter(r));
        const st = arr => ({
          pts:  arr.reduce((s, r) => s + (r.punti_effettivi || 0), 0),
          wins: arr.filter(r => r.posizione === 1).length,
          podi: arr.filter(r => r.posizione <= 3).length,
          gare: new Set(arr.map(r => r.gara_id)).size,
          km:   Math.round(arr.reduce((s, r) => s + (parseFloat(r.km) || 0), 0)),
          media: arr.filter(r => r.media).length
            ? (arr.reduce((s, r) => s + (parseFloat(r.media) || 0), 0) / arr.filter(r => r.media).length).toFixed(1)
            : '—',
        });
        const sA = st(aRes), sB = st(bRes);
        resultHtml = compBars(aData.cognome, bData.cognome, sA, sB, 'atleta');
      }
    }

    return `
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div style="flex:1;min-width:200px">
          <label class="comp-label">Atleta A</label>
          <select class="cal-filter-select" style="width:100%" onchange="window.setCompA(this.value)">
            <option value="">— Seleziona —</option>${aOpts}
          </select>
        </div>
        <div style="font-family:var(--font-display);font-size:2.5rem;color:var(--red-hot);align-self:flex-end;padding-bottom:4px">VS</div>
        <div style="flex:1;min-width:200px">
          <label class="comp-label">Atleta B</label>
          <select class="cal-filter-select" style="width:100%" onchange="window.setCompB(this.value)">
            <option value="">— Seleziona —</option>${bOpts}
          </select>
        </div>
      </div>
      ${resultHtml || '<div style="text-align:center;padding:32px;color:var(--text-muted);font-style:italic">Seleziona due atleti per confrontarli</div>'}`;
  };

  // ── TEAM ────────────────────────────────────────────────────
  const buildTeamResult = () => {
    // Team attivi nella categoria/genere selezionati
    const teamPts = {};
    resultsRaw
      .filter(r => r.genere === compGender && (!compCat || r.categoria === compCat))
      .forEach(r => {
        if (!r.team_id) return;
        if (!teamPts[r.team_id]) teamPts[r.team_id] = { id: r.team_id, nome: r.team };
      });
    const filteredTeams = Object.values(teamPts).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    const aOpts = filteredTeams.map(t =>
      `<option value="${t.id}" ${t.id === compA ? 'selected' : ''}>${esc(t.nome)}</option>`
    ).join('');
    const bOpts = filteredTeams.map(t =>
      `<option value="${t.id}" ${t.id === compB ? 'selected' : ''}>${esc(t.nome)}</option>`
    ).join('');

    let resultHtml = '';
    if (compA && compB && compA !== compB) {
      const aNome = filteredTeams.find(t => t.id === compA)?.nome || compA;
      const bNome = filteredTeams.find(t => t.id === compB)?.nome || compB;
      const catFilter = r => r.genere === compGender && (!compCat || r.categoria === compCat);
      const aRes = resultsRaw.filter(r => r.team_id === compA && catFilter(r));
      const bRes = resultsRaw.filter(r => r.team_id === compB && catFilter(r));
      const st = arr => ({
        pts:  arr.reduce((s, r) => s + (r.punti_effettivi || 0), 0),
        wins: arr.filter(r => r.posizione === 1).length,
        podi: arr.filter(r => r.posizione <= 3).length,
        gare: new Set(arr.map(r => r.gara_id)).size,
        km:   Math.round(arr.reduce((s, r) => s + (parseFloat(r.km) || 0), 0)),
        atleti: new Set(arr.map(r => r.atleta_id)).size,
      });
      const sA = st(aRes), sB = st(bRes);
      resultHtml = compBars(aNome, bNome, sA, sB, 'team');
    }

    return `
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div style="flex:1;min-width:200px">
          <label class="comp-label">Team A</label>
          <select class="cal-filter-select" style="width:100%" onchange="window.setCompA(this.value)">
            <option value="">— Seleziona —</option>${aOpts}
          </select>
        </div>
        <div style="font-family:var(--font-display);font-size:2.5rem;color:var(--red-hot);align-self:flex-end;padding-bottom:4px">VS</div>
        <div style="flex:1;min-width:200px">
          <label class="comp-label">Team B</label>
          <select class="cal-filter-select" style="width:100%" onchange="window.setCompB(this.value)">
            <option value="">— Seleziona —</option>${bOpts}
          </select>
        </div>
      </div>
      ${resultHtml || '<div style="text-align:center;padding:32px;color:var(--text-muted);font-style:italic">Seleziona due team per confrontarli</div>'}`;
  };

  setPage(`
    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:8px">COMPARATORE</h1>
    <p style="color:var(--text-muted);margin-bottom:24px">Confronta atleti o team della stessa categoria e genere</p>

    <!-- FILTRI -->
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:20px;margin-bottom:24px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">

        <!-- Tab Atleti / Team -->
        <div style="display:flex;gap:6px;align-items:center">
          <button id="comp-tab-atleta" onclick="window.setCompMode('atleta')"
            style="font-family:var(--font-heading);font-weight:700;font-size:0.85rem;padding:6px 18px;border-radius:20px;
            border:1px solid ${compMode === 'atleta' ? 'var(--red-hot)' : 'var(--border-subtle)'};
            background:${compMode === 'atleta' ? 'var(--red-hot)' : 'none'};
            color:${compMode === 'atleta' ? '#fff' : 'var(--text-muted)'};cursor:pointer">
            👤 Atleti
          </button>
          <button id="comp-tab-team" onclick="window.setCompMode('team')"
            style="font-family:var(--font-heading);font-weight:700;font-size:0.85rem;padding:6px 18px;border-radius:20px;
            border:1px solid ${compMode === 'team' ? 'var(--yellow-race)' : 'var(--border-subtle)'};
            background:${compMode === 'team' ? 'var(--yellow-race)' : 'none'};
            color:${compMode === 'team' ? '#000' : 'var(--text-muted)'};cursor:pointer">
            🚴 Team
          </button>
        </div>

        <!-- Genere -->
        <div style="flex:1;min-width:140px">
          <label class="comp-label">Genere</label>
          <select class="cal-filter-select" style="width:100%" onchange="window.setCompGender(this.value)">
            <option value="M" ${compGender === 'M' ? 'selected' : ''}>♂ Uomini</option>
            <option value="F" ${compGender === 'F' ? 'selected' : ''}>♀ Donne</option>
          </select>
        </div>

        <!-- Categoria -->
        <div style="flex:2;min-width:200px">
          <label class="comp-label">Categoria</label>
          <select class="cal-filter-select" style="width:100%" onchange="window.setCompCat(this.value)">
            <option value="">— Tutte —</option>${catOpts}
          </select>
        </div>
      </div>

      <!-- Selettori A vs B -->
      <div id="comp-selectors">
        ${compMode === 'atleta' ? buildAthleteResult() : buildTeamResult()}
      </div>
    </div>
  `);

  window.setCompMode   = v => { compMode = v; compA = ''; compB = ''; renderComparatore(); };
  window.setCompGender = v => { compGender = v; compA = ''; compB = ''; renderComparatore(); };
  window.setCompCat    = v => { compCat = v; compA = ''; compB = ''; renderComparatore(); };
  window.setCompA      = v => { compA = v; renderComparatore(); };
  window.setCompB      = v => { compB = v; renderComparatore(); };
}

function compBars(labelA, labelB, sA, sB, mode) {
  const bar = (vA, vB, label, fmt = '') => {
    const tot = (parseFloat(vA) || 0) + (parseFloat(vB) || 0) || 1;
    const pA = Math.round((parseFloat(vA) || 0) / tot * 100);
    const winsA = pA > 50;
    return `
      <div style="margin:14px 0">
        <div style="font-family:var(--font-heading);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:5px">${label}</div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-family:var(--font-display);font-size:${winsA ? '1.6' : '1.3'}rem;color:var(--red-hot);min-width:90px;text-align:right">${vA}${fmt}</span>
          <div style="flex:1;height:12px;border-radius:6px;overflow:hidden;display:flex">
            <div style="width:${pA}%;background:var(--red-hot);transition:width 0.7s ease"></div>
            <div style="width:${100 - pA}%;background:var(--cat-juniores);transition:width 0.7s ease"></div>
          </div>
          <span style="font-family:var(--font-display);font-size:${!winsA ? '1.6' : '1.3'}rem;color:var(--cat-juniores);min-width:90px">${vB}${fmt}</span>
        </div>
      </div>`;
  };

  const extraRow = mode === 'team'
    ? bar(sA.atleti, sB.atleti, 'Atleti Schierati')
    : `<div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center">
         <span style="font-family:var(--font-display);font-size:1.5rem;color:var(--red-hot)">${sA.media} km/h</span>
         <span style="font-family:var(--font-heading);font-size:0.7rem;text-transform:uppercase;color:var(--text-muted)">Velocità Media</span>
         <span style="font-family:var(--font-display);font-size:1.5rem;color:var(--cat-juniores)">${sB.media} km/h</span>
       </div>`;

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border-subtle);border-radius:8px 8px 0 0;overflow:hidden;margin-top:16px">
      <div style="padding:16px 20px;background:rgba(232,0,29,0.07);border-right:1px solid var(--border-subtle)">
        <div style="font-family:var(--font-display);font-size:1.8rem;color:var(--red-hot);line-height:1.1">${esc(labelA)}</div>
      </div>
      <div style="padding:16px 20px;background:rgba(16,185,129,0.07)">
        <div style="font-family:var(--font-display);font-size:1.8rem;color:var(--cat-juniores);line-height:1.1">${esc(labelB)}</div>
      </div>
    </div>
    <div style="border:1px solid var(--border-subtle);border-top:none;border-radius:0 0 8px 8px;padding:20px;background:var(--bg-card)">
      ${bar(sA.pts, sB.pts, 'Punti Totali', ' pt')}
      ${bar(sA.wins, sB.wins, 'Vittorie')}
      ${bar(sA.podi, sB.podi, 'Podi (Top 3)')}
      ${bar(sA.gare, sB.gare, 'Gare Disputate')}
      ${bar(sA.km, sB.km, 'Km Percorsi', ' km')}
      ${extraRow}
    </div>`;
}

function renderRegolamento() {
  setPage(`
    <div class="content-wrapper">
      <div class="section-header">
        <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">REGOLAMENTO</h1>
        <span class="section-line"></span>
      </div>
      <div style="max-width:800px; margin:0 auto; line-height:1.6; color:var(--text-primary)">
        <p>Il sistema di punteggio di <strong>Italiacrit</strong> è progettato per valorizzare la costanza e la qualità delle prestazioni degli atleti nelle gare su strada.</p>
        
        <h3 style="margin-top:32px; color:var(--red-hot)">PUNTEGGIO BASE</h3>
        <p>In base alla posizione d'arrivo (Top 10), vengono assegnati i seguenti punti:</p>
        <table class="ranking-table" style="max-width:300px">
          <thead><tr><th>POS</th><th>PUNTI</th></tr></thead>
          <tbody>
            <tr><td>1°</td><td>15</td></tr>
            <tr><td>2°</td><td>12</td></tr>
            <tr><td>3°</td><td>10</td></tr>
            <tr><td>4°</td><td>8</td></tr>
            <tr><td>5°</td><td>6</td></tr>
            <tr><td>6°</td><td>5</td></tr>
            <tr><td>7°</td><td>4</td></tr>
            <tr><td>8°</td><td>3</td></tr>
            <tr><td>9°</td><td>2</td></tr>
            <tr><td>10°</td><td>1</td></tr>
          </tbody>
        </table>

        <h3 style="margin-top:32px; color:var(--red-hot)">MOLTIPLICATORI</h3>
        <p>Il punteggio base viene moltiplicato in base al livello della gara:</p>
        <ul style="list-style:none; padding-left:0">
          <li style="margin-bottom:12px"><strong>×1 (Regionale):</strong> Gare di livello regionale standard.</li>
          <li style="margin-bottom:12px"><strong>×2 (Nazionale):</strong> Gare nazionali e <strong>Campionati Regionali</strong>.</li>
          <li style="margin-bottom:12px"><strong>×3 (Internazionale):</strong> Gare del calendario internazionale e <strong>Campionati Italiani</strong>.</li>
        </ul>

        <h3 style="margin-top:32px; color:var(--red-hot)">CLASSIFICHE SPECIALI</h3>
        <ul style="list-style:none; padding-left:0">
          <li><strong>Ranking Regionale:</strong> Classifica calcolata esclusivamente sui punteggi ottenuti in gare svolte in una specifica regione.</li>
          <li><strong>Ranking Mensile:</strong> Classifica calcolata sui punteggi ottenuti in un singolo mese solare.</li>
        </ul>
      </div>
    </div>
  `);
}

// ── NOT FOUND ─────────────────────────────────────────────────
function renderNotFound() {
  setPage(`
    <div class="not-found">
      <h2>404</h2>
      <p>Pagina non trovata — <a href="#/" style="color:var(--red-hot)">Torna alla home</a></p>
    </div>
  `);
}

// ── SEARCH GLOBALE ────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('nav-search');
  const dropdown = document.getElementById('search-results-dropdown');
  if (!input || !dropdown) return;

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(input.value), 250);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 200);
  });
}

function doSearch(q) {
  const dropdown = document.getElementById('search-results-dropdown');
  if (!q.trim() || !globalData) {
    dropdown.style.display = 'none';
    return;
  }

  const { athletes, teams } = globalData;
  const ql = q.toLowerCase();
  const results = [];

  // Cerca atleti
  for (const [id, a] of Object.entries(athletes)) {
    const name = `${a.cognome||''} ${a.nome||''}`.toLowerCase();
    if (name.includes(ql)) {
      results.push({ type: 'atleta', id, display: `${a.cognome} ${a.nome}`, sub: a.team_attuale||'' });
    }
    if (results.length >= 5) break;
  }

  // Cerca team
  for (const [id, t] of Object.entries(teams)) {
    if ((t.nome||'').toLowerCase().includes(ql)) {
      results.push({ type: 'team', id, display: t.nome, sub: `${t.atleti?.length||0} atleti` });
    }
    if (results.length >= 8) break;
  }

  if (!results.length) {
    dropdown.innerHTML = '<div class="search-result-item"><span class="search-result-sub">Nessun risultato</span></div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = results.map(r => `
    <div class="search-result-item" onclick="goTo('#/${r.type}/${r.id}'); document.getElementById('search-results-dropdown').style.display='none'">
      <div>
        <div class="search-result-label">${r.type === 'atleta' ? 'ATLETA' : 'TEAM'}</div>
        <div class="search-result-name">${esc(r.display)}</div>
        <div class="search-result-sub">${esc(r.sub)}</div>
      </div>
    </div>`).join('');
  dropdown.style.display = 'block';
}

window.goTo = (hash) => { window.location.hash = hash; };

// ── MOBILE MENU ───────────────────────────────────────────────
function initMobileMenu() {
  const hamburger = document.getElementById('nav-hamburger');
  const drawer    = document.getElementById('nav-drawer');
  if (!hamburger || !drawer) return;

  hamburger.addEventListener('click', () => {
    const isOpen = drawer.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', isOpen);
  });

  // Chiudi drawer al click su link
  drawer.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      drawer.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
}

// ── CONSTANTS ─────────────────────────────────────────────────
// Spostato in alto

// ── RISULTATI FEED ──────────────────────────────────────────
let risQueryGenere = '';
let risQueryCat = '';
let risQueryMonth = '';
let risQueryRegion = '';
let risSearchQuery = '';
let _risSearchTimer = null;

window.risSetGenere = (v) => { risQueryGenere = v; renderRisultati(); };
window.risSetCat    = (v) => { risQueryCat = v; renderRisultati(); };
window.risSetMonth  = (v) => { risQueryMonth = v; renderRisultati(); };
window.risSetRegion = (v) => { risQueryRegion = v; renderRisultati(); };
window.risSetSearch = (v) => { 
  clearTimeout(_risSearchTimer); 
  _risSearchTimer = setTimeout(() => { risSearchQuery = v; renderRisultati(); }, 300);
};

async function renderRisultati() {
  if (!globalData) return;
  const { resultsRaw, calendar } = globalData;
  
  // Raggruppa per EVENTO: (nome_gara normalizzato, data, genere)
  // Questo evita che la stessa gara con categorie diverse appaia come doppia
  const eventMap = {};
  for (const r of resultsRaw) {
    const eventKey = r.nome_gara.trim().toUpperCase() + '|' + r.data + '|' + (r.genere||'M');
    if (!eventMap[eventKey]) {
      eventMap[eventKey] = {
        id: r.gara_id,          // gara_id del primo risultato (per link gara)
        nome: r.nome_gara,
        data: r.data,
        genere: r.genere,
        tipo: r.tipo,
        regione: r.regione,
        byCategory: {}          // risultati raggruppati per categoria
      };
    }
    const cat = r.categoria || 'N/D';
    if (!eventMap[eventKey].byCategory[cat]) {
      eventMap[eventKey].byCategory[cat] = { gara_id: r.gara_id, results: [] };
    }
    eventMap[eventKey].byCategory[cat].results.push(r);
  }

  for (const ev of Object.values(eventMap)) {
    const firstCat = Object.values(ev.byCategory)[0];
    const firstRes = firstCat ? firstCat.results[0] : null;
    ev.mult = firstRes?.moltiplicatore || 1;
    ev.tipo = firstRes?.tipo || 'regionale';
    ev.campionato_regionale = firstRes?.campionato_regionale || false;
    ev.campionato_italiano = firstRes?.campionato_italiano || false;
  }

  let races = Object.values(eventMap).sort((a,b) => (b.data||'').localeCompare(a.data||''));
  
  // Extract all regions, filtering out category false positives
  const badRegions = ['JUNIORES', 'ALLIEVE', 'ESORDIENTI', 'UNDER', 'ELITE', 'DONNE', 'UOMINI', 'ITALIA', 'PROVA', 'CAMPIONATO'];
  const allRegions = [...new Set(races.map(r => r.regione).filter(Boolean))].filter(r => !badRegions.includes(r.toUpperCase())).sort();

  // Apply filters
  if (risSearchQuery) {
    const q = risSearchQuery.toLowerCase();
    races = races.filter(r => r.nome.toLowerCase().includes(q) || (r.regione || '').toLowerCase().includes(q));
  }
  if (risQueryGenere) races = races.filter(r => r.genere === risQueryGenere);
  if (risQueryMonth)  races = races.filter(r => r.data && r.data.split('-')[1] === risQueryMonth);
  if (risQueryRegion) races = races.filter(r => r.regione === risQueryRegion);
  const allCatsSet = new Set();
  races.forEach(r => Object.keys(r.byCategory||{}).forEach(c => allCatsSet.add(c)));
  const allCats = [...allCatsSet].sort();
  if (risQueryCat) races = races.filter(r => r.byCategory && r.byCategory[risQueryCat]);

  // ── First render: build the persistent shell ──────────────────
  const appEl = document.getElementById('app');
  if (!appEl) return;
  const isFirstRender = !document.getElementById('ris-cards');
  if (isFirstRender) {
    const selectsHtml = `
      <select class="cal-filter-select" id="ris-sel-month" onchange="window.risSetMonth(this.value)" aria-label="Filtra per mese">
        <option value="">Tutti i mesi</option>
        ${['01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i) =>
          `<option value="${m}">${['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'][i]}</option>`
        ).join('')}
      </select>
      <select class="cal-filter-select" id="ris-sel-genere" onchange="window.risSetGenere(this.value)" aria-label="Filtra per genere">
        <option value="">Tutti i generi</option>
        <option value="M">Uomini</option>
        <option value="F">Donne</option>
      </select>
      <select class="cal-filter-select" id="ris-sel-region" onchange="window.risSetRegion(this.value)" aria-label="Filtra per regione">
        <option value="">Tutte le regioni</option>
        ${allRegions.map(r => `<option value="${r}">${esc(r)}</option>`).join('')}
      </select>
      <select class="cal-filter-select" id="ris-sel-cat" onchange="window.risSetCat(this.value)" aria-label="Filtra per categoria">
        <option value="">Tutte le categorie</option>
      </select>`;

    setPage(`
      <div class="content-wrapper">
        <div class="section-header">
          <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">RISULTATI GARE</h1>
          <span class="section-line"></span>
        </div>
        <div class="calendar-controls">
          <input type="text" id="ris-search-input" class="cal-filter-select" placeholder="Cerca gara o regione..."
            style="width:100%;box-sizing:border-box;padding:12px 16px;margin-bottom:12px;"
            oninput="window.risSetSearch(this.value)" autocomplete="off">
          <div id="ris-selects">${selectsHtml}</div>
          <span class="ranking-count" id="ris-count"></span>
        </div>
        <div class="risultati-feed" style="margin-top:20px;" id="ris-cards"></div>
      </div>
    `);
  }

  // ── Always: update selects state ──────────────────────────────
  const selMonth  = document.getElementById('ris-sel-month');
  const selGenere = document.getElementById('ris-sel-genere');
  const selRegion = document.getElementById('ris-sel-region');
  const selCat    = document.getElementById('ris-sel-cat');
  const countEl   = document.getElementById('ris-count');
  const cardsEl   = document.getElementById('ris-cards');

  if (selMonth)  selMonth.value  = risQueryMonth  || '';
  if (selGenere) selGenere.value = risQueryGenere || '';
  if (selRegion) {
    // Rebuild region options (they can change with filters)
    selRegion.innerHTML = `<option value="">Tutte le regioni</option>` +
      allRegions.map(r => `<option value="${r}"${r === risQueryRegion ? ' selected' : ''}>${esc(r)}</option>`).join('');
  }
  if (selCat) {
    selCat.innerHTML = `<option value="">Tutte le categorie</option>` +
      allCats.map(c => `<option value="${c}"${c === risQueryCat ? ' selected' : ''}>${catLabel(c)}</option>`).join('');
  }
  if (countEl) countEl.textContent = `${races.length} gare trovate`;

  // Always: rebuild only the cards area
  if (cardsEl) {
    cardsEl.innerHTML = races.map(race => {
      const mult = race.mult || 1;
      const categories = Object.entries(race.byCategory || {});

      // Una sezione per ogni categoria dell'evento
      const catSections = categories.map(([catName, catData]) => {
        const top3 = (catData.results || []).sort((a,b) => a.posizione - b.posizione).slice(0,3);
        const catGaraId = catData.gara_id;
        const cLabel = catLabel(catName) || catName;

        // km/media specifici di questa categoria
        const firstRes = catData.results?.[0];
        const kmVal    = firstRes?.km    || '';
        const mediaVal = firstRes?.media || '';
        const techBit  = (kmVal || mediaVal)
          ? ' &nbsp;|&nbsp; ' +
            (kmVal ? '&#128205; ' + esc(kmVal) + ' km' : '') +
            (kmVal && mediaVal ? ' &nbsp;|&nbsp; ' : '') +
            (mediaVal ? '&#9889; ' + esc(mediaVal) + ' km/h' : '')
          : '';

        const podioRows = top3.map((r,i) => {
          const pClass = ['p1','p2','p3'][i] || 'pout';
          return '<div class="hero-podio-row" style="animation-delay:' + (i*60) + 'ms;grid-template-columns:40px 1fr auto;">' +
            '<div class="hero-pos ' + pClass + '" style="font-size:2rem">' + r.posizione + '&#176;</div>' +
            '<div>' +
              '<div class="hero-name"><a href="#/atleta/' + esc(r.atleta_id) + '">' + esc(r.cognome) + ' ' + esc(r.nome) + '</a></div>' +
              '<div class="hero-team"><a href="#/team/' + esc(r.team_id) + '" style="color:var(--text-secondary)">' + esc(r.team) + '</a></div>' +
            '</div>' +
            '<div class="hero-pts" style="font-size:1.3rem">' + r.punti_effettivi + ' pt</div>' +
          '</div>';
        }).join('');

        return `
          <div style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
              ${categories.length > 1 ? '<span style="font-size:0.65rem;font-family:var(--font-mono);color:var(--accent);text-transform:uppercase;letter-spacing:1px;">' + cLabel + '</span>' : ''}
              <span style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono)">${techBit}</span>
            </div>
            ${podioRows}
            <div style="padding-top:10px;margin-top:10px;border-top:1px solid var(--border-subtle);">
              <a href="#/gara/${esc(catGaraId)}" class="btn-action full" style="font-size:0.75rem;text-align:center;">VAI ALLA CLASSIFICA COMPLETA &rarr;</a>
            </div>
          </div>`;
      }).join(categories.length > 1 ? '<div style="border-top:2px solid var(--border-subtle);margin:16px 0;"></div>' : '');

      return `
        <div class="hero-band" style="margin-bottom:24px;padding:24px;">
          <div class="hero-label" style="font-size:0.6rem">RISULTATI GARA</div>
          <div class="hero-race-name" style="font-size:clamp(1.6rem,3vw,2.4rem);"><a href="#/gara/${esc(race.id)}">${esc(race.nome)}</a></div>
          <div class="hero-race-meta" style="margin-bottom:16px;">
            <span>${fmtDate(race.data)}</span>
            ${badgeMult(race.mult, race.tipo, race.campionato_regionale, race.campionato_italiano)}
          </div>
          <div class="hero-divider" style="margin-bottom:12px;"></div>
          <div class="hero-podio">${catSections}</div>
        </div>`;
    }).join('') || '<div class="empty-state">Nessuna gara trovata</div>';
  }
}



