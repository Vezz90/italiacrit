/* ============================================================
   ICS — Redazione AI (privata, solo amministratori)
   Prepara bozze di articoli dai dati del sito, dal web e da pagine ufficiali. Non pubblica nulla:
   si genera, si rilegge, si corregge e si approva. Server: server/redazione.js
   ============================================================ */
'use strict';

(function () {
  const TIPI = { gara: 'Gara (resoconto o anteprima)', settimana: 'Il punto della settimana', atleta: 'Profilo atleta', stagione: 'Fine stagione per categoria', squadre: 'Fine stagione: le squadre', libero: 'Richiesta libera' };
  const STATI = { in_generazione: 'In scrittura…', bozza: 'Bozza', approvata: 'Approvata', pubblicata: 'Pubblicata', scartata: 'Scartata', errore: 'Errore' };
  const st = { spOcc: new Map(), spunti: null, spErr: '', prev: false, cand: {}, attesa: 0, altro: false, bozze: [], sel: null, tipo: 'gara', pick: null, cerca: [], q: '', timer: null, busy: false, msg: '' };
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

  // scelta dei corridori sulle cui pagine pubblicare
  function pubPanel() {
    const b = sel(); if (!b || st.pub !== b.id || st.prev) return '';
    const l = st.pubList;
    return `<div class="hx-panel rd-pub"><h3>Pubblica sulle pagine dei corridori</h3>${!l ? '<p class="rd-muted">Cerco i corridori di cui parla l\'articolo…</p>' : `
      <p class="rd-muted">L'articolo avrà una pagina pubblica e comparirà nella sezione «Articoli» della pagina di ogni corridore che lasci spuntato. Le modifiche che fai dopo diventano subito pubbliche.</p>
      <div class="rd-publ">${l.map(a => `<label><input type="checkbox" data-pa="${esc(a.id)}" ${a.on ? 'checked' : ''}> ${esc(a.nome)} <small class="rd-muted">${a.nel_testo ? 'citato nel testo' : 'in classifica/risultati'}${a.rango ? ' · ' + a.rango + '°' : ''}</small></label>`).join('') || '<small class="rd-muted">Nessun corridore riconosciuto: l\'articolo avrà solo la sua pagina.</small>'}</div>
      <div class="rd-btns"><button type="button" class="admin-edit-btn ok" data-act="pubOk">Pubblica ora</button><button type="button" class="admin-edit-btn" data-act="pubNo">Annulla</button></div>`}</div>`;
  }
  function editor() { return editorBase() + pubPanel(); }
  function editorBase() {
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
        ${b.stato === 'pubblicata'
          ? `<a class="admin-edit-btn ok" href="/articolo/${esc(b.slug)}" target="_blank" rel="noopener">Pubblicato ✓ · apri la pagina</a><button type="button" class="admin-edit-btn" data-act="pubblica">Cambia i corridori</button><button type="button" class="admin-edit-btn" data-act="ritira">Ritira dal sito</button>`
          : `<button type="button" class="admin-edit-btn ok" data-act="pubblica">Pubblica sulle pagine dei corridori</button>`}
      </div></div>`;
  }

  // costi e impostazioni dell'AI: interruttori, limite mensile, consumi registrati
  function costiPanel() {
    const k = st.costi; if (!k) return '<div class="hx-panel rd-costi"><h3>Costi e impostazioni AI</h3><small class="rd-muted">Non disponibili: ricarica la pagina.</small></div>';
    const c = k.config, pct = c.limite_mensile_usd > 0 ? Math.min(100, Math.round(k.spesa_mese / c.limite_mensile_usd * 100)) : 100;
    const col = pct >= 100 ? '#dc2626' : pct >= 80 ? '#d97706' : '#16a34a';
    const usd = n => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
    return `<div class="hx-panel rd-costi"><h3>Costi e impostazioni AI <small class="rd-muted">modello ${esc(k.modello)} · stime in dollari</small></h3>
      ${k.chiave ? '' : '<div class="rd-err">Chiave ANTHROPIC_API_KEY non configurata sul server: nessuna chiamata possibile.</div>'}
      <div class="rd-btns" style="gap:14px;align-items:center;flex-wrap:wrap">
        <label class="rd-c"><input type="checkbox" id="cs-ai" ${c.ai_attiva ? 'checked' : ''}> AI attiva</label>
        <label class="rd-c"><input type="checkbox" id="cs-auto" ${c.auto_attiva ? 'checked' : ''}> Scrittura automatica: 3 volte al giorno (${(c.auto_orari || []).map(h => h + ':00').join(', ')})</label>
        <label class="rd-c">Limite mensile <input type="number" id="cs-lim" min="0" max="1000" step="1" value="${c.limite_mensile_usd}" style="width:70px"> $</label>
        <label class="rd-c">Ricerca web (scrittura automatica)
          <select id="cs-web">${[[0, 'su tutte le gare'], [1, 'solo gare con un peso (regionali, nazionali…)'], [3, 'solo campionati italiani'], [99, 'mai']].map(([v, t]) => `<option value="${v}" ${Number(c.web_auto_da_imp) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button type="button" class="admin-edit-btn" id="cs-salva">Salva</button></div>
      <div style="margin:10px 0 4px;font-size:.88rem"><b>${usd(k.spesa_mese)}</b> su ${usd(c.limite_mensile_usd)} questo mese · ${pct}% della soglia, restano ${usd(Math.max(0, c.limite_mensile_usd - k.spesa_mese))} (${k.richieste_mese} richieste${pct >= 100 ? ' · LIMITE RAGGIUNTO: le chiamate sono bloccate' : ''})</div>
      <div style="height:8px;background:var(--border-subtle,#ddd);border-radius:4px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${col}"></div></div>
      <details class="rd-box"><summary>Ultime richieste e mesi precedenti</summary>
        <div style="overflow-x:auto"><table style="width:100%;font-size:.8rem;border-collapse:collapse">
          <tr><th align="left">Mese</th><th align="right">Richieste</th><th align="right">Token in</th><th align="right">Token out</th><th align="right">Costo</th></tr>
          ${k.mesi.map(m => `<tr><td>${esc(m.mese)}</td><td align="right">${m.richieste}</td><td align="right">${m.token_in}</td><td align="right">${m.token_out}</td><td align="right">${usd(m.costo_usd)}</td></tr>`).join('') || '<tr><td colspan="5" class="rd-muted">Ancora nessuna richiesta registrata.</td></tr>'}
        </table>
        <table style="width:100%;font-size:.78rem;border-collapse:collapse;margin-top:10px">
          <tr><th align="left">Quando</th><th align="left">Modello</th><th align="right">Token in/out</th><th align="right">Ricerche</th><th align="right">Costo</th><th align="left">Esito</th></tr>
          ${k.ultime.map(u => `<tr><td>${fmtData(u.ts)}</td><td>${esc(u.modello)}</td><td align="right">${u.token_in}/${u.token_out}</td><td align="right">${u.ricerche}</td><td align="right">${usd(u.costo_usd)}</td><td>${esc(u.esito)}</td></tr>`).join('')}
        </table></div>
        <small class="rd-muted">Prezzi usati per la stima ($ per milione di token): ${Object.entries(c.prezzi).map(([m, p]) => `${esc(m)} ${p.in} in / ${p.out} out`).join(' · ')} · ricerca web ${c.prezzo_ricerca_usd} $ l'una. Sono stime: verifica sul listino Anthropic e sul saldo della console.</small></details></div>`;
  }
  async function caricaCosti() { try { st.costi = await api('/costi'); } catch (e) { st.costi = null; } }

  /* ---------- L'ufficio: gli agenti alle scrivanie, calcolati dallo stato vero della redazione ---------- */
  const UFF_CSS = `
.rd-ufficio{margin:0 0 16px}
.rd-uff-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 8px}
.rd-uff-head h3{margin:0;font-size:1rem}
.rd-uff-head small{opacity:.7}
.rd-uff-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:10px}
.rd-sc{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 8px 10px;border:1px solid rgba(128,128,128,.28);border-radius:10px;background:rgba(128,128,128,.07);text-align:center;transition:border-color .3s,background .3s}
.rd-sc.lavora{border-color:#16a34a;background:rgba(22,163,74,.09)}
.rd-sc.errore{border-color:#dc2626;background:rgba(220,38,38,.08)}
.rd-sc.vuoto{border-style:dashed}
.rd-pill{position:absolute;top:8px;right:8px;font-size:.66rem;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;background:rgba(128,128,128,.2)}
.rd-sc.lavora .rd-pill{background:#16a34a;color:#fff}
.rd-sc.errore .rd-pill{background:#dc2626;color:#fff}
.rd-om{width:100%;max-width:150px;height:auto;color:inherit}
.rd-sc-nome{font-weight:700;font-size:.92rem}
.rd-sc-ruolo{font-size:.72rem;opacity:.65}
.rd-sc-fumetto{margin-top:6px;font-size:.78rem;line-height:1.3;min-height:2.6em;padding:5px 8px;border-radius:8px;background:rgba(128,128,128,.14);width:100%;box-sizing:border-box;overflow-wrap:anywhere}
.rd-om *{transform-box:fill-box}
.lavora .om-bs{animation:om-tip .45s ease-in-out infinite alternate}
.lavora .om-bd{animation:om-tip .45s .22s ease-in-out infinite alternate}
.lavora .om-sch{animation:om-blink 1.1s steps(2,jump-none) infinite}
.lavora .om-testa{animation:om-look 3s ease-in-out infinite}
.riposa .om-testa{animation:om-nod 4.5s ease-in-out infinite}
.om-z{font:700 11px sans-serif;fill:currentColor;opacity:0}
.riposa .om-z{animation:om-z 3.6s ease-in-out infinite}
.riposa .om-z2{animation-delay:1.2s}
@keyframes om-tip{to{transform:translateY(-3px)}}
@keyframes om-blink{50%{opacity:.55}}
@keyframes om-look{0%,100%{transform:translateX(0)}50%{transform:translateX(2px)}}
@keyframes om-nod{0%,100%{transform:rotate(0)}50%{transform:rotate(4deg)}}
@keyframes om-z{0%{opacity:0;transform:translate(0,4px)}30%{opacity:.7}100%{opacity:0;transform:translate(6px,-10px)}}
.rd-sp{margin:0 0 16px}
.rd-spl{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin:8px 0}
.rd-spc{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid rgba(128,128,128,.28);border-radius:10px;background:rgba(128,128,128,.06)}
.rd-spc.usato{border-color:#16a34a}
.rd-spc.scartato{opacity:.65}
.rd-spc-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rd-tag{font-size:.66rem;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;background:rgba(101,163,13,.22)}
.rd-tag.rd-usato{background:#16a34a;color:#fff}
.rd-spg{display:flex;flex-wrap:wrap;gap:5px}
.rd-spg span{font-size:.72rem;padding:2px 7px;border-radius:6px;background:rgba(128,128,128,.14)}
.rd-spg i{opacity:.7;font-style:normal}
.rd-sp-sp{margin:0;font-size:.84rem;line-height:1.4;padding:6px 8px;border-radius:8px;background:rgba(101,163,13,.1)}
@media (prefers-reduced-motion:reduce){.rd-om *{animation:none!important}}`;

  function prossimoGiro(orari) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
      const ora = Number(p.hour) % 24, hs = (orari || []).map(Number).sort((a, b) => a - b);
      if (!hs.length) return '';
      const h = hs.find(x => x > ora);
      return h != null ? `oggi alle ${h}:00` : `domani alle ${hs[0]}:00`;
    } catch (_) { return ''; }
  }

  function agenti() {
    const k = st.costi, cfg = k && k.config, ora = Date.now();
    const attive = st.bozze.filter(b => b.stato === 'in_generazione' && ora - Date.parse(b.creato) < 12 * 60000);
    const errori = st.bozze.filter(b => b.stato === 'errore' && ora - Date.parse(b.aggiornato || b.creato) < 30 * 60000);
    const usd = n => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
    const scrive = (nome, ruolo, colore, capelli, tipi, riposo) => {
      const a = attive.filter(b => tipi.includes(b.tipo)), e = errori.filter(b => tipi.includes(b.tipo));
      if (a.length) return { nome, ruolo, colore, capelli, stato: 'lavora', testo: `Scrive: ${a[0].soggetto || 'un articolo'}${a.length > 1 ? ` (+${a.length - 1} in coda)` : ''}` };
      if (e.length) return { nome, ruolo, colore, capelli, stato: 'errore', testo: `Non è riuscito: ${e[0].soggetto || 'ultima bozza'}` };
      return { nome, ruolo, colore, capelli, stato: 'riposa', testo: riposo };
    };
    const cap = (() => {
      const auto = attive.some(b => b.parametri && b.parametri.auto);
      const base = { nome: 'Caporedattore', ruolo: 'Giri automatici', colore: '#7c3aed', capelli: '#4b5563' };
      if (auto) return { ...base, stato: 'lavora', testo: 'Coordina il giro automatico' };
      if (!k) return { ...base, stato: 'riposa', testo: 'Impostazioni non disponibili' };
      if (!cfg.ai_attiva) return { ...base, stato: 'riposa', testo: 'AI spenta: nessuno scrive' };
      if (!cfg.auto_attiva) return { ...base, stato: 'riposa', testo: 'Scrittura automatica spenta. Si lavora a mano.' };
      return { ...base, stato: 'riposa', testo: `Prossimo giro ${prossimoGiro(cfg.auto_orari)}` };
    })();
    const ricerca = (() => {
      const base = { nome: 'Ricercatore', ruolo: 'Notizie dal web', colore: '#0ea5e9', capelli: '#1f2937' };
      const a = attive.filter(b => b.parametri && b.parametri.web);
      if (a.length) return { ...base, stato: 'lavora', testo: `Cerca sul web: ${a[0].soggetto || 'contesto'}` };
      if (cfg && Number(cfg.web_auto_da_imp) === 99) return { ...base, stato: 'riposa', testo: 'Ricerca automatica: mai' };
      return { ...base, stato: 'riposa', testo: 'Nessuna ricerca in corso' };
    })();
    const cassa = (() => {
      const base = { nome: 'Cassiere', ruolo: 'Costi e limite', colore: '#d97706', capelli: '#7c2d12' };
      if (!k) return { ...base, stato: 'riposa', testo: 'Costi non disponibili' };
      const lim = Number(cfg.limite_mensile_usd) || 0, pct = lim > 0 ? Math.round(k.spesa_mese / lim * 100) : 100;
      const u = k.ultime && k.ultime[0], ultima = u ? ` · ultima: ${u.uso || 'chiamata'}, ${fmtData(u.ts).split(', ').pop() || ''}` : '';
      if (pct >= 100) return { ...base, stato: 'errore', testo: `Limite raggiunto: ${usd(k.spesa_mese)} su ${usd(lim)}. Chiamate bloccate.` };
      return { ...base, stato: attive.length ? 'lavora' : 'riposa', testo: `${usd(k.spesa_mese)} su ${usd(lim)} (${pct}%)${ultima}` };
    })();
    return [
      cap,
      scrive('Cronista', 'Gare e punto della settimana', '#16a34a', '#78350f', ['gara', 'settimana'], 'Aspetta una gara da raccontare'),
      scrive('Cronista di stagione', 'Fine stagione e squadre', '#2563eb', '#111827', ['stagione', 'squadre'], 'Aspetta la fine stagione'),
      scrive('Profilista', 'Schede e storie degli atleti', '#db2777', '#92400e', ['atleta'], 'Nessun atleta da raccontare'),
      scrive('Inviato speciale', 'Richieste libere', '#0d9488', '#374151', ['libero'], 'Aspetta una richiesta libera'),
      ricerca, cassa,
      (() => {
        const base = { nome: 'Analista', ruolo: 'Spunti dai dati', colore: '#65a30d', capelli: '#422006' };
        const occ = st.spOcc.size ? [...st.spOcc.values()][0] : null, sp = st.spunti;
        if (occ) return { ...base, stato: 'lavora', testo: occ };
        if (st.spErr) return { ...base, stato: 'errore', testo: st.spErr };
        if (!sp) return { ...base, stato: 'riposa', testo: 'Spunti non disponibili' };
        const n = sp.spunti.filter(s => s.stato === 'nuovo').length;
        return { ...base, stato: 'riposa', testo: n ? `${n} spunt${n === 1 ? 'o pronto' : 'i pronti'} da leggere` : 'Nessuno spunto forte in questo periodo' };
      })()
    ];
  }

  /* ---------- Spunti dell'Analista: calcolati dai dati con regole fisse, l'AI li spiega soltanto ---------- */
  const SP_TIPI = { vittorie: 'Vittorie', podi: 'Serie di podi', crescita: 'Progressione', costanza: 'Costanza', squadra_vittorie: 'Squadra', squadra_crescita: 'Squadra in crescita', rivalita: 'Rivalità' };
  async function caricaSpunti() { try { st.spunti = await api('/spunti'); st.spErr = ''; } catch (e) { st.spunti = null; st.spErr = 'Spunti non disponibili'; } }
  function spuntiPanel() {
    const sp = st.spunti, occ = st.spOcc.size > 0;
    if (!sp) return `<div class="hx-panel rd-sp"><h3>Spunti dell'Analista</h3><small class="rd-muted">${esc(st.spErr || 'Caricamento…')}</small></div>`;
    const card = s => `<div class="rd-spc ${s.stato}">
      <div class="rd-spc-top"><span class="rd-tag">${esc(SP_TIPI[s.tipo] || s.tipo)}</span><small class="rd-muted">${esc(s.categoria)} · ${esc(fmtGiorno(s.periodo.dal))} – ${esc(fmtGiorno(s.periodo.al))}</small>${s.stato === 'usato' ? '<span class="rd-tag rd-usato">Bozza creata</span>' : ''}</div>
      <b>${esc(s.titolo)}</b>
      <small class="rd-muted">${esc(s.motivo)}</small>
      ${(s.gare || []).length ? `<div class="rd-spg">${s.gare.slice(0, 4).map(g => `<span>${esc(g.nome)} <i>${esc(fmtGiorno(g.data))}${typeof g.pos === 'number' ? ' · ' + g.pos + '°' : ' · ' + esc(g.pos)}</i></span>`).join('')}${s.gare.length > 4 ? `<span>+${s.gare.length - 4}</span>` : ''}</div>` : ''}
      ${s.spiegazione ? `<p class="rd-sp-sp">${esc(s.spiegazione)}</p>` : ''}
      <div class="rd-btns">
        ${s.stato === 'scartato' ? `<button type="button" class="admin-edit-btn" data-sp="ripristina" data-id="${esc(s.id)}" ${occ ? 'disabled' : ''}>Ripristina</button>` : `
        ${s.spiegazione ? '' : `<button type="button" class="admin-edit-btn" data-sp="spiega" data-id="${esc(s.id)}" ${occ ? 'disabled' : ''} title="Una richiesta breve all'AI, senza ricerca web">Spiega (AI)</button>`}
        ${s.stato === 'usato' && s.bozza_id ? `<button type="button" class="admin-edit-btn" data-open="${esc(s.bozza_id)}">Apri la bozza</button>` : `<button type="button" class="admin-edit-btn rd-go" data-sp="articolo" data-id="${esc(s.id)}" ${occ ? 'disabled' : ''}>Scrivi l'articolo</button>`}
        <button type="button" class="admin-edit-btn" data-sp="scarta" data-id="${esc(s.id)}" ${occ ? 'disabled' : ''}>Scarta</button>`}
      </div></div>`;
    const buoni = sp.spunti.filter(s => s.stato !== 'scartato'), scart = sp.spunti.filter(s => s.stato === 'scartato');
    return `<div class="hx-panel rd-sp"><div class="rd-uff-head"><h3>Spunti dell'Analista</h3>
      <small>${sp.fine ? 'dati fino al ' + esc(fmtGiorno(sp.fine)) + ' · ' : ''}scelti con regole fisse sui risultati del sito, senza AI</small>
      <button type="button" class="admin-edit-btn" data-sp="calcola" ${occ ? 'disabled' : ''}>Aggiorna</button></div>
      ${buoni.length ? `<div class="rd-spl">${buoni.map(card).join('')}</div>` : '<small class="rd-muted">Nessuno spunto forte negli ultimi 28 giorni.</small>'}
      ${scart.length ? `<details class="rd-box"><summary>${scart.length} scartat${scart.length === 1 ? 'o' : 'i'}</summary><div class="rd-spl">${scart.map(card).join('')}</div></details>` : ''}
      <small class="rd-muted">Calcolati sui risultati presenti nel sito: se una gara non è stata importata, il conteggio può essere più basso del reale.</small></div>`;
  }
  const fmtGiorno = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); } catch (_) { return iso; } };
  function legaSpunti() {
    const el = document.querySelector('.rd-spunti'); if (!el) return;
    const ridisegna = () => { el.innerHTML = spuntiPanel(); const u = document.querySelector('.rd-ufficio'); if (u) u.innerHTML = ufficio(); };
    const errore = e => { if (typeof showToast === 'function') showToast((e && e.message) || 'Errore', 'error'); };
    el.onclick = async ev => {
      const ap = ev.target.closest('[data-open]'); if (ap) { st.sel = ap.dataset.open; st.prev = false; paint(); return; }
      const b = ev.target.closest('[data-sp]'); if (!b || st.spOcc.size) return;
      const act = b.dataset.sp, id = b.dataset.id, s = st.spunti && st.spunti.spunti.find(x => x.id === id);
      const nomi = { calcola: 'Rilegge i risultati per trovare gli spunti', spiega: `Spiega: ${s ? s.titolo : 'uno spunto'}`, articolo: `Prepara la bozza: ${s ? s.titolo : 'uno spunto'}`, scarta: 'Mette da parte uno spunto', ripristina: 'Rimette in lista uno spunto' };
      st.spOcc.set(id || 'calcola', nomi[act] || 'Lavora'); ridisegna();
      try {
        if (act === 'calcola') st.spunti = await api('/spunti/calcola', { method: 'POST' });
        else if (act === 'spiega') { await api(`/spunti/${encodeURIComponent(id)}/spiega`, { method: 'POST' }); await caricaSpunti(); }
        else if (act === 'articolo') { const r = await api(`/spunti/${encodeURIComponent(id)}/articolo`, { method: 'POST', body: {} }); st.sel = r.id; st.attesa = Date.now() + 6 * 60000; await Promise.all([carica(), caricaSpunti()]); st.spOcc.clear(); paint(); return; }
        else { await api(`/spunti/${encodeURIComponent(id)}/stato`, { method: 'POST', body: { stato: act === 'scarta' ? 'scartato' : 'nuovo' } }); await caricaSpunti(); }
      } catch (e) { errore(e); }
      st.spOcc.clear(); ridisegna();
    };
  }

  function omino(d) {
    const vuoto = d.stato === 'vuoto';
    return `<svg class="rd-om" viewBox="0 0 140 110" role="img" aria-label="${esc(d.nome)}: ${esc(d.testo)}">
      <ellipse cx="70" cy="105" rx="54" ry="4" fill="currentColor" opacity=".08"/>
      ${vuoto ? '<text x="52" y="50" font-size="26" font-family="sans-serif" fill="currentColor" opacity=".3">?</text>' : `
      <rect x="40" y="56" width="32" height="26" rx="9" fill="${d.colore}"/>
      <g class="om-testa"><circle cx="56" cy="44" r="12" fill="#f1c9a5"/><path d="M44 42c1-10 8-14 14-13 7 1 11 7 10 13-4-5-8-6-12-6-4 0-9 2-12 6z" fill="${d.capelli}"/></g>
      <text class="om-z" x="68" y="34">z</text><text class="om-z om-z2" x="72" y="26">z</text>
      <rect class="om-bs" x="34" y="66" width="9" height="15" rx="4" fill="${d.colore}"/>
      <rect class="om-bd" x="68" y="66" width="9" height="15" rx="4" fill="${d.colore}"/>`}
      <rect x="22" y="78" width="96" height="7" rx="2" fill="#8b6f4e"/>
      <rect x="28" y="85" width="5" height="18" fill="#6f5a40"/><rect x="107" y="85" width="5" height="18" fill="#6f5a40"/>
      <rect x="38" y="75" width="30" height="3" rx="1" fill="#9ca3af"/>
      <rect x="82" y="55" width="30" height="21" rx="3" fill="#1f2937"/>
      <rect class="om-sch" x="85" y="58" width="24" height="15" rx="1.5" fill="${d.stato === 'lavora' ? '#38bdf8' : d.stato === 'errore' ? '#f87171' : '#374151'}"/>
      <rect x="94" y="76" width="6" height="2" fill="#1f2937"/>
      ${d.stato === 'lavora' ? '<rect x="88" y="62" width="12" height="2" fill="#fff" opacity=".7"/><rect x="88" y="66" width="16" height="2" fill="#fff" opacity=".5"/>' : ''}
      ${vuoto ? '<rect x="52" y="30" width="36" height="18" rx="3" fill="none" stroke="currentColor" stroke-dasharray="3 2" opacity=".4"/>' : ''}
    </svg>`;
  }

  function ufficio() {
    const ag = agenti(), n = ag.filter(a => a.stato === 'lavora').length;
    const ETI = { lavora: 'Al lavoro', riposa: 'Libero', errore: 'Problema', vuoto: 'Libero' };
    return `<div class="rd-uff-head"><h3>L'ufficio</h3><small>${n ? `${n} al lavoro adesso` : 'tutti fermi, nessuna bozza in scrittura'} · si aggiorna da solo</small></div>
      <div class="rd-uff-grid">${ag.map(d => `<div class="rd-sc ${d.stato}"><span class="rd-pill">${d.stato === 'vuoto' ? 'Posto libero' : ETI[d.stato]}</span>${omino(d)}
        <div class="rd-sc-nome">${esc(d.nome)}</div><div class="rd-sc-ruolo">${esc(d.ruolo)}</div><div class="rd-sc-fumetto">${esc(d.testo)}</div></div>`).join('')}</div>`;
  }

  function tickUfficio() {
    clearTimeout(st.tu);
    if (!document.querySelector('.rd-wrap')) return;
    st.tu = setTimeout(async () => {
      if (document.querySelector('.rd-wrap') && !document.hidden) {
        const firma = () => st.bozze.map(b => b.id + b.stato).join();
        const prima = firma();
        await Promise.all([carica(), caricaCosti()]);
        const el = document.querySelector('.rd-ufficio'); if (el) el.innerHTML = ufficio();
        if (firma() !== prima) paint(true);
      }
      tickUfficio();
    }, 8000);
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
      <div class="rd-ufficio">${ufficio()}</div>
      <div class="rd-spunti">${spuntiPanel()}</div>
      <div class="rd-costiwrap">${costiPanel()}</div>
      <div class="rd-bar"><button type="button" class="admin-edit-btn rd-go" id="rd-auto">${Date.now() < st.attesa ? 'Sto scrivendo…' : 'Scrivi gli articoli'}</button>
        <small class="rd-muted">Prepara da solo gli articoli dei campionati e delle gare importanti di questi giorni (e il punto della settimana il lunedì). Lo fa anche in automatico 3 volte al giorno (mattina, pranzo e sera), solo se l'interruttore «Scrittura automatica» è acceso.</small>
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
    legaSpunti();
    let tm = null;
    const cs = w.querySelector('#cs-salva'); if (cs) cs.onclick = async () => {
      try {
        await api('/config', { method: 'PUT', body: { ai_attiva: w.querySelector('#cs-ai').checked, auto_attiva: w.querySelector('#cs-auto').checked, limite_mensile_usd: Number(w.querySelector('#cs-lim').value), web_auto_da_imp: Number(w.querySelector('#cs-web').value) } });
        await caricaCosti(); w.querySelector('.rd-costiwrap').innerHTML = costiPanel(); lega();
        if (typeof showToast === 'function') showToast('Impostazioni AI salvate');
      } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); }
    };
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
    w.querySelectorAll('.rd-pub [data-act]').forEach(x => { x.onclick = () => azione(x.dataset.act); });
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
    if (a === 'pubNo') { st.pub = null; paint(); return; }
    if (a === 'pubblica') {
      st.pub = b.id; st.pubList = null; paint();
      try {
        const r = await api('/atleti/' + b.id); const gia = new Set(r.scelti || []);
        st.pubList = (r.atleti || []).map(x => ({ ...x, on: r.scelti ? gia.has(x.id) : x.nel_testo }));
      } catch (e) { st.pubList = []; }
      paint(); return;
    }
    if (a === 'pubOk') {
      const ids = [...document.querySelectorAll('.rd-pub [data-pa]')].filter(x => x.checked).map(x => x.dataset.pa);
      try {
        const bodyT = ed ? { titolo: ed.querySelector('#ed-titolo').value, sommario: ed.querySelector('#ed-sommario').value, corpo: ed.querySelector('#ed-corpo').value } : null;
        if (bodyT) await api('/bozze/' + b.id, { method: 'PUT', body: bodyT });
        const r = await api('/pubblica/' + b.id, { method: 'POST', body: { atleti: ids } });
        st.pub = null; if (typeof showToast === 'function') showToast('Pubblicato: ' + (r.url || ''));
      } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); }
      await carica(); paint(); return;
    }
    if (a === 'ritira') {
      if (!confirm('Ritirare l\'articolo dal sito? Sparisce dalla sua pagina e dalle pagine dei corridori.')) return;
      try { await api('/ritira/' + b.id, { method: 'POST', body: {} }); if (typeof showToast === 'function') showToast('Articolo ritirato'); } catch (e) { if (typeof showToast === 'function') showToast(e.message || 'Errore', 'error'); }
      await carica(); paint(); return;
    }
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
    st.msg = ''; await Promise.all([carica(), cercaOra(), caricaCosti(), caricaSpunti()]);
    if (!sel()) { const p = st.bozze.find(b => b.stato === 'bozza' || b.stato === 'approvata'); if (p) st.sel = p.id; }
    if (!document.getElementById('rd-uff-css')) { const s = document.createElement('style'); s.id = 'rd-uff-css'; s.textContent = UFF_CSS; document.head.appendChild(s); }
    paint(); tickUfficio();
  }
  window.renderRedazione = render;
})();
