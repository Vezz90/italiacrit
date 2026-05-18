
// ════════════════════════════════════════════════════════════════════
//  ITALIACRIT MULTI-HUB SYSTEM
//  One platform, contextual category ecosystems
// ════════════════════════════════════════════════════════════════════

const HUB_CONFIG = {
  'uomini': {
    label:'Uomini', gender:'M',
    catCodes:['ELI_M','JUN_M','AL_M','ES2_M','ES1_M'],
    mainCat:'ELI_M', catFilter:'',
    icon:'♂', color:'#1D4ED8',
    gradient:'linear-gradient(135deg,#1D4ED8 0%,#0EA5E9 100%)',
    desc:'Tutto il ciclismo maschile italiano'
  },
  'donne': {
    label:'Donne', gender:'F',
    catCodes:['ELI_F','JUN_F','AL_F','ES2_F','ES1_F'],
    mainCat:'ELI_F', catFilter:'',
    icon:'♀', color:'#EC4899',
    gradient:'linear-gradient(135deg,#BE185D 0%,#EC4899 100%)',
    desc:'Tutto il ciclismo femminile italiano'
  },
  'elite-m': {
    label:'Elite / U23', gender:'M',
    catCodes:['ELI_M'],
    mainCat:'ELI_M', catFilter:'Elite',
    icon:'👑', color:'#F59E0B',
    gradient:'linear-gradient(135deg,#92400E 0%,#F59E0B 100%)',
    desc:'Il vertice del ciclismo maschile italiano'
  },
  'juniores-m': {
    label:'Juniores', gender:'M',
    catCodes:['JUN_M'],
    mainCat:'JUN_M', catFilter:'Junior',
    icon:'🏆', color:'#E11D48',
    gradient:'linear-gradient(135deg,#9F1239 0%,#E11D48 100%)',
    desc:'La classe del futuro del ciclismo maschile'
  },
  'allievi-m': {
    label:'Allievi', gender:'M',
    catCodes:['AL_M'],
    mainCat:'AL_M', catFilter:'Alliev',
    icon:'⭐', color:'#10B981',
    gradient:'linear-gradient(135deg,#065F46 0%,#10B981 100%)',
    desc:'I talenti in crescita del pedale maschile'
  },
  'esordienti-m': {
    label:'Esordienti', gender:'M',
    catCodes:['ES2_M','ES1_M'],
    mainCat:'ES2_M', catFilter:'Esordient',
    icon:'🌱', color:'#6366F1',
    gradient:'linear-gradient(135deg,#3730A3 0%,#6366F1 100%)',
    desc:'I giovanissimi campioni del domani'
  },
  'elite-f': {
    label:'Elite Donne', gender:'F',
    catCodes:['ELI_F'],
    mainCat:'ELI_F', catFilter:'Elite',
    icon:'👑', color:'#F472B6',
    gradient:'linear-gradient(135deg,#9D174D 0%,#F472B6 100%)',
    desc:'Il vertice del ciclismo femminile italiano'
  },
  'juniores-f': {
    label:'Juniores Donne', gender:'F',
    catCodes:['JUN_F'],
    mainCat:'JUN_F', catFilter:'Junior',
    icon:'🏆', color:'#F43F5E',
    gradient:'linear-gradient(135deg,#881337 0%,#F43F5E 100%)',
    desc:'Il futuro del ciclismo femminile'
  },
  'allievi-f': {
    label:'Allieve', gender:'F',
    catCodes:['AL_F'],
    mainCat:'AL_F', catFilter:'Alliev',
    icon:'⭐', color:'#8B5CF6',
    gradient:'linear-gradient(135deg,#4C1D95 0%,#8B5CF6 100%)',
    desc:'I talenti femminili in crescita'
  },
  'esordienti-f': {
    label:'Esordienti Donne', gender:'F',
    catCodes:['ES2_F','ES1_F'],
    mainCat:'ES2_F', catFilter:'Esordient',
    icon:'🌱', color:'#A78BFA',
    gradient:'linear-gradient(135deg,#5B21B6 0%,#A78BFA 100%)',
    desc:'Le giovanissime campionesse del domani'
  },
};

const _HUB_MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

let activeHub = null;

