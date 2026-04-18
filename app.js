/* ============================================================
   ItaliacritResultati — app.js
   Hash Router + Page Renderers
   Legge i JSON statici da data/ via fetch()
   ============================================================ */

'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────
const BASEPTS = { 1:15, 2:12, 3:10, 4:8, 5:6, 6:5, 7:4, 8:3, 9:2, 10:1 };

// ── DATA CACHE ────────────────────────────────────────────────
const cache = {};
async function loadJson(path) {
  if (cache[path]) return cache[path];
  try {
    const r = await fetch(path, { cache: 'no-store' });
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
  const [calendar, resultsRaw, athletes, teams, meta] = await Promise.all([
    loadJson('data/calendar.json'),
    loadJson('data/results_raw.json'),
    loadJson('data/athletes.json'),
    loadJson('data/teams.json'),
    loadJson('data/meta.json'),
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
    resultsByAtleta,
    resultsByTeam
  };
}

const RANKING_CODES = [
  'ES1_M','ES2_M','AL_M','JUN_M','ELI_M',
  'ES1_F','ES2_F','AL_F','JUN_F','ELI_F'
];

async function loadRanking(code, territory) {
  const path = (!territory || territory === 'ITALIA') 
    ? `data/rankings/${code}.json`
    : `data/rankings_regionali/${territory}/${code}.json`;
  const data = await loadJson(path);
  return data || [];
}

async function loadTeamRanking(code, territory) {
  const path = (!territory || territory === 'ITALIA') 
    ? `data/team_rankings/${code}.json`
    : `data/rankings_regionali/${territory}/team/${code}.json`;
  const data = await loadJson(path);
  return data || [];
}

// ── UTILITY ───────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── CUSTOM MODAL (sostituisce window.prompt bloccato dal browser) ──
function showModalInput(title, placeholder, callback) {
  // Rimuovi eventuale modal esistente
  document.getElementById('__modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__modal-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:9999;
    display:flex; align-items:center; justify-content:center;
    animation:fadeIn 0.15s ease;
  `;

  overlay.innerHTML = `
    <div style="background:var(--bg-card,#1a1a1f); border:1px solid var(--border-subtle,#333); border-radius:12px;
      padding:32px; min-width:340px; max-width:90vw; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="font-family:'Rajdhani',sans-serif; font-size:1.1rem; text-transform:uppercase;
        letter-spacing:1px; color:var(--text-primary,#fff); margin-bottom:16px;">${title}</div>
      <input id="__modal-input" type="text" placeholder="${placeholder}"
        style="width:100%; padding:10px 14px; background:var(--bg-secondary,#111); border:1px solid var(--yellow-race,#f5c518);
        border-radius:6px; color:var(--text-primary,#fff); font-size:1rem; outline:none; box-sizing:border-box;" />
      <div id="__modal-results" style="margin-top:8px; max-height:200px; overflow-y:auto;"></div>
      <div style="display:flex; gap:10px; margin-top:20px; justify-content:flex-end;">
        <button id="__modal-cancel" style="padding:8px 20px; background:transparent; border:1px solid var(--border-subtle,#333);
          color:var(--text-muted,#888); border-radius:4px; cursor:pointer; font-family:'Rajdhani',sans-serif;
          text-transform:uppercase;">Annulla</button>
        <button id="__modal-confirm" style="padding:8px 20px; background:var(--red-hot,#e63946); border:none;
          color:#fff; border-radius:4px; cursor:pointer; font-family:'Rajdhani',sans-serif;
          text-transform:uppercase; font-weight:700;">Cerca</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = document.getElementById('__modal-input');
  const confirm = document.getElementById('__modal-confirm');
  const cancel = document.getElementById('__modal-cancel');

  input.focus();

  const close = () => overlay.remove();
  const submit = () => {
    const val = input.value.trim();
    if (val) { close(); callback(val); }
  };

  confirm.addEventListener('click', submit);
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
}

// Modal per selezionare tra risultati multipli
function showModalSelect(title, items, labelFn, callback) {
  document.getElementById('__modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__modal-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:9999;
    display:flex; align-items:center; justify-content:center;
    animation:fadeIn 0.15s ease;
  `;

  const rows = items.map((item, i) => `
    <div class="__modal-row" data-idx="${i}" style="padding:10px 14px; cursor:pointer;
      border-bottom:1px solid var(--border-subtle,#333); transition:background 0.1s;
      font-family:'Rajdhani',sans-serif; font-size:0.95rem; color:var(--text-primary,#fff);"
      onmouseover="this.style.background='rgba(255,255,255,0.05)'" 
      onmouseout="this.style.background='transparent'">
      ${labelFn(item, i)}
    </div>
  `).join('');

  overlay.innerHTML = `
    <div style="background:var(--bg-card,#1a1a1f); border:1px solid var(--border-subtle,#333); border-radius:12px;
      padding:24px; min-width:340px; max-width:90vw; max-height:80vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="font-family:'Rajdhani',sans-serif; font-size:1.1rem; text-transform:uppercase;
        letter-spacing:1px; color:var(--text-primary,#fff); margin-bottom:16px;">${title}</div>
      <div>${rows}</div>
      <div style="margin-top:16px; text-align:right;">
        <button id="__modal-cancel" style="padding:8px 20px; background:transparent; border:1px solid var(--border-subtle,#333);
          color:var(--text-muted,#888); border-radius:4px; cursor:pointer; font-family:'Rajdhani',sans-serif;
          text-transform:uppercase;">Annulla</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById('__modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.__modal-row').forEach(row => {
    row.addEventListener('click', () => {
      close();
      callback(items[parseInt(row.dataset.idx)]);
    });
  });
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

function badgeMult(m) {
  const cls = m === 3 ? 'mult-x3' : m === 2 ? 'mult-x2' : 'mult-x1';
  return `<span class="badge-cat badge-${cls}">×${m}</span>`;
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

function getRankingFileCode(cat) {
  if (!cat) return null;
  // Accorpiamo Allievi 1 e 2 in 'AL' per i file di classifica
  if (cat.startsWith('AL')) return 'AL_' + (cat.endsWith('_F') ? 'F' : 'M');
  return cat;
}

function renderTrend(r) {
  if (!r) return '';
  const currentPos = r.pos;
  const prevRank = r.prev_pos;
  
  if (!prevRank) {
    // Se non abbiamo prev_pos ma abbiamo gare, potrebbe essere un nuovo ingresso
    if (r.gare === 1 || r.n_atleti === 1) return `<span class="trend-new">NEW</span>`;
    return '';
  }
  
  const diff = prevRank - currentPos;
  if (diff > 0) return `<span class="trend trend-up">▲${diff}</span>`;
  if (diff < 0) return `<span class="trend trend-down">▼${Math.abs(diff)}</span>`;
  return `<span class="trend trend-stable">●</span>`;
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

// ── ROUTER ────────────────────────────────────────────────────
const app = document.getElementById('app');
const footer_update = document.getElementById('footer-update');

let globalData = null;

window.addEventListener('hashchange', route);
window.addEventListener('load', async () => {
  globalData = await loadAll();

  // Footer update
  if (globalData.meta?.last_update) {
    const d = new Date(globalData.meta.last_update);
    footer_update.textContent = d.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  // Live badge: se aggiornato nelle ultime 2 ore
  if (globalData.meta?.last_update) {
    const ageMs = Date.now() - new Date(globalData.meta.last_update).getTime();
    if (ageMs < 2 * 3600 * 1000) {
      document.getElementById('badge-live').classList.add('visible');
    }
  }

  document.getElementById('initial-loader')?.remove();
  route();
  initSearch();
  initMobileMenu();
  initTheme();
});

// ── THEME TOGGLE ───────────────────────────────────────────────
function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const updateIcon = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    btn.textContent = isLight ? '🌙' : '☀️';
    btn.title = isLight ? 'Passa a tema scuro' : 'Passa a tema chiaro';
  };

  updateIcon(); // inizializza icona in base al tema corrente

  btn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const newTheme = isLight ? 'dark' : 'light';
    if (newTheme === 'dark') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('italiacrit-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('italiacrit-theme', 'light');
    }
    updateIcon();
  });
}

function route() {
  const hash = window.location.hash || '#/';
  updateNavActive(hash);

  const match = (pattern) => {
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
    return hash.replace('#', '').match(re);
  };

  if (match('/')) return renderHome();
  if (match('/classifica')) {
    document.getElementById('nav-class')?.classList.add('active');
    return renderClassifica();
  }
  if (match('/risultati')) return renderRisultati();
  if (match('/calendario')) return renderCalendario();
  if (match('/statistiche')) return renderStats();
  if (match('/mensile')) return renderClassificaMensile();
  if (match('/info')) {
    document.getElementById('nav-info')?.classList.add('active');
    return renderInfo();
  }
  if (match('/atleti')) {
    document.getElementById('nav-atleti')?.classList.add('active');
    return renderDirectoryAtleti();
  }
  if (match('/squadre')) {
    document.getElementById('nav-squadre')?.classList.add('active');
    return renderDirectoryTeams();
  }
  const m_atleta = match('/atleta/:id');
  if (m_atleta) return renderAtleta(m_atleta[1]);
  const m_team = match('/team/:id');
  if (m_team) return renderTeam(m_team[1]);
  const m_gara = match('/gara/:id');
  if (m_gara) return renderGara(m_gara[1]);
  const m_confronto = match('/confronto/:id1/:id2');
  if (m_confronto) return renderConfronto(m_confronto[1], m_confronto[2]);
  const m_confronto_team = match('/confronto-team/:id1/:id2');
  if (m_confronto_team) return renderConfrontoTeam(m_confronto_team[1], m_confronto_team[2]);

  renderNotFound();
}

function updateNavActive(hash) {
  ['nav-home','nav-class','nav-cal','nav-risultati','nav-stats','nav-atleti','nav-squadre','nav-info'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  if (hash === '#/' || hash === '#') document.getElementById('nav-home')?.classList.add('active');
  else if (hash.startsWith('#/classifica')) document.getElementById('nav-class')?.classList.add('active');
  else if (hash.startsWith('#/risultati')) document.getElementById('nav-risultati')?.classList.add('active');
  else if (hash.startsWith('#/calendario')) document.getElementById('nav-cal')?.classList.add('active');
  else if (hash.startsWith('#/info')) document.getElementById('nav-info')?.classList.add('active');
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
    if (!raceMap[r.gara_id]) raceMap[r.gara_id] = { id: r.gara_id, nome: r.nome_gara, data: r.data, categoria: r.categoria, genere: r.genere, tipo: r.tipo, results: [] };
    raceMap[r.gara_id].results.push(r);
  }
  // Aumenta moltiplicatori
  for (const g of calendar) {
    if (raceMap[g.id]) {
      raceMap[g.id].mult = multFromType(g.tipo, g.campionato_regionale, g.campionato_italiano);
    }
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
                ${badgeMult(mult)}
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

  // Top 3 per categoria
  const catOrder = ['JUN_M','ELI_M','AL_M','ES2_M','ES1_M','ELI_F','JUN_F','AL_F','ES2_F','ES1_F'];
  const catCardsHtml = await (async () => {
    const cards = [];
    for (const code of catOrder) {
      const ranking = await loadRanking(code, 'ITALIA');
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
                  </div>
                  <div class="cat-rider-team">
                    <a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team_nome)}</a>
                  </div>
                </div>
                <span class="cat-pts">${r.punti}</span>
              </div>`).join('')}
          </div>
          <div style="padding: 10px 16px; border-top: 1px solid var(--border-subtle); background: var(--bg-secondary);">
             <a href="#/classifica" onclick="window.rankCat='${code}'; window.rankGender='${isF ? 'donne' : 'uomini'}'; window.rankFilter='';" class="btn-action full" style="font-size:0.7rem;">VAI ALLA CLASSIFICA &rarr;</a>
          </div>
        </div>`);
    }
    return cards.join('');
  })();

  setPage(`
    ${heroHtml}
    <div class="section-header">
      <span class="section-title">CLASSIFICHE</span>
      <span class="section-line"></span>
      <span class="section-subtitle">Top 3 per categoria</span>
    </div>
    <div class="cat-grid">${catCardsHtml}</div>
  `);
}

// ── CLASSIFICA ────────────────────────────────────────────────
let rankGender    = 'uomini';
let rankCat       = 'JUN_M';
let rankView      = 'atleti';
let rankFilter    = '';
let rankTerritory = 'ITALIA';
let rankMonth     = ''; // '' = stagionale, 'YYYY-MM' = mensile

window.setRankGender = (v) => { rankGender = v; rankCat = (v === 'uomini' ? 'AL_M' : 'AL_F'); updateRankTable(); renderClassifica(); };
window.setRankCat    = (v) => { rankCat = v; updateRankTable(); renderClassifica(); };
window.setRankView   = (v) => { rankView = v; updateRankTable(); renderClassifica(); };
window.setRankFilter = (v) => { rankFilter = v; updateRankTable(); };
window.setRankTerritory = (v) => { rankTerritory = v; updateRankTable(); renderClassifica(); };
window.setRankMonth  = (v) => { rankMonth = v; updateRankTable(); };

async function renderClassifica() {
  if (!globalData) return;
  const { calendar } = globalData;
  const allRegs = [...new Set(calendar.map(g => g.regione).filter(Boolean))].sort();

  // Mesi disponibili da resultsRaw
  const MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                   'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const { resultsRaw } = globalData;
  const allMonths = [...new Set(
    resultsRaw.map(r => r.data?.slice(0,7)).filter(Boolean)
  )].sort().reverse();

  const cats = rankGender === 'uomini' ? [
    {id:'ES1_M',label:'Esordienti 1°'},{id:'ES2_M',label:'Esordienti 2°'},{id:'AL_M',label:'Allievi'},{id:'JUN_M',label:'Juniores'},{id:'ELI_M',label:'Elite - U23'}
  ] : [
    {id:'ES1_F',label:'Donne Es 1°'},{id:'ES2_F',label:'Donne Es 2°'},{id:'AL_F',label:'Donne Allieve'},{id:'JUN_F',label:'Donne Juniores'},{id:'ELI_F',label:'Donne Elite - U23'}
  ];

  const genderTabs = `
    <button class="tab-btn ${rankGender==='uomini'?'active-cat':''}" onclick="setRankGender('uomini')">UOMINI</button>
    <button class="tab-btn ${rankGender==='donne'?'active-cat':''}" onclick="setRankGender('donne')">DONNE</button>
  `;

  const catTabs = cats.map(c => `
    <button class="tab-btn ${rankCat===c.id?'active-cat':''}" onclick="setRankCat('${c.id}')">${c.label}</button>
  `).join('');

  const territorySelect = `
    <select class="cal-filter-select" onchange="setRankTerritory(this.value)" style="font-weight:700">
      <option value="ITALIA" ${rankTerritory==='ITALIA'?'selected':''}>🇮🇹 ITALIA (Nazionale)</option>
      ${allRegs.map(r => `<option value="${r}" ${rankTerritory===r?'selected':''}>${esc(r)}</option>`).join('')}
    </select>
    <select class="cal-filter-select" onchange="setRankMonth(this.value)" style="font-weight:700">
      <option value="" ${rankMonth===''?'selected':''}>📅 Stagionale</option>
      ${allMonths.map(ym => {
        const [y,m] = ym.split('-');
        return `<option value="${ym}" ${rankMonth===ym?'selected':''}>${MESI_IT[parseInt(m)-1]} ${y}</option>`;
      }).join('')}
    </select>
  `;

  const viewTabs = `
    <div class="tab-group" role="tablist" style="margin-left:auto">
      <button class="tab-btn ${rankView==='atleti'?'active-cat':''}" onclick="setRankView('atleti')">👤 ATLETI</button>
      <button class="tab-btn ${rankView==='team'?'active-cat':''}" onclick="setRankView('team')">🏢 TEAM</button>
    </div>`;

  setPage(`
    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:28px">CLASSIFICHE</h1>
    <div class="ranking-controls">
      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px">
        ${territorySelect}
        <div class="tab-group" role="tablist" aria-label="Seleziona genere">${genderTabs}</div>
      </div>
      <div class="tab-group" role="tablist" aria-label="Seleziona categoria" style="margin-bottom:24px">${catTabs}</div>
      <div class="ranking-filter-bar">
        <input type="search" id="ranking-search"
          placeholder="${rankView==='atleti'?'Filtra atleta o team…':'Filtra team…'}"
          value="${esc(rankFilter)}"
          oninput="setRankFilter(this.value)"
          aria-label="Filtra classifica" />
        <span class="ranking-count" id="rank-count-label">Caricamento...</span>
        ${viewTabs}
      </div>
    </div>
    <div class="ranking-table-wrap" id="rank-table-container"></div>
  `);

  await updateRankTable();
}

async function updateRankTable() {
  const container = document.getElementById('rank-table-container');
  const countSpan = document.getElementById('rank-count-label');
  if (!container || !countSpan) return;

  // ── MODALITÀ MENSILE: calcola on-the-fly da resultsRaw ──
  if (rankMonth) {
    const { resultsRaw, athletes, teams } = globalData;
    const catCode = rankCat;
    const ym = rankMonth;

    if (rankView === 'atleti') {
      const byAtleta = {};
      // filtra per mese E regione (se selezionata)
      resultsRaw.filter(r =>
        r.data?.startsWith(ym) &&
        (rankTerritory === 'ITALIA' || r.regione === rankTerritory)
      ).forEach(r => {
        const a = athletes[r.atleta_id];
        if (!a || a.categoria !== catCode) return;
        if (!byAtleta[r.atleta_id]) byAtleta[r.atleta_id] = {
          atleta_id: r.atleta_id, cognome: a.cognome, nome: a.nome,
          team_id: a.team_id, team_nome: a.team_attuale,
          punti: 0, gare: 0, p1: 0, p2: 0, p3: 0, pout: 0
        };
        const entry = byAtleta[r.atleta_id];
        entry.punti += r.punti_effettivi || 0;
        entry.gare++;
        if (r.posizione === 1) entry.p1++;
        else if (r.posizione === 2) entry.p2++;
        else if (r.posizione === 3) entry.p3++;
        else if (r.posizione <= 10) entry.pout++;
      });
      let ranking = Object.values(byAtleta)
        .sort((a,b) => b.punti - a.punti || b.p1 - a.p1)
        .map((r, i) => ({ ...r, pos: i+1 }));

      const filtered = ranking.filter(r => {
        if (!rankFilter) return true;
        const q = rankFilter.toLowerCase();
        return (r.cognome||'').toLowerCase().includes(q) ||
               (r.nome||'').toLowerCase().includes(q) ||
               (r.team_nome||'').toLowerCase().includes(q);
      });
      countSpan.textContent = `${filtered.length} atleti`;

      const rows = filtered.map((r, i) => `
        <tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
          <td><span class="rank-num ${posClass(r.pos)}">${r.pos}</span></td>
          <td>
            <div class="rank-progress-wrap">
              <span class="rank-name"><a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a></span>
            </div>
          </td>
          <td class="hide-mobile"><a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary);font-size:.85rem">${esc(r.team_nome)}</a></td>
          <td class="r"><span class="rank-pts">${r.punti}</span></td>
          <td class="r hide-mobile" style="color:var(--text-secondary);font-family:var(--font-mono);font-size:.85rem">${r.gare}</td>
          <td class="hide-mobile">
            <div class="td-p-wrap">
              <span class="td-p p1">${r.p1}</span>
              <span class="td-p p2">${r.p2}</span>
              <span class="td-p p3">${r.p3}</span>
              <span class="td-p pout">${r.pout}</span>
            </div>
          </td>
        </tr>`).join('');

      const MESI_IT_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
      const [ymY, ymM] = ym.split('-');
      const meseLbl = `${MESI_IT_SHORT[parseInt(ymM)-1]} ${ymY}`;
      const regioneLbl = rankTerritory !== 'ITALIA' ? ` — ${rankTerritory}` : '';

      container.innerHTML = `
        <div style="font-family:var(--font-heading); font-size:0.75rem; text-transform:uppercase;
          color:var(--text-muted); letter-spacing:0.1em; margin-bottom:8px; padding:8px 0;
          border-bottom:1px solid var(--border-subtle);">
          Piazzamenti e punti relativi a: <strong style="color:var(--text-primary)">${meseLbl}${regioneLbl}</strong>
        </div>
        <table class="ranking-table" role="table">
          <thead><tr>
            <th style="width:50px">POS</th><th>ATLETA</th>
            <th class="hide-mobile">TEAM</th>
            <th class="r">PUNTI</th>
            <th class="r hide-mobile">GARE</th>
            <th class="hide-mobile">
              <div class="td-p-wrap">
                <span class="td-p">1°</span><span class="td-p">2°</span>
                <span class="td-p">3°</span><span class="td-p" style="font-size:0.7rem">4-10</span>
              </div>
            </th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty-state">Nessun dato per questo mese' + (regioneLbl ? regioneLbl : '') + '</td></tr>'}</tbody>
        </table>`;
      return;
    }

    // Team mensile (con filtro regione)
    const byTeam = {};
    resultsRaw.filter(r =>
      r.data?.startsWith(ym) &&
      (rankTerritory === 'ITALIA' || r.regione === rankTerritory)
    ).forEach(r => {
      const a = athletes[r.atleta_id];
      if (!a || a.categoria !== catCode) return;
      const tid = a.team_id || r.team_id;
      const tnome = a.team_attuale || r.team || tid;
      if (!byTeam[tid]) byTeam[tid] = { team_id: tid, team_nome: tnome, punti: 0, p1:0, p2:0, p3:0, pout:0, n_atleti: new Set() };
      byTeam[tid].punti += r.punti_effettivi || 0;
      if (r.posizione === 1) byTeam[tid].p1++;
      else if (r.posizione === 2) byTeam[tid].p2++;
      else if (r.posizione === 3) byTeam[tid].p3++;
      else if (r.posizione <= 10) byTeam[tid].pout++;
      byTeam[tid].n_atleti.add(r.atleta_id);
    });
    let teamRanking = Object.values(byTeam)
      .map(t => ({ ...t, n_atleti: t.n_atleti.size }))
      .sort((a,b) => b.punti - a.punti)
      .map((t,i) => ({ ...t, pos: i+1 }));

    const filteredT = teamRanking.filter(t =>
      !rankFilter || (t.team_nome||'').toLowerCase().includes(rankFilter.toLowerCase())
    );
    countSpan.textContent = `${filteredT.length} team`;

    const teamRows = filteredT.map((t,i) => `
      <tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td><span class="rank-num ${posClass(t.pos)}">${t.pos}</span></td>
        <td><div class="rank-progress-wrap"><span class="rank-name"><a href="#/team/${esc(t.team_id)}">${esc(t.team_nome)}</a></span></div></td>
        <td class="r"><span class="rank-pts">${t.punti}</span></td>
        <td class="hide-mobile"><div class="td-p-wrap">
          <span class="td-p p1">${t.p1}</span><span class="td-p p2">${t.p2}</span>
          <span class="td-p p3">${t.p3}</span><span class="td-p pout">${t.pout}</span>
        </div></td>
        <td class="r hide-mobile" style="font-family:var(--font-mono);font-size:.85rem;color:var(--text-muted)">${t.n_atleti}</td>
      </tr>`).join('');

    const MESI_IT_SHORT2 = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    const [ymY2, ymM2] = ym.split('-');
    const meseLbl2 = `${MESI_IT_SHORT2[parseInt(ymM2)-1]} ${ymY2}`;
    const regioneLbl2 = rankTerritory !== 'ITALIA' ? ` — ${rankTerritory}` : '';

    container.innerHTML = `
      <div style="font-family:var(--font-heading); font-size:0.75rem; text-transform:uppercase;
        color:var(--text-muted); letter-spacing:0.1em; margin-bottom:8px; padding:8px 0;
        border-bottom:1px solid var(--border-subtle);">
        Piazzamenti e punti relativi a: <strong style="color:var(--text-primary)">${meseLbl2}${regioneLbl2}</strong>
      </div>
      <table class="ranking-table" role="table">
        <thead><tr>
          <th style="width:50px">POS</th><th>TEAM</th>
          <th class="r">PUNTI</th>
          <th class="hide-mobile"><div class="td-p-wrap">
            <span class="td-p">1°</span><span class="td-p">2°</span>
            <span class="td-p">3°</span><span class="td-p" style="font-size:0.7rem">4-10</span>
          </div></th>
          <th class="r hide-mobile">ATLETI</th>
        </tr></thead>
        <tbody>${teamRows || '<tr><td colspan="5" class="empty-state">Nessun dato per questo mese' + (regioneLbl2 ? regioneLbl2 : '') + '</td></tr>'}</tbody>
      </table>`;
    return;
  }

  // ── MODALITÀ STAGIONALE (default) ──
  let tableHtml = '';
  let countLabel = '';

  if (rankView === 'atleti') {
    const raw = await loadRanking(rankCat, rankTerritory);
    const ranking = raw.map(r => ({
      ...r,
      atleta_id: r.atleta_id || r.id,
      punti: r.punti ?? r.pts,
      team_nome: r.team_nome || r.team
    }));
    const filtered = ranking.filter(r => {
      if (!rankFilter) return true;
      const q = rankFilter.toLowerCase();
      return (r.cognome||'').toLowerCase().includes(q) ||
             (r.nome||'').toLowerCase().includes(q) ||
             (r.team_nome||'').toLowerCase().includes(q);
    });
    countLabel = `${filtered.length} atleti`;

    const rows = filtered.map((r, i) => {
      const wins = r.vittorie || 0;
      const pClass = posClass(r.pos);
      return `<tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td>
          <div style="display:flex; align-items:baseline; gap:8px">
            <span class="rank-num ${pClass}">${r.pos}</span>
            ${renderTrend(r)}
          </div>
        </td>
        <td>
          <div class="rank-progress-wrap">
            ${wins >= 2 ? flameSvg() : ''}
            <span class="rank-name"><a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a></span>
          </div>
        </td>
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
      <table class="ranking-table" role="table" aria-label="Classifica atleti ${catLabel(rankCat)}">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th>ATLETA</th>
          <th class="hide-mobile">TEAM</th>
          <th class="r">PUNTI</th>
          <th class="r hide-mobile">GARE</th>
          <th class="hide-mobile">
            <div class="td-p-wrap">
              <span class="td-p">1°</span>
              <span class="td-p">2°</span>
              <span class="td-p">3°</span>
              <span class="td-p" style="font-size:0.7rem">4-10</span>
            </div>
          </th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty-state">Nessun dato</td></tr>'}</tbody>
      </table>`;

  } else {
    // ── TEAM RANKING ───────────────────────────────────────────
    const raw = await loadTeamRanking(rankCat, rankTerritory);
    const teamRanking = raw.map(t => ({
      ...t,
      team_id: t.team_id || t.id,
      punti: t.punti ?? t.pts,
      team_nome: t.team_nome || t.nome
    }));
    const filtered = teamRanking.filter(t => {
      if (!rankFilter) return true;
      return (t.team_nome||'').toLowerCase().includes(rankFilter.toLowerCase());
    });
    countLabel = `${filtered.length} team`;

    const rows = filtered.map((t, i) => {
      const pClass = posClass(t.pos);
      return `<tr class="ranking-row" style="animation-delay:${Math.min(i,20)*30}ms">
        <td>
          <div style="display:flex; align-items:baseline; gap:8px">
            <span class="rank-num ${pClass}">${t.pos}</span>
            ${renderTrend(t)}
          </div>
        </td>
        <td>
          <div class="rank-progress-wrap">
            <span class="rank-name"><a href="#/team/${esc(t.team_id)}">${esc(t.team_nome)}</a></span>
          </div>
        </td>
        <td class="r"><span class="rank-pts">${t.punti}</span></td>
        <td class="hide-mobile">
          <div class="td-p-wrap">
            <span class="td-p p1" title="Vittorie">${t.p1||0}</span>
            <span class="td-p p2" title="Secondi Posti">${t.p2||0}</span>
            <span class="td-p p3" title="Terzi Posti">${t.p3||0}</span>
            <span class="td-p pout" title="Piazzamenti 4-10">${t.pout||0}</span>
          </div>
        </td>
        <td class="r hide-mobile" style="font-family:var(--font-mono);font-size:.85rem;color:var(--text-muted)">${t.n_atleti||0}</td>
      </tr>`;
    }).join('');

    tableHtml = `
      <table class="ranking-table" role="table" aria-label="Classifica team ${catLabel(rankCat)}">
        <thead><tr>
          <th style="width:50px">POS</th>
          <th>TEAM</th>
          <th class="r">PUNTI</th>
          <th class="hide-mobile">
            <div class="td-p-wrap">
              <span class="td-p">1°</span>
              <span class="td-p">2°</span>
              <span class="td-p">3°</span>
              <span class="td-p" style="font-size:0.7rem">4-10</span>
            </div>
          </th>
          <th class="r hide-mobile">ATLETI</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty-state">Nessun dato</td></tr>'}</tbody>
      </table>`;
  }

  container.innerHTML = tableHtml;
  countSpan.textContent = countLabel;
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
          ${(() => {
             if (!a.regional_ranks) return '';
             const rRanks = Object.entries(a.regional_ranks).sort((a,b) => a[1] - b[1]);
             return `
               <div style="margin-top:20px; display:flex; flex-wrap:wrap; gap:16px;">
                 ${rRanks.map(([reg, pos]) => `
                   <div style="display:flex; align-items:baseline; gap:6px; background:rgba(255,255,255,0.05); padding:4px 12px; border-radius:4px; border:1px solid var(--border-subtle)">
                     <span style="font-weight:900; color:var(--red-hot); font-size:1.1rem">${pos}°</span>
                     <span style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted)">${esc(reg)}</span>
                   </div>
                 `).join('')}
               </div>
             `;
           })()}
           <div style="margin-top:24px; display:flex; gap:12px; flex-wrap:wrap">
             <button onclick="window.exportPalmares('${esc(a.id)}')" class="btn-action">📸 CONDIVIDI PALMARÈS</button>
             <button onclick="window.openH2H('${esc(a.id)}')" class="btn-action">⚔️ CONFRONTA</button>
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
      <td class="hide-mobile" style="color:var(--text-muted);font-size:0.7rem;text-transform:uppercase">${esc(r.regione||'-')}</td>
      <td class="hide-mobile" style="font-size:0.75rem;font-weight:700;color:var(--accent)">${esc(r.cat_gara||'-')}</td>
      <td class="td-pos ${pClass} ${r.posizione===1?'win':''}">${r.posizione}°</td>
      <td class="hide-mobile" style="font-family:var(--font-mono);font-size:0.8rem">${r.km ? r.km+' km' : '-'}</td>
      <td class="hide-mobile" style="font-family:var(--font-mono);font-size:0.8rem">${r.media ? r.media+' km/h' : '-'}</td>
      <td class="td-pts">${r.punti_effettivi||0}</td>
    </tr>`;
  }).join('');

  // Calcolo punti mensili per atleta
  const monthlyPts = {};
  risultati.forEach(r => {
    if (!r.data) return;
    const ym = r.data.slice(0, 7); // 'YYYY-MM'
    if (!monthlyPts[ym]) monthlyPts[ym] = { pts: 0, gare: 0, wins: 0 };
    monthlyPts[ym].pts += r.punti_effettivi || 0;
    monthlyPts[ym].gare++;
    if (r.posizione === 1) monthlyPts[ym].wins++;
  });
  const months = Object.keys(monthlyPts).sort();
  const MESI_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  const monthlyHtml = months.length ? `
    <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:8px;
      padding:20px; margin-bottom:24px;">
      <div style="font-family:var(--font-heading); font-size:0.85rem; text-transform:uppercase;
        letter-spacing:0.1em; color:var(--text-muted); margin-bottom:12px;">
        📅 PUNTI MENSILI — STAGIONE ${new Date().getFullYear()}
        <a href="#/mensile" style="float:right; font-size:0.75rem; color:var(--red-hot); text-decoration:none;
          font-family:var(--font-heading); text-transform:uppercase;">Classifica Mensile →</a>
      </div>
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border-subtle);">
          <th style="font-family:var(--font-heading); font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); padding:4px 8px; text-align:left;">MESE</th>
          <th style="font-family:var(--font-heading); font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); padding:4px 8px; text-align:right;">PT</th>
          <th style="font-family:var(--font-heading); font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); padding:4px 8px; text-align:right;">GARE</th>
          <th style="font-family:var(--font-heading); font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); padding:4px 8px; text-align:right;">WIN</th>
        </tr></thead>
        <tbody>
          ${months.map(ym => {
            const [y, m] = ym.split('-');
            const d = monthlyPts[ym];
            const isPeakMonth = d.pts === Math.max(...Object.values(monthlyPts).map(x=>x.pts));
            return `<tr style="border-bottom:1px solid var(--border-subtle);${isPeakMonth?'background:rgba(245,196,0,0.06);':''}">
              <td style="font-family:var(--font-heading); font-weight:700; padding:6px 8px; color:var(--text-primary);">${MESI_IT[parseInt(m)-1]} ${y}</td>
              <td style="text-align:right; font-family:var(--font-display); font-size:1.1rem; color:var(--yellow-race); padding:6px 8px;">${d.pts}</td>
              <td style="text-align:right; color:var(--text-secondary); padding:6px 8px;">${d.gare}</td>
              <td style="text-align:right; color:var(--gold); padding:6px 8px;">${d.wins > 0 ? '🏆 ' + d.wins : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  setPage(`
    ${headerHtml}
    ${sparkHtml ? `<div class="sparkline-wrap"><div class="sparkline-title">ANDAMENTO PUNTI — STAGIONE ${new Date().getFullYear()}</div>${sparkHtml}</div>` : ''}
    ${risultati.length >= 2 ? buildProgressionChart(risultati) : ''}
    ${monthlyHtml}
    <div class="section-header" style="margin-top:24px">
      <span class="section-title">RISULTATI STAGIONE</span>
      <span class="section-line"></span>
    </div>
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr>
          <th>DATA</th><th>GARA</th><th class="hide-mobile">REG</th><th class="hide-mobile">CAT</th><th>POS</th><th class="hide-mobile">KM</th><th class="hide-mobile">MEDIA</th><th>PTS</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="6" class="empty-state">Nessun risultato</td></tr>'}</tbody>
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

// ── FORM GUIDE (ultimi 5 risultati) ────────────────────────────
function formGuide(risultati) {
  const last5 = (risultati || []).slice(0, 5);
  if (!last5.length) return '';
  return last5.map(r => {
    const p = r.posizione;
    let icon, title, color;
    if (p === 1)       { icon = '🏆'; title = '1° Posto'; color = 'var(--gold)'; }
    else if (p === 2)  { icon = '🥈'; title = '2°'; color = 'var(--silver)'; }
    else if (p === 3)  { icon = '🥉'; title = '3°'; color = 'var(--bronze)'; }
    else if (p <= 5)   { icon = '⬆'; title = `${p}°`; color = 'var(--cat-juniores)'; }
    else if (p <= 10)  { icon = `${p}`; title = `${p}°`; color = 'var(--text-secondary)'; }
    else               { icon = '●'; title = `${p}°`; color = 'var(--text-muted)'; }
    return `<span title="${esc(r.nome_gara || '')} — ${esc(title)}" style="
      display:inline-flex; align-items:center; justify-content:center;
      width:22px; height:22px; border-radius:50%; font-size:0.7rem; font-weight:700;
      background:rgba(128,128,128,0.08); border:1px solid rgba(128,128,128,0.15);
      color:${color}; cursor:default; font-family:var(--font-mono);
    ">${icon}</span>`;
  }).join('');
}

// ── GRAFICO PROGRESSIONE PUNTI CUMULATIVI ──────────────────────
function buildProgressionChart(risultati) {
  // Ordina per data crescente per accumulare
  const sorted = [...risultati].sort((a,b) => (a.data||'').localeCompare(b.data||''));
  if (sorted.length < 2) return '';

  // Calcola punti cumulativi settimana per settimana
  const weekData = {};
  let cumulative = 0;
  sorted.forEach(r => {
    const d = new Date(r.data);
    // ISO week key: YYYY-WXX
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + (4 - (d.getDay() || 7)));
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    const key = `${thursday.getFullYear()}-W${String(weekNum).padStart(2,'0')}`;
    cumulative += (r.punti_effettivi || 0);
    weekData[key] = { pts: cumulative, label: key };
  });

  const weeks = Object.keys(weekData).sort();
  const values = weeks.map(w => weekData[w].pts);

  const W = 800, H = 100, pad = 12;
  const maxV = Math.max(...values, 1);
  const n = values.length;
  const xs = values.map((_, i) => pad + (i / Math.max(n-1,1)) * (W - 2*pad));
  const ys = values.map(v => H - pad - (v / maxV) * (H - 2*pad));

  const pathD = xs.map((x,i) => `${i===0?'M':'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${xs[n-1].toFixed(1)} ${H} L ${xs[0].toFixed(1)} ${H} Z`;

  const circles = xs.map((x,i) => `
    <circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3.5"
      fill="var(--bg-card)" stroke="var(--yellow-race)" stroke-width="2"
      data-label="${weeks[i]}: ${values[i]} pt totali"
      onmouseenter="showSparkTip(event,this)" onmouseleave="hideSparkTip()"
      style="cursor:pointer"/>`).join('');

  // Linee di griglia orizzontali
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => {
    const yg = (H - pad) - f * (H - 2*pad);
    const val = Math.round(f * maxV);
    return `<line x1="${pad}" y1="${yg.toFixed(1)}" x2="${W-pad}" y2="${yg.toFixed(1)}"
      stroke="var(--border-subtle)" stroke-dasharray="3 3" stroke-width="1"/>
    <text x="${pad+2}" y="${(yg-3).toFixed(1)}" fill="var(--text-muted)" font-size="8"
      font-family="var(--font-mono)">${val}</text>`;
  }).join('');

  return `
    <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:8px;
      padding:20px; margin-bottom:24px;">
      <div style="font-family:var(--font-heading); font-size:0.85rem; text-transform:uppercase;
        letter-spacing:0.1em; color:var(--text-muted); margin-bottom:12px;">
        📈 PROGRESSIONE PUNTI — STAGIONE ${new Date().getFullYear()}
        <span style="float:right; font-family:var(--font-display); color:var(--yellow-race); font-size:1.2rem;">
          ${values[values.length-1]} PT
        </span>
      </div>
      <div style="position:relative">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:80px;display:block">
          <defs>
            <linearGradient id="prog-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--yellow-race)" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="var(--yellow-race)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${gridLines}
          <path d="${areaD}" fill="url(#prog-grad)"/>
          <path d="${pathD}" stroke="var(--yellow-race)" stroke-width="2.5" fill="none"
            stroke-linecap="round" stroke-linejoin="round"/>
          ${circles}
        </svg>
      </div>
      <div style="display:flex; justify-content:space-between; font-family:var(--font-mono); font-size:0.7rem; color:var(--text-muted); margin-top:4px;">
        <span>${weeks[0]}</span>
        <span>${weeks[weeks.length-1]}</span>
      </div>
    </div>`;
}

// ── TEAM ──────────────────────────────────────────────────────
async function renderTeam(team_id) {
  if (!globalData) return;
  const { teams, athletes } = globalData;

  const t = teams[team_id];
  if (!t) return renderNotFound();

  // Atleti con punti
  const atletiList = (t.atleti || [])
    .map(id => ({ id, ...athletes[id] }))
    .filter(a => a.punti_totali > 0)
    .sort((a,b) => (b.punti_totali||0) - (a.punti_totali||0));

  const p1 = (t.risultati||[]).filter(r=>r.posizione===1).length;
  const p2 = (t.risultati||[]).filter(r=>r.posizione===2).length;
  const p3 = (t.risultati||[]).filter(r=>r.posizione===3).length;
  const pout = (t.risultati||[]).filter(r=>r.posizione>=4 && r.posizione<=10).length;

  const atletiRows = atletiList.map((a,i) => `
    <div class="cat-card-row">
      <span class="cat-pos ${posClass(i+1)}">${i+1}</span>
      <div>
        <div class="cat-rider-name"><a href="#/atleta/${esc(a.id)}">${esc(a.cognome)} ${esc(a.nome)}</a></div>
        <div class="cat-rider-team">${catLabel(a.categoria||'')}</div>
      </div>
      <span class="cat-pts">${a.punti_totali||0}</span>
    </div>`).join('');

  const risultatiRows = (t.risultati||[])
    .sort((a,b) => (b.data||'').localeCompare(a.data||''))
    .slice(0, 30)
    .map(r => {
      // Per la scheda Team mostriamo il rank della squadra (con tie-break)
      const rankVal = r.team_rank_dopo_gara;
      return `<tr>
        <td class="td-date">${fmtDateShort(r.data)}</td>
        <td class="td-race"><a href="#/gara/${esc(r.gara_id)}">${esc(r.nome_gara)}</a></td>
        <td><a href="#/atleta/${esc(r.atleta_id)}" style="color:var(--text-primary);font-family:var(--font-heading);font-weight:700">${esc(r.atleta_cognome)} ${esc(r.atleta_nome)}</a></td>
        <td class="hide-mobile" style="color:var(--text-muted);font-size:0.7rem;text-transform:uppercase">${esc(r.regione||'-')}</td>
        <td class="hide-mobile" style="font-size:0.75rem;font-weight:700;color:var(--accent)">${esc(r.cat_gara||'-')}</td>
        <td class="td-pos ${posClass(r.posizione)}">${r.posizione}°</td>
        <td class="hide-mobile" style="font-family:var(--font-mono);font-size:0.8rem">${r.km ? r.km+' km' : '-'}</td>
        <td class="hide-mobile" style="font-family:var(--font-mono);font-size:0.8rem">${r.media ? r.media+' km/h' : '-'}</td>
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
  const headerStats = `
    <div class="team-stats-row">
      ${tCatRanks.map(rk => `
      <div class="team-stat" style="border-right:1px solid var(--border-subtle); padding-right:16px; margin-right:6px">
        <span class="team-stat-val" style="color:var(--accent)">${rk.pos}°</span>
        <span class="team-stat-label">Cl. Gen. ${catLabel(rk.cat)}</span>
      </div>`).join('')}
      <div class="team-stat">
        <span class="team-stat-val">${t.punti_totali||0}</span>
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
        ${(() => {
          if (!t.regional_ranks) return '';
          const rRanks = Object.entries(t.regional_ranks).sort((a,b) => a[1] - b[1]);
          return `
            <div style="margin-top:20px; display:flex; flex-wrap:wrap; gap:16px;">
              ${rRanks.map(([reg, pos]) => `
                <div style="display:flex; align-items:baseline; gap:6px; background:rgba(255,255,255,0.05); padding:4px 12px; border-radius:4px; border:1px solid var(--border-subtle)">
                  <span style="font-weight:900; color:var(--red-hot); font-size:1.1rem">${pos}°</span>
                  <span style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted)">${esc(reg)}</span>
                </div>
              `).join('')}
            </div>
          `;
        })()}
      </div>
    </div>
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
          <th>DATA</th><th>GARA</th><th>ATLETA</th><th class="hide-mobile">REG</th><th class="hide-mobile">CAT</th><th>POS</th><th class="hide-mobile">KM</th><th class="hide-mobile">MEDIA</th><th>PTS</th>
        </tr></thead>
        <tbody>${risultatiRows || '<tr><td colspan="5" class="empty-state">Nessun risultato</td></tr>'}</tbody>
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

  const res0 = results[0] || {};
  const name = res0.nome_gara || calEntry?.nome || gara_id;
  const data = res0.data || calEntry?.data || '';
  const cat  = res0.categoria || calEntry?.categoria || '';
  
  // Metadati tecnici con fallback sui risultati
  const km    = res0.km || calEntry?.km || '-';
  const media = res0.media || calEntry?.media || '-';
  const reg   = res0.regione || calEntry?.regione || '—';
  const loc   = res0.localita || calEntry?.localita || '—';

  const mult = res0.moltiplicatore ||
    calEntry?.moltiplicatore ||
    multFromType(
      calEntry?.tipo || res0.tipo || 'regionale',
      calEntry?.campionato_regionale || false,
      calEntry?.campionato_italiano  || false
    );
  const tipo = res0.tipo || calEntry?.tipo || 'regionale';

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
      <td style="text-align:right" class="hide-mobile">${r.rank_dopo_gara ? `<span class="rank-badge" style="font-size:0.75rem; font-weight:normal; color:var(--text-muted)">Rank: <span class="b-num">${r.rank_dopo_gara}°</span></span>` : ''}</td>
      <td class="td-pts">${pts > 0 ? pts : '—'}</td>
    </tr>`;
  }).join('');

  setPage(`
    <div class="race-header">
      <div class="race-name-display">${esc(name)}</div>
      <div class="race-subtitle" style="margin-bottom:12px"><i class="icon-loc">📍</i> ${esc(loc)} (${esc(reg)})</div>
      <div class="race-meta-row" style="margin-bottom:24px">
        <span>${fmtDate(data)}</span>
        <span class="race-meta-sep">|</span>
        <span>${esc(catLabel(cat))}</span>
        <span class="race-meta-sep">|</span>
        <span style="text-transform:capitalize">${esc(tipo)}</span>
        <span class="race-meta-sep">|</span>
        ${badgeMult(mult)}
        ${reg !== '—' ? `<span class="race-reg-badge" style="margin-left:auto">${esc(reg)}</span>` : ''}
      </div>
      
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div class="tech-card">
          <div class="tech-label">Km Percorsi</div>
          <div class="tech-val">${km} <span class="tech-unit">KM</span></div>
        </div>
        <div class="tech-card">
          <div class="tech-label">Velocità Media</div>
          <div class="tech-val">${media} <span class="tech-unit">KM/H</span></div>
        </div>
        <div class="tech-card">
          <div class="tech-label">Classe/Tipo</div>
          <div class="tech-val" style="color:var(--gold);text-transform:uppercase">${esc(res0.cat_gara || tipo)}</div>
        </div>
      </div>
    </div>
    <div class="results-table-wrap">
      <table class="results-table">
        <thead><tr>
          <th>POS</th><th>ATLETA</th><th>TEAM</th><th>TEMPO</th><th style="text-align:right">RNK</th><th>PUNTI</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="5" class="empty-state">Nessuna classifica disponibile</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

let calQGenere = '';
let calQTipo   = '';
let calQSearch = '';
let calQCat    = '';
let calQMonth  = new Date().toISOString().slice(5, 7); // Default mese corrente = '04' ad es.

async function renderCalendario() {
  if (!globalData) return;
  const { calendar } = globalData;

  const allCats = [...new Set(calendar.map(g => g.categoria).filter(Boolean))].sort();

  const render = () => {
    let filtered = calendar
      .filter(g => !calQGenere || g.genere === calQGenere)
      .filter(g => !calQCat    || g.categoria === calQCat)
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
      })
      .sort((a,b) => (a.data||'').localeCompare(b.data||''));

    const todayIso = new Date().toISOString().split('T')[0];
    const upcoming = [];
    const past = [];
    
    filtered.forEach(g => {
      if (!g.data || g.data >= todayIso) upcoming.push(g);
      else past.push(g);
    });
    
    // Passate dalla piu recente
    past.reverse();

    const drawCard = (g) => {
      const mult = multFromType(g.tipo, g.campionato_regionale, g.campionato_italiano);
      const day = g.data ? g.data.split('-')[2] : '—';
      const mon = g.data ? (['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'][parseInt(g.data.split('-')[1])-1]||'') : '';
      return `<div class="cal-item">
        <div class="cal-date-block">
          <div class="cal-day">${day}</div>
          <div class="cal-month">${mon}</div>
        </div>
        <div>
          <div class="cal-name"><a href="#/gara/${esc(g.id)}">${esc(g.nome)}</a></div>
          <div class="cal-loc" style="font-size:0.85rem; color:var(--text-muted); margin: 2px 0 4px">
            <i class="icon-loc">📍</i> ${esc(g.localita || '—')} (${esc(g.regione || '—')})
          </div>
          <div class="cal-cat">${esc(catLabel(g.categoria)||'')} — <span style="text-transform:capitalize;color:var(--text-muted)">${esc(g.tipo)}</span></div>
        </div>
        <div class="cal-badges">
          ${badgeMult(mult)}
          ${g.genere==='F'?'<span class="badge-cat badge-genere-f">♀</span>':''}
          ${g.campionato_italiano?'<span class="badge-cat badge-mult-x3">CI</span>':''}
          ${g.campionato_regionale?'<span class="badge-cat badge-mult-x2">CR</span>':''}
        </div>
      </div>`;
    };

    let html = '';
    if (upcoming.length > 0) {
      html += `<h3 class="cal-section-title upcoming">Prossime Gare</h3>`;
      html += upcoming.map(drawCard).join('');
    }
    if (past.length > 0) {
      if (upcoming.length > 0) html += `<br/><br/>`;
      html += `<h3 class="cal-section-title">Gare Passate</h3>`;
      html += past.map(drawCard).join('');
    }
    if (!html) html = '<div class="empty-state">Nessuna gara trovata</div>';

    document.getElementById('cal-list').innerHTML = html;
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
  render();
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
let risQueryReg = '';
let risLimit = 10;

window.risSetGenere = (v) => { risQueryGenere = v; risLimit = 10; renderRisultati(); };
window.risSetCat    = (v) => { risQueryCat = v; risLimit = 10; renderRisultati(); };
window.risSetMonth  = (v) => { risQueryMonth = v; risLimit = 10; renderRisultati(); };
window.risSetReg    = (v) => { risQueryReg = v; risLimit = 10; renderRisultati(); };
window.risLoadMore  = () => { risLimit += 10; renderRisultati(); };

async function renderRisultati() {
  if (!globalData) return;
  const { resultsRaw, calendar } = globalData;
  
  const raceMap = {};
  for (const r of resultsRaw) {
    if (!raceMap[r.gara_id]) {
      raceMap[r.gara_id] = { 
        id: r.gara_id, nome: r.nome_gara, data: r.data, 
        categoria: r.categoria, genere: r.genere, tipo: r.tipo, 
        results: [] 
      };
    }
    raceMap[r.gara_id].results.push(r);
  }

  for (const g of calendar) {
    if (raceMap[g.id]) raceMap[g.id].mult = multFromType(g.tipo, g.campionato_regionale, g.campionato_italiano);
  }

  let races = Object.values(raceMap).sort((a,b) => (b.data||'').localeCompare(a.data||''));
  
  if (risQueryGenere) {
    races = races.filter(r => r.genere === risQueryGenere);
  }
  if (risQueryMonth) {
    races = races.filter(r => r.data && r.data.split('-')[1] === risQueryMonth);
  }

  // Estrai le categorie uniche per il filtro (considerando il genere corrente)
  const allCats = [...new Set(races.map(r => r.categoria).filter(Boolean))].sort();
  const allRegs = [...new Set(calendar.map(g => g.regione).filter(Boolean))].sort();

  if (risQueryCat) {
    races = races.filter(r => r.categoria === risQueryCat);
  }
  if (risQueryReg) {
    races = races.filter(r => {
      const cal = calendar.find(c => c.id === r.id || c.id === r.gara_id);
      return cal?.regione === risQueryReg;
    });
  }

  const shownRaces = races.slice(0, risLimit);

  const filterHtml = `
    <div class="calendar-controls">
      <select class="cal-filter-select" onchange="window.risSetMonth(this.value)" aria-label="Filtra per mese">
        <option value="">Tutti i mesi</option>
        <option value="01" ${risQueryMonth==='01'?'selected':''}>Gennaio</option>
        <option value="02" ${risQueryMonth==='02'?'selected':''}>Febbraio</option>
        <option value="03" ${risQueryMonth==='03'?'selected':''}>Marzo</option>
        <option value="04" ${risQueryMonth==='04'?'selected':''}>Aprile</option>
        <option value="05" ${risQueryMonth==='05'?'selected':''}>Maggio</option>
        <option value="06" ${risQueryMonth==='06'?'selected':''}>Giugno</option>
        <option value="07" ${risQueryMonth==='07'?'selected':''}>Luglio</option>
        <option value="08" ${risQueryMonth==='08'?'selected':''}>Agosto</option>
        <option value="09" ${risQueryMonth==='09'?'selected':''}>Settembre</option>
        <option value="10" ${risQueryMonth==='10'?'selected':''}>Ottobre</option>
        <option value="11" ${risQueryMonth==='11'?'selected':''}>Novembre</option>
        <option value="12" ${risQueryMonth==='12'?'selected':''}>Dicembre</option>
      </select>
      <select class="cal-filter-select" onchange="window.risSetGenere(this.value)" aria-label="Filtra per genere">
        <option value="">Tutti i generi</option>
        <option value="M" ${risQueryGenere === 'M' ? 'selected' : ''}>Uomini</option>
        <option value="F" ${risQueryGenere === 'F' ? 'selected' : ''}>Donne</option>
      </select>
      <select class="cal-filter-select" onchange="window.risSetCat(this.value)" aria-label="Filtra per categoria">
        <option value="">Tutte le categorie</option>
        ${allCats.map(c => `<option value="${c}" ${c === risQueryCat ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}
      </select>
      <select class="cal-filter-select" onchange="window.risSetReg(this.value)" aria-label="Filtra per regione">
        <option value="">Tutte le regioni</option>
        ${allRegs.map(r => `<option value="${r}" ${r === risQueryReg ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      </select>
      <span class="ranking-count">${races.length} gare trovate</span>
    </div>
  `;

  const cardsHtml = shownRaces.map(race => {
    const cal = calendar.find(c => c.id === race.id);
    const top3 = race.results.sort((a,b)=>a.posizione-b.posizione).slice(0,3);
    const mult = race.mult || 1;
    return `
      <div class="hero-band" style="margin-bottom:24px; padding:24px;">
        <div class="hero-label" style="font-size:0.6rem">RISULTATI GARA</div>
        <div class="hero-race-name" style="font-size: clamp(1.6rem, 3vw, 2.4rem);"><a href="#/gara/${esc(race.id)}">${esc(race.nome)}</a></div>
        <div class="hero-race-loc" style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px">
          <i class="icon-loc">📍</i> ${esc(cal?.localita || '—')} (${esc(cal?.regione || '—')})
        </div>
        <div class="hero-race-meta" style="margin-bottom:16px;">
          <span>${fmtDate(race.data)}</span>
          <span>${esc(catLabel(race.categoria) || '')}</span>
          ${badgeMult(mult)}
        </div>
        <div class="hero-divider" style="margin-bottom:12px;"></div>
        <div class="hero-podio">
          ${top3.map((r,i) => {
            const pClass = ['p1','p2','p3'][i] || 'pout';
            const pts = r.punti_effettivi;
            const rankStr = r.rank_dopo_gara ? `<span class="rank-badge">Pos in Classifica: <span class="b-num">${r.rank_dopo_gara}°</span></span>` : '';
            return `<div class="hero-podio-row" style="animation-delay:${i*60}ms; grid-template-columns: 40px 1fr auto;">
              <div class="hero-pos ${pClass}" style="font-size:2rem">${r.posizione}°</div>
              <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px">
                <div class="hero-name">
                  <a href="#/atleta/${esc(r.atleta_id)}">${esc(r.cognome)} ${esc(r.nome)}</a>
                </div>
                <div class="hero-team" style="margin-right:auto">
                  <a href="#/team/${esc(r.team_id)}" style="color:var(--text-secondary)">${esc(r.team)}</a>
                </div>
                ${rankStr}
              </div>
              <div class="hero-pts" style="font-size:1.3rem">${pts} pt</div>
            </div>`;
          }).join('')}
        </div>
        <div style="padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--border-subtle);">
           <a href="#/gara/${esc(race.id)}" class="btn-action full" style="font-size:0.75rem; text-align:center;">VAI ALLA CLASSIFICA COMPLETA &rarr;</a>
        </div>
      </div>
    `;
  }).join('');

  setPage(`
    <div class="content-wrapper">
      <div class="section-header">
        <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:0">RISULTATI GARE</h1>
        <span class="section-line"></span>
      </div>
      ${filterHtml}
      
      <div class="risultati-feed" style="margin-top:20px;">
        ${cardsHtml || '<div class="empty-state">Nessuna gara trovata</div>'}
      </div>

      ${risLimit < races.length ? `
        <div style="text-align:center; margin-top:32px;">
          <button class="btn-action" onclick="window.risLoadMore()">CARICA ALTRE GARE</button>
        </div>
      ` : ''}
    </div>
  `);
}

// ── SOCIAL SHARE ──────────────────────────────────────────────
window.exportPalmares = async function(atleta_id) {
  if (!globalData || !window.html2canvas) return;
  const a = globalData.athletes[atleta_id];
  if (!a) return;
  
  const risultati = (a.risultati || []).sort((x,y) => (y.data||'').localeCompare(x.data||''));
  const top10 = risultati.length;
  const p1 = risultati.filter(r => r.posizione === 1).length;
  const podi = risultati.filter(r => r.posizione <= 3).length;
  const media = top10 ? Math.round(a.punti_totali / top10) : 0;
  
  const rCode = getRankingFileCode(a.categoria);
  const currentRanking = rCode ? await loadRanking(rCode) : [];
  const rankVal = currentRanking.find(x => x.atleta_id === a.id)?.pos || '-';
  
  // Trova miglior rank regionale
  let bestRegRankStr = '';
  if (a.regional_ranks && Object.keys(a.regional_ranks).length > 0) {
    const rRanks = Object.entries(a.regional_ranks).sort((a,b) => a[1] - b[1]);
    bestRegRankStr = `${rRanks[0][1]}° in ${rRanks[0][0].toUpperCase()}`;
  }
  
  const vittorie = risultati.filter(r => r.posizione === 1);
  const recentRaces = vittorie.slice(0, 3).map(r => `
    <div class="export-recent-row">
      <div class="export-recent-pos" style="color:var(--gold)">🏆</div>
      <div class="export-recent-name">${esc(r.nome_gara)}</div>
      <div class="export-recent-date" style="margin-left:8px">${fmtDateShort(r.data)}</div>
    </div>
  `).join('');
  
  const wrap = document.getElementById('export-card-wrapper');
  wrap.innerHTML = `
    <div class="export-card">
      <div class="export-card-border"></div>
      <div class="export-card-logo">ITALIA<span>CRIT</span></div>
      <div style="margin-top:auto; padding:0 20px;">
        <div style="text-align:center; margin-bottom:8px;"><span style="background:var(--red-hot); padding:3px 10px; border-radius:3px; font-size:0.85rem; font-family:var(--font-heading); color:#fff; letter-spacing:0.1em; text-transform:uppercase;">${esc(catLabel(a.categoria))}</span></div>
        <div class="export-card-sub">${esc(a.nome)}</div>
        <div class="export-card-title">${esc(a.cognome)}</div>
        <div style="text-align:center;">
           <div class="export-card-sub" style="margin-top:12px; font-size:1.1rem; color: #fff; letter-spacing:0.1em; background:rgba(232,0,29,0.5); display:inline-block; padding:6px 16px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); max-width:90%; box-sizing:border-box;">${esc(a.team_attuale)}</div>
        </div>
      </div>
      
      <div class="e-card-glass">
        <div class="export-card-stats" style="grid-template-columns: repeat(3, 1fr); gap:12px;">
          <div class="export-stat">
            <div class="export-stat-val">${a.punti_totali}</div>
            <div class="export-stat-lbl">Punti</div>
          </div>
          <div class="export-stat">
            <div class="export-stat-val w">${rankVal}°</div>
            <div class="export-stat-lbl">Rank Globale</div>
          </div>
          <div class="export-stat">
            <div class="export-stat-val w">${podi}</div>
            <div class="export-stat-lbl">Podi (1-3)</div>
          </div>
          <div class="export-stat">
            <div class="export-stat-val">${top10}</div>
            <div class="export-stat-lbl">Gare Top10</div>
          </div>
          <div class="export-stat">
            <div class="export-stat-val w">${p1}</div>
            <div class="export-stat-lbl">Vittorie</div>
          </div>
          <div class="export-stat">
            <div class="export-stat-val">${media}</div>
            <div class="export-stat-lbl">Media Pt.</div>
          </div>
        </div>
        
        ${bestRegRankStr ? `<div style="text-align:center; font-family:var(--font-heading); font-size:0.85rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:12px; margin-bottom:16px; color:var(--gold);">🏅 Eccellenza: ${bestRegRankStr}</div>` : ''}
        
        <div class="export-recent-title">ULTIME VITTORIE STAGIONALI</div>
        ${recentRaces || '<div style="text-align:center;font-size:0.8rem;color:var(--text-muted)">Nessuna vittoria finora</div>'}
      </div>
      
      <div class="export-footer">
        ITALIACRIT.COM
      </div>
    </div>
  `;
  
  setTimeout(async () => {
    try {
      const canvas = await window.html2canvas(wrap, {
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#0a0a0a'
      });
      const link = document.createElement('a');
      link.download = `italiacrit_${a.cognome.toLowerCase().replace(/\s/g,'_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error("Export error", e);
    }
  }, 100);
};

// ── TESTA A TESTA (H2H) ───────────────────────────────────────
window.openH2H = function(id1) {
  const a1 = globalData.athletes[id1];
  if (!a1) return;

  // showModalInput(title, placeholder, callback)  ← 3 params
  showModalInput(
    `\u2694\ufe0f Confronta ${a1.cognome} ${a1.nome} — cerca il rivale`,
    'Cognome o nome del rivale (stessa categoria)...',
    (q) => {
      const rivals = Object.values(globalData.athletes).filter(a =>
        (a.cognome.toLowerCase().includes(q.toLowerCase()) ||
         a.nome.toLowerCase().includes(q.toLowerCase())) &&
        a.id !== id1 && a.categoria === a1.categoria
      );
      if (rivals.length === 0) {
        showModalInput(
          'Nessun rivale trovato',
          `Nessun atleta in "${catLabel(a1.categoria)}" per "${q}". Riprova:`,
          (q2) => window.openH2H._search(id1, a1, q2)
        );
        return;
      }
      if (rivals.length === 1) {
        window.location.hash = `#/confronto/${id1}/${rivals[0].id}`;
        return;
      }
      // showModalSelect(title, items, labelFn, callback) ← 4 params
      showModalSelect(
        '\u2694\ufe0f Seleziona il rivale',
        rivals.slice(0, 10),
        (r) => `${esc(r.cognome)} ${esc(r.nome)} <span style="opacity:0.6;font-size:0.8rem;">${esc(r.team_attuale)}</span>`,
        (rival) => { window.location.hash = `#/confronto/${id1}/${rival.id}`; }
      );
    }
  );
};

// ── SCARICA SCHEDA ATLETA (PNG) ───────────────────────────────
window.exportPalmares = function(atleta_id) {
  const a = globalData?.athletes?.[atleta_id];
  if (!a) return;

  const risultati = (a.risultati || []).sort((x,y) => (y.data||'').localeCompare(x.data||''));
  const p1 = risultati.filter(r => r.posizione === 1).length;
  const p2 = risultati.filter(r => r.posizione === 2).length;
  const p3 = risultati.filter(r => r.posizione === 3).length;
  const gare = risultati.length;
  const best5 = risultati.slice(0, 5);

  const W = 600, H = 340;
  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  // Sfondo
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e8001d';
  ctx.fillRect(0, 0, W, 5);

  // Header
  ctx.fillStyle = '#e8001d';
  ctx.font = 'bold 11px Arial';
  ctx.fillText('ITALIACRIT RISULTATI', 20, 28);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.fillText((a.cognome || '').toUpperCase(), 20, 68);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '20px Arial';
  ctx.fillText((a.nome || '').toUpperCase(), 20, 92);

  ctx.fillStyle = '#e8001d';
  ctx.font = 'bold 11px Arial';
  ctx.fillText(catLabel(a.categoria || '').toUpperCase(), 20, 115);
  ctx.fillStyle = '#777777';
  ctx.font = '11px Arial';
  ctx.fillText((a.team_attuale || '').toUpperCase(), 20, 130);

  // Stats
  const stats = [
    { label: '1\u00b0 POSTO', val: p1, color: '#f5c400' },
    { label: '2\u00b0 POSTO', val: p2, color: '#aaaaaa' },
    { label: '3\u00b0 POSTO', val: p3, color: '#cd7f32' },
    { label: 'GARE',     val: gare, color: '#ffffff' },
    { label: 'PUNTI',    val: a.punti_totali, color: '#e8001d' },
  ];
  const bx = 20, by = 155, bw = 100, bh = 68, gap = 8;
  stats.forEach((s, i) => {
    const x = bx + i * (bw + gap);
    ctx.fillStyle = '#1a1a1e';
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(x, by, bw, bh, 4); ctx.fill();
    } else {
      ctx.fillRect(x, by, bw, bh);
    }
    ctx.fillStyle = s.color;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.val), x + bw/2, by + 38);
    ctx.fillStyle = '#666666';
    ctx.font = '9px Arial';
    ctx.fillText(s.label, x + bw/2, by + 56);
    ctx.textAlign = 'left';
  });

  // Ultimi risultati
  ctx.fillStyle = '#555555';
  ctx.font = '9px Arial';
  ctx.fillText('ULTIMI RISULTATI', 20, 245);
  best5.forEach((r, i) => {
    const y = 260 + i * 15;
    const pColors = { 1: '#f5c400', 2: '#aaaaaa', 3: '#cd7f32' };
    ctx.fillStyle = pColors[r.posizione] || '#555555';
    ctx.font = 'bold 10px Arial';
    ctx.fillText(`${r.posizione}\u00b0`, 20, y);
    ctx.fillStyle = '#cccccc';
    ctx.font = '10px Arial';
    ctx.fillText((r.nome_gara || '').slice(0, 42), 50, y);
    ctx.fillStyle = '#888888';
    ctx.font = '9px Arial';
    ctx.fillText(`${r.punti_effettivi || 0} pt`, 510, y);
  });

  // Footer
  ctx.fillStyle = '#222222';
  ctx.fillRect(0, H - 22, W, 22);
  ctx.fillStyle = '#888888';
  ctx.font = '9px Arial';
  ctx.fillText(`italiacrit.local \u2014 Stagione ${new Date().getFullYear()}`, 20, H - 8);

  // Genera il blob in modo sincrono
  const dataURL = canvas.toDataURL('image/png');
  const byteStr = atob(dataURL.split(',')[1]);
  const ab = new ArrayBuffer(byteStr.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
  const blob = new Blob([ab], { type: 'image/png' });
  const blobUrl = URL.createObjectURL(blob);
  const safe = (s) => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'_');
  const filename = `${safe(a.cognome)}_${safe(a.nome)}_italiacrit.png`;

  // Rimuovi eventuale banner precedente
  document.getElementById('dl-banner-png')?.remove();

  // Banner flottante — il click dell'utente sul link garantisce il proprio filename in Chrome
  const banner = document.createElement('div');
  banner.id = 'dl-banner-png';
  banner.style.cssText = `
    position:fixed; top:72px; right:20px; z-index:99999;
    background:linear-gradient(135deg,#e8001d,#a00010);
    color:#fff; padding:16px 20px; border-radius:10px;
    font-family:Arial,sans-serif; font-weight:bold;
    box-shadow:0 6px 24px rgba(0,0,0,0.5);
    display:flex; align-items:center; gap:12px;
    animation:slide-in-right 0.3s ease;
  `;
  banner.innerHTML = `
    <span style="font-size:1.4rem;">📸</span>
    <div>
      <div style="font-size:0.75rem; opacity:0.8; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">Scheda pronta!</div>
      <a href="${blobUrl}" download="${filename}"
         style="color:#fff; font-size:0.95rem; text-decoration:underline; cursor:pointer;"
         onclick="setTimeout(()=>{document.getElementById('dl-banner-png')?.remove();},800);">
        ${filename}
      </a>
    </div>
    <button onclick="document.getElementById('dl-banner-png').remove(); URL.revokeObjectURL('${blobUrl}');"
      style="background:rgba(255,255,255,0.2); border:none; color:#fff; cursor:pointer;
             padding:4px 8px; border-radius:4px; font-size:1rem; margin-left:4px;">✕</button>
  `;
  document.body.appendChild(banner);
  // Auto-rimozione dopo 15s
  setTimeout(() => {
    document.getElementById('dl-banner-png')?.remove();
    URL.revokeObjectURL(blobUrl);
  }, 15000);
};



async function renderConfronto(id1, id2) {
  if (!globalData) return;
  const a1 = globalData.athletes[id1];
  const a2 = globalData.athletes[id2];
  if (!a1 || !a2) return renderNotFound();
  
  const rCode1 = getRankingFileCode(a1.categoria);
  const currentRanking1 = rCode1 ? await loadRanking(rCode1) : [];
  const rank1 = currentRanking1.find(x => x.atleta_id === id1)?.pos || 999;
  const rank2 = currentRanking1.find(x => x.atleta_id === id2)?.pos || 999;

  const pts1 = a1.punti_totali;
  const pts2 = a2.punti_totali;
  
  const r1 = a1.risultati || [];
  const r2 = a2.risultati || [];
  const v1 = r1.filter(r => r.posizione===1).length;
  const v2 = r2.filter(r => r.posizione===1).length;
  
  const t5_1 = r1.filter(r => r.posizione<=5).length;
  const t5_2 = r2.filter(r => r.posizione<=5).length;
  
  const m1 = r1.length ? Math.round(pts1 / r1.length) : 0;
  const m2 = r2.length ? Math.round(pts2 / r2.length) : 0;
  
  // Radar data normalization
  const maxPts = Math.max(pts1, pts2, 1);
  const maxV = Math.max(v1, v2, 1);
  const maxT5 = Math.max(t5_1, t5_2, 1);
  const maxM = Math.max(m1, m2, 1);
  const maxR = Math.max(r1.length, r2.length, 1);
  
  // order: PUNTI, VITTORIE, TOP5, MEDIA PT, PRESENZE
  const getRadarPts = (p, v, t5, m, ga) => {
     const arr = [ p/maxPts, v/maxV, t5/maxT5, m/maxM, ga/maxR ].map(x => Math.max(0.1, x));
     // hexagon center is 100,100, radius 80
     let pts = [];
     for(let i=0; i<5; i++) {
        let angle = (Math.PI*2 * i / 5) - Math.PI/2;
        let r = arr[i] * 80;
        pts.push(`${100 + Math.cos(angle)*r},${100 + Math.sin(angle)*r}`);
     }
     return pts.join(" ");
  };
  
  const poly1 = getRadarPts(pts1, v1, t5_1, m1, r1.length);
  const poly2 = getRadarPts(pts2, v2, t5_2, m2, r2.length);
  
  // Intersection of races
  const map2 = {};
  r2.forEach(r => { map2[r.gara_id] = r.posizione; });
  const common = r1.filter(r => map2[r.gara_id] !== undefined);
  
  let h2hwins1 = 0;
  let h2hwins2 = 0;
  const commonHtml = common.map(c1 => {
    const gid = c1.gara_id;
    const race = globalData.calendar.find(g => g.id === gid);
    const pos1 = c1.posizione;
    const pos2 = map2[gid];
    if (pos1 < pos2) h2hwins1++;
    else if (pos2 < pos1) h2hwins2++;
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border-subtle)">
      <div style="flex:1; text-align:right; font-family:var(--font-display); font-size:1.8rem; line-height:1; color:${pos1<pos2 ? 'var(--yellow-race)' : 'var(--text-muted)'}">${pos1}°</div>
      <div style="flex:3; text-align:center; padding:0 12px;">
         <a href="#/gara/${esc(gid)}" style="font-size:0.85rem; font-family:var(--font-heading); text-transform:uppercase; font-weight:700">${esc(race?.nome || gid)}</a>
      </div>
      <div style="flex:1; text-align:left; font-family:var(--font-display); font-size:1.8rem; line-height:1; color:${pos2<pos1 ? 'var(--yellow-race)' : 'var(--text-muted)'}">${pos2}°</div>
    </div>`;
  }).join('');

  setPage(`
    <div style="max-width:800px; margin:0 auto; padding-top:20px; animation:slide-up 0.2s ease;">
      <button class="btn-action" onclick="window.history.back()" style="margin-bottom:20px;">&larr; INDIETRO</button>
      
      <div class="h2h-container">
        <div class="h2h-rider left">
          <div class="h2h-name"><a href="#/atleta/${id1}">${esc(a1.cognome)}</a></div>
          <div class="h2h-team">${esc(a1.team_attuale)}</div>
        </div>
        <div class="h2h-rider right">
          <div class="h2h-name"><a href="#/atleta/${id2}">${esc(a2.cognome)}</a></div>
          <div class="h2h-team">${esc(a2.team_attuale)}</div>
        </div>
      </div>
      
      <div class="h2h-radar-box">
        <svg viewBox="0 0 200 200">
           <!-- Radar grid lines -->
           <polygon class="radar-grid" points="100,20 176,75 147,164 53,164 24,75" />
           <polygon class="radar-grid" points="100,40 157,81 135,148 65,148 43,81" />
           <polygon class="radar-grid" points="100,60 138,88 123,132 77,132 62,88" />
           <line class="radar-axis" x1="100" y1="100" x2="100" y2="20" />
           <line class="radar-axis" x1="100" y1="100" x2="176" y2="75" />
           <line class="radar-axis" x1="100" y1="100" x2="147" y2="164" />
           <line class="radar-axis" x1="100" y1="100" x2="53" y2="164" />
           <line class="radar-axis" x1="100" y1="100" x2="24" y2="75" />
           
           <!-- Data Polygons -->
           <polygon points="${poly2}" fill="var(--cat-under23)" opacity="0.3" stroke="var(--cat-under23)" stroke-width="2" />
           <polygon points="${poly1}" fill="var(--red-hot)" opacity="0.5" stroke="var(--red-hot)" stroke-width="2" />
           
           <text x="100" y="10" class="radar-label">PUNTI</text>
           <text x="195" y="75" class="radar-label">VITTORIE</text>
           <text x="160" y="180" class="radar-label">TOP 5</text>
           <text x="40" y="180" class="radar-label">MEDIA PT</text>
           <text x="5" y="75" class="radar-label">PRESENZE</text>
        </svg>
      </div>
      
      <div class="h2h-stats-grid">
        <div class="h2h-stats-row">
          <div class="h2h-val left ${rank1<rank2?'win':''}">${rank1===999?'-':rank1+'°'}</div>
          <div class="h2h-lbl">RANK GLOBALE</div>
          <div class="h2h-val right ${rank2<rank1?'win':''}">${rank2===999?'-':rank2+'°'}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${pts1>pts2?'win':''}">${pts1}</div>
          <div class="h2h-lbl">PUNTI STAGIONALI
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill left" style="width:${(pts1/maxPts)*100}%"></div></div>
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill right" style="width:${(pts2/maxPts)*100}%"></div></div>
          </div>
          <div class="h2h-val right ${pts2>pts1?'win':''}">${pts2}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${v1>v2?'win':''}">${v1}</div>
          <div class="h2h-lbl">VITTORIE assolute
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill left" style="width:${(v1/maxV)*100}%"></div></div>
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill right" style="width:${(v2/maxV)*100}%"></div></div>
          </div>
          <div class="h2h-val right ${v2>v1?'win':''}">${v2}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${m1>m2?'win':''}">${m1}</div>
          <div class="h2h-lbl">Media pt/gara</div>
          <div class="h2h-val right ${m2>m1?'win':''}">${m2}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${t5_1>t5_2?'win':''}">${t5_1}</div>
          <div class="h2h-lbl">Piazzamenti Top 5</div>
          <div class="h2h-val right ${t5_2>t5_1?'win':''}">${t5_2}</div>
        </div>
      </div>
      
      <div class="h2h-common-races">
        <h3 style="text-align:center; font-family:var(--font-heading); color:var(--text-muted); text-transform:uppercase; margin-bottom:20px;">SCONTRI DIRETTI NELLA STESSA GARA: <span style="color:var(--text-primary)">${h2hwins1}</span> a <span style="color:var(--text-primary)">${h2hwins2}</span></h3>
        ${common.length ? commonHtml : '<div class="empty-state">Nessuna gara in comune.</div>'}
      </div>
    </div>
  `);
}

// ── GLOBAL STATISTICHE ──────────────────────────────────────────
function renderStats() {
  if (!globalData) return;
  const as = Object.values(globalData.athletes);
  const resultsRaw = globalData.resultsRaw || [];
  
  const cats = ['AL_M','JUN_M','ELI_M','AL_F','JUN_F','ELI_F'];

  // ── Top Vincitori Overall (cross-categoria)
  const byWins = [...as]
    .map(a => ({ a, v: (a.risultati||[]).filter(r=>r.posizione===1).length }))
    .filter(x=>x.v>0).sort((x,y)=>y.v - x.v).slice(0, 10);

  // ── Top Podi (1°+2°+3°)
  const byPodio = [...as]
    .map(a => ({ a, v: (a.risultati||[]).filter(r=>r.posizione<=3).length }))
    .filter(x=>x.v>0).sort((x,y)=>y.v - x.v).slice(0, 10);

  // ── Atleti più presenti
  const byPresenze = [...as]
    .map(a => ({ a, v: (a.risultati||[]).length }))
    .filter(x=>x.v>0).sort((x,y)=>y.v - x.v).slice(0, 10);

  // ── Migliore Media Punti (min 3 gare)
  const byMedia = [...as]
    .map(a => {
      const n = (a.risultati||[]).length;
      const m = n >= 3 ? Math.round(a.punti_totali / n) : 0;
      return { a, v: m, n };
    })
    .filter(x=>x.v>0).sort((x,y)=>y.v - x.v).slice(0, 10);

  // ── Top team per vittorie
  const teamsWins = {};
  as.forEach(a => {
    const t = a.team_attuale;
    const teamId = a.team_id;
    if(!teamsWins[t]) teamsWins[t] = {wins:0, pts:0, atleti:0, id:teamId};
    teamsWins[t].wins += (a.risultati||[]).filter(r=>r.posizione===1).length;
    teamsWins[t].pts += a.punti_totali;
    teamsWins[t].atleti++;
  });
  const topTeamsWins = Object.entries(teamsWins).sort((x,y)=>y[1].wins - x[1].wins).slice(0, 8);
  const topTeamsPts = Object.entries(teamsWins).sort((x,y)=>y[1].pts - x[1].pts).slice(0, 8);

  // ── Forma recente: ULTIME 3 SETTIMANE (settimana = Lun→Dom)
  //    1. Trova la data più recente con risultati
  //    2. Calcola la domenica di chiusura della settimana di quella data
  //    3. Finestra = quella domenica − 20 giorni (3 settimane complete)
  const today = new Date().toISOString().split('T')[0];
  const allRaceDates = [...new Set(
    resultsRaw.map(r => r.data).filter(d => d && d <= today)
  )].sort().reverse();

  let refSundayStr = today;
  if (allRaceDates.length > 0) {
    const d = new Date(allRaceDates[0] + 'T12:00:00');
    const dow = d.getDay(); // 0=Dom, 6=Sab
    const daysToSunday = dow === 0 ? 0 : (7 - dow);
    const refSunday = new Date(d);
    refSunday.setDate(d.getDate() + daysToSunday);
    refSundayStr = refSunday.toISOString().split('T')[0];
  }
  const refSundayDate = new Date(refSundayStr + 'T12:00:00');
  const startDateObj = new Date(refSundayDate);
  startDateObj.setDate(refSundayDate.getDate() - 20);
  const startDateStr = startDateObj.toISOString().split('T')[0];

  const formWindow = `${startDateStr} \u2192 ${refSundayStr}`;

  // Per ogni atleta somma i punti nella finestra delle 3 settimane
  const inForm = [...as]
    .map(a => {
      const recentRes = (a.risultati||[]).filter(r => r.data >= startDateStr && r.data <= refSundayStr);
      const pts3 = recentRes.reduce((s,r) => s+(r.punti_effettivi||0), 0);
      return { a, pts3, recentRes };
    })
    .filter(x => x.pts3 > 0)
    .sort((x,y) => y.pts3 - x.pts3)
    .slice(0, 8);

  // ── Gare più corse
  const raceCount = {};
  resultsRaw.forEach(r => { raceCount[r.gara_id] = (raceCount[r.gara_id]||0)+1; });
  const topGare = Object.entries(raceCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,n]) => ({
    gara: globalData.calendar.find(g=>g.id===id),
    id, n
  }));

  const renderRankRow = (items, i, nameHtml, valHtml) => `
    <div style="display:flex; justify-content:space-between; align-items:center;
      padding:10px 0; border-bottom:1px solid var(--border-subtle);">
      <div style="display:flex; gap:12px; align-items:center;">
        <div style="width:28px; text-align:center; font-family:var(--font-display); font-size:1.2rem;
          color:${i===0?'var(--gold)':i===1?'var(--silver)':i===2?'var(--bronze)':'var(--text-muted)'}">${i+1}</div>
        <div>${nameHtml}</div>
      </div>
      <div>${valHtml}</div>
    </div>`;

  const aN = (a, extra='') => `
    <a href="#/atleta/${a.id}" style="font-family:var(--font-heading);font-weight:700;font-size:0.95rem;color:var(--text-primary)">${esc(a.cognome)} ${esc(a.nome)}</a>
    <div style="font-size:0.72rem;color:var(--red-hot);text-transform:uppercase;font-family:var(--font-heading)">${catLabel(a.categoria)}${extra}</div>`;

  const val = (n, unit='', color='var(--text-primary)') =>
    `<span style="font-family:var(--font-display);font-size:1.5rem;color:${color}">${n}</span><span style="font-size:0.8rem;color:var(--text-muted);margin-left:4px">${unit}</span>`;

  setPage(`
    <style>
      .stat-card { background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; padding:20px; }
      .stat-card-title { font-family:var(--font-heading); font-size:1rem; text-transform:uppercase;
        margin-bottom:16px; color:var(--text-primary); font-weight:700; letter-spacing:0.05em;
        padding-bottom:8px; border-bottom:2px solid var(--red-hot); display:inline-block;}
    </style>
    <div style="max-width:1100px; margin:0 auto; padding-top:20px; animation:slide-up 0.2s ease;">
      <div style="text-align:center; margin-bottom:40px;">
        <h1 style="font-family:var(--font-display); font-size:3.5rem; text-transform:uppercase; color:var(--text-primary);">TOP CHARTS</h1>
        <div style="color:var(--text-muted); font-family:var(--font-heading); margin-top:4px;">
          Record, Classifiche e Statistiche Cross-Categoria — Stagione ${new Date().getFullYear()}
        </div>
      </div>

      <!-- Atleti in forma: TOP 3 PER CATEGORIA -->
      <div style="background:linear-gradient(135deg, var(--red-hot), var(--red-deep)); border-radius:10px; padding:20px 24px; margin-bottom:30px;">
        <div style="font-family:var(--font-heading); font-size:1.1rem; text-transform:uppercase; color:#fff; margin-bottom:4px; letter-spacing:0.1em;">🔥 ATLETI IN FORMA — Top 3 per Categoria</div>
        <div style="font-size:0.75rem; color:rgba(255,255,255,0.6); font-family:var(--font-mono); margin-bottom:20px;">
          Punti nelle ultime 3 settimane ${formWindow ? `(${formWindow})` : ''}
        </div>
        ${(() => {
          // Calcola forma per categoria
          const cats = [
            {id:'ES1_M',label:'Esordienti 1° (M)'},{id:'ES2_M',label:'Esordienti 2° (M)'},{id:'AL_M',label:'Allievi (M)'},
            {id:'JUN_M',label:'Juniores (M)'},{id:'ELI_M',label:'Elite-U23 (M)'},
            {id:'ES1_F',label:'Donne Es 1°'},{id:'ES2_F',label:'Donne Es 2°'},{id:'AL_F',label:'Donne Allieve'},
            {id:'JUN_F',label:'Donne Juniores'},{id:'ELI_F',label:'Donne Elite-U23'}
          ];

          // Calcola forma per ogni atleta basata sulla stessa finestra
          const formByCat = {};
          as.forEach(a => {
            const recentRes = (a.risultati||[]).filter(r => r.data >= startDateStr && r.data <= refSundayStr);
            const pts3 = recentRes.reduce((s,r) => s+(r.punti_effettivi||0), 0);
            if (pts3 > 0) {
              if (!formByCat[a.categoria]) formByCat[a.categoria] = [];
              formByCat[a.categoria].push({ a, pts3, recentRes });
            }
          });
          Object.values(formByCat).forEach(arr => arr.sort((x,y) => y.pts3 - x.pts3));

          // Filtra solo categorie con dati
          const activeCats = cats.filter(c => formByCat[c.id]?.length > 0);
          if (!activeCats.length) return '<div style="color:rgba(255,255,255,0.6); font-family:var(--font-heading);">Nessun risultato nel periodo.</div>';

          const podioIcon = i => i===0 ? '🏆' : i===1 ? '🥈' : '🥉';

          return `<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px;">
            ${activeCats.map(c => {
              const top3 = (formByCat[c.id]||[]).slice(0,3);
              return `<div style="background:rgba(255,255,255,0.08); border-radius:8px; padding:14px;
                border:1px solid rgba(255,255,255,0.12);">
                <div style="font-family:var(--font-heading); font-size:0.8rem; text-transform:uppercase;
                  color:rgba(255,255,255,0.7); letter-spacing:0.08em; margin-bottom:10px;
                  border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px;">${c.label}</div>
                ${top3.map((x,i) => `
                  <a href="#/atleta/${x.a.id}" style="display:flex; justify-content:space-between;
                    align-items:center; padding:5px 0;
                    border-bottom:${i<2?'1px solid rgba(255,255,255,0.07)':'none'}; text-decoration:none;">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span style="font-size:1rem;">${podioIcon(i)}</span>
                      <div>
                        <div style="font-family:var(--font-heading); font-weight:700; color:#fff; font-size:0.9rem;">${esc(x.a.cognome)} ${esc(x.a.nome)}</div>
                        <div style="display:flex; gap:2px; margin-top:2px;">${formGuide(x.recentRes)}</div>
                      </div>
                    </div>
                    <div style="font-family:var(--font-display); font-size:1.3rem; color:#fff;">${x.pts3}</div>
                  </a>
                `).join('')}
              </div>`;
            }).join('')}
          </div>`;
        })()}
      </div>

      <!-- Grid statistiche -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:24px; margin-bottom:30px;">
        <div class="stat-card">
          <div class="stat-card-title">🏆 Top Vincitori</div>
          ${byWins.map((x,i) => renderRankRow([], i, aN(x.a), val(x.v,'🏆','var(--gold)'))).join('')}
        </div>

        <div class="stat-card">
          <div class="stat-card-title">🥇 Top Podisti</div>
          ${byPodio.map((x,i) => renderRankRow([], i, aN(x.a), val(x.v,'podi','var(--bronze)'))).join('')}
        </div>

        <div class="stat-card">
          <div class="stat-card-title">🎯 Punti Classifica</div>
          ${byWins.length ? [...as].sort((x,y)=>y.punti_totali-x.punti_totali).slice(0,10).map((a,i) => renderRankRow([], i, aN(a), val(a.punti_totali,'PT','var(--yellow-race)'))).join('') : ''}
        </div>

        <div class="stat-card">
          <div class="stat-card-title">📅 Più Presenti</div>
          ${byPresenze.map((x,i) => renderRankRow([], i, aN(x.a), val(x.v,'gare'))).join('')}
        </div>

        <div class="stat-card">
          <div class="stat-card-title">⚡ Miglior Media PT/Gara</div>
          ${byMedia.map((x,i) => renderRankRow([], i, aN(x.a, ` &bull; ${x.n} gare`), val(x.v,'media','var(--cat-juniores)'))).join('')}
        </div>

        <div class="stat-card">
          <div class="stat-card-title">🛡️ Team Più Vincenti</div>
          ${topTeamsWins.map(([nome,d],i) => renderRankRow([], i,
            `<a href="#/team/${encodeURIComponent(d.id||nome)}" style="font-family:var(--font-heading);font-weight:700;color:var(--text-primary)">${esc(nome)}</a>
             <div style="font-size:0.7rem;color:var(--text-muted);">${d.atleti} atleti</div>`,
            val(d.wins,'🏆','var(--gold)')
          )).join('')}
        </div>

        <div class="stat-card">
          <div class="stat-card-title">🏅 Team Top Punti</div>
          ${topTeamsPts.map(([nome,d],i) => renderRankRow([], i,
            `<a href="#/team/${encodeURIComponent(d.id||nome)}" style="font-family:var(--font-heading);font-weight:700;color:var(--text-primary)">${esc(nome)}</a>`,
            val(d.pts,'PT','var(--yellow-race)')
          )).join('')}
        </div>
      </div>
    </div>
  `);
}

// ── DIRECTORY ATLETI ──────────────────────────────────────────
// ── DIRECTORY ATLETI ──────────────────────────────────────────
function renderDirectoryAtleti() {
  if (!globalData) return;
  const athletes = Object.values(globalData.athletes);
  
  const byCat = {};
  athletes.forEach(a => {
    if(!byCat[a.categoria]) byCat[a.categoria] = [];
    byCat[a.categoria].push(a);
  });

  const catM = [
    {id:'ES1_M',label:'Esordienti 1°'},{id:'ES2_M',label:'Esordienti 2°'},{id:'AL_M',label:'Allievi'},{id:'JUN_M',label:'Juniores'},{id:'ELI_M',label:'Elite - U23'}
  ];
  const catF = [
    {id:'ES1_F',label:'Donne Es 1°'},{id:'ES2_F',label:'Donne Es 2°'},{id:'AL_F',label:'Donne Allieve'},{id:'JUN_F',label:'Donne Juniores'},{id:'ELI_F',label:'Donne Elite - U23'}
  ];

  let htmlContainers = '';
  const buildCatContainers = (cats) => {
    cats.forEach(c => {
      const arr = byCat[c.id] || [];
      const sorted = arr.sort((a,b) => (a.cognome+a.nome).localeCompare(b.cognome+b.nome));
      htmlContainers += `
        <div class="dir-container" id="dir-container-${c.id}" style="display:none;">
          <h3 style="font-family:var(--font-heading); color:var(--text-primary); text-transform:uppercase; border-bottom:1px solid var(--border-subtle); padding-bottom:8px; margin-top:20px; margin-bottom:16px;">${c.label} <span style="font-size:0.8rem; color:var(--text-muted); float:right;">Top ${sorted.length}</span></h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
            ${sorted.map(a => `
              <div class="dir-item" data-search="${esc(a.cognome).toLowerCase()} ${esc(a.nome).toLowerCase()} ${esc(a.team_attuale).toLowerCase()}" style="background:var(--bg-card); padding:16px; border-radius:6px; border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-family:var(--font-display); font-size:1.4rem; line-height:1.2;">
                    <a href="#/atleta/${a.id}" style="color:var(--text-primary)">${esc(a.cognome)} <span style="color:var(--text-secondary)">${esc(a.nome)}</span></a>
                  </div>
                  <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; font-family:var(--font-mono); margin-top:4px;">${esc(a.team_attuale)}</div>
                  <div style="display:flex; gap:3px; margin-top:6px;">${formGuide(a.risultati)}</div>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
                  <div style="font-family:var(--font-display); color:var(--yellow-race); font-size:1.4rem; line-height:1;">${a.punti_totali} <span style="font-size:0.7rem; color:var(--text-muted)">pt</span></div>
                  <button class="btn-action" style="font-size:0.7rem; padding:4px 8px; margin-top:4px;" onclick="promptH2H('${a.id}')">Confronta</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });
  };
  buildCatContainers(catM);
  buildCatContainers(catF);

  setPage(`
    <style>
      .btn-action { background:var(--red-hot); border:none; color:#fff; font-family:var(--font-heading); text-transform:uppercase; border-radius:4px; cursor:pointer; }
      .btn-action:hover { background:var(--gold); color:#000; }
      .dir-search-wrap { display:flex; justify-content:center; margin-bottom:30px; margin-top:20px; }
      .dir-search-input { width:100%; max-width:600px; padding:12px 20px; font-size:1rem; font-family:var(--font-heading); border-radius:30px; border:1px solid var(--border-subtle); background:var(--bg-card); color:var(--text-primary); outline:none; transition: border-color 0.2s; }
      .dir-search-input:focus { border-color:var(--yellow-race); }
    </style>
    <div style="max-width:1200px; margin:0 auto; padding-top:20px; animation:slide-up 0.2s ease;">
      <div style="text-align:center; margin-bottom:20px;">
        <h1 style="font-family:var(--font-display); font-size:3.5rem; text-transform:uppercase; margin-bottom:10px; color:var(--text-primary);">Elenco Atleti</h1>
      </div>
      
      <div class="tabs-wrap" style="margin-bottom:20px;">
         <div style="display:flex; justify-content:center; gap:8px; margin-bottom:12px;">
           <button class="tab-btn active-cat" id="dir-btn-uomini" onclick="switchDirGender('uomini', 'AL_M')">UOMINI</button>
           <button class="tab-btn" id="dir-btn-donne" onclick="switchDirGender('donne', 'AL_F')">DONNE</button>
         </div>
         <div style="display:flex; justify-content:center; flex-wrap:wrap; gap:8px;" id="dir-cats-uomini">
            ${catM.map(c => `<button class="tab-btn dir-cat-btn" id="dir-catbtn-${c.id}" onclick="switchDirCat('${c.id}')">${c.label}</button>`).join('')}
         </div>
         <div style="display:none; justify-content:center; flex-wrap:wrap; gap:8px;" id="dir-cats-donne">
            ${catF.map(c => `<button class="tab-btn dir-cat-btn" id="dir-catbtn-${c.id}" onclick="switchDirCat('${c.id}')">${c.label}</button>`).join('')}
         </div>
      </div>

      <div class="dir-search-wrap">
         <input type="text" class="dir-search-input" id="dir-search" placeholder="🔍 Cerca atleta..." oninput="dirLiveSearch(this.value)" />
      </div>

      <div id="dir-master-container">
        ${htmlContainers}
      </div>
    </div>
  `);

  setTimeout(() => { switchDirCat('AL_M'); }, 50);
}

// ── CONFRONTO TEAM ─────────────────────────────────────────────
async function renderConfrontoTeam(t1_id, t2_id) {
  if (!globalData) return;
  const t1 = globalData.teams[t1_id];
  const t2 = globalData.teams[t2_id];
  if (!t1 || !t2) return renderNotFound();
  
  const pts1 = t1.punti_totali || 0;
  const pts2 = t2.punti_totali || 0;
  
  const r1 = t1.risultati || [];
  const r2 = t2.risultati || [];
  const v1 = r1.filter(r => r.posizione===1).length;
  const v2 = r2.filter(r => r.posizione===1).length;
  
  const t5_1 = r1.filter(r => r.posizione<=5).length;
  const t5_2 = r2.filter(r => r.posizione<=5).length;
  
  const atleti1 = (t1.atleti || []).length;
  const atleti2 = (t2.atleti || []).length;

  const getUniqueRacesCount = (resArray) => new Set(resArray.map(r => r.gara_id)).size;
  const resCount1 = getUniqueRacesCount(r1);
  const resCount2 = getUniqueRacesCount(r2);
  
  const m1 = resCount1 ? Math.round(pts1 / resCount1) : 0;
  const m2 = resCount2 ? Math.round(pts2 / resCount2) : 0;
  
  // Radar data normalization
  const maxPts = Math.max(pts1, pts2, 1);
  const maxV = Math.max(v1, v2, 1);
  const maxT5 = Math.max(t5_1, t5_2, 1);
  const maxM = Math.max(m1, m2, 1);
  const maxA = Math.max(atleti1, atleti2, 1);
  
  // order: PUNTI, VITTORIE, TOP5, MEDIA PT/GARA, ATLETI STATI
  const getRadarPts = (p, v, t5, m, ga) => {
     const arr = [ p/maxPts, v/maxV, t5/maxT5, m/maxM, ga/maxA ].map(x => Math.max(0.1, x));
     let pts = [];
     for(let i=0; i<5; i++) {
        let angle = (Math.PI*2 * i / 5) - Math.PI/2;
        let r_val = arr[i] * 80;
        pts.push(`${100 + Math.cos(angle)*r_val},${100 + Math.sin(angle)*r_val}`);
     }
     return pts.join(" ");
  };
  
  const poly1 = getRadarPts(pts1, v1, t5_1, m1, atleti1);
  const poly2 = getRadarPts(pts2, v2, t5_2, m2, atleti2);
  
  // Intersection of races (BEST result per team in each race)
  const map1 = {};
  r1.forEach(r => { if(!map1[r.gara_id] || map1[r.gara_id]>r.posizione) map1[r.gara_id] = r.posizione; });
  const map2 = {};
  r2.forEach(r => { if(!map2[r.gara_id] || map2[r.gara_id]>r.posizione) map2[r.gara_id] = r.posizione; });
  
  const commonGaras = Object.keys(map1).filter(g => map2[g] !== undefined);
  let h2hwins1 = 0;
  let h2hwins2 = 0;
  const commonHtml = commonGaras.map(gid => {
    const race = globalData.calendar.find(g => g.id === gid);
    const pos1 = map1[gid];
    const pos2 = map2[gid];
    if (pos1 < pos2) h2hwins1++;
    else if (pos2 < pos1) h2hwins2++;
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border-subtle)">
      <div style="flex:1; text-align:right; font-family:var(--font-display); font-size:1.8rem; line-height:1; color:${pos1<pos2 ? 'var(--yellow-race)' : 'var(--text-muted)'}">${pos1}°</div>
      <div style="flex:3; text-align:center; padding:0 12px;">
         <a href="#/gara/${esc(gid)}" style="font-size:0.85rem; font-family:var(--font-heading); text-transform:uppercase; font-weight:700">${esc(race?.nome || gid)}</a>
      </div>
      <div style="flex:1; text-align:left; font-family:var(--font-display); font-size:1.8rem; line-height:1; color:${pos2<pos1 ? 'var(--yellow-race)' : 'var(--text-muted)'}">${pos2}°</div>
    </div>`;
  }).join('');

  setPage(`
    <style>
      .h2h-container { display:flex; justify-content:space-between; align-items:flex-end; background:var(--bg-card); border-radius:12px; padding:30px; margin-bottom:20px; border:1px solid var(--border-subtle); position:relative; overflow:hidden;}
      .h2h-container::before { content:'VS'; position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); font-family:var(--font-display); font-size:4rem; color:var(--text-muted); opacity:0.1; }
      .h2h-rider { display:flex; flex-direction:column; z-index:2; width:45%; }
      .h2h-rider.left { text-align:left; border-left:4px solid var(--red-hot); padding-left:16px;}
      .h2h-rider.right { text-align:right; border-right:4px solid var(--cat-under23); padding-right:16px;}
      .h2h-name { font-family:var(--font-display); font-size:1.4rem; line-height:1.1; margin-bottom:4px;}
      .h2h-team { font-size:0.9rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:1px;}
      .h2h-radar-box { background:var(--bg-card); border-radius:12px; padding:20px; text-align:center; border:1px solid var(--border-subtle); margin-bottom:20px; }
      .radar-grid { fill:none; stroke:var(--border-subtle); }
      .radar-axis { stroke:var(--border-subtle); stroke-dasharray:4 4; }
      .radar-label { fill:var(--text-secondary); font-size:10px; font-family:var(--font-heading); text-anchor:middle; }
      .h2h-stats-grid { display:flex; flex-direction:column; gap:8px; margin-bottom:20px;}
      .h2h-stats-row { display:flex; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:8px; align-items:center;}
      .h2h-lbl { flex:1; text-align:center; font-family:var(--font-heading); font-size:0.8rem; color:var(--text-muted); padding:10px; border-left:1px solid var(--border-subtle); border-right:1px solid var(--border-subtle); }
      .h2h-val { width:100px; text-align:center; font-family:var(--font-display); font-size:1.8rem; padding:10px;}
      .h2h-val.win { color:var(--yellow-race); }
      .h2h-val.left { color:var(--text-primary); }
      .h2h-val.right { color:var(--text-primary); }
      .h2h-bar-wrap { width:100%; height:4px; background:rgba(255,255,255,0.05); margin-top:4px; border-radius:2px; position:relative; overflow:hidden;}
      .h2h-bar-fill { position:absolute; top:0; bottom:0; height:100%; }
      .h2h-bar-fill.left { right:0; background:var(--red-hot); }
      .h2h-bar-fill.right { left:0; background:var(--cat-under23); }
    </style>
    <div style="max-width:800px; margin:0 auto; padding-top:20px; animation:slide-up 0.2s ease;">
      <button class="btn-action" onclick="window.history.back()" style="margin-bottom:20px;">&larr; INDIETRO</button>
      
      <div class="h2h-container">
        <div class="h2h-rider left">
          <div class="h2h-name"><a href="#/team/${t1_id}">${esc(t1.nome)}</a></div>
        </div>
        <div class="h2h-rider right">
          <div class="h2h-name"><a href="#/team/${t2_id}">${esc(t2.nome)}</a></div>
        </div>
      </div>
      
      <div class="h2h-radar-box">
        <svg viewBox="0 0 200 200">
           <!-- Radar grid lines -->
           <polygon class="radar-grid" points="100,20 176,75 147,164 53,164 24,75" />
           <polygon class="radar-grid" points="100,40 157,81 135,148 65,148 43,81" />
           <polygon class="radar-grid" points="100,60 138,88 123,132 77,132 62,88" />
           <line class="radar-axis" x1="100" y1="100" x2="100" y2="20" />
           <line class="radar-axis" x1="100" y1="100" x2="176" y2="75" />
           <line class="radar-axis" x1="100" y1="100" x2="147" y2="164" />
           <line class="radar-axis" x1="100" y1="100" x2="53" y2="164" />
           <line class="radar-axis" x1="100" y1="100" x2="24" y2="75" />
           
           <!-- Data Polygons -->
           <polygon points="${poly2}" fill="var(--cat-under23)" opacity="0.3" stroke="var(--cat-under23)" stroke-width="2" />
           <polygon points="${poly1}" fill="var(--red-hot)" opacity="0.5" stroke="var(--red-hot)" stroke-width="2" />
           
           <text x="100" y="10" class="radar-label">PUNTI GLOBALI</text>
           <text x="195" y="75" class="radar-label">VITTORIE IND.</text>
           <text x="160" y="180" class="radar-label">TOP 10</text>
           <text x="40" y="180" class="radar-label">PT. / GARA</text>
           <text x="5" y="75" class="radar-label">ATLETI REG.</text>
        </svg>
      </div>
      
      <div class="h2h-stats-grid">
        <div class="h2h-stats-row">
          <div class="h2h-val left ${pts1>pts2?'win':''}">${pts1}</div>
          <div class="h2h-lbl">PUNTI SQUADRA
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill left" style="width:${(pts1/maxPts)*100}%"></div></div>
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill right" style="width:${(pts2/maxPts)*100}%"></div></div>
          </div>
          <div class="h2h-val right ${pts2>pts1?'win':''}">${pts2}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${v1>v2?'win':''}">${v1}</div>
          <div class="h2h-lbl">VITTORIE INDIVIDUALI
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill left" style="width:${(v1/maxV)*100}%"></div></div>
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill right" style="width:${(v2/maxV)*100}%"></div></div>
          </div>
          <div class="h2h-val right ${pts2>pts1?'win':''}">${v2}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${t5_1>t5_2?'win':''}">${t5_1}</div>
          <div class="h2h-lbl">PIAZZAMENTI TOP 10
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill left" style="width:${(t5_1/maxT5)*100}%"></div></div>
            <div class="h2h-bar-wrap"><div class="h2h-bar-fill right" style="width:${(t5_2/maxT5)*100}%"></div></div>
          </div>
          <div class="h2h-val right ${t5_2>t5_1?'win':''}">${t5_2}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${m1>m2?'win':''}">${m1}</div>
          <div class="h2h-lbl">MEDIA PUNTI / GARA
             <div class="h2h-bar-wrap"><div class="h2h-bar-fill left" style="width:${(m1/maxM)*100}%"></div></div>
             <div class="h2h-bar-wrap"><div class="h2h-bar-fill right" style="width:${(m2/maxM)*100}%"></div></div>
          </div>
          <div class="h2h-val right ${m2>m1?'win':''}">${m2}</div>
        </div>
        <div class="h2h-stats-row">
          <div class="h2h-val left ${atleti1>atleti2?'win':''}">${atleti1}</div>
          <div class="h2h-lbl">ATLETI REGISTRATI
             <div class="h2h-bar-wrap"><div class="h2h-bar-fill left" style="width:${(atleti1/maxA)*100}%"></div></div>
             <div class="h2h-bar-wrap"><div class="h2h-bar-fill right" style="width:${(atleti2/maxA)*100}%"></div></div>
          </div>
          <div class="h2h-val right ${atleti2>atleti1?'win':''}">${atleti2}</div>
        </div>
      </div>
      
      <div style="margin-top:40px; background:var(--bg-card); border-radius:12px; border:1px solid var(--border-subtle); overflow:hidden;">
        <div style="background:var(--bg-secondary); padding:16px; font-family:var(--font-heading); text-align:center; border-bottom:1px solid var(--border-subtle);">
          SCONTRI DIRETTI PER SQUADRA 
          <div style="font-family:var(--font-display); font-size:2.5rem; margin-top:10px; display:flex; justify-content:center; gap:20px; align-items:center;">
             <span style="color:${h2hwins1>h2hwins2?'var(--red-hot)':'var(--text-primary)'}">${h2hwins1}</span>
             <span style="font-size:1.2rem; color:var(--text-muted); opacity:0.5">-</span>
             <span style="color:${h2hwins2>h2hwins1?'var(--cat-under23)':'var(--text-primary)'}">${h2hwins2}</span>
          </div>
        </div>
        <div>
          ${commonGaras.length ? commonHtml : '<div style="padding:40px; text-align:center; color:var(--text-muted);">Nessuna partecipazione in gara comune.</div>'}
        </div>
      </div>
    </div>
  `);
}

window.promptH2H = async function(id1) {
  showModalInput('Confronta Atleta — cerca il rivale', 'Nome o Cognome...', (q) => {
    const ats = Object.values(globalData.athletes);
    const find = ats.filter(a =>
      a.cognome.toLowerCase().includes(q.toLowerCase()) ||
      a.nome.toLowerCase().includes(q.toLowerCase())
    ).filter(a => a.id !== id1);

    if (find.length === 0) {
      alert('Atleta non trovato.');
    } else if (find.length === 1) {
      window.location.hash = `#/confronto/${id1}/${find[0].id}`;
    } else {
      showModalSelect(
        'Seleziona il rivale',
        find,
        (f, i) => `${f.cognome} ${f.nome} <span style="color:var(--text-muted);font-size:0.8rem;">(${f.team_attuale})</span>`,
        (chosen) => { window.location.hash = `#/confronto/${id1}/${chosen.id}`; }
      );
    }
  });
};

window.switchDirGender = function(gender, defaultCat) {
   document.getElementById('dir-btn-uomini').classList.toggle('active-cat', gender==='uomini');
   document.getElementById('dir-btn-donne').classList.toggle('active-cat', gender==='donne');
   document.getElementById('dir-cats-uomini').style.display = gender==='uomini' ? 'flex' : 'none';
   document.getElementById('dir-cats-donne').style.display = gender==='donne' ? 'flex' : 'none';
   switchDirCat(defaultCat);
};

window.switchDirCat = function(catId) {
   document.querySelectorAll('.dir-cat-btn').forEach(btn => btn.classList.remove('active-cat'));
   const btn = document.getElementById(`dir-catbtn-${catId}`);
   if(btn) btn.classList.add('active-cat');

   document.querySelectorAll('.dir-container').forEach(c => c.style.display = 'none');
   const cont = document.getElementById(`dir-container-${catId}`);
   if(cont) cont.style.display = 'block';

   const searchVal = document.getElementById('dir-search')?.value || '';
   dirLiveSearch(searchVal);
};

window.dirLiveSearch = function(val) {
   const q = val.toLowerCase().trim();
   const activeCont = Array.from(document.querySelectorAll('.dir-container')).find(c => c.style.display !== 'none');
   if (!activeCont) return;

   activeCont.querySelectorAll('.dir-item').forEach(el => {
      if(!q || el.getAttribute('data-search').includes(q)) {
         el.style.display = '';
      } else {
         el.style.display = 'none';
      }
   });
};

// ── DIRECTORY SQUADRE ─────────────────────────────────────────
function renderDirectoryTeams() {
  if (!globalData) return;
  
  const teamsMap = {};
  Object.values(globalData.athletes).forEach(a => {
    const cat = a.categoria;
    const t = a.team_attuale;
    if(!teamsMap[cat]) teamsMap[cat] = {};
    if(!teamsMap[cat][t]) teamsMap[cat][t] = { name: t, id: a.team_id, count: 0, pts: 0 };
    teamsMap[cat][t].count++;
    teamsMap[cat][t].pts += a.punti_totali;
  });

  const catM = [
    {id:'ES1_M',label:'Esordienti 1°'},{id:'ES2_M',label:'Esordienti 2°'},{id:'AL_M',label:'Allievi'},{id:'JUN_M',label:'Juniores'},{id:'ELI_M',label:'Elite - U23'}
  ];
  const catF = [
    {id:'ES1_F',label:'Donne Es 1°'},{id:'ES2_F',label:'Donne Es 2°'},{id:'AL_F',label:'Donne Allieve'},{id:'JUN_F',label:'Donne Juniores'},{id:'ELI_F',label:'Donne Elite - U23'}
  ];

  let htmlContainers = '';
  const buildCatContainers = (cats) => {
    cats.forEach(c => {
      const teamDict = teamsMap[c.id] || {};
      const sorted = Object.values(teamDict).sort((a,b) => (b.pts) - (a.pts)); // Sort teams by points!
      htmlContainers += `
        <div class="dir-container" id="dir-container-${c.id}" style="display:none;">
          <h3 style="font-family:var(--font-heading); color:var(--text-primary); text-transform:uppercase; border-bottom:1px solid var(--border-subtle); padding-bottom:8px; margin-top:10px; margin-bottom:16px;">${c.label} <span style="font-size:0.8rem; color:var(--text-muted); float:right;">Top ${sorted.length}</span></h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
            ${sorted.map(t => `
              <div class="dir-item" data-search="${esc(t.name).toLowerCase()}" style="background:var(--bg-card); padding:16px; border-radius:6px; border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
                 <div>
                   <div style="font-family:var(--font-heading); font-size:1.1rem; font-weight:700;"><a href="#/team/${encodeURIComponent(t.id)}" style="color:var(--text-primary)">🛡️ ${esc(t.name)}</a></div>
                 </div>
                 <div style="display:flex; flex-direction:column; align-items:flex-end;">
                   <div style="font-family:var(--font-display); font-size:1.4rem; color:var(--yellow-race); line-height:1;">${t.pts} <span style="font-size:0.7rem; color:var(--text-muted)">pt</span></div>
                   <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">${t.count} Atleti</div>
                   <button class="btn-action" style="font-size:0.7rem; padding:4px 8px; margin-top:8px;" onclick="promptH2HTeam('${t.id}')">Confronta Team</button>
                 </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });
  };
  buildCatContainers(catM);
  buildCatContainers(catF);

  setPage(`
    <style>
      .btn-action { background:var(--red-hot); border:none; color:#fff; font-family:var(--font-heading); text-transform:uppercase; border-radius:4px; cursor:pointer; }
      .btn-action:hover { background:var(--gold); color:#000; }
      .dir-search-wrap { display:flex; justify-content:center; margin-bottom:30px; margin-top:20px;}
      .dir-search-input { width:100%; max-width:600px; padding:12px 20px; font-size:1rem; font-family:var(--font-heading); border-radius:30px; border:1px solid var(--border-subtle); background:var(--bg-card); color:var(--text-primary); outline:none; transition: border-color 0.2s; }
      .dir-search-input:focus { border-color:var(--yellow-race); }
    </style>
    <div style="max-width:1200px; margin:0 auto; padding-top:20px; animation:slide-up 0.2s ease;">
      <div style="text-align:center; margin-bottom:20px;">
        <h1 style="font-family:var(--font-display); font-size:3.5rem; text-transform:uppercase; margin-bottom:10px; color:var(--text-primary);">Elenco Squadre</h1>
      </div>
      
      <div class="tabs-wrap" style="margin-bottom:20px;">
         <div style="display:flex; justify-content:center; gap:8px; margin-bottom:12px;">
           <button class="tab-btn active-cat" id="dir-btn-uomini" onclick="switchDirGender('uomini', 'AL_M')">UOMINI</button>
           <button class="tab-btn" id="dir-btn-donne" onclick="switchDirGender('donne', 'AL_F')">DONNE</button>
         </div>
         <div style="display:flex; justify-content:center; flex-wrap:wrap; gap:8px;" id="dir-cats-uomini">
            ${catM.map(c => `<button class="tab-btn dir-cat-btn" id="dir-catbtn-${c.id}" onclick="switchDirCat('${c.id}')">${c.label}</button>`).join('')}
         </div>
         <div style="display:none; justify-content:center; flex-wrap:wrap; gap:8px;" id="dir-cats-donne">
            ${catF.map(c => `<button class="tab-btn dir-cat-btn" id="dir-catbtn-${c.id}" onclick="switchDirCat('${c.id}')">${c.label}</button>`).join('')}
         </div>
      </div>

      <div class="dir-search-wrap">
         <input type="text" class="dir-search-input" id="dir-search" placeholder="🔍 Cerca squadra..." oninput="dirLiveSearch(this.value)" />
      </div>

      <div id="dir-master-container">
        ${htmlContainers}
      </div>
    </div>
  `);

  setTimeout(() => { switchDirCat('AL_M'); }, 50);
}

window.promptH2HTeam = async function(id1) {
  showModalInput('Confronta Squadra — cerca il rivale', 'Nome squadra...', (q) => {
    const t1 = globalData.teams[id1];
    if (!t1) { alert('Team non trovato.'); return; }

    // Categoria dell'atleta del team
    const t1AthletaId = (t1.atleti || [])[0];
    const t1Cat = t1AthletaId ? globalData.athletes[t1AthletaId]?.categoria : null;

    const allTeams = Object.values(globalData.teams);
    let sameCategory;
    if (t1Cat) {
      sameCategory = allTeams.filter(t => {
        const firstAtletaId = (t.atleti || [])[0];
        const cat = firstAtletaId ? globalData.athletes[firstAtletaId]?.categoria : null;
        return cat === t1Cat && t.id !== id1;
      });
    } else {
      sameCategory = allTeams.filter(t => t.id !== id1);
    }

    const find = sameCategory.filter(t => (t.nome||'').toLowerCase().includes(q.toLowerCase()));

    if (find.length === 0) {
      alert('Nessun Team trovato in questa categoria con quel nome.');
    } else if (find.length === 1) {
      window.location.hash = `#/confronto-team/${id1}/${find[0].id}`;
    } else {
      showModalSelect(
        'Seleziona il team rivale',
        find,
        (f) => `🛡️ ${f.nome}`,
        (chosen) => { window.location.hash = `#/confronto-team/${id1}/${chosen.id}`; }
      );
    }
  });
};

// ── SEARCH AUTOCOMPLETE ────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('nav-search');
  const drop = document.getElementById('search-results-dropdown');
  let timeout = null;
  if(!input || !drop) return;
  input.addEventListener('input', (e) => {
    clearTimeout(timeout);
    drop.style.display = 'none';
    const q = e.target.value.toLowerCase().trim();
    if (q.length < 2) return;
    
    timeout = setTimeout(() => {
        const athletes = Object.values(globalData?.athletes||{});
        const resA = athletes.filter(a => a.cognome.toLowerCase().includes(q) || a.nome.toLowerCase().includes(q)).slice(0, 6);
        const resT = [...new Set(athletes.map(a => a.team_attuale))].filter(t => t.toLowerCase().includes(q)).slice(0, 3);
        
        if (resA.length === 0 && resT.length === 0) {
          drop.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:0.9rem; text-align:center;">Nessun risultato :(</div>';
          drop.style.display = 'block';
          return;
        }
        
        let html = '';
        if (resT.length) {
          resT.forEach(t => {
             html += `<a href="#/team/${encodeURIComponent(t)}" class="search-item" onclick="document.getElementById('search-results-dropdown').style.display='none'">
               <div style="font-family:var(--font-heading); font-size:1.1rem; font-weight:700;">🛡️ ${esc(t)}</div>
               <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Squadra / Team</div>
             </a>`;
          });
        }
        if (resA.length) {
          resA.forEach(a => {
             html += `<a href="#/atleta/${a.id}" class="search-item" onclick="document.getElementById('search-results-dropdown').style.display='none'">
               <div style="font-family:var(--font-display); font-size:1.2rem;">${esc(a.cognome)} ${esc(a.nome)}</div>
               <div style="font-size:0.8rem; color:var(--text-secondary); text-transform:uppercase;">${catLabel(a.categoria)} <span style="opacity:0.5; margin:0 4px;">|</span> ${esc(a.team_attuale)}</div>
             </a>`;
          });
        }
        drop.innerHTML = html;
        drop.style.display = 'block';
    }, 200);
  });
  
  document.addEventListener('click', (e) => {
    if(!e.target.closest('.nav-search-wrap')) drop.style.display = 'none';
  });
}


// \u2500\u2500 CLASSIFICA MENSILE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function renderClassificaMensile() {
  if (!globalData) return;
  const { athletes, resultsRaw } = globalData;

  const allMonths = [...new Set(
    resultsRaw.map(r => r.data?.slice(0,7)).filter(Boolean)
  )].sort().reverse();

  if (!allMonths.length) {
    setPage('<div class="empty-state" style="padding:80px;text-align:center;">Nessun dato mensile disponibile.</div>');
    return;
  }

  const CATS_M = [
    {id:'ES1_M',label:'Esordienti 1\u00b0'},{id:'ES2_M',label:'Esordienti 2\u00b0'},{id:'AL_M',label:'Allievi'},
    {id:'JUN_M',label:'Juniores'},{id:'ELI_M',label:'Elite - U23'}
  ];
  const CATS_F = [
    {id:'ES1_F',label:'Donne Es 1\u00b0'},{id:'ES2_F',label:'Donne Es 2\u00b0'},{id:'AL_F',label:'Donne Allieve'},
    {id:'JUN_F',label:'Donne Juniores'},{id:'ELI_F',label:'Donne Elite - U23'}
  ];
  const MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                   'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  function calcMese(ym, catId) {
    const byAtleta = {};
    resultsRaw.filter(r => r.data?.startsWith(ym)).forEach(r => {
      const a = athletes[r.atleta_id];
      if (!a || a.categoria !== catId) return;
      if (!byAtleta[r.atleta_id]) byAtleta[r.atleta_id] = { a, pts:0, gare:0, wins:0 };
      byAtleta[r.atleta_id].pts += r.punti_effettivi || 0;
      byAtleta[r.atleta_id].gare++;
      if (r.posizione === 1) byAtleta[r.atleta_id].wins++;
    });
    return Object.values(byAtleta).sort((a,b) => b.pts - a.pts);
  }

  function catTable(ym, cats) {
    return cats.map(c => {
      const rank = calcMese(ym, c.id);
      if (!rank.length) return '';
      const rows = rank.slice(0,10).map((x,i) => `
        <tr style="border-bottom:1px solid var(--border-subtle);">
          <td style="font-family:var(--font-display);font-size:1.3rem;padding:6px 10px;
            color:${i===0?'var(--gold)':i===1?'var(--silver)':i===2?'var(--bronze)':'var(--text-muted)'};">${i+1}</td>
          <td style="padding:6px 10px;">
            <a href="#/atleta/${x.a.id}" style="font-family:var(--font-heading);font-weight:700;color:var(--text-primary);">${esc(x.a.cognome)} ${esc(x.a.nome)}</a>
            <div style="font-size:0.7rem;color:var(--text-muted);">${esc(x.a.team_attuale)}</div>
          </td>
          <td style="text-align:right;font-family:var(--font-display);font-size:1.2rem;color:var(--yellow-race);padding:6px 10px;">${x.pts}</td>
          <td style="text-align:right;color:var(--text-secondary);padding:6px 10px;">${x.gare}</td>
          <td style="text-align:right;color:var(--gold);padding:6px 10px;">${x.wins>0?'\ud83c\udfc6 '+x.wins:'\u2014'}</td>
        </tr>`).join('');
      return `
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;margin-bottom:16px;overflow:hidden;">
          <div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);
            font-family:var(--font-heading);font-weight:700;text-transform:uppercase;font-size:0.95rem;color:var(--text-primary);">
            ${c.label} <span style="float:right;font-size:0.75rem;color:var(--text-muted);">${rank.length} classificati</span>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:2px solid var(--border-subtle);">
              <th style="font-family:var(--font-heading);font-size:0.7rem;text-transform:uppercase;color:var(--text-muted);padding:6px 10px;text-align:left;width:40px;">POS</th>
              <th style="font-family:var(--font-heading);font-size:0.7rem;text-transform:uppercase;color:var(--text-muted);padding:6px 10px;text-align:left;">CORRIDORE</th>
              <th style="font-family:var(--font-heading);font-size:0.7rem;text-transform:uppercase;color:var(--text-muted);padding:6px 10px;text-align:right;">PT</th>
              <th style="font-family:var(--font-heading);font-size:0.7rem;text-transform:uppercase;color:var(--text-muted);padding:6px 10px;text-align:right;">GARE</th>
              <th style="font-family:var(--font-heading);font-size:0.7rem;text-transform:uppercase;color:var(--text-muted);padding:6px 10px;text-align:right;">WIN</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');
  }

  const monthOptions = allMonths.map(ym => {
    const [y,m] = ym.split('-');
    return `<option value="${ym}">${MESI_IT[parseInt(m)-1]} ${y}</option>`;
  }).join('');

  setPage(`
    <style>
      #mensile-month-sel { background:var(--bg-card); border:1px solid var(--border-subtle); color:var(--text-primary);
        font-family:var(--font-heading); font-size:1rem; padding:8px 16px; border-radius:6px; outline:none; cursor:pointer; }
    </style>
    <div style="max-width:1000px;margin:0 auto;padding-top:20px;animation:slide-up 0.2s ease;">
      <div style="text-align:center;margin-bottom:28px;">
        <h1 style="font-family:var(--font-display);font-size:3rem;text-transform:uppercase;color:var(--text-primary);">CLASSIFICA MENSILE</h1>
        <div style="color:var(--text-muted);font-family:var(--font-heading);margin-top:4px;">
          Punti accumulati mese per mese \u2014 Stagione ${new Date().getFullYear()}
        </div>
      </div>
      <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-bottom:24px;">
        <label style="font-family:var(--font-heading);text-transform:uppercase;color:var(--text-muted);">Mese:</label>
        <select id="mensile-month-sel" onchange="switchMensileMonth(this.value)">${monthOptions}</select>
      </div>
      <div style="display:flex;justify-content:center;gap:8px;margin-bottom:24px;">
        <button class="tab-btn active-gender" id="mens-btn-m" onclick="switchMensileGender('m')">UOMINI</button>
        <button class="tab-btn" id="mens-btn-f" onclick="switchMensileGender('f')">DONNE</button>
      </div>
      <div id="mensile-content-m"><div id="mensile-tables-m"></div></div>
      <div id="mensile-content-f" style="display:none;"><div id="mensile-tables-f"></div></div>
    </div>
  `);

  window._catTableFn = catTable;

  window.switchMensileMonth = function(ym) {
    document.getElementById('mensile-tables-m').innerHTML = window._catTableFn(ym, CATS_M);
    document.getElementById('mensile-tables-f').innerHTML = window._catTableFn(ym, CATS_F);
  };
  window.switchMensileGender = function(gender) {
    document.getElementById('mens-btn-m').classList.toggle('active-gender', gender==='m');
    document.getElementById('mens-btn-f').classList.toggle('active-gender', gender==='f');
    document.getElementById('mensile-content-m').style.display = gender==='m' ? '' : 'none';
    document.getElementById('mensile-content-f').style.display = gender==='f' ? '' : 'none';
  };

  setTimeout(() => window.switchMensileMonth(allMonths[0]), 50);
}

// ── REGOLAMENTO ───────────────────────────────────────────────
function renderInfo() {
  setPage(`
    <style>
      .grid-regole b { color: var(--yellow-race); }
    </style>
    <div style="max-width:900px;margin:0 auto;padding:40px 20px;animation:fadeIn 0.4s ease;">
      <div style="text-align:center;margin-bottom:60px;">
        <h1 style="font-family:var(--font-display);font-size:3.5rem;text-transform:uppercase;margin:0;color:var(--text-primary);">
          REGOLAMENTO <span class="red">PUNTEGGI</span>
        </h1>
        <div style="width:60px;height:4px;background:var(--red-hot);margin:20px auto;"></div>
        <p style="color:var(--text-muted);font-size:1.1rem;max-width:600px;margin:10px auto;">
          Scopri come vengono calcolate le classifiche ufficiali di Italiacrit per ogni categoria e tipologia di gara.
        </p>
      </div>

      <div class="grid-regole" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:30px;margin-bottom:60px;">
        
        <!-- Punti Base -->
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);padding:30px;border-radius:16px;">
          <h2 style="font-family:var(--font-display);font-size:1.5rem;margin-bottom:20px;color:var(--red-hot);">PUNTEGGI BASE</h2>
          <table style="width:100%;font-family:var(--font-heading);border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:0.8rem;">
                <th style="text-align:left;padding-bottom:10px;">POSIZIONE</th>
                <th style="text-align:right;padding-bottom:10px;">PUNTI</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(BASEPTS).map(([pos, pts]) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                  <td style="padding:10px 0;font-weight:700;">${pos}\u00b0 Posto</td>
                  <td style="padding:10px 0;text-align:right;color:var(--yellow-race);font-size:1.2rem;font-weight:700;">${pts}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p style="margin-top:20px;font-size:0.85rem;color:var(--text-muted);line-height:1.4;">
            I punti vengono assegnati ai primi 10 atleti classificati per ogni categoria presente in gara.
          </p>
        </div>

        <!-- Moltiplicatori -->
        <div style="display:flex;flex-direction:column;gap:30px;">
          <div style="background:var(--bg-card);border:1px solid var(--border-subtle);padding:30px;border-radius:16px;">
            <h2 style="font-family:var(--font-display);font-size:1.5rem;margin-bottom:20px;color:var(--red-hot);">LIVELLO GARA</h2>
            <div style="display:flex;flex-direction:column;gap:15px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:700;font-size:1rem;color:var(--text-primary);">REGIONALE / LOCALE</div>
                  <div style="font-size:0.8rem;color:var(--text-muted);">Gare standard da calendario</div>
                </div>
                <div class="badge-cat badge-mult-x1" style="font-size:1rem;padding:6px 12px;">\u00d71</div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:700;font-size:1rem;color:var(--text-primary);">CAMP. REGIONALE / NAZIONALE</div>
                  <div style="font-size:0.8rem;color:var(--text-muted);">Gare di rilevanza superiore</div>
                </div>
                <div class="badge-cat badge-mult-x2" style="font-size:1rem;padding:6px 12px;">\u00d72</div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:700;font-size:1rem;color:var(--text-primary);">CAMP. ITALIANO / INTERNAZ.</div>
                  <div style="font-size:0.8rem;color:var(--text-muted);">Le massime competizioni</div>
                </div>
                <div class="badge-cat badge-mult-x3" style="font-size:1rem;padding:6px 12px;">\u00d73</div>
              </div>
            </div>
          </div>

          <div style="background:var(--bg-card);border:1px solid var(--border-subtle);padding:30px;border-radius:16px;">
            <h2 style="font-family:var(--font-display);font-size:1.4rem;margin-bottom:15px;color:var(--text-primary);">NOTE TECNICHE</h2>
            <ul style="padding-left:20px;color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin:0;">
              <li>Le classifiche vengono aggiornate settimanalmente.</li>
              <li>Per le classifiche di squadra, sommiamo i punti di tutti gli atleti del team.</li>
              <li>In caso di parit\u00e0 di punti totale, prevale l'atleta con il miglior piazzamento individuale pi\u00f9 recente.</li>
              <li>La classifica <b>Mensile</b> conta solo i punti presi in quel mese solare.</li>
            </ul>
          </div>
        </div>

      </div>

      <div style="text-align:center;padding:40px;border-top:1px solid var(--border-subtle);color:var(--text-muted);font-size:0.9rem;">
        ITALIACRIT \u2014 Performance Analytics per il Ciclismo Giovanile.
      </div>
    </div>
  `);
}

function renderNotFound() {
  setPage(`
    <div style="text-align:center;padding:100px 20px; animation:fadeIn 0.5s ease;">
      <h1 style="font-family:var(--font-display);font-size:6rem;color:var(--red-hot);margin:0">404</h1>
      <p style="color:var(--text-muted);font-size:1.2rem;margin-bottom:40px;">Pagina non trovata &mdash; <a href="#/" style="color:var(--red-hot)">Torna alla home</a></p>
    </div>
  `);
}
