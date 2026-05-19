// ── ENTRY EXPERIENCE ─────────────────────────────────────────────────

var ENTRY_CATS = {
  M: [
    { code: 'elite-m',      label: 'ELITE / U23', sub: 'Maschile', color: '#F59E0B', gradient: 'linear-gradient(145deg,#78350f 0%,#d97706 100%)' },
    { code: 'juniores-m',   label: 'JUNIORES',    sub: 'Maschile', color: '#E11D48', gradient: 'linear-gradient(145deg,#881337 0%,#E11D48 100%)' },
    { code: 'allievi-m',    label: 'ALLIEVI',     sub: 'Maschile', color: '#10B981', gradient: 'linear-gradient(145deg,#064e3b 0%,#10B981 100%)' },
    { code: 'esordienti-m', label: 'ESORDIENTI',  sub: 'Maschile', color: '#6366F1', gradient: 'linear-gradient(145deg,#312e81 0%,#6366F1 100%)' }
  ],
  F: [
    { code: 'elite-f',      label: 'ELITE / U23', sub: 'Femminile', color: '#F472B6', gradient: 'linear-gradient(145deg,#831843 0%,#db2777 100%)' },
    { code: 'juniores-f',   label: 'JUNIORES',    sub: 'Femminile', color: '#F43F5E', gradient: 'linear-gradient(145deg,#881337 0%,#F43F5E 100%)' },
    { code: 'allievi-f',    label: 'ALLIEVE',     sub: 'Femminile', color: '#8B5CF6', gradient: 'linear-gradient(145deg,#4c1d95 0%,#8B5CF6 100%)' },
    { code: 'esordienti-f', label: 'ESORDIENTI',  sub: 'Femminile', color: '#A78BFA', gradient: 'linear-gradient(145deg,#4c1d95 0%,#A78BFA 100%)' }
  ]
};

function _entryHideShell() {
  var nb = document.getElementById('navbar');
  var nd = document.getElementById('nav-drawer');
  var ft = document.querySelector('footer');
  if (nb) nb.style.display = 'none';
  if (nd) nd.style.display = 'none';
  if (ft) ft.style.display = 'none';
}

function _entryShowShell() {
  var nb = document.getElementById('navbar');
  var nd = document.getElementById('nav-drawer');
  var ft = document.querySelector('footer');
  if (nb) nb.style.display = '';
  if (nd) nd.style.display = '';
  if (ft) ft.style.display = '';
}

function renderEntry(step, data) {
  _entryHideShell();
  var appEl = document.getElementById('app');

  if (!step || step === 'gender') {
    appEl.innerHTML =
      '<div class="entry-page" id="entry-page">' +
        '<div class="entry-bg-glow"></div>' +
        '<div class="entry-content">' +
          '<div class="entry-brand">' +
            '<div class="entry-logo-ring">ITC</div>' +
            '<h1 class="entry-title">ITALIACRIT</h1>' +
            '<p class="entry-tagline">Il Ciclismo Agonistico Italiano</p>' +
          '</div>' +
          '<div class="entry-selector">' +
            '<p class="entry-prompt">SCEGLI IL TUO MONDO</p>' +
            '<div class="entry-gender-grid">' +
              '<div class="entry-gender-card entry-men" onclick="window._entryGender(\'M\')">' +
                '<div class="entry-gender-symbol">&#9794;</div>' +
                '<div class="entry-gender-name">UOMINI</div>' +
                '<div class="entry-gender-cta">Entra &#8594;</div>' +
              '</div>' +
              '<div class="entry-gender-card entry-women" onclick="window._entryGender(\'F\')">' +
                '<div class="entry-gender-symbol">&#9792;</div>' +
                '<div class="entry-gender-name">DONNE</div>' +
                '<div class="entry-gender-cta">Entra &#8594;</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="entry-skip" onclick="window._entrySkip()">Continua senza selezionare &#8594;</div>' +
        '</div>' +
      '</div>';
    requestAnimationFrame(function() {
      var p = document.getElementById('entry-page');
      if (!p) return;
      p.style.opacity = '0';
      requestAnimationFrame(function() {
        p.style.transition = 'opacity .5s ease';
        p.style.opacity = '1';
      });
    });

  } else if (step === 'category') {
    var gender = data.gender;
    var cats = ENTRY_CATS[gender];
    var gLabel = gender === 'M' ? '&#9794; UOMINI' : '&#9792; DONNE';
    var catsHtml = cats.map(function(c) {
      return '<div class="entry-cat-card" style="background:' + c.gradient + ';--cat-c:' + c.color + '" onclick="window._entryCat(\'' + c.code + '\')">' +
        '<div class="entry-cat-name">' + c.label + '</div>' +
        '<div class="entry-cat-sub">' + c.sub + '</div>' +
        '<div class="entry-cat-go">&#8594;</div>' +
        '</div>';
    }).join('');
    appEl.innerHTML =
      '<div class="entry-page entry-cat-view" id="entry-page">' +
        '<div class="entry-bg-glow"></div>' +
        '<div class="entry-content">' +
          '<button class="entry-back" onclick="window.renderEntry()">&larr; ' + gLabel + '</button>' +
          '<p class="entry-prompt entry-prompt-cat">SCEGLI LA TUA CATEGORIA</p>' +
          '<div class="entry-cat-grid">' + catsHtml + '</div>' +
          '<div class="entry-skip" onclick="window._entrySkip()">Continua senza selezionare &#8594;</div>' +
        '</div>' +
      '</div>';
    requestAnimationFrame(function() {
      var p = document.getElementById('entry-page');
      if (!p) return;
      p.style.opacity = '0';
      requestAnimationFrame(function() {
        p.style.transition = 'opacity .4s ease';
        p.style.opacity = '1';
      });
    });
  }
}
window.renderEntry = renderEntry;