// ── Hub secondary navigation strip ───────────────────────────────────
function buildHubSubnav(hub) {
  const h = window.location.hash || '';
  const code = hub._code || '';
  const base = '#/hub/' + code;
  const tabs = [
    { path:'',            label:'Home' },
    { path:'/classifica', label:'Classifica' },
    { path:'/risultati',  label:'Risultati' },
    { path:'/atleti',     label:'Atleti' },
    { path:'/team',       label:'Team' },
    { path:'/calendario', label:'Calendario' },
    { path:'/statistiche',label:'Statistiche' },
  ];
  const tabsHtml = tabs.map(function(t) {
    const href = base + t.path;
    const isActive = t.path === ''
      ? (h === base || h === base + '/home' || h === base + '/')
      : h.startsWith(base + t.path);
    return '<a href="' + href + '" class="hub-subnav-tab' + (isActive ? ' hub-subnav-active' : '') + '">' + t.label + '</a>';
  }).join('');
  return '<div class="hub-subnav" style="--hub-color:' + hub.color + '">' +
    '<a href="#/" class="hub-subnav-back">← Network</a>' +
    '<span class="hub-subnav-name">' + hub.icon + ' ' + hub.label.toUpperCase() + '</span>' +
    '<div class="hub-subnav-tabs">' + tabsHtml + '</div>' +
  '</div>';
}

// ── Set hub filter state on all page-level filter vars ────────────────
function applyHubFilters(hub) {
  rankGender = hub.gender;
  rankCat = hub.mainCat;
  atlGender = hub.gender;
  atlCat = hub.mainCat;
  teamGender = hub.gender;
  teamCat = hub.mainCat;
  risSearchQuery = '';
  risQueryCat = hub.catFilter;
  risQueryMonth = '';
  risQueryRegion = '';
  risQueryGenere = hub.gender;
  calQGenere = hub.gender;
  calQCat = hub.catFilter;
  calQMonth = '';
  calQSearch = '';
  calQTipo = '';
  calQRegione = '';
}

