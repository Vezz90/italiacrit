/* ============================================================
   ICS — Redazione AI (privata, solo amministratori)
   Prepara bozze di articoli dai dati del sito, dal web e da pagine ufficiali. Non pubblica nulla:
   si genera, si rilegge, si corregge e si approva. Server: server/redazione.js
   ============================================================ */
'use strict';

(function () {
  const TIPI = { gara: 'Gara (resoconto o anteprima)', settimana: 'Il punto della settimana', atleta: 'Profilo atleta', stagione: 'Fine stagione per categoria', squadre: 'Fine stagione: le squadre', libero: 'Richiesta libera' };
  const STATI = { in_generazione: 'In scrittura…', bozza: 'Bozza', approvata: 'Approvata', scartata: 'Scartata', errore: 'Errore' };
  const st = { prev: false, cand: {}, attesa: 0, altro: false, bozze: [], sel: null, tipo: 'gara', pick: null, cerca: [], q: '', timer: null, busy: false, msg: '' };
  const fmtData = iso => { try { return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const parole = t => (String(t || '').trim().match(/\S+/g) || []).length;
  const api = (p, o) => apiCall('/admin/redazione' + p, o);

  async function carica() {
    try { st.bozze = (await api('/bozze')).bozze || []; st.err = ''; }
    catch (e) { st.err = e.message || 'Errore di lettura'; }
    const inCorso = st.bozze.some(b => b.stato === 'in_generazione' && Date.now() - Date.parse(b.creato) < 12 * 60000) || Date.now() < st.attesa;
    clearTimeout(st.timer);
    if (inCorso && document.querySelector('.rd-wrap')) st.timer = setTimeout(async () => { await carica(); paint(true); }, 6000);
  }
  const sel = () => st.bozze.find(b => b.id === st.sel) || null;

  async function cercaOra() {
    if (st.tipo === 'settimana') { st.cerca = []; return; }
    try { st.cerca = (await api(`/cerca?tipo=${st.tipo}&q=${encodeURIComponent(st.q)}`)).risultati || []; } catch (_) { st.cerca = []; }
  }

  function form() {
    const need = st.tipo !== 'settimana';
    return `<div class="hx-panel rd-new"><h3>Nuova bozza</h3>
      <label class="rd-l">Tipo di articolo<select id="rd-tipo">${Object.entries(TIPI).map(([k, v]) => `<option value="${k}" ${st.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${need ? `<label class="rd-l">${st.tipo === 'gara' ? 'Gara (ultimi 60 giorni e prossimi 5)' : 'Atleta'}
        <input id="rd-q" type="search" value="${esc(st.q)}" placeholder="Cerca per nome…" autocomplete="off"></label>
        <div class="rd-res">${st.cerca.map(r => `<button type="button" data-pick="${esc(r.id)}" class="${st.pick && st.pick.id === r.id ? 'on' : ''}"><b>${esc(r.titolo)}</b><small>${esc(r.dettaglio)}</small></button>`).join('') || '<small class="rd-muted">Nessun risultato.</small>'}</div>
        ${st.pick ? `<div class="rd-pick">Scelto: <b>${esc(st.pick.titolo)}</b></div>` : ''}`
      : `<label class="rd-l">Ultimo giorno della settimana <small>(vuoto = l'ultimo giorno con gare)</small><input id="rd-fine" type="date"></label>`}
      <label class="rd-l">Pagine ufficiali da usare come fonte <small>(un indirizzo https per riga, max 5; i PDF non si leggono ancora)</small>
        <textarea id="rd-link" rows="3" placeholder="https://www.esperiapiasco.it/programma.html"></textarea></label>
      <label class="rd-l">Indicazioni per il redattore AI <small>(facoltative)</small><input id="rd-ind" type="text" maxlength="600" placeholder="Es. taglio più narrativo, metti in evidenza il campionato"></label>
      <label class="rd-c"><input id="rd-web" type="checkbox" checked> Cerca anche sul web (contesto, orari, notizie). Richiede più tempo, fino a 2 minuti.</label>
      <button type="button" class="admin-edit-btn rd-go" id="rd-genera" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Avvio…' : 'Genera bozza'}</button>
      ${st.msg ? `<div class="rd-msg">${esc(st.msg)}</div>` : ''}</div>`;
  }

  function lista() {
    const vis = st.bozze.filter(b => b.stato !== 'scartata');
    return `<div class="hx-panel"><h3>Articoli <small class="rd-muted">${vis.length}</small></h3>${st.err ? `<div class="rd-err">${esc(st.err)}</div>` : ''}
      ${vis.map(b => `<button type="button" class="rd-item ${st.sel === b.id ? 'on' : ''}" data-open="${b.id}">
        <span class="rd-chip s-${b.stato}">${STATI[b.stato] || b.stato}</span><b>${esc(b.titolo || b.soggetto || '—')}</b>
        <small>${esc(TIPI[b.tipo] || b.tipo)} · ${fmtData(b.aggiornato || b.creato)}</small></button>`).join('') || '<small class="rd-muted">Nessun articolo ancora. Premi "Scrivi gli articoli": ci vogliono un paio di minuti per ciascuno.</small>'}</div>`;
  }

  const imgSrc = u => (/ciclismo\.info|italiaciclismo/i.test(u) && typeof icProxy === 'function') ? icProxy(u) : u;
  function fotoHtml(b) {
    const sc = b.foto || [];
    if (!sc.length) return `<div class="rd-l"><b>Foto dell'articolo</b> <small class="rd-muted">nessuna foto: tra gli atleti citati non ne risulta una con una vittoria fotografata</small></div>`;
    return `<div class="rd-l"><b>Foto dell'articolo</b> <small class="rd-muted">messe dal sistema sotto il corridore di cui si parla: sposta la riga [[foto:N]] nel testo o toglile con la ✕</small></div>
      <div class="rd-fsel">${sc.map((f, i) => `<figure><img src="${esc(imgSrc(f.url))}" alt="" loading="lazy" onerror="this.style.opacity=.25"><b class="rd-fn">Foto ${i + 1}</b><input type="text" data-cr="${i}" value="${esc(f.credito)}" placeholder="Credito (fotografo)"><button type="button" data-fdel="${i}" title="Togli">✕</button></figure>`).join('')}</div>`;
  }
  async function fotoSalva(b) {
    const ta = document.querySelector('#ed-corpo');
    try { await api('/bozze/' + b.id, { method: 'PUT', body: ta ? { foto: b.foto, corpo: (b.corpo = ta.value) } : { foto: b.foto } }); } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); }
  }
  async function fotoLega() {
    const box = document.querySelector('.rd-foto'); const b = sel(); if (!box || !b) return;
    const ridisegna = () => { box.innerHTML = fotoHtml(b); fotoLega2(box, b, ridisegna); };
    ridisegna();
  }
  function fotoLega2(box, b, ridisegna) {
    box.querySelectorAll('[data-fdel]').forEach(x => { x.onclick = () => { const k = +x.dataset.fdel + 1; b.foto.splice(k - 1, 1); const ta = document.querySelector('#ed-corpo'); if (ta) ta.value = ta.value.replace(new RegExp(`\\n*\\[\\[foto:${k}\\]\\]\\n*`, 'g'), '\n\n').replace(/\[\[foto:(\d+)\]\]/g, (m, n) => +n > k ? `[[foto:${+n - 1}]]` : m); fotoSalva(b); ridisegna(); }; });
    box.querySelectorAll('[data-cr]').forEach(x => { x.onchange = () => { b.foto[+x.dataset.cr].credito = x.value; fotoSalva(b); }; });
  }

  // anteprima: come apparirebbe l'articolo a un lettore (usa i campi correnti, anche non salvati)
  function articolo(b) {
    const f = b.foto || [], usate = new Set();
    const fig = x => `<figure><img src="${esc(imgSrc(x.url))}" alt="${esc(x.didascalia || '')}" loading="lazy" onerror="this.parentNode.remove()">${(x.didascalia || x.credito) ? `<figcaption>${esc(x.didascalia || '')}${x.didascalia && x.credito ? ' · ' : ''}${x.credito ? 'Foto: ' + esc(x.credito) : ''}</figcaption>` : ''}</figure>`;
    const corpo = []; let par = [];
    const flush = () => { if (par.length) { corpo.push(`<p>${esc(par.join(' '))}</p>`); par = []; } };
    for (const r0 of String(b.corpo || '').replace(/\r/g, '').split('\n')) {
      const r = r0.trim(), m = r.match(/^\[\[foto:(\d+)\]\]$/);
      if (!r) { flush(); continue; }
      if (m) { flush(); const ft = f[+m[1] - 1]; if (ft) { usate.add(+m[1] - 1); corpo.push(fig(ft)); } continue; }
      if (/^##\s+/.test(r)) { flush(); corpo.push(`<h2>${esc(r.replace(/^##\s+/, ''))}</h2>`); continue; }
      par.push(r.replace(/\[\[foto:\d+\]\]/g, ''));
    }
    flush();
    const meta = [fmtData(b.aggiornato || b.creato), (b.tag || []).slice(0, 4).map(t => '#' + t).join(' ')].filter(Boolean).join(' · ');
    return `<div class="hx-panel rd-prev"><div class="rd-top"><span class="rd-chip s-${b.stato}">Anteprima di lettura</span><button type="button" class="admin-edit-btn" data-act="back">← Torna alla modifica</button></div>
      <article class="rd-art"><small class="rd-muted">${esc(meta)}</small><h1>${esc(b.titolo)}</h1><p class="lead">${esc(b.sommario)}</p>
      ${corpo.join('')}${f.map((x, i) => usate.has(i) ? '' : fig(x)).join('')}
      <footer>© Produzione riservata</footer></article></div>`;
  }

  function editor() {
    const b = sel();
    if (b && st.prev && b.stato !== 'in_generazione' && b.stato !== 'errore') { try { return articolo(b); } catch (e) { st.prev = false; if (typeof showToast === 'function') showToast('Anteprima non disponibile: ' + (e.message || e), 'error'); } }
    if (!b) return `<div class="hx-panel rd-empty"><h3>Anteprima</h3><p class="rd-muted">Scegli una bozza dall'elenco per leggerla, correggerla e approvarla. Nulla viene pubblicato sul sito.</p></div>`;
    if (b.stato === 'in_generazione') return `<div class="hx-panel"><h3>${esc(b.soggetto)}</h3><p>La bozza si sta scrivendo (può servire fino a 2 minuti con la ricerca web)…</p></div>`;
    if (b.stato === 'errore') return `<div class="hx-panel"><h3>${esc(b.soggetto)}</h3><div class="rd-err">${esc(b.errore || 'Errore sconosciuto')}</div><div class="rd-btns"><button type="button" class="admin-edit-btn" data-act="del">Elimina</button></div></div>`;
    const fonti = (b.fonti || []).map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titolo || f.url)}</a>${f.uso ? ` <small class="rd-muted">— ${esc(f.uso)}</small>` : ''}</li>`).join('');
    const dv = (b.da_verificare || []).map(x => `<li>${esc(x)}</li>`).join('');
    return `<div class="hx-panel rd-editor" data-id="${b.id}">
      <div class="rd-top"><span class="rd-chip s-${b.stato}">${STATI[b.stato]}</span><small class="rd-muted">${esc(TIPI[b.tipo])} · ${esc(b.soggetto)}</small></div>
      <label class="rd-l">Titolo<input id="ed-titolo" type="text" value="${esc(b.titolo)}"></label>
      <label class="rd-l">Sommario<textarea id="ed-sommario" rows="2">${esc(b.sommario)}</textarea></label>
      <div class="rd-foto" data-foto="${b.id}">${fotoHtml(b)}</div>
      <label class="rd-l">Testo <small id="ed-parole">${parole(b.corpo)} parole</small><textarea id="ed-corpo" rows="18">${esc(b.corpo)}</textarea></label>
      ${dv ? `<div class="rd-box warn"><b>Da verificare prima di pubblicare</b><ul>${dv}</ul></div>` : ''}
      <div class="rd-box"><b>Fonti</b><ul>${fonti || '<li class="rd-muted">Nessuna fonte esterna: solo i dati del sito.</li>'}</ul></div>
      <details class="rd-box"><summary>Dati usati dall'AI</summary><pre>${esc(JSON.stringify(b.dati, null, 1)).slice(0, 12000)}</pre></details>
      <div class="rd-btns">
        <button type="button" class="admin-edit-btn" data-act="prev">Anteprima</button>
        <button type="button" class="admin-edit-btn" data-act="save">Salva modifiche</button>
        <button type="button" class="admin-edit-btn ok" data-act="approve">${b.stato === 'approvata' ? 'Approvata ✓' : 'Approva'}</button>
        <button type="button" class="admin-edit-btn" data-act="discard">Scarta</button>
        <button type="button" class="admin-edit-btn" data-act="again">Rigenera</button>
        <button type="button" class="admin-edit-btn" data-act="del">Elimina</button>
        <button type="button" class="admin-edit-btn" disabled title="La pubblicazione si attiva dopo la prova">Pubblica (non ancora attiva)</button>
      </div></div>`;
  }

  function paint(soloLista) {
    const w = document.querySelector('.rd-wrap');
    if (soloLista && w) { // aggiornamento durante la scrittura: non toccare i campi che si stanno compilando
      w.querySelector('.rd-list').innerHTML = lista();
      const b = sel(); const ed = w.querySelector('.rd-ed');
      if (b && ed && !ed.querySelector('textarea:focus,input:focus') && (b.stato !== 'in_generazione' || !ed.querySelector('.rd-editor'))) ed.innerHTML = editor();
      lega();
      return;
    }
    setPage(`<div class="hx-wrap rd-wrap">
      <div class="rs-head"><h1>Redazione</h1><span class="rs-cnt">articoli privati · nessuna pubblicazione</span></div>
      <div class="rd-bar"><button type="button" class="admin-edit-btn rd-go" id="rd-auto">${Date.now() < st.attesa ? 'Sto scrivendo…' : 'Scrivi gli articoli'}</button>
        <small class="rd-muted">Prepara da solo gli articoli dei campionati e delle gare importanti di questi giorni (e il punto della settimana il lunedì). Lo fa anche in automatico ogni mezz'ora.</small>
        <button type="button" class="admin-edit-btn" id="rd-stagione" title="Un articolo per ciascuna delle 10 categorie">Articoli di fine stagione</button>
        <button type="button" class="admin-edit-btn" id="rd-squadre" title="Un articolo sulle squadre per ciascuna categoria">Articoli sulle squadre</button>
        <button type="button" class="admin-edit-btn" id="rd-altro">${st.altro ? 'Chiudi' : 'Un altro articolo…'}</button></div>
      <div class="hx-panel rd-ask"><h3>Scrivi all'AI cosa vuoi realizzare</h3>
        <textarea id="rd-richiesta" rows="3" maxlength="2000" placeholder="Es. Un articolo sulla stagione di Nicolas Milesi, dai primi anni a oggi · Il confronto tra le squadre Juniores di quest'anno · Un'anteprima della prossima stagione per gli Allievi">${esc(st.richiesta || '')}</textarea>
        <div class="rd-btns"><button type="button" class="admin-edit-btn rd-go" id="rd-invia">Invia alla redazione</button>
          <label class="rd-c"><input id="rd-richiesta-web" type="checkbox"> Cerca anche sul web</label>
          <small class="rd-muted">L'AI decide da sola quali dati del sito usare (gare, atleti, stagione) e scrive la bozza qui sotto.</small></div></div>
      <div class="rd-form rd-more" ${st.altro ? '' : 'hidden'}>${form()}</div>
      <div class="rd-grid"><div class="rd-side"><div class="rd-list">${lista()}</div></div><div class="rd-ed">${editor()}</div></div></div>`);
    lega();
  }

  function lega() {
    const w = document.querySelector('.rd-wrap'); if (!w) return;
    let tm = null;
    const t = w.querySelector('#rd-tipo'); if (t) t.onchange = async () => { st.tipo = t.value; st.pick = null; st.q = ''; await cercaOra(); w.querySelector('.rd-form').innerHTML = form(); lega(); };
    const q = w.querySelector('#rd-q'); if (q) q.oninput = () => { clearTimeout(tm); tm = setTimeout(async () => { st.q = q.value; await cercaOra(); const pos = q.selectionStart; w.querySelector('.rd-form').innerHTML = form(); lega(); const n = w.querySelector('#rd-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} }, 350); };
    w.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { const r = st.cerca.find(x => x.id === b.dataset.pick); st.pick = r || null; w.querySelector('.rd-form').innerHTML = form(); lega(); }; });
    const g = w.querySelector('#rd-genera'); if (g) g.onclick = genera;
    const au = w.querySelector('#rd-auto'); if (au) au.onclick = async () => { try { await api('/auto', { method: 'POST', body: {} }); st.attesa = Date.now() + 6 * 60000; if (typeof showToast === 'function') showToast('Sto scrivendo: gli articoli compaiono a sinistra man mano'); } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); } await carica(); paint(); };
    const sg = w.querySelector('#rd-stagione'); if (sg) sg.onclick = async () => { if (!confirm('Scrivere un articolo di fine stagione per ogni categoria (10 articoli, circa 15-20 minuti)?')) return; try { const r = await api('/stagione', { method: 'POST', body: { web: false } }); st.attesa = Date.now() + 25 * 60000; if (typeof showToast === 'function') showToast(r.avviati ? `Sto scrivendo ${r.avviati} articoli: compaiono a sinistra man mano` : 'Sono già tutti presenti'); } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); } await carica(); paint(); };
    const sq = w.querySelector('#rd-squadre'); if (sq) sq.onclick = async () => { if (!confirm('Scrivere un articolo sulle squadre per ogni categoria (10 articoli, circa 15 minuti)?')) return; try { const r = await api('/stagione', { method: 'POST', body: { tipo: 'squadre', web: false } }); st.attesa = Date.now() + 25 * 60000; if (typeof showToast === 'function') showToast(r.avviati ? `Sto scrivendo ${r.avviati} articoli sulle squadre` : 'Sono già tutti presenti'); } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); } await carica(); paint(); };
    const iv = w.querySelector('#rd-invia'); if (iv) iv.onclick = async () => { const ta = w.querySelector('#rd-richiesta'); st.richiesta = ta.value; try { const r = await api('/richiesta', { method: 'POST', body: { testo: ta.value, web: w.querySelector('#rd-richiesta-web').checked } }); st.sel = r.id; st.richiesta = ''; st.attesa = Date.now() + 6 * 60000; } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); return; } await carica(); paint(); };
    const al = w.querySelector('#rd-altro'); if (al) al.onclick = () => { st.altro = !st.altro; w.querySelector('.rd-more').hidden = !st.altro; al.textContent = st.altro ? 'Chiudi' : 'Un altro articolo…'; };
    w.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => { st.sel = b.dataset.open; st.prev = false; paint(); }; });
    const bk = w.querySelector('.rd-prev [data-act="back"]'); if (bk) bk.onclick = () => azione('back');
    const ed = w.querySelector('.rd-editor');
    if (ed) fotoLega();
    if (ed) {
      const corpo = ed.querySelector('#ed-corpo'); if (corpo) corpo.oninput = () => { ed.querySelector('#ed-parole').textContent = parole(corpo.value) + ' parole'; };
      ed.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => azione(b.dataset.act); });
    }
    const evt = w.querySelector('.rd-ed [data-act="del"]'); if (evt && !ed) evt.onclick = () => azione('del');
  }

  async function genera() {
    if (st.tipo !== 'settimana' && !st.pick) { st.msg = 'Scegli prima la gara o l\'atleta dall\'elenco.'; document.querySelector('.rd-form').innerHTML = form(); lega(); return; }
    const w = document.querySelector('.rd-wrap');
    const body = { tipo: st.tipo, id: st.pick ? st.pick.id : '', fine: (w.querySelector('#rd-fine') || {}).value || '', web: w.querySelector('#rd-web').checked,
      link: w.querySelector('#rd-link').value.split('\n').map(s => s.trim()).filter(Boolean), indicazioni: w.querySelector('#rd-ind').value };
    st.busy = true; st.msg = ''; w.querySelector('.rd-form').innerHTML = form(); lega();
    try {
      const r = await api('/genera', { method: 'POST', body });
      st.sel = r.id; st.msg = 'Bozza avviata: compare qui sotto appena è pronta.';
    } catch (e) { st.msg = 'Errore: ' + (e.message || e); }
    st.busy = false; await carica(); paint();
  }

  async function azione(a) {
    const b = sel(); if (!b) return;
    const ed = document.querySelector('.rd-editor');
    if (a === 'back') { st.prev = false; paint(); return; }
    if (a === 'prev') { if (ed) { b.titolo = ed.querySelector('#ed-titolo').value; b.sommario = ed.querySelector('#ed-sommario').value; b.corpo = ed.querySelector('#ed-corpo').value; } st.prev = true; paint(); return; }
    try {
      if (a === 'del') { if (!confirm('Eliminare questa bozza?')) return; await api('/bozze/' + b.id, { method: 'DELETE' }); st.sel = null; }
      else if (a === 'again') {
        const p = b.parametri || {};
        if (b.tipo === 'libero') await api('/richiesta', { method: 'POST', body: { testo: p.richiesta, web: p.web, link: p.link } });
        else await api('/genera', { method: 'POST', body: { tipo: b.tipo, id: p.id, fine: p.fine, web: p.web, link: p.link, indicazioni: p.indicazioni } });
      } else {
        const body = ed ? { titolo: ed.querySelector('#ed-titolo').value, sommario: ed.querySelector('#ed-sommario').value, corpo: ed.querySelector('#ed-corpo').value } : {};
        if (a === 'approve') body.stato = 'approvata'; if (a === 'discard') body.stato = 'scartata'; if (a === 'save' && b.stato === 'approvata') body.stato = 'bozza';
        await api('/bozze/' + b.id, { method: 'PUT', body });
        if (typeof showToast === 'function') showToast(a === 'approve' ? 'Bozza approvata' : a === 'discard' ? 'Bozza scartata' : 'Modifiche salvate');
      }
    } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); }
    await carica(); paint();
  }

  async function render() {
    if (!globalData) { setPage('<div class="loading-bar"></div>'); return; }
    const u = authUser();
    if (!u || u.role !== 'admin') { setPage('<div class="hx-wrap"><div class="hx-none">Area riservata agli amministratori.</div></div>'); return; }
    setPageMeta('Redazione AI (riservata)', 'Area riservata.');
    st.msg = ''; await Promise.all([carica(), cercaOra()]);
    if (!sel()) { const p = st.bozze.find(b => b.stato === 'bozza' || b.stato === 'approvata'); if (p) st.sel = p.id; }
    paint();
  }
  window.renderRedazione = render;
})();
