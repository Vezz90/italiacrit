/* ============================================================
   ICS — Articoli della redazione (pubblici): pagina dell'articolo, elenco e sezione "Articoli" nella pagina del corridore.
   Gli articoli si preparano e si pubblicano dalla pagina Redazione (riservata): qui si legge soltanto.
   ============================================================ */
'use strict';

(function () {
  const dataIt = iso => { try { return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return ''; } };
  const get = p => fetch(`${API_BASE}${p}`).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
  const img1 = a => ((a.foto || [])[0] || {}).url || '';
  const src = u => (typeof icProxy === 'function' ? icProxy(u) : u);

  function corpoHtml(a) {
    const f = a.foto || [], usate = new Set(), out = []; let par = [];
    const fig = x => `<figure><img src="${esc(src(x.url))}" alt="${esc(x.didascalia || '')}" loading="lazy" onerror="this.parentNode.remove()">${(x.didascalia || x.credito) ? `<figcaption>${esc(x.didascalia || '')}${x.didascalia && x.credito ? ' · ' : ''}${x.credito ? 'Foto: ' + esc(x.credito) : ''}</figcaption>` : ''}</figure>`;
    const flush = () => { if (par.length) { out.push(`<p>${esc(par.join(' '))}</p>`); par = []; } };
    for (const r0 of String(a.corpo || '').replace(/\r/g, '').split('\n')) {
      const r = r0.trim(), m = r.match(/^\[\[foto:(\d+)\]\]$/);
      if (!r) { flush(); continue; }
      if (m) { flush(); const ft = f[+m[1] - 1]; if (ft) { usate.add(+m[1] - 1); out.push(fig(ft)); } continue; }
      if (/^##\s+/.test(r)) { flush(); out.push(`<h2>${esc(r.replace(/^##\s+/, ''))}</h2>`); continue; }
      par.push(r.replace(/\[\[foto:\d+\]\]/g, ''));
    }
    flush();
    return out.join('') + f.map((x, i) => usate.has(i) ? '' : fig(x)).join('');
  }
  const card = a => `<a class="ar-card" href="/articolo/${esc(a.slug)}">${img1(a) ? `<img src="${esc(src(img1(a)))}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="ar-ph"></span>'}<span class="ar-t"><b>${esc(a.titolo)}</b><small>${esc(dataIt(a.pubblicata_il))}</small>${a.sommario ? `<span class="ar-s">${esc(a.sommario)}</span>` : ''}</span></a>`;

  window.renderArticolo = async function (slug) {
    setPage('<div class="loading-bar"></div>');
    let a;
    try { a = await get('/articoli/' + encodeURIComponent(slug)); }
    catch (_) { setPage('<div class="hx-wrap"><div class="hx-none">Articolo non trovato.</div></div>'); return; }
    setPageMeta(a.titolo + ' | ICS', a.sommario || a.titolo);
    setPage(`<div class="hx-wrap"><article class="rd-art ar-art"><small class="rd-muted">${esc(dataIt(a.pubblicata_il))}${(a.tag || []).length ? ' · ' + a.tag.slice(0, 4).map(t => '#' + esc(t)).join(' ') : ''}</small>
      <h1>${esc(a.titolo)}</h1><p class="lead">${esc(a.sommario)}</p>${corpoHtml(a)}
      ${(a.atleti || []).length ? `<div class="ar-chips"><b>I corridori di cui si parla</b>${a.atleti.slice(0, 24).map(x => `<a href="/atleta/${esc(x.id)}">${esc(x.nome)}</a>`).join('')}</div>` : ''}
      <footer>© Produzione riservata</footer></article>
      <p class="ar-all"><a href="/articoli">← Tutti gli articoli</a></p></div>`);
  };

  window.renderArticoli = async function () {
    setPage('<div class="loading-bar"></div>');
    let l = [];
    try { l = (await get('/articoli')).articoli || []; } catch (_) { /* elenco vuoto */ }
    setPageMeta('Articoli | ICS', 'Gli articoli di Italia Cycling Stats: campionati, stagioni e protagonisti del ciclismo giovanile e dilettantistico.');
    setPage(`<div class="hx-wrap"><div class="rs-head"><h1>Articoli</h1></div>${l.length ? `<div class="ar-list">${l.map(card).join('')}</div>` : '<div class="hx-none">Nessun articolo pubblicato per ora.</div>'}</div>`);
  };

  // sezione nella pagina del corridore (riempie #atleta-articoli)
  window._caricaArticoliAtleta = async function (id) {
    const box = document.getElementById('atleta-articoli'); if (!box) return;
    try {
      const l = (await get('/articoli/atleta/' + encodeURIComponent(id))).articoli || [];
      if (!l.length || !document.getElementById('atleta-articoli')) return;
      box.innerHTML = `<section class="ath-block ar-sec"><h3>Articoli</h3><div class="ar-list">${l.map(card).join('')}</div></section>`;
    } catch (_) { /* nessuna sezione */ }
  };
})();