// ── Network section for global homepage ─────────────────────────────
function buildNetworkSection(resultsRaw, calendar) {
  const lastDate = resultsRaw.reduce(function(mx,r){ return (r.data||'')>mx?r.data:mx; }, '');
  const cut14 = (function(){ var d=new Date(lastDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();

  // Hottest hub by recent activity
  const recentCounts = {};
  resultsRaw.filter(function(r){ return r.data >= cut14; }).forEach(function(r) {
    var code = getRankingFileCode(r);
    if (code) recentCounts[code] = (recentCounts[code]||0) + 1;
  });
  const hottestCode = Object.entries(recentCounts).sort(function(a,b){ return b[1]-a[1]; })[0];
  const hottestCat = hottestCode ? hottestCode[0] : '';

  // Gender totals
  var mCount = 0, fCount = 0;
  var mAthletes = new Set(), fAthletes = new Set();
  resultsRaw.forEach(function(r) {
    if (r.genere === 'F') { fCount++; if(r.atleta_id) fAthletes.add(r.atleta_id); }
    else { mCount++; if(r.atleta_id) mAthletes.add(r.atleta_id); }
  });

  // Gender cards
  const genderCards =
    '<div class="em-gender-card em-gender-m" onclick="location.hash=\'#/hub/uomini\'">' +
      '<div class="em-gender-symbol">♂</div>' +
      '<div class="em-gender-name">UOMINI</div>' +
      '<div class="em-gender-cats">Elite · Juniores · Allievi · Esordienti</div>' +
      '<div class="em-gender-stats">' + mAthletes.size + ' atleti</div>' +
      '<div class="em-gender-cta">Entra →</div>' +
    '</div>' +
    '<div class="em-gender-card em-gender-f" onclick="location.hash=\'#/hub/donne\'">' +
      '<div class="em-gender-symbol">♀</div>' +
      '<div class="em-gender-name">DONNE</div>' +
      '<div class="em-gender-cats">Elite · Juniores · Allieve · Esordienti</div>' +
      '<div class="em-gender-stats">' + fAthletes.size + ' atlete</div>' +
      '<div class="em-gender-cta">Entra →</div>' +
    '</div>';

  // Individual hub cards
  const indivHubs = ['elite-m','juniores-m','allievi-m','esordienti-m','elite-f','juniores-f','allievi-f','esordienti-f'];
  const hubCards = indivHubs.map(function(code) {
    const hub = HUB_CONFIG[code];
    const isHot = hub.catCodes.includes(hottestCat);
    const cnt = new Set(resultsRaw.filter(function(r) {
      return r.genere === hub.gender && hub.catCodes.includes(getRankingFileCode(r));
    }).map(function(r){ return r.atleta_id; })).size;
    return '<div class="hub-entry-card" style="--hub-color:' + hub.color + ';--hub-gradient:' + hub.gradient + '" onclick="location.hash=\'#/hub/' + code + '\'">' +
      '<div class="hub-entry-top">' +
        '<span class="hub-entry-icon">' + hub.icon + '</span>' +
        (isHot ? '<span class="hub-entry-hot">🔥</span>' : '') +
      '</div>' +
      '<div class="hub-entry-label">' + hub.label + '</div>' +
      '<div class="hub-entry-desc">' + hub.desc + '</div>' +
      '<div class="hub-entry-count">' + cnt + ' atleti</div>' +
      '<div class="hub-entry-cta">Entra →</div>' +
    '</div>';
  }).join('');

  return '<section class="em-network">' +
    '<div class="em-network-header">' +
      '<div class="em-network-eyebrow">🌐 ITALIACRIT NETWORK</div>' +
      '<h2 class="em-network-title">Scegli il tuo ecosistema</h2>' +
      '<div class="em-network-sub">Ogni categoria ha il suo mondo — risultati, classifica, rivalità</div>' +
    '</div>' +
    '<div class="em-network-genders">' + genderCards + '</div>' +
    '<div class="em-network-hubs">' + hubCards + '</div>' +
  '</section>';
}

// ── Hub Homepage ──────────────────────────────────────────────────────
async function renderHubHome(hubCode) {
  if (!globalData) return;
  const hub = HUB_CONFIG[hubCode];
  if (!hub) { renderNotFound(); return; }
  activeHub = hub;
  activeHub._code = hubCode;

  const { resultsRaw, calendar } = globalData;

  // Filter results to this hub
  const hubRes = resultsRaw.filter(function(r) {
    if (r.genere !== hub.gender) return false;
    const code = getRankingFileCode(r);
    return hub.catCodes.includes(code);
  });

  // Load ranking for main category
  const hubRanking = (await loadRanking(hub.mainCat)).slice(0, 5);

  // Date helpers
  const lastDate = hubRes.reduce(function(mx,r){ return (r.data||'')>mx?r.data:mx; }, '');
  const cut14 = (function(){ var d=new Date(lastDate||new Date()); d.setDate(d.getDate()-14); return d.toISOString().split('T')[0]; })();
  const cut7  = (function(){ var d=new Date(lastDate||new Date()); d.setDate(d.getDate()-7);  return d.toISOString().split('T')[0]; })();
  const todayStr = new Date().toISOString().split('T')[0];

  // Rider on Fire (last 14 days)
  const fireMap = {};
  hubRes.filter(function(r){ return r.data >= cut14; }).forEach(function(r) {
    if (!fireMap[r.atleta_id]) fireMap[r.atleta_id] = { atleta_id:r.atleta_id, cognome:r.cognome, nome:r.nome, team:r.team, wins:0, podi:0, pts:0 };
    if (r.posizione === 1) fireMap[r.atleta_id].wins++;
    if (r.posizione <= 3) fireMap[r.atleta_id].podi++;
    fireMap[r.atleta_id].pts += (r.punti_effettivi||0);
  });
  const fireList = Object.values(fireMap).sort(function(a,b){ return b.wins-a.wins||b.podi-a.podi||b.pts-a.pts; });
  const fireAthlete = fireList[0] || null;
  const fireStory = fireAthlete ? siAthleteStory(fireAthlete.atleta_id, hubRes) : null;
  const fireStreak = fireAthlete ? siStreak(fireAthlete.atleta_id, hubRes) : null;

  // Rivalry
  const rivals = siRivalryFinder(hubRes);
  const rv = rivals[0] || null;

  // Recent winners (last 7 days)
  const recentWins = hubRes.filter(function(r){ return r.data >= cut7 && r.posizione === 1; })
    .sort(function(a,b){ return b.data.localeCompare(a.data); }).slice(0, 5);

  // Upcoming hub races
  const upcomingHub = calendar.filter(function(g) {
    if (g.genere && g.genere !== hub.gender) return false;
    if (hub.catFilter && !(g.categoria||'').toLowerCase().includes(hub.catFilter.toLowerCase())) return false;
    return (g.data || '') >= todayStr;
  }).sort(function(a,b){ return a.data.localeCompare(b.data); }).slice(0, 4);

  // Newsroom (hub-scoped)
  const newsItems = siNewsroomFeed(hubRes, [], [], [], {}).slice(0, 5);

  // ── HTML ASSEMBLY ────────────────────────────────────────────────

  const heroHtml =
    '<div class="hub-hero" style="--hub-gradient:' + hub.gradient + ';--hub-color:' + hub.color + '">' +
      '<div class="hub-hero-eyebrow">🇮🇹 ITALIACRIT NETWORK</div>' +
      '<div class="hub-hero-title">' + hub.label.toUpperCase() + '</div>' +
      '<div class="hub-hero-desc">' + hub.desc + '</div>' +
      '<div class="hub-hero-cta-row">' +
        '<a href="#/hub/' + hubCode + '/classifica" class="hub-hero-btn">Classifica →</a>' +
        '<a href="#/hub/' + hubCode + '/risultati"  class="hub-hero-btn hub-hero-btn-ghost">Risultati →</a>' +
        '<a href="#/hub/' + hubCode + '/calendario" class="hub-hero-btn hub-hero-btn-ghost">Calendario →</a>' +
      '</div>' +
    '</div>';

  const fireHtml = fireAthlete
    ? '<section class="hub-fire-section">' +
        '<div class="hub-section-label">🔥 RIDER ON FIRE · ' + catLabel(hub.mainCat) + '</div>' +
        '<div class="hub-fire-card" style="--hub-color:' + hub.color + '" onclick="location.hash=\'#/atleta/' + encodeURIComponent(fireAthlete.atleta_id) + '\'">' +
          (fireStory ? '<div class="hub-fire-story">' + fireStory + '</div>' : '') +
          '<div class="hub-fire-name">' + esc(fireAthlete.cognome) + ' ' + esc(fireAthlete.nome) + '</div>' +
          '<div class="hub-fire-team">' + esc(fireAthlete.team||'') + '</div>' +
          '<div class="hub-fire-stats">' +
            '<span><strong>' + fireAthlete.wins + '</strong> vittorie</span>' +
            '<span><strong>' + fireAthlete.podi + '</strong> podi</span>' +
            '<span><strong>' + fireAthlete.pts + '</strong> pt</span>' +
            (fireStreak && fireStreak.winStreak >= 2 ? '<span class="hub-fire-streak">👑 ' + fireStreak.winStreak + ' consecutive</span>' : '') +
          '</div>' +
          '<div class="hub-fire-arrow">Scheda atleta →</div>' +
        '</div>' +
      '</section>'
    : '';

  const rivalHtml = rv
    ? '<section class="hub-rivalry-section">' +
        '<div class="hub-section-label">⚔ RIVALITÀ DI STAGIONE</div>' +
        '<div class="hub-rivalry-card">' +
          '<div class="hub-rv-side hub-rv-a" onclick="location.hash=\'#/atleta/' + encodeURIComponent(rv.aId) + '\'">' +
            '<div class="hub-rv-wins">' + rv.aWins + 'V</div>' +
            '<div class="hub-rv-name">' + esc(rv.aCog) + '</div>' +
            '<div class="hub-rv-nom">' + esc(rv.aNom) + '</div>' +
            '<div class="hub-rv-team">' + esc(rv.aTeam||'') + '</div>' +
          '</div>' +
          '<div class="hub-rv-center">' +
            '<div class="hub-rv-vs">VS</div>' +
            '<div class="hub-rv-enc">' + rv.encounters + ' scontri</div>' +
            '<div class="hub-rv-cat">' + catLabel(rv.code || hub.mainCat) + '</div>' +
          '</div>' +
          '<div class="hub-rv-side hub-rv-b" onclick="location.hash=\'#/atleta/' + encodeURIComponent(rv.bId) + '\'">' +
            '<div class="hub-rv-wins">' + rv.bWins + 'V</div>' +
            '<div class="hub-rv-name">' + esc(rv.bCog) + '</div>' +
            '<div class="hub-rv-nom">' + esc(rv.bNom) + '</div>' +
            '<div class="hub-rv-team">' + esc(rv.bTeam||'') + '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    : '';

  const rankHtml = hubRanking.length
    ? '<section class="hub-ranking-section">' +
        '<div class="hub-section-header">' +
          '<div class="hub-section-label">🏆 TOP CLASSIFICA · ' + catLabel(hub.mainCat) + '</div>' +
          '<a href="#/hub/' + hubCode + '/classifica" class="hub-section-more">Vedi tutto →</a>' +
        '</div>' +
        '<div class="hub-rank-list">' +
          hubRanking.map(function(a, i) {
            return '<div class="hub-rank-row' + (i===0?' hub-rank-leader':'') + '" onclick="location.hash=\'#/atleta/' + encodeURIComponent(a.atleta_id) + '\'">' +
              '<span class="hub-rank-pos' + (i===0?' hub-rank-pos-1':i===1?' hub-rank-pos-2':i===2?' hub-rank-pos-3':'') + '">' + (i+1) + '</span>' +
              '<div class="hub-rank-info">' +
                '<div class="hub-rank-name">' + esc(a.cognome) + ' ' + esc(a.nome) + '</div>' +
                '<div class="hub-rank-team">' + esc(a.team_attuale||a.team||'') + '</div>' +
              '</div>' +
              '<span class="hub-rank-pts">' + a.punti + '<small> pt</small></span>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</section>'
    : '';

  const recentHtml = recentWins.length
    ? '<section class="hub-recent-section">' +
        '<div class="hub-section-header">' +
          '<div class="hub-section-label">🥇 ULTIMI VINCITORI</div>' +
          '<a href="#/hub/' + hubCode + '/risultati" class="hub-section-more">Tutti i risultati →</a>' +
        '</div>' +
        '<div class="hub-recent-list">' +
          recentWins.map(function(r) {
            const d = new Date(r.data);
            return '<div class="hub-recent-row">' +
              '<span class="hub-recent-date">' + d.getDate() + ' ' + _HUB_MONTHS[d.getMonth()] + '</span>' +
              '<div class="hub-recent-info">' +
                '<a href="#/atleta/' + encodeURIComponent(r.atleta_id) + '" class="hub-recent-name">' + esc(r.cognome) + ' ' + esc(r.nome) + '</a>' +
                '<span class="hub-recent-race">' + esc(r.nome_gara||'') + '</span>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</section>'
    : '';

  const upcomingHtml = upcomingHub.length
    ? '<section class="hub-upcoming-section">' +
        '<div class="hub-section-header">' +
          '<div class="hub-section-label">📅 PROSSIME GARE</div>' +
          '<a href="#/hub/' + hubCode + '/calendario" class="hub-section-more">Calendario →</a>' +
        '</div>' +
        '<div class="hub-upcoming-list">' +
          upcomingHub.map(function(g) {
            const d = new Date(g.data);
            const days = Math.round((d - new Date(todayStr)) / 86400000);
            const dStr = days === 0 ? 'OGGI' : days === 1 ? 'DOMANI' : 'fra ' + days + 'gg';
            return '<div class="hub-upcoming-row" onclick="location.hash=\'#/calendario/' + encodeURIComponent(g.id) + '\'">' +
              '<span class="hub-upcoming-badge' + (days === 0 ? ' hub-upcoming-oggi' : '') + '">' + dStr + '</span>' +
              '<div class="hub-upcoming-info">' +
                '<span class="hub-upcoming-date">' + d.getDate() + ' ' + _HUB_MONTHS[d.getMonth()] + '</span>' +
                '<span class="hub-upcoming-name">' + esc(g.nome) + '</span>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</section>'
    : '';

  const newsHtml = newsItems.length
    ? '<section class="hub-news-section">' +
        '<div class="hub-section-label">📡 NEWSROOM · ' + hub.label.toUpperCase() + '</div>' +
        '<div class="hub-news-feed">' +
          newsItems.map(function(item) {
            const click = item.atleta_id
              ? " onclick=\"location.hash='#/atleta/" + item.atleta_id + "'\""
              : item.team_id
                ? " onclick=\"location.hash='#/team/" + item.team_id + "'\""
                : '';
            return '<div class="hub-news-item em-news-' + item.type + '"' + click + '>' +
              '<span class="hub-news-icon">' + item.icon + '</span>' +
              '<div class="hub-news-text">' + item.text + '</div>' +
              (click ? '<span class="hub-news-arrow">→</span>' : '') +
            '</div>';
          }).join('') +
        '</div>' +
      '</section>'
    : '';

  setPage(
    heroHtml +
    '<div class="hub-content-grid">' +
      fireHtml +
      rivalHtml +
      rankHtml +
      recentHtml +
      upcomingHtml +
      newsHtml +
    '</div>'
  );
}

// ── Hub subpage dispatcher ────────────────────────────────────────────
function renderHubSubpage(hubCode, subpage) {
  const hub = HUB_CONFIG[hubCode];
  if (!hub) { renderNotFound(); return; }
  activeHub = hub;
  activeHub._code = hubCode;
  applyHubFilters(hub);
  switch (subpage) {
    case 'classifica':   return renderClassifica();
    case 'risultati':    return renderRisultati();
    case 'atleti':       return renderAtletiList();
    case 'team':         return renderTeamList();
    case 'calendario':   return renderCalendario();
    case 'statistiche':  return renderStatistiche();
    default:             return renderHubHome(hubCode);
  }
}