window._entryGender = function(gender) {
  var p = document.getElementById('entry-page');
  if (p) {
    p.style.transition = 'opacity .28s ease, transform .28s ease';
    p.style.opacity = '0';
    p.style.transform = 'scale(.97)';
  }
  setTimeout(function() { renderEntry('category', { gender: gender }); }, 300);
};

window._entryCat = function(hubCode) {
  var p = document.getElementById('entry-page');
  if (p) {
    p.style.transition = 'opacity .5s ease, transform .5s ease';
    p.style.opacity = '0';
    p.style.transform = 'scale(1.04)';
  }
  setTimeout(function() {
    _entryShowShell();
    activeHub = Object.assign({}, HUB_CONFIG[hubCode]);
    activeHub._code = hubCode;
    applyHubFilters(activeHub);
    try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
    var returnHash = window._entryReturnHash || '#/';
    window._entryReturnHash = null;
    if (window.location.hash !== returnHash) window.location.hash = returnHash;
    route();
  }, 530);
};

window._entrySkip = function() {
  var p = document.getElementById('entry-page');
  if (p) { p.style.transition = 'opacity .35s'; p.style.opacity = '0'; }
  setTimeout(function() {
    _entryShowShell();
    try { localStorage.setItem('itcContext', 'skip'); } catch(e) {}
    window.location.hash = '#/';
    route();
  }, 370);
};

window.openContextSwitcher = function() {
  window._entryReturnHash = window.location.hash || '#/';
  renderEntry();
};

function _routeEntryGate() {
  var stored;
  try { stored = localStorage.getItem('itcContext'); } catch(e) { stored = 'skip'; }
  if (!activeHub && !stored) {
    _entryHideShell();
    renderEntry();
    return true;
  }
  if (!activeHub && stored && stored !== 'skip' && HUB_CONFIG[stored]) {
    activeHub = Object.assign({}, HUB_CONFIG[stored]);
    activeHub._code = stored;
    applyHubFilters(activeHub);
  }
  _entryShowShell();
  return false;
}

function updateNavContextChip() {
  var chip = document.getElementById('ctx-chip');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'ctx-chip';
    var navbar = document.getElementById('navbar');
    var badge  = document.getElementById('badge-live');
    if (navbar && badge) navbar.insertBefore(chip, badge);
    else if (navbar) navbar.appendChild(chip);
  }
  if (activeHub) {
    chip.className = 'ctx-chip ctx-chip-on';
    chip.style.setProperty('--ctx-c', activeHub.color || '#E11D48');
    chip.innerHTML =
      '<span class="ctx-chip-lbl">' + (activeHub.icon || '') + ' ' + (activeHub.label || 'CATEGORIA') + '</span>' +
      '<span class="ctx-chip-arr">&#9660;</span>';
    chip.onclick = function() { openContextSwitcher(); };
  } else {
    chip.className = 'ctx-chip ctx-chip-off';
    chip.style.removeProperty('--ctx-c');
    chip.innerHTML = '<span class="ctx-chip-lbl">TUTTE</span><span class="ctx-chip-arr">&#9660;</span>';
    chip.onclick = function() { openContextSwitcher(); };
  }
}

