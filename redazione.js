/* ============================================================
   ICS — Redazione AI (privata, solo amministratori)
   Prepara bozze di articoli dai dati del sito, dal web e da pagine ufficiali. Non pubblica nulla:
   si genera, si rilegge, si corregge e si approva. Server: server/redazione.js
   ============================================================ */
'use strict';

(function () {
  const TIPI = { gara: 'Gara (resoconto o anteprima)', settimana: 'Il punto della settimana', atleta: 'Profilo atleta', stagione: 'Fine stagione per categoria', squadre: 'Fine stagione: le squadre', libero: 'Richiesta libera' };
  const STATI = { in_generazione: 'In scrittura…', bozza: 'Bozza', approvata: 'Approvata', pubblicata: 'Pubblicata', scartata: 'Scartata', errore: 'Errore' };
  const st = { radar: null, spOcc: new Map(), spunti: null, spErr: '', prev: false, cand: {}, attesa: 0, altro: false, bozze: [], sel: null, tipo: 'gara', pick: null, cerca: [], q: '', timer: null, busy: false, msg: '' };
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
  function revisioneHtml(b) {
    const r = b.revisione; if (!r) return '';
    const ET = { confermata: 'Confermata', corretta: 'Corretta', segnalata: 'Con dubbi' };
    const li = a => (a || []).map(x => `<li>${esc(typeof x === 'string' ? x : x.testo)}</li>`).join('');
    const iniz = (r.problemi || []).filter(x => x.gravita !== 'bassa'), res = (r.residui || []).filter(x => x.gravita !== 'bassa'), bassi = ((r.residui || r.problemi) || []).filter(x => x.gravita === 'bassa');
    return `<details class="rd-box ${r.esito === 'segnalata' ? 'warn' : ''}" ${r.esito === 'segnalata' ? 'open' : ''}><summary><b>Controllo del ${esc(r.responsabile)}</b>: ${esc(ET[r.esito] || r.esito)}</summary>
      ${r.esito === 'confermata' ? '<p class="rd-muted">Numeri, nomi e citazioni controllati con i dati: tutto torna.</p>' : ''}
      ${r.esito === 'corretta' ? '<b>Cosa è stato corretto</b><ul>' + (li(r.correzioni) || '<li>Il testo è stato ritoccato.</li>') + '</ul>' : ''}
      ${iniz.length && r.esito !== 'confermata' ? '<b>Cosa non tornava</b><ul>' + li(iniz) + '</ul>' : ''}
      ${res.length ? '<b>Cosa resta da controllare</b><ul>' + li(res) + '</ul>' : ''}${bassi.length ? '<small class="rd-muted">' + bassi.map(x => esc(x.testo)).join(' · ') + '</small>' : ''}
      ${r.errore ? '<small class="rd-muted">Nota: ' + esc(r.errore) + '</small>' : ''}</details>`;
  }
  function dossierHtml(b) {
    const d = b.dossier; if (!d) return '';
    const voci = (d.voci || []).map(v => `<li><b>${esc(v.tema)}</b>: ${esc(v.fatto)} <a href="${esc(v.fonte.url)}" target="_blank" rel="noopener noreferrer">${esc(v.fonte.nome || v.fonte.url)}</a> <small class="rd-muted">(${esc(v.fonte.livello)}${v.conferme > 1 ? ', ' + v.conferme + ' fonti' : ''}${v.fonte.data ? ', ' + esc(v.fonte.data) : ''})</small></li>`).join('');
    const nt = (d.non_trovato || []).map(x => `<li>${esc(x)}</li>`).join(''), co = (d.contraddizioni || []).map(x => `<li>${esc(x)}</li>`).join('');
    return `<details class="rd-box"><summary><b>Dossier del Ricercatore</b>: ${(d.voci || []).length} informazioni da altre fonti${d.radar ? ` (partito da ${d.radar} notizie del radar)` : ''}${d.dallarchivio ? ' (già pronto, riusato)' : ''}</summary>
      <ul>${voci || '<li class="rd-muted">Nessuna informazione trovata fuori dal sito.</li>'}</ul>
      ${co ? '<b>Fonti in contrasto con i dati</b><ul>' + co + '</ul>' : ''}${nt ? '<b>Non trovato</b><ul>' + nt + '</ul>' : ''}</details>`;
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
      ${revisioneHtml(b)}
      ${dossierHtml(b)}
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
.st-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}
.st-tab{border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.08);border-radius:99px;padding:4px 12px;font:600 .8rem system-ui,sans-serif;cursor:pointer;color:inherit}
.st-tab.on{background:#4f46e5;border-color:#4f46e5;color:#fff}
.st-tab small{opacity:.8;font-weight:500}
.st-scroll{overflow-x:auto;border-radius:16px}
.st-room{position:relative;container-type:inline-size;width:min(100%,calc((100vh - 170px) * 1.78));min-width:720px;aspect-ratio:var(--ar,660/370);border-radius:16px;overflow:hidden;background:#e8ecf1;box-shadow:0 10px 30px rgba(15,23,42,.16),0 0 0 1px rgba(15,23,42,.06)}
.st-world{--u:calc(var(--tz,1) * 1cqw);position:absolute;top:0;left:var(--wl,0%);width:var(--ww,100%);aspect-ratio:660/370}
.st-cv{position:absolute;inset:0;width:100%;height:100%}
.st-ov{position:absolute;inset:0;pointer-events:none}
.st-ag{position:absolute;display:flex;flex-direction:column;align-items:center;gap:calc(var(--u) * .4);transform:translate(-50%,-100%);z-index:2}
.st-ag.parla{z-index:6}
.st-nome{display:flex;align-items:center;font:600 max(7px,calc(var(--u) * 1.12))/1.2 system-ui,-apple-system,sans-serif;padding:calc(var(--u) * .2) calc(var(--u) * .8) calc(var(--u) * .2) calc(var(--u) * .55);border-radius:99px;background:rgba(255,255,255,.93);color:#0f172a;white-space:nowrap;box-shadow:0 1px 4px rgba(15,23,42,.18)}
.st-nome::before{content:"";width:calc(var(--u) * .75);height:calc(var(--u) * .75);border-radius:50%;background:var(--c,#64748b);margin-right:calc(var(--u) * .5);flex:none}
.st-bub{position:relative;font:500 max(8px,calc(var(--u) * 1.35))/1.3 system-ui,-apple-system,sans-serif;max-width:calc(1cqw * 21 * min(var(--tz,1), 1.3));padding:calc(var(--u) * .7) calc(var(--u) * 1.1);margin-bottom:calc(var(--u) * .9);border-radius:calc(var(--u) * 1.3);background:#fff;color:#0f172a;text-align:left;overflow-wrap:anywhere;box-shadow:0 6px 18px rgba(15,23,42,.2),0 0 0 1px rgba(15,23,42,.06)}
.st-bub[hidden]{display:none}
.st-bub::after{content:"";position:absolute;left:50%;bottom:-calc(var(--u) * .5);width:calc(var(--u) * 1);height:calc(var(--u) * 1);background:inherit;transform:translateX(-50%) rotate(45deg);border-radius:calc(var(--u) * .2);box-shadow:2px 2px 4px rgba(15,23,42,.08)}
.st-bub.lavoro{background:#f0fdf4;color:#14532d;box-shadow:0 6px 18px rgba(22,163,74,.2),0 0 0 1px rgba(22,163,74,.35)}
.st-bub.errore{background:#fef2f2;color:#7f1d1d;box-shadow:0 6px 18px rgba(220,38,38,.2),0 0 0 1px rgba(220,38,38,.4)}
.st-bub.chiac{background:rgba(255,255,255,.82);color:#475569;font-style:italic;box-shadow:0 4px 12px rgba(15,23,42,.12),0 0 0 1px rgba(100,116,139,.35)}
.st-lavagna{position:absolute;left:44.17%;top:2.16%;width:11.06%;height:3.24%;display:flex;align-items:center;justify-content:center;font:600 max(7px,calc(var(--u) * 1.05))/1.15 system-ui,-apple-system,sans-serif;color:#e2e8f0;white-space:nowrap;pointer-events:none;letter-spacing:.02em}
.st-zona{position:absolute;bottom:1.3%;transform:translateX(-50%);font:700 max(7px,calc(var(--u) * .95))/1 system-ui,-apple-system,sans-serif;letter-spacing:.08em;color:rgba(30,41,59,.55);white-space:nowrap;cursor:pointer}
.st-zona:hover{color:#4f46e5}
.rd-tag.rd-ag{background:rgba(99,102,241,.2)}
.rd-rdr{margin:0 0 16px}
.rd-rdl{list-style:none;margin:8px 0;padding:0}
.rd-rdl li{padding:4px 0;border-top:1px solid rgba(128,128,128,.18);font-size:.85rem}
.rd-lv-ufficiale{background:rgba(22,163,74,.25)!important}
.rd-lv-testata{background:rgba(37,99,235,.2)!important}
.rd-lv-locale{background:rgba(217,119,6,.22)!important}
.rd-lv-segnalata{background:rgba(124,58,237,.22)!important}
.st-elenco summary{cursor:pointer;margin:6px 0 2px;font-weight:600}
.st-avviso{margin:0 0 8px;padding:8px 12px;border-radius:10px;background:#fef3c7;color:#78350f;font-size:.85rem;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.st-avviso[hidden]{display:none}
.st-sotto{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px}
.st-elenco,.st-log{font-size:.8rem;border:1px solid rgba(128,128,128,.28);border-radius:10px;background:rgba(128,128,128,.07);padding:8px 10px}
.st-elenco>div{display:flex;gap:7px;align-items:baseline;padding:2px 0}
.st-pt{width:9px;height:9px;border-radius:50%;flex:none;background:#9ca3af}
.st-pt.lavora{background:#16a34a;animation:st-pulsa 1s infinite alternate}
.st-pt.errore{background:#dc2626}
@keyframes st-pulsa{to{opacity:.35}}
.st-log ol{margin:4px 0 0;padding:0;list-style:none;max-height:190px;overflow:auto}
.st-log li{padding:3px 0;border-top:1px solid rgba(128,128,128,.18)}
.st-log time{opacity:.6;margin-right:6px}
@media (prefers-reduced-motion:reduce){.st-pt.lavora{animation:none}}
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

  /* ---------- Gli addetti: la direzione (7) e un reparto per categoria e sesso (40: responsabile, atleti, team, ricercatore) ---------- */
  const CATEGORIE = [['ELI', 'Elite/U23'], ['JUN', 'Juniores'], ['AL', 'Allievi'], ['ES2', 'Esord. 2°'], ['ES1', 'Esord. 1°']];
  const STAFF = [
    ['Caporedattore', 0, 8, { camicia: '#7c3aed', capelli: '#4b5563', pelle: '#f1c9a5', stile: 'corto', extra: 'cravatta' }, 'Coordina e decide'],
    ['Capo servizio', 0, 9, { camicia: '#475569', capelli: '#9ca3af', pelle: '#e0ac82', stile: 'corto', extra: 'cravatta' }, 'Controlla gare, settimana e richieste libere'],
    ['Cronista', 1, 8, { camicia: '#16a34a', capelli: '#78350f', pelle: '#e8b98e', stile: 'corto' }, 'Gare e punto della settimana'],
    ['Ricercatore', 1, 9, { camicia: '#0ea5e9', capelli: '#1f2937', pelle: '#f1c9a5', stile: 'lungo', extra: 'occhiali' }, 'Notizie dal web per le gare'],
    ['Analista', 2, 8, { camicia: '#65a30d', capelli: '#422006', pelle: '#d8a06f', stile: 'riccio', extra: 'occhiali' }, 'Spunti dai dati'],
    ['Inviato speciale', 2, 9, { camicia: '#0d9488', capelli: '#374151', pelle: '#c68642', stile: 'corto' }, 'Richieste libere'],
    ['Cassiere', 3, 8, { camicia: '#d97706', capelli: '#7c2d12', pelle: '#e0ac82', stile: 'corto', extra: 'visiera' }, 'Costi e limite']
  ];
  const PELLI = ['#f1c9a5', '#e8b98e', '#8d5a3b', '#f5d0b0', '#c68642', '#d8a06f', '#e0ac82', '#a9714b'];
  const CAPELLI = ['#4b5563', '#78350f', '#111827', '#92400e', '#374151', '#1f2937', '#422006', '#7c2d12'];
  const CAMICIA_AT = { ELI: '#2563eb', JUN: '#16a34a', AL: '#d97706', ES2: '#db2777', ES1: '#7c3aed' };
  const CAMICIA_TM = { ELI: '#1e3a8a', JUN: '#14532d', AL: '#92400e', ES2: '#9d174d', ES1: '#5b21b6' };
  const ETI_RUOLO = { resp: 'Responsabile', atleti: 'Atleti', team: 'Team', ric: 'Ricercatore' };
  const REPARTI = (() => {
    const out = [];
    CATEGORIE.forEach(([c, nome], riga) => [['M', 0], ['F', 4]].forEach(([sx, c0]) => ['resp', 'atleti', 'team', 'ric'].forEach((ruolo, i) => {
      const n = out.length, pelle = PELLI[(n * 5 + 2) % PELLI.length];
      out.push({ nome: `${ETI_RUOLO[ruolo]} ${nome} ${sx}`, ruolo, cod: `${c}_${sx}`, riga, col: c0 + i,
        look: ruolo === 'resp'
          ? { camicia: '#334155', capelli: '#9ca3af', pelle, stile: sx === 'F' ? 'lungo' : 'corto', extra: 'occhiali' }
          : ruolo === 'ric'
            ? { camicia: '#0369a1', capelli: CAPELLI[(n * 3 + 1) % CAPELLI.length], pelle, stile: sx === 'F' ? 'lungo' : 'corto', extra: 'occhiali' }
            : { camicia: (ruolo === 'atleti' ? CAMICIA_AT : CAMICIA_TM)[c], capelli: CAPELLI[(n * 3 + 1) % CAPELLI.length], pelle,
              stile: sx === 'F' ? ['lungo', 'riccio'][n % 2] : ['corto', 'riccio', 'corto'][n % 3], extra: ruolo === 'team' ? 'cravatta' : (n % 3 === 0 ? 'occhiali' : '') } });
    })));
    return out;
  })();
  // chi controlla: il responsabile del reparto per atleti/squadre/stagione, il Capo servizio per gare, settimana e richieste libere
  // chi cerca le informazioni: il Ricercatore del reparto per atleti/squadre/stagione, quello delle gare per il resto
  const ricDi = agente => (/^(Atleti|Team) /.test(agente || '') ? 'Ricercatore ' + agente.replace(/^(Atleti|Team) /, '') : 'Ricercatore');
  const respDi = agente => (/^(Atleti|Team) /.test(agente || '') ? 'Responsabile ' + agente.replace(/^(Atleti|Team) /, '') : 'Capo servizio');
  const nomeRep = (ruolo, cod) => { const r = REPARTI.find(x => x.ruolo === ruolo && x.cod === cod); return r ? r.nome : null; };
  const agenteSpunto = s => nomeRep(/^squadra/.test(s.tipo) ? 'team' : 'atleti', s.codice_categoria);
  // chi lavora a una bozza: i reparti per atleti/squadre/stagione, il Cronista per gare e settimana, l'Inviato per le richieste libere
  function agenteDiBozza(b) {
    const p = b.parametri || {}, cod = c => (c && /_[MF]$/.test(c) ? c : null);
    if (b.tipo === 'stagione') return nomeRep('atleti', cod(p.id)) || 'Inviato speciale';
    if (b.tipo === 'squadre') return nomeRep('team', cod(p.id)) || 'Inviato speciale';
    if (b.tipo === 'atleta') return nomeRep('atleti', cod(p.cat)) || 'Inviato speciale';
    if (b.tipo === 'libero') {
      const s = /^spunto\|/.test(p.chiave || '') && st.spunti && st.spunti.spunti.find(x => 'spunto|' + x.id === p.chiave);
      return (s && agenteSpunto(s)) || 'Inviato speciale';
    }
    return 'Cronista';
  }

  function agenti() {
    const k = st.costi, cfg = k && k.config, ora = Date.now();
    const attive = st.bozze.filter(b => b.stato === 'in_generazione' && ora - Date.parse(b.creato) < 12 * 60000);
    const errori = st.bozze.filter(b => b.stato === 'errore' && ora - Date.parse(b.aggiornato || b.creato) < 30 * 60000);
    const usd = n => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
    const sp = st.spunti;
    const di = (lista, nome) => lista.filter(b => agenteDiBozza(b) === nome);
    const lavoro = (nome, riposo) => {
      const a = di(attive, nome), e = di(errori, nome);
      if (a.length) return { stato: 'lavora', testo: `Scrive: ${a[0].soggetto || 'un articolo'}${a.length > 1 ? ` (+${a.length - 1} in coda)` : ''}` };
      if (e.length) return { stato: 'errore', testo: `Non è riuscito: ${e[0].soggetto || 'ultima bozza'}` };
      return { stato: 'riposa', testo: riposo };
    };
    const cap = (() => {
      const auto = attive.some(b => b.parametri && b.parametri.auto);
      if (auto) return { stato: 'lavora', testo: 'Coordina il giro automatico' };
      if (!k) return { stato: 'riposa', testo: 'Impostazioni non disponibili' };
      if (!cfg.ai_attiva) return { stato: 'riposa', testo: 'AI spenta: nessuno scrive' };
      if (!cfg.auto_attiva) return { stato: 'riposa', testo: 'Scrittura automatica spenta. Si lavora a mano.' };
      return { stato: 'riposa', testo: `Prossimo giro ${prossimoGiro(cfg.auto_orari)}` };
    })();
    const ricerca = (() => {
      const a = attive.filter(b => b.parametri && b.parametri.web && ricDi(agenteDiBozza(b)) === 'Ricercatore');
      if (a.length) return { stato: 'lavora', testo: `Cerca sul web: ${a[0].soggetto || 'contesto'}` };
      if (cfg && Number(cfg.web_auto_da_imp) === 99) return { stato: 'riposa', testo: 'Ricerca automatica: mai' };
      const at = (sp && sp.attesa) || [];
      const ra = st.radar && st.radar.items && st.radar.items[0];
      return { stato: 'riposa', testo: at.length ? `In attesa di risultati: ${at[0].nome}${at.length > 1 ? ` e altre ${at.length - 1}` : ''}` : ra ? `Radar: ${st.radar.totale} notizie seguite, ultima da ${ra.fonte || 'una testata'}` : 'Nessuna ricerca in corso' };
    })();
    const cassa = (() => {
      if (!k) return { stato: 'riposa', testo: 'Costi non disponibili' };
      const lim = Number(cfg.limite_mensile_usd) || 0, pct = lim > 0 ? Math.round(k.spesa_mese / lim * 100) : 100;
      const u = k.ultime && k.ultime[0], ultima = u ? ` · ultima: ${u.uso || 'chiamata'}, ${fmtData(u.ts).split(', ').pop() || ''}` : '';
      if (pct >= 100) return { stato: 'errore', testo: `Limite raggiunto: ${usd(k.spesa_mese)} su ${usd(lim)}. Chiamate bloccate.` };
      return { stato: attive.length ? 'lavora' : 'riposa', testo: `${usd(k.spesa_mese)} su ${usd(lim)} (${pct}%)${ultima}` };
    })();
    const analista = (() => {
      const occ = st.spOcc.size ? [...st.spOcc.values()][0] : null;
      if (occ) return { stato: 'lavora', testo: occ };
      if (st.spErr) return { stato: 'errore', testo: st.spErr };
      if (!sp) return { stato: 'riposa', testo: 'Spunti non disponibili' };
      const n = sp.spunti.filter(s => s.stato === 'nuovo').length;
      return { stato: 'riposa', testo: n ? `${n} spunt${n === 1 ? 'o pronto' : 'i pronti'} da leggere` : 'Nessuno spunto forte in questo periodo' };
    })();
    const stato = {
      'Capo servizio': { stato: 'riposa', testo: 'Controlla gare, settimana e richieste libere' },
      'Caporedattore': cap, 'Ricercatore': ricerca, 'Cassiere': cassa, 'Analista': analista,
      'Cronista': lavoro('Cronista', 'Aspetta una gara da raccontare'), 'Inviato speciale': lavoro('Inviato speciale', 'Aspetta una richiesta libera')
    };
    const seg = nome => attive.filter(b => respDi(agenteDiBozza(b)) === nome);                      // chi segue le bozze in corso
    const ultimaRev = nome => st.bozze.filter(b => b.revisione && b.revisione.responsabile === nome).sort((x, y) => String(y.aggiornato || y.creato).localeCompare(String(x.aggiornato || x.creato)))[0];
    const ETI_ES = { confermata: 'confermata', corretta: 'corretta', segnalata: 'con dubbi' };
    const dellaSupervisione = (nome, riposo) => {
      const s = seg(nome), e = errori.filter(b => respDi(agenteDiBozza(b)) === nome), u = ultimaRev(nome);
      if (s.length) return { stato: 'lavora', testo: `Segue: ${s[0].soggetto || 'una bozza'}${s.length > 1 ? ` (+${s.length - 1})` : ''}` };
      if (e.length) return { stato: 'errore', testo: `Una bozza non è riuscita: ${e[0].soggetto || ''}` };
      return { stato: 'riposa', testo: u ? `Ultima: ${ETI_ES[u.revisione.esito] || u.revisione.esito} «${u.soggetto}»` : riposo };
    };
    stato['Capo servizio'] = dellaSupervisione('Capo servizio', 'Controlla gare, settimana e richieste libere');
    const direzione = STAFF.map(([nome, , , , ruolo]) => ({ nome, ruolo, reparto: false, ...stato[nome] }));
    const reparti = REPARTI.map(r => {
      if (r.ruolo === 'ric') {
        const a = attive.filter(b => b.parametri && b.parametri.web && ricDi(agenteDiBozza(b)) === r.nome);
        if (a.length) return { nome: r.nome, ruolo: 'Ricercatore', reparto: true, stato: 'lavora', testo: `Cerca sul web: ${a[0].soggetto || 'contesto'}` };
        const rd = st.radar && st.radar.items ? st.radar.items.filter(x => (x.reparti || []).includes(r.cod)) : [], at = sp && sp.attesa ? sp.attesa.filter(g => (g.cods || []).includes(r.cod)) : [];
        return { nome: r.nome, ruolo: 'Ricercatore', reparto: true, stato: 'riposa', testo: at.length ? `In attesa di risultati: ${at[0].nome}${at.length > 1 ? ` e altre ${at.length - 1}` : ''}` : rd.length ? `Radar: ${rd.length} notizie, ultima da ${rd[0].fonte || 'una testata'}` : 'Nessuna notizia per questa categoria' };
      }
      if (r.ruolo === 'resp') {
        const mia = ['Atleti', 'Team'].map(x => x + ' ' + r.nome.replace('Responsabile ', ''));
        const best = sp && sp.spunti.filter(s => s.stato !== 'scartato' && mia.includes(agenteSpunto(s))).sort((a, b) => b.score - a.score)[0];
        return { nome: r.nome, ruolo: 'Responsabile', reparto: true, ...dellaSupervisione(r.nome, best ? `Reparto: ${best.titolo}` : 'Nessuno spunto in questa categoria') };
      }
      const mio = sp && sp.spunti.filter(s => s.stato !== 'scartato' && agenteSpunto(s) === r.nome).sort((a, b) => b.score - a.score)[0];
      return { nome: r.nome, ruolo: r.ruolo === 'atleti' ? 'Atleti' : 'Team', reparto: true, ...lavoro(r.nome, mio ? `Radar: ${mio.titolo}` : 'Nessuno spunto in questa categoria') };
    });
    return [...direzione, ...reparti];
  }

  /* ---------- Spunti dell'Analista: calcolati dai dati con regole fisse, l'AI li spiega soltanto ---------- */
  const SP_TIPI = { vittorie: 'Vittorie', podi: 'Serie di podi', crescita: 'Progressione', costanza: 'Costanza', squadra_vittorie: 'Squadra', squadra_crescita: 'Squadra in crescita', rivalita: 'Rivalità' };
  async function caricaSpunti() { try { st.spunti = await api('/spunti'); st.spErr = ''; } catch (e) { st.spunti = null; st.spErr = 'Spunti non disponibili'; } }
  function spuntiPanel() {
    const sp = st.spunti, occ = st.spOcc.size > 0;
    if (!sp) return `<div class="hx-panel rd-sp"><h3>Spunti dell'Analista</h3><small class="rd-muted">${esc(st.spErr || 'Caricamento…')}</small></div>`;
    const card = s => `<div class="rd-spc ${s.stato}">
      <div class="rd-spc-top"><span class="rd-tag">${esc(SP_TIPI[s.tipo] || s.tipo)}</span><span class="rd-tag rd-ag">${esc(agenteSpunto(s) || "")}</span><small class="rd-muted">${esc(s.categoria)} · ${esc(fmtGiorno(s.periodo.dal))} – ${esc(fmtGiorno(s.periodo.al))}</small>${s.stato === 'usato' ? '<span class="rd-tag rd-usato">Bozza creata</span>' : ''}</div>
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
      ${(sp.attesa || []).length ? `<small class="rd-muted"><b>In attesa di risultati:</b> ${sp.attesa.slice(0, 6).map(g => esc(g.nome) + ' (' + esc(fmtGiorno(g.data)) + ')').join(' · ')}${sp.attesa.length > 6 ? ' · +' + (sp.attesa.length - 6) : ''}</small>` : ''}
      ${buoni.length ? `<div class="rd-spl">${buoni.slice(0, 8).map(card).join('')}</div>${buoni.length > 8 ? `<details class="rd-box"><summary>Altri ${buoni.length - 8} spunti degli altri reparti</summary><div class="rd-spl">${buoni.slice(8).map(card).join('')}</div></details>` : ''}` : '<small class="rd-muted">Nessuno spunto forte negli ultimi 28 giorni.</small>'}
      ${scart.length ? `<details class="rd-box"><summary>${scart.length} scartat${scart.length === 1 ? 'o' : 'i'}</summary><div class="rd-spl">${scart.map(card).join('')}</div></details>` : ''}
      <small class="rd-muted">Calcolati sui risultati presenti nel sito: se una gara non è stata importata, il conteggio può essere più basso del reale.</small></div>`;
  }
  const fmtGiorno = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); } catch (_) { return iso; } };
  /* ---------- Radar delle notizie: federazione, testate e giornali locali, seguiti senza AI e agganciati a gare e atleti ---------- */
  const LIV_RADAR = { ufficiale: 'ufficiale', testata: 'testata', locale: 'locale', segnalata: 'segnalata' };
  const nomeGaraDaChiave = k => String(k || '').split('|')[1] || '';
  async function caricaRadar() { try { st.radar = await api('/radar'); } catch (e) { st.radar = null; } }
  function radarPanel() {
    const r = st.radar;
    if (!r) return '<div class="hx-panel rd-rdr"><h3>Radar delle notizie</h3><small class="rd-muted">Non disponibile: riprova tra poco.</small></div>';
    const vol = st.radarBusy;
    const righe = (r.items || []).slice(0, 10).map(x => {
      const gara = nomeGaraDaChiave((x.gare || [])[0]), dove = gara ? ' · ' + esc(gara.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())) : ((x.atleti || []).length ? ' · atleta citato' : '');
      const t = x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.titolo)}</a>` : esc(x.titolo);
      return `<li><span class="rd-tag rd-lv-${esc(x.livello)}">${esc(LIV_RADAR[x.livello] || x.livello)}</span> ${t} <small class="rd-muted">${esc(x.fonte || '')}${x.data ? ' · ' + esc(fmtGiorno(String(x.data).slice(0, 10))) : ''}${dove}</small></li>`;
    }).join('');
    return `<div class="hx-panel rd-rdr"><div class="rd-uff-head"><h3>Radar delle notizie</h3>
      <small>segue federazione, testate e giornali locali · senza AI${r.aggiornato ? ' · aggiornato alle ' + esc(hhmm(r.aggiornato)) : ''} · ${r.totale || 0} in archivio</small>
      <button type="button" class="admin-edit-btn" data-rd="agg" ${vol ? 'disabled' : ''}>${vol ? 'Cerco…' : 'Aggiorna ora'}</button></div>
      <ul class="rd-rdl">${righe || '<li class="rd-muted">Ancora nessuna notizia agganciata alle gare di questi giorni.</li>'}</ul>
      <details class="rd-box"><summary>Segnala una notizia (per esempio un post sui social)</summary>
        <textarea id="rd-sg-testo" rows="3" maxlength="1500" placeholder="Incolla qui il testo: il sito lo aggancia alla gara o all'atleta giusto e lo passa al Ricercatore"></textarea>
        <input id="rd-sg-url" type="url" placeholder="Indirizzo della pagina (facoltativo)" style="width:100%;margin:6px 0">
        <button type="button" class="admin-edit-btn" data-rd="segnala" ${vol ? 'disabled' : ''}>Segnala</button></details>
      <small class="rd-muted">Facebook e i profili di altri non si possono seguire in automatico: se trovi qualcosa di importante, segnalalo qui.</small></div>`;
  }
  function legaRadar() {
    const el = document.querySelector('.rd-radar'); if (!el) return;
    el.onclick = async ev => {
      const b = ev.target.closest('[data-rd]'); if (!b || st.radarBusy) return;
      const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };
      st.radarBusy = true; el.innerHTML = radarPanel();
      try {
        if (b.dataset.rd === 'agg') { const r = await api('/radar/aggiorna', { method: 'POST' }); st.radar = { aggiornato: r.aggiornato, items: r.items, totale: r.totale }; toast(r.nuovi ? r.nuovi + ' notizie nuove' : 'Nessuna notizia nuova'); }
        else {
          const testo = (el.querySelector('#rd-sg-testo') || {}).value || '', url = (el.querySelector('#rd-sg-url') || {}).value || '';
          const r = await api('/radar/segnala', { method: 'POST', body: { testo, url } });
          await caricaRadar(); toast(r.agganciata_a && (r.agganciata_a.gare || r.agganciata_a.atleti) ? 'Segnalazione salvata e agganciata' : 'Segnalazione salvata (non riconosco una gara o un atleta: resta nell\'archivio)');
        }
      } catch (e) { toast((e && e.message) || 'Errore', 'error'); }
      st.radarBusy = false; el.innerHTML = radarPanel(); aggiornaStanza();
    };
  }
  function legaSpunti() {
    const el = document.querySelector('.rd-spunti'); if (!el) return;
    const ridisegna = () => { el.innerHTML = spuntiPanel(); aggiornaStanza(); };
    const errore = e => { if (typeof showToast === 'function') showToast((e && e.message) || 'Errore', 'error'); };
    el.onclick = async ev => {
      const ap = ev.target.closest('[data-open]'); if (ap) { st.sel = ap.dataset.open; st.prev = false; paint(); return; }
      const b = ev.target.closest('[data-sp]'); if (!b || st.spOcc.size) return;
      const act = b.dataset.sp, id = b.dataset.id, s = st.spunti && st.spunti.spunti.find(x => x.id === id);
      const nomi = { calcola: 'Rilegge i risultati per trovare gli spunti', spiega: `Spiega: ${s ? s.titolo : 'uno spunto'}`, articolo: `Prepara la bozza: ${s ? s.titolo : 'uno spunto'}`, scarta: 'Mette da parte uno spunto', ripristina: 'Rimette in lista uno spunto' };
      st.spOcc.set(id || 'calcola', nomi[act] || 'Lavora'); ridisegna();
      try {
        if (act === 'calcola') { st.spunti = await api('/spunti/calcola', { method: 'POST' }); const n = st.spunti.spunti.filter(x => x.stato === 'nuovo').length; scena('Analista', 'Caporedattore', `Ho riletto i risultati: ${n} spunt${n === 1 ? 'o pronto' : 'i pronti'}`, 'Bene, vediamo quali valgono un articolo.'); }
        else if (act === 'spiega') { await api(`/spunti/${encodeURIComponent(id)}/spiega`, { method: 'POST' }); await caricaSpunti(); scena('Analista', 'Caporedattore', `Ho spiegato lo spunto: ${s ? s.titolo : ''}`, 'Chiaro, grazie.'); }
        else if (act === 'articolo') { const r = await api(`/spunti/${encodeURIComponent(id)}/articolo`, { method: 'POST', body: {} }); st.sel = r.id; st.attesa = Date.now() + 6 * 60000; await Promise.all([carica(), caricaSpunti()]); scena('Analista', 'Inviato speciale', `Ti passo lo spunto: ${s ? s.titolo : ''}`, 'Lo scrivo subito.'); st.spOcc.clear(); paint(); return; }
        else { await api(`/spunti/${encodeURIComponent(id)}/stato`, { method: 'POST', body: { stato: act === 'scarta' ? 'scartato' : 'nuovo' } }); await caricaSpunti(); }
      } catch (e) { errore(e); }
      st.spOcc.clear(); ridisegna();
    };
  }

  /* ---------- La stanza: gli addetti in un ufficio stile moderno. Camminano, lavorano e si parlano.
     I fumetti con il riquadro pieno raccontano fatti veri (bozze, ricerche, costi, spunti); quelli tratteggiati sono solo chiacchiere. ---------- */
  const SW = 660, SH = 370, SCALA = 3;
  const COL_X = [38, 102, 166, 230, 294, 358, 422, 486, 550, 614], ROW_Y = [92, 148, 204, 260, 316], LANE = ROW_Y.map(y => y + 30);
  const sullaCorsia = y => LANE.some(l => Math.abs(l - y) < 0.7);
  const laneVicina = y => LANE.reduce((m, v) => (Math.abs(v - y) < Math.abs(m - y) ? v : m), LANE[0]);
  const ORDINE = [...STAFF.map(([nome, riga, col, look]) => ({ nome, riga, col, look })), ...REPARTI];
  const SPOTS = [
    { id: 'caffe', x: COL_X[9] - 24, y: LANE[3], frasi: ['Un caffè e si riparte.', 'Il terzo caffè della mattina.'] },
    { id: 'acqua', x: COL_X[8] - 24, y: LANE[4], frasi: ['Una pausa e torno.', 'Acqua fresca, idee fresche.'] },
    { id: 'lavagna', x: COL_X[4] + 24, y: 82, frasi: ['Controllo i totali sullo schermo.', 'Segno le gare da seguire.'] }
  ];
  const CHIACCHIERE = [
    ['Hai visto che volata, domenica?', 'Eh, in rettilineo non lo riprendevi più.'],
    ['Quanti chilometri avrà fatto oggi il gruppo?', 'Abbastanza da meritarsi una birra.'],
    ['Dicono vento contrario in Toscana.', 'Allora oggi fughe vietate!'],
    ['Pausa pranzo?', 'Prima finiamo la bozza.'],
    ['Pronostico per il campionato italiano?', 'Mai fare pronostici, lo dice il Capo.'],
    ['Io salgo in bici solo in discesa.', 'Si vede dai tuoi articoli sulle salite.']
  ];
  const stanza = { ag: null, gen: 0, coda: [], log: [], prevB: null, ultimoTs: undefined, avvisi: new Set(), ora: null, oraTs: 0, rm: false, canvas: null, ctx: null, bg: null, spIds: null, spAtt: undefined, rdIds: null, repAperti: false, vista: 'tutto' };
  const FMT_ORA = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
  const rnd = n => Math.floor(Math.random() * n);
  const eur = n => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
  const hhmm = ts => { try { return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const trova = nome => stanza.ag.find(a => a.nome === nome);
  const durata = t => Math.min(7000, 1900 + String(t || '').length * 55);

  function inizStanza() {
    if (stanza.ag) return;
    const now = performance.now();
    stanza.ag = ORDINE.map(({ nome, riga, col, look }) => {
      const cx = COL_X[col], D = ROW_Y[riga], sx = cx - 5, sy = D + 3;
      return { nome, riga, col, look, cx, D, sx, sy, x: sx, y: sy, dir: 1, stato: 'seduto', path: [], parla: null, parlaChiac: false, fase: 'riposa', lavoro: '', scena: null, giro: null, prossimo: now + 4000 + rnd(14000), el: null, bub: null, _k: '' };
    });
  }

  // ---- movimento: si cammina solo nelle corsie sotto ogni fila e nei corridoi verticali tra le scrivanie
  function vai(a, tx, ty) {
    const p = [];
    let x = a.x, y = a.y;
    if (Math.abs(a.x - a.sx) < 1 && Math.abs(a.y - a.sy) < 1) { p.push([a.cx - 20, a.sy], [a.cx - 20, LANE[a.riga]]); x = a.cx - 20; y = LANE[a.riga]; }
    else if (!sullaCorsia(y)) { const l = laneVicina(y); p.push([x, l]); y = l; }
    if (Math.abs(x - tx) > 0.5) p.push([tx, y]);
    if (Math.abs(y - ty) > 0.5) p.push([tx, ty]);
    a.path = p;
    if (stanza.rm) { a.path = []; a.x = tx; a.y = ty; }
  }
  function tornaAlPosto(a) {
    const p = []; let y = a.y;
    if (!sullaCorsia(y)) { y = laneVicina(y); p.push([a.x, y]); }
    p.push([a.cx - 20, y], [a.cx - 20, a.sy], [a.sx, a.sy]);
    a.path = p;
    if (stanza.rm) { a.path = []; a.x = a.sx; a.y = a.sy; }
  }
  function muovi(a, dt) {
    if (a.path.length) {
      const [tx, ty] = a.path[0], dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy), passo = 36 * dt;
      if (d <= passo) { a.x = tx; a.y = ty; a.path.shift(); } else { a.x += dx / d * passo; a.y += dy / d * passo; }
      if (Math.abs(dx) > 0.5) a.dir = dx > 0 ? 1 : -1;
    }
    const alPosto = Math.abs(a.x - a.sx) < 0.6 && Math.abs(a.y - a.sy) < 0.6;
    a.stato = a.path.length ? 'cammina' : (alPosto ? 'seduto' : 'fermo');
  }

  // ---- conversazioni
  function scena(da, a, t1, t2, opz) {
    inizStanza();
    const chiac = !!(opz && opz.chiac);
    if (!da || !a || stanza.coda.some(x => x.da === da && x.a === a && x.t1 === t1)) return;
    stanza.coda.push({ da, a, t1, t2: t2 || '', chiac, fase: 'attesa', fino: 0, scad: 0 });
    if (stanza.coda.length > 16) {                                             // si scartano solo scene non ancora iniziate (mai quelle in corso: gli agenti resterebbero bloccati)
      let i = stanza.coda.findIndex(x => x.chiac && x.fase === 'attesa'); if (i < 0) i = stanza.coda.findIndex(x => x.fase === 'attesa');
      if (i >= 0) stanza.coda.splice(i, 1);
    }
    if (!chiac) { stanza.log.unshift({ ts: Date.now(), da, a, t1, t2: t2 || '' }); stanza.log.length = Math.min(stanza.log.length, 40); }
  }
  function rilascia(sc, A, B) { if (A) { A.parla = null; A.scena = null; } if (B) { B.parla = null; B.scena = null; } sc.fase = 'fine'; }
  function giraScene(now) {
    const urgenti = stanza.coda.some(x => !x.chiac && x.fase === 'attesa');
    for (const sc of stanza.coda) {
      if (sc.fase !== 'attesa' || (sc.chiac && urgenti)) continue;
      const A = trova(sc.da), B = trova(sc.a);
      if (!A || !B) { sc.fase = 'fine'; continue; }
      if (A.scena || B.scena || A.giro || B.giro) continue;
      sc.fase = 'vai'; sc.scad = now + 90000; A.scena = B.scena = sc;
      vai(A, B.col === 9 ? B.cx - 24 : B.cx + 24, LANE[B.riga]);
    }
    for (const sc of stanza.coda) {
      if (sc.fase === 'attesa' || sc.fase === 'fine') continue;
      const A = trova(sc.da), B = trova(sc.a);
      if (now > sc.scad) { rilascia(sc, A, B); tornaAlPosto(A); continue; }              // sicurezza: nessuna scena resta bloccata
      if (sc.fase === 'vai' && !A.path.length) { sc.fase = 'p1'; sc.fino = now + durata(sc.t1); A.parla = sc.t1; A.parlaChiac = sc.chiac; A.dir = B.sx > A.x ? 1 : -1; }
      else if (sc.fase === 'p1' && now >= sc.fino) {
        A.parla = null;
        if (sc.t2) { sc.fase = 'p2'; sc.fino = now + durata(sc.t2); B.parla = sc.t2; B.parlaChiac = sc.chiac; }
        else { sc.fase = 'torna'; tornaAlPosto(A); }
      } else if (sc.fase === 'p2' && now >= sc.fino) { B.parla = null; sc.fase = 'torna'; tornaAlPosto(A); }
      else if (sc.fase === 'torna' && !A.path.length && A.stato === 'seduto') rilascia(sc, A, B);
    }
    stanza.coda = stanza.coda.filter(x => x.fase !== 'fine');
  }
  // ---- pause e chiacchiere: solo per chi non sta lavorando, e mai troppi insieme in giro
  function giraGiretti(now) {
    for (const a of stanza.ag) {
      if (a.giro) {
        const g = a.giro;
        if (g.fase === 'vai' && !a.path.length) { g.fase = 'sosta'; g.fino = now + 4200 + rnd(2500); a.parla = g.sp.frasi[rnd(g.sp.frasi.length)]; a.parlaChiac = true; a.dir = 1; }
        else if (g.fase === 'sosta' && now >= g.fino) { a.parla = null; g.fase = 'torna'; tornaAlPosto(a); }
        else if (g.fase === 'torna' && !a.path.length && a.stato === 'seduto') { a.giro = null; a.prossimo = now + 9000 + rnd(14000); }
        continue;
      }
      if (a.scena || a.stato !== 'seduto' || now < a.prossimo) continue;
      if (a.fase === 'lavora') { a.prossimo = now + 20000; continue; }
      if (stanza.coda.some(x => !x.chiac) || stanza.ag.filter(x => x.giro || x.scena).length >= 6) { a.prossimo = now + 4000 + rnd(3000); continue; }
      if (Math.random() < 0.5) {
        const altri = stanza.ag.filter(b => b !== a && !b.scena && !b.giro && b.stato === 'seduto' && b.fase !== 'lavora');
        const vicini = altri.filter(b => b.riga === a.riga), pool = vicini.length && Math.random() < 0.7 ? vicini : altri;
        if (pool.length) { const b = pool[rnd(pool.length)], c = CHIACCHIERE[rnd(CHIACCHIERE.length)]; scena(a.nome, b.nome, c[0], c[1], { chiac: true }); a.prossimo = now + 14000 + rnd(12000); continue; }
      }
      const sp = SPOTS[rnd(SPOTS.length)]; a.giro = { fase: 'vai', sp, fino: 0 }; vai(a, sp.x, sp.y);
    }
  }

  // ---- collegamento con lo stato vero della redazione: ogni novità diventa una scena
  function aggiornaStanza() {
    inizStanza();
    for (const d of agenti()) { const a = trova(d.nome); if (a) { a.fase = d.stato; a.lavoro = d.testo; } }
    const ora = Date.now(), k = st.costi;
    if (stanza.prevB) {
      for (const b of st.bozze) {
        const prima = stanza.prevB.get(b.id), agente = agenteDiBozza(b);
        if (prima === undefined && b.stato === 'in_generazione' && ora - Date.parse(b.creato) < 12 * 60000) {
          scena('Caporedattore', agente, `${b.parametri && b.parametri.auto ? 'Giro automatico' : 'Nuovo incarico'}: ${b.soggetto}`, 'Ricevuto, ci penso io.');
          if (b.parametri && b.parametri.web) scena(agente, ricDi(agente), `Mi serve il contesto su ${b.soggetto}`, 'Cerco sul web e ti passo le fonti.');
        } else if (prima === 'in_generazione' && b.stato === 'bozza') {                 // addetto -> responsabile (controlla) -> Caporedattore
          const rv = b.revisione, resp = rv && rv.responsabile && trova(rv.responsabile) ? rv.responsabile : null;
          if (resp && resp !== agente) {
            scena(agente, resp, `Bozza pronta: ${b.soggetto}`, 'La controllo con i dati.');
            const n = (rv.correzioni || []).length, dubbi = (rv.residui || []).filter(x => x.gravita !== 'bassa').length;
            scena(resp, 'Caporedattore', rv.esito === 'corretta' ? `Corretta (${n} correzion${n === 1 ? 'e' : 'i'}): ${b.soggetto}` : rv.esito === 'segnalata' ? `Controllata, restano ${dubbi || 'dei'} dubbi: ${b.soggetto}` : `Confermata: ${b.soggetto}`, 'Bene, la leggo e decido se approvarla.');
          } else scena(agente, 'Caporedattore', `Bozza pronta: ${b.soggetto}`, 'Bene, la leggo e decido se approvarla.');
        }
        else if (prima === 'in_generazione' && b.stato === 'errore') scena(agente, 'Caporedattore', `Non mi è riuscita: ${b.soggetto}`, 'Capito, controlla l\'errore e riproviamo.');
      }
    }
    stanza.prevB = new Map(st.bozze.map(b => [b.id, b.stato]));
    if (k && k.config) {
      const u = (k.ultime || [])[0], ts = u ? String(u.ts) : null;
      if (stanza.ultimoTs !== undefined && ts && ts !== stanza.ultimoTs) scena('Cassiere', 'Caporedattore', `Registrato: ${u.uso || 'chiamata'}, ${eur(u.costo_usd)}`, `Spesa del mese: ${eur(k.spesa_mese)} su ${eur(k.config.limite_mensile_usd)}`);
      stanza.ultimoTs = ts;
      const lim = Number(k.config.limite_mensile_usd) || 0, pct = lim > 0 ? k.spesa_mese / lim * 100 : 0;
      if (pct >= 100 && !stanza.avvisi.has(100)) { stanza.avvisi.add(100); scena('Cassiere', 'Caporedattore', 'Limite mensile raggiunto: blocco le chiamate.', 'Lo alzo io o fermiamo la scrittura?'); }
      else if (pct >= 80 && !stanza.avvisi.has(80)) { stanza.avvisi.add(80); scena('Cassiere', 'Caporedattore', `Attenzione: siamo al ${Math.round(pct)}% del limite.`, 'Teniamo d\'occhio la spesa.'); }
    }
    const sp = st.spunti;
    if (sp) {
      const ids = new Set(sp.spunti.map(x => x.id)), at = (sp.attesa || []).map(x => x.nome + x.data).join();
      if (stanza.spIds) {                                                    // ogni addetto riferisce al Caporedattore il suo spunto nuovo
        const nuovi = sp.spunti.filter(x => x.stato === 'nuovo' && !stanza.spIds.has(x.id)).sort((x, y) => y.score - x.score);
        nuovi.slice(0, 3).forEach(x => scena(agenteSpunto(x), 'Caporedattore', `Ho trovato qualcosa: ${x.titolo}`, 'Ok, lo segno tra gli spunti.'));
        if (nuovi.length) scena('Analista', 'Caporedattore', `Giro dei dati finito: ${nuovi.length} spunt${nuovi.length === 1 ? 'o nuovo' : 'i nuovi'}.`, 'Bene, vediamo cosa vale un articolo.');
        if (at !== stanza.spAtt && (sp.attesa || []).length) { const q = sp.attesa; scena('Ricercatore', 'Caporedattore', `Aspetto ancora i risultati di ${q[0].nome}${q.length > 1 ? ` e di altre ${q.length - 1} gare` : ''}`, 'Appena arrivano, li scrive il Cronista.'); }
      }
      stanza.spIds = ids; stanza.spAtt = at;
    }
    const rd = st.radar;
    if (rd && rd.items) {
      const ids = new Set(rd.items.map(x => x.id));
      if (stanza.rdIds) {                                                    // il Ricercatore riferisce al Caporedattore le notizie nuove, gara per gara
        const nuove = rd.items.filter(x => !stanza.rdIds.has(x.id) && x.livello !== 'segnalata'), per = new Map();
        nuove.forEach(x => { const k = nomeGaraDaChiave((x.gare || [])[0]) || 'atleti citati'; if (!per.has(k)) per.set(k, []); per.get(k).push(x); });
        [...per.entries()].slice(0, 2).forEach(([k, l]) => {
          const fonti = [...new Set(l.map(x => x.fonte).filter(Boolean))].slice(0, 3).join(', ');
          const codR = (l[0].reparti || [])[0], ricR = codR && nomeRep('ric', codR), respR = codR && nomeRep('resp', codR);
          scena(ricR || 'Ricercatore', respR || 'Caporedattore', `Radar: ${l.length} notizi${l.length === 1 ? 'a nuova' : 'e nuove'} su ${k.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())}${fonti ? ' (' + fonti + ')' : ''}`, 'Bene, le useremo nei dossier.');
        });
      }
      stanza.rdIds = ids;
    }
    aggiornaPannelli();
  }

  // ---- disegno: stile moderno, forme morbide e ombre leggere (coordinate logiche, canvas ad alta risoluzione)
  const rr = (c, x, y, w, h, r, fill) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } };
  const cerchio = (c, x, y, r, fill) => { c.beginPath(); c.arc(x, y, r, 0, 6.2832); if (fill) { c.fillStyle = fill; c.fill(); } };
  const ombra = (c, x, y, rx, ry, a) => { c.save(); c.translate(x, y); c.scale(1, ry / rx); cerchio(c, 0, 0, rx, `rgba(15,23,42,${a})`); c.restore(); };
  const grad = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
  function oraRoma(ms) {
    if (!stanza.ora || ms - stanza.oraTs > 5000) { const p = Object.fromEntries(FMT_ORA.formatToParts(new Date()).map(x => [x.type, x.value])); stanza.ora = { h: Number(p.hour) % 24, m: Number(p.minute) }; stanza.oraTs = ms; }
    return stanza.ora;
  }
  function pianta(c, x, y) {                                                  // x,y = base del vaso
    ombra(c, x, y + 0.6, 5.5, 1.5, 0.16);
    [[-3.4, -8.5, -0.75, '#16a34a'], [3.4, -8.5, 0.75, '#22c55e'], [0, -11, 0, '#15803d'], [-1.7, -7.5, -0.35, '#4ade80'], [1.7, -7.5, 0.35, '#16a34a']].forEach(([dx, dy, rot, col]) => { c.save(); c.translate(x + dx, y + dy); c.rotate(rot); c.beginPath(); c.ellipse(0, 0, 1.9, 4.3, 0, 0, 6.2832); c.fillStyle = col; c.fill(); c.restore(); });
    rr(c, x - 3.3, y - 5, 6.6, 5.4, 1.5, '#f8fafc'); rr(c, x - 3.3, y - 5, 6.6, 1.3, 0.65, '#e2e8f0');
  }
  const ZONE = [[6, 262, '96,165,250'], [266, 518, '244,114,182'], [522, 654, '139,92,246']];
  const VISTE = { tutto: [0, SW], uomini: [0, 264], donne: [264, 520], direzione: [500, SW] };      // uomini, donne, direzione
  function costruisciSfondo() {
    const cv = document.createElement('canvas'); cv.width = SW * SCALA; cv.height = SH * SCALA;
    const c = cv.getContext('2d'); c.setTransform(SCALA, 0, 0, SCALA, 0, 0);
    c.fillStyle = grad(c, 0, 0, 0, 74, [[0, '#f4f7fb'], [1, '#dde5ef']]); c.fillRect(0, 0, SW, 75);              // parete
    c.fillStyle = '#c3cedd'; c.fillRect(0, 73, SW, 2);
    c.fillStyle = grad(c, 0, 75, 0, SH, [[0, '#eef1f5'], [1, '#d9e0e8']]); c.fillRect(0, 75, SW, SH - 75);       // pavimento
    c.strokeStyle = 'rgba(100,116,139,.10)'; c.lineWidth = 0.3; c.beginPath();
    for (let x = 0; x <= SW; x += 40) { c.moveTo(x, 75); c.lineTo(x, SH); }
    for (let y = 75; y <= SH; y += 30) { c.moveTo(0, y); c.lineTo(SW, y); }
    c.stroke();
    ZONE.forEach(([x0, x1, rgb]) => { rr(c, x0, 81, x1 - x0, SH - 90, 8, `rgba(${rgb},.12)`); c.strokeStyle = `rgba(${rgb},.34)`; c.lineWidth = 0.5; c.stroke(); });   // tre zone colorate
    for (const a of ORDINE) { const cx = COL_X[a.col], D = ROW_Y[a.riga]; const g = c.createRadialGradient(cx, D + 6, 2, cx, D + 6, 30); g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(cx - 32, D - 24, 64, 60); }   // luce sulle scrivanie
    rr(c, 15, 5, 64, 34, 3, '#ffffff');                                                                         // cornice finestra (il cielo è dinamico)
    rr(c, 290, 6, 76, 30, 3.5, '#0f172a'); rr(c, 291.5, 7.5, 73, 27, 2.6, grad(c, 0, 7, 0, 35, [[0, '#1e293b'], [1, '#0f172a']]));   // schermo a parete
    [[4, '#818cf8'], [7, '#38bdf8'], [5, '#34d399'], [9, '#fbbf24'], [6, '#f472b6'], [11, '#818cf8']].forEach(([h, col], i) => rr(c, 298 + i * 6, 32 - h, 3.4, h, 1.1, col));
    c.strokeStyle = 'rgba(148,163,184,.5)'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(296, 32.5); c.lineTo(336, 32.5); c.stroke();
    rr(c, 600, 8, 31, 27, 2, '#ffffff'); c.strokeStyle = '#e2e8f0'; c.lineWidth = 0.6; c.stroke();                  // quadro con la bici
    c.strokeStyle = '#6366f1'; c.lineWidth = 0.9; c.lineCap = 'round'; c.lineJoin = 'round';
    [609, 623].forEach(x => { c.beginPath(); c.arc(x, 27, 4.2, 0, 6.2832); c.stroke(); });
    c.beginPath(); c.moveTo(609, 27); c.lineTo(615, 19.5); c.lineTo(623, 27); c.moveTo(615, 19.5); c.lineTo(620.5, 19.5); c.moveTo(609, 27); c.lineTo(616.5, 27); c.stroke();
    const mx = COL_X[9] - 8, my = ROW_Y[3] - 14;                                                                 // macchina del caffè
    ombra(c, mx + 8, my + 28.5, 11, 2, 0.16); rr(c, mx, my, 16, 27, 3.2, '#334155'); rr(c, mx + 2, my + 2.5, 12, 7, 1.8, '#94a3b8');
    cerchio(c, mx + 4.5, my + 14, 0.9, '#22c55e'); cerchio(c, mx + 8, my + 14, 0.9, '#f59e0b'); rr(c, mx + 5.5, my + 18, 5.5, 5.2, 1.2, '#f8fafc'); rr(c, mx + 6.4, my + 19, 3.7, 1.6, 0.6, '#92400e'); rr(c, mx, my + 25.5, 16, 2, 1, '#1e293b');
    const dx0 = COL_X[8] - 5, dy0 = ROW_Y[4] - 12;                                                               // distributore dell'acqua
    ombra(c, dx0 + 5, dy0 + 31.5, 8, 1.8, 0.16); rr(c, dx0 + 0.5, dy0, 9, 13, 3.2, 'rgba(125,211,252,.75)'); rr(c, dx0, dy0 + 12, 10, 18, 2, '#f8fafc');
    c.strokeStyle = '#cbd5e1'; c.lineWidth = 0.4; c.stroke(); rr(c, dx0 + 3, dy0 + 16, 4, 2, 0.8, '#60a5fa');
    pianta(c, COL_X[9], ROW_Y[4] + 12); pianta(c, COL_X[4], SH - 14); pianta(c, 20, SH - 14); pianta(c, SW - 14, SH - 14);
    return cv;
  }
  function scrivania(c, a, t) {
    const cx = a.cx, D = a.D;
    ombra(c, cx, D + 12, 15.5, 2.2, 0.16);
    rr(c, cx - 13.5, D + 3.5, 27, 8, 1.6, '#f8fafc'); c.strokeStyle = '#d5dde8'; c.lineWidth = 0.35; c.stroke();     // fianco bianco
    rr(c, cx - 5, D + 6, 10, 2, 1, a.look.camicia);                                                            // targhetta col colore del reparto
    rr(c, cx - 15, D - 0.6, 30, 5, 2.2, '#e9d6b8'); rr(c, cx - 15, D - 0.6, 30, 1.4, 0.7, 'rgba(255,255,255,.5)');   // piano in legno chiaro
    rr(c, cx - 12, D + 0.2, 11, 2.2, 0.9, '#cbd5e1');                                                         // tastiera
    cerchio(c, cx - 13, D + 1.3, 1.4, '#ffffff'); cerchio(c, cx - 13, D + 1.3, 0.8, '#92400e');                // tazza
    rr(c, cx + 6.5, D - 0.6, 6, 1, 0.5, '#94a3b8'); rr(c, cx + 8.1, D - 2, 2.8, 1.6, 0.5, '#94a3b8');         // base e piede del monitor
    rr(c, cx + 2.6, D - 11.2, 12.8, 9.4, 1.6, '#0f172a');
    const f = a.fase;
    c.fillStyle = f === 'lavora' ? grad(c, cx + 3, D - 10.5, cx + 15, D - 3, [[0, '#38bdf8'], [1, '#6366f1']]) : f === 'errore' ? grad(c, cx + 3, D - 10.5, cx + 15, D - 3, [[0, '#fca5a5'], [1, '#ef4444']]) : grad(c, cx + 3, D - 10.5, cx + 15, D - 3, [[0, '#1e293b'], [1, '#334155']]);
    rr(c, cx + 3.4, D - 10.4, 11.2, 7.7, 1.1, c.fillStyle);
    if (f === 'lavora') { c.fillStyle = 'rgba(255,255,255,.8)'; const k = Math.floor(t * 3); rr(c, cx + 4.6, D - 9.2, 3 + (k % 5), 0.9, 0.45, c.fillStyle); rr(c, cx + 4.6, D - 7.3, 7 - (k % 3), 0.9, 0.45, c.fillStyle); rr(c, cx + 4.6, D - 5.4, 4.2, 0.9, 0.45, c.fillStyle); }
  }
  function sprite(c, a, seduto, t) {
    const L = a.look, x = a.x, y = a.y, cam = L.camicia;
    const cammina = !seduto && a.stato === 'cammina', w = Math.sin(t * 9), yy = y - (cammina ? Math.abs(w) * 0.7 : 0), hy = yy - 13.6;
    if (!seduto) ombra(c, x, y + 0.4, 5.2, 1.5, 0.2);
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (!seduto) { const s = cammina ? w * 1.8 : 0; c.lineWidth = 2.3; c.strokeStyle = '#334155'; c.beginPath(); c.moveTo(x - 1.6, yy - 5); c.lineTo(x - 1.6 + s, y - 0.6); c.moveTo(x + 1.6, yy - 5); c.lineTo(x + 1.6 - s, y - 0.6); c.stroke(); }
    if (L.stile === 'lungo') rr(c, x - 4.4, hy - 3.9, 8.8, 9.6, 3.9, L.capelli);                                 // capelli dietro
    rr(c, x - 4, yy - 11.3, 8, 8.4, 3.3, cam); rr(c, x - 4, yy - 11.3, 8, 3.2, 1.6, 'rgba(255,255,255,.2)');     // busto
    c.lineWidth = 2; c.strokeStyle = cam; c.beginPath();
    if (seduto) { const k = a.fase === 'lavora' ? Math.sin(t * 14) * 0.9 : 0; c.moveTo(x - 3.6, yy - 9.5); c.lineTo(x - 2.6 + k, a.D + 0.8); c.moveTo(x + 3.6, yy - 9.5); c.lineTo(x + 2.6 - k, a.D + 0.8); }
    else { const s = cammina ? w * 1.6 : 0; c.moveTo(x - 3.8, yy - 9.5); c.lineTo(x - 4.6, yy - 5.2 + s); c.moveTo(x + 3.8, yy - 9.5); c.lineTo(x + 4.6, yy - 5.2 - s); }
    c.stroke();
    if (L.extra === 'cravatta') { c.beginPath(); c.moveTo(x, yy - 10.7); c.lineTo(x - 0.9, yy - 9); c.lineTo(x, yy - 6.3); c.lineTo(x + 0.9, yy - 9); c.closePath(); c.fillStyle = '#ef4444'; c.fill(); }
    rr(c, x - 1.2, yy - 11.6, 2.4, 2, 1, L.pelle);                                                             // collo
    cerchio(c, x, hy, 3.75, L.pelle);                                                                          // testa
    if (L.stile === 'riccio') [[-3, -2.4], [-1, -3.7], [1.2, -3.7], [3, -2.4]].forEach(([dx, dy]) => cerchio(c, x + dx, hy + dy, 1.95, L.capelli));
    else { c.beginPath(); c.arc(x, hy, 3.95, Math.PI * 1.04, Math.PI * 1.96); c.quadraticCurveTo(x + 1, hy - 2.3, x - 3.85, hy - 1.1); c.closePath(); c.fillStyle = L.capelli; c.fill(); }
    const ex = seduto ? 0 : a.dir * 0.5;
    cerchio(c, x - 1.35 + ex, hy + 0.2, 0.55, '#0f172a'); cerchio(c, x + 1.35 + ex, hy + 0.2, 0.55, '#0f172a');
    if (a.parla && Math.floor(t * 6) % 2) { c.beginPath(); c.ellipse(x + ex, hy + 1.6, 0.8, 0.6, 0, 0, 6.2832); c.fillStyle = '#9f1239'; c.fill(); }
    else { c.strokeStyle = '#9a3412'; c.lineWidth = 0.35; c.beginPath(); c.arc(x + ex, hy + 1, 0.9, Math.PI * 0.15, Math.PI * 0.85); c.stroke(); }
    if (L.extra === 'occhiali') { c.strokeStyle = '#0f172a'; c.lineWidth = 0.35; [-1.35, 1.35].forEach(d => { c.beginPath(); c.arc(x + d + ex, hy + 0.2, 1.15, 0, 6.2832); c.stroke(); }); c.beginPath(); c.moveTo(x - 0.2 + ex, hy + 0.2); c.lineTo(x + 0.2 + ex, hy + 0.2); c.stroke(); }
    if (L.extra === 'visiera') { rr(c, x - 4.1, hy - 3.9, 8.2, 1.6, 0.8, '#16a34a'); rr(c, x + (a.dir > 0 ? 1.6 : -5.6), hy - 2.7, 4, 0.9, 0.45, '#15803d'); }
  }
  function disegna(t, ms) {
    const c = stanza.ctx;
    c.drawImage(stanza.bg, 0, 0, SW, SH);
    const o = oraRoma(ms), giorno = o.h >= 7 && o.h < 18, sera = (o.h >= 18 && o.h < 21) || (o.h >= 5 && o.h < 7);
    c.save(); rr(c, 17, 7, 60, 30, 2); c.clip();                                                                  // cielo nella finestra
    c.fillStyle = giorno ? grad(c, 0, 7, 0, 37, [[0, '#9bd3ff'], [1, '#e6f4ff']]) : sera ? grad(c, 0, 7, 0, 37, [[0, '#fb923c'], [1, '#fecdd3']]) : grad(c, 0, 7, 0, 37, [[0, '#0b1220'], [1, '#1e3a8a']]);
    c.fillRect(17, 7, 60, 30);
    if (giorno) { c.fillStyle = 'rgba(255,255,255,.9)'; [[20 + ((t * 1.4) % 50), 14, 6, 2.2], [42 + ((t * 0.9) % 38), 22, 5, 1.8]].forEach(([x, y, rx, ry]) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 6.2832); c.fill(); }); }
    else if (!sera) { c.fillStyle = 'rgba(226,232,240,.9)'; [[24, 13], [36, 21], [30, 28], [58, 14], [68, 24], [62, 30]].forEach(([x, y]) => cerchio(c, x, y, 0.45)); c.fill(); }
    c.fillStyle = giorno ? 'rgba(100,116,139,.35)' : 'rgba(15,23,42,.55)';
    [[18, 28, 6, 9], [25, 24, 5, 13], [31, 29, 7, 8], [39, 26, 5, 11], [52, 27, 6, 10], [60, 23, 5, 14], [67, 28, 8, 9]].forEach(([x, y, w, h]) => c.fillRect(x, y, w, h));
    c.restore();
    c.fillStyle = '#ffffff'; c.fillRect(46, 7, 2, 30);
    cerchio(c, 440, 20, 9.4, '#ffffff'); c.strokeStyle = '#cbd5e1'; c.lineWidth = 0.8; c.stroke();                // orologio
    const am = o.m * 6 * Math.PI / 180, ah = ((o.h % 12) + o.m / 60) * 30 * Math.PI / 180;
    c.strokeStyle = '#0f172a'; c.lineCap = 'round'; c.lineWidth = 1; c.beginPath(); c.moveTo(440, 20); c.lineTo(440 + Math.sin(am) * 6.6, 20 - Math.cos(am) * 6.6); c.stroke();
    c.lineWidth = 1.4; c.beginPath(); c.moveTo(440, 20); c.lineTo(440 + Math.sin(ah) * 4.2, 20 - Math.cos(ah) * 4.2); c.stroke();
    for (const a of stanza.ag) rr(c, a.sx - 5.8, a.D - 9.5, 11.6, 10, 3.6, '#64748b');                               // schienali
    stanza.ag.filter(a => a.stato === 'seduto').forEach(a => sprite(c, a, true, t));
    stanza.ag.forEach(a => scrivania(c, a, t));
    stanza.ag.filter(a => a.stato !== 'seduto').sort((p, q) => p.y - q.y).forEach(a => sprite(c, a, false, t));
  }
  function aggiornaOverlay() {
    for (const a of stanza.ag) {
      if (!a.el) continue;
      a.el.style.left = (a.x / SW * 100).toFixed(2) + '%'; a.el.style.top = ((a.y - 19) / SH * 100).toFixed(2) + '%';
      let testo = '', cls = '';
      if (a.parla) { testo = a.parla; cls = a.parlaChiac ? 'chiac' : ''; }
      else if (a.stato === 'seduto' && a.fase === 'lavora') { testo = a.lavoro; cls = 'lavoro'; }
      else if (a.stato === 'seduto' && a.fase === 'errore') { testo = a.lavoro; cls = 'errore'; }
      const k = cls + '|' + testo;
      if (k !== a._k) { a._k = k; a.bub.textContent = testo; a.bub.hidden = !testo; a.bub.className = 'st-bub ' + cls; a.el.classList.toggle('parla', !!a.parla); }
    }
  }
  function aggiornaPannelli() {
    const host = document.querySelector('.rd-ufficio'); if (!host) return;
    const ag = agenti(), n = ag.filter(a => a.stato === 'lavora').length;
    const per = { uomini: 0, donne: 0, direzione: 0 };
    stanza.ag.forEach(a => { if (a.fase === 'lavora') per[a.col < 4 ? 'uomini' : a.col < 8 ? 'donne' : 'direzione']++; });
    host.querySelectorAll('[data-bd]').forEach(el => { const n = per[el.dataset.bd]; el.textContent = n ? ' · ' + n + ' al lavoro' : ''; });
    const conto = host.querySelector('.st-conto'); if (conto) conto.textContent = n ? `${n} al lavoro adesso` : 'tutti fermi, nessuna bozza in scrittura';
    const av = host.querySelector('.st-avviso'), kk = st.costi;
    if (av) {
      const msg = !kk ? '' : !kk.chiave ? 'Manca la chiave dell\'AI sul server: nessuno può scrivere.' : !kk.config.ai_attiva ? 'L\'AI è spenta: nessuno può scrivere.' : !kk.config.auto_attiva ? 'La scrittura automatica è spenta: nessuno scrive da solo (gli spunti si calcolano lo stesso).' : '';
      const btn = kk && kk.chiave && kk.config.ai_attiva && !kk.config.auto_attiva;
      const h = msg + '|' + btn;
      if (av.dataset.h !== h) { av.dataset.h = h; av.hidden = !msg; av.innerHTML = esc(msg) + (btn ? ' <button type="button" class="admin-edit-btn" data-accendi="1">Accendi la scrittura automatica</button>' : ''); }
    }
    const lav = host.querySelector('.st-lavagna');
    if (lav) lav.textContent = `Bozze ${st.bozze.filter(b => b.stato === 'bozza').length} · Spunti ${st.spunti ? st.spunti.spunti.filter(s => s.stato === 'nuovo').length : 0}`;
    const riga = d => `<div><span class="st-pt ${d.stato}"></span><span><b>${esc(d.nome)}</b>: ${esc(d.testo)}</span></div>`;
    const el = host.querySelector('.st-elenco'), dir = ag.filter(d => !d.reparto), rep = ag.filter(d => d.reparto), nl = rep.filter(d => d.stato === 'lavora').length;
    const h1 = dir.map(riga).join('') + `<details ${stanza.repAperti ? 'open' : ''}><summary>Reparti per categoria (${rep.length}${nl ? ', ' + nl + ' al lavoro' : ''})</summary>${rep.map(riga).join('')}</details>`;
    if (el && el.dataset.h !== h1) { el.dataset.h = h1; el.innerHTML = '<b>Chi fa cosa adesso</b>' + h1; const d = el.querySelector('details'); if (d) d.ontoggle = () => { stanza.repAperti = d.open; }; }
    const lg = host.querySelector('.st-log'), h2 = stanza.log.map(l => `<li><time>${esc(hhmm(l.ts))}</time><b>${esc(l.da)}</b> a <b>${esc(l.a)}</b>: ${esc(l.t1)}${l.t2 ? ' «' + esc(l.t2) + '»' : ''}</li>`).join('');
    if (lg && lg.dataset.h !== h2) { lg.dataset.h = h2; lg.innerHTML = '<b>Cosa si sono detti</b>' + (h2 ? `<ol>${h2}</ol>` : '<div class="rd-muted">Ancora niente: appena parte un incarico, li vedi parlare.</div>'); }
  }
  function applicaVista() {
    const room = document.querySelector('.st-room'); if (!room) return;
    const [x0, x1] = VISTE[stanza.vista] || VISTE.tutto, w = x1 - x0, tutto = stanza.vista === 'tutto';
    room.style.setProperty('--ar', w + '/' + SH); room.style.setProperty('--ww', (SW / w * 100) + '%'); room.style.setProperty('--wl', (-x0 / w * 100) + '%');
    room.style.width = tutto ? 'min(100%, 900px)' : 'min(100%, ' + Math.round(w * 2.5) + 'px)'; room.style.minWidth = tutto ? '720px' : '0';
    const px = room.clientWidth || 900;                                          // nello zoom il testo e un po piu grande, ma sempre proporzionato alla finestra
    room.style.setProperty('--tz', tutto ? '1' : String(+(11.5 * 100 / (1.12 * px)).toFixed(3)));
    if (!stanza.rz) { stanza.rz = true; window.addEventListener('resize', () => { if (document.querySelector('.st-room')) applicaVista(); }); }
    document.querySelectorAll('.st-tab').forEach(b => b.classList.toggle('on', b.dataset.vista === stanza.vista));
  }
  function montaStanza() {
    const host = document.querySelector('.rd-ufficio'); if (!host) return;
    inizStanza();
    stanza.rm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    host.innerHTML = `<div class="rd-uff-head"><h3>L'ufficio</h3><small class="st-conto"></small><small>fumetto pieno = fatto vero · tratteggiato = chiacchiere</small></div>
      <div class="st-avviso" hidden></div>
      <div class="st-tabs"><button type="button" class="st-tab" data-vista="tutto">Tutto l'ufficio</button><button type="button" class="st-tab" data-vista="uomini">Uomini<small data-bd="uomini"></small></button><button type="button" class="st-tab" data-vista="donne">Donne<small data-bd="donne"></small></button><button type="button" class="st-tab" data-vista="direzione">Direzione<small data-bd="direzione"></small></button></div>
      <div class="st-scroll"><div class="st-room"><div class="st-world"><canvas class="st-cv" width="${SW * SCALA}" height="${SH * SCALA}"></canvas><div class="st-lavagna"></div>
        <div class="st-zona" data-vista="uomini" style="left:${(ZONE[0][0] + ZONE[0][1]) / 2 / SW * 100}%">UOMINI · reparti</div><div class="st-zona" data-vista="donne" style="left:${(ZONE[1][0] + ZONE[1][1]) / 2 / SW * 100}%">DONNE · reparti</div><div class="st-zona" data-vista="direzione" style="left:${(ZONE[2][0] + ZONE[2][1]) / 2 / SW * 100}%">DIREZIONE</div>
        <div class="st-ov"></div></div></div></div>
      <div class="st-sotto"><div class="st-elenco"></div><div class="st-log"></div></div>`;
    applicaVista();
    host.onclick = async ev => {
      const vv = ev.target.closest('[data-vista]'); if (vv) { stanza.vista = vv.dataset.vista; applicaVista(); return; }
      if (!ev.target.closest('[data-accendi]')) return;
      try {
        await api('/config', { method: 'PUT', body: { auto_attiva: true } });
        await caricaCosti(); aggiornaStanza();
        const w = document.querySelector('.rd-costiwrap'); if (w) { w.innerHTML = costiPanel(); lega(); }
        if (typeof showToast === 'function') showToast('Scrittura automatica accesa: 3 volte al giorno, entro il limite mensile');
      } catch (e) { if (typeof showToast === 'function') showToast((e && e.message) || 'Errore', 'error'); }
    };
    const canvas = host.querySelector('.st-cv'), ov = host.querySelector('.st-ov');
    stanza.canvas = canvas; stanza.ctx = canvas.getContext('2d'); stanza.ctx.setTransform(SCALA, 0, 0, SCALA, 0, 0); stanza.bg = costruisciSfondo();
    for (const a of stanza.ag) {
      a.el = document.createElement('div'); a.el.className = 'st-ag'; a._k = '';
      a.bub = document.createElement('div'); a.bub.className = 'st-bub'; a.bub.hidden = true;
      const nome = document.createElement('div'); nome.className = 'st-nome'; nome.textContent = a.nome.replace('Responsabile', 'Resp.').replace(/^Ricercatore /, 'Ric. '); nome.style.setProperty('--c', a.look.camicia);
      a.el.appendChild(a.bub); a.el.appendChild(nome); ov.appendChild(a.el);
    }
    aggiornaStanza(); aggiornaOverlay();
    const gen = ++stanza.gen; let ultimo = 0;
    const ciclo = ts => {
      if (gen !== stanza.gen || !document.body.contains(canvas)) return;
      if (!document.hidden) {
        const dt = ultimo ? Math.min(0.25, (ts - ultimo) / 1000) : 0; ultimo = ts;
        stanza.ag.forEach(a => muovi(a, dt)); giraScene(ts); giraGiretti(ts);
        disegna(ts / 1000, ts); aggiornaOverlay();
      } else ultimo = 0;
      requestAnimationFrame(ciclo);
    };
    requestAnimationFrame(ciclo);
  }

  function tickUfficio() {
    clearTimeout(st.tu);
    if (!document.querySelector('.rd-wrap')) return;
    st.tu = setTimeout(async () => {
      if (document.querySelector('.rd-wrap') && !document.hidden) {
        st.nt = (st.nt || 0) + 1; if (st.nt % 12 === 0 && !st.spOcc.size) { await Promise.all([caricaSpunti(), st.radarBusy ? null : caricaRadar()]); const el = document.querySelector('.rd-spunti'); if (el) el.innerHTML = spuntiPanel(); const er = document.querySelector('.rd-radar'); if (er && !st.radarBusy) er.innerHTML = radarPanel(); }
        const firma = () => st.bozze.map(b => b.id + b.stato).join();
        const prima = firma();
        await Promise.all([carica(), caricaCosti()]);
        aggiornaStanza();
        if (firma() !== prima) paint(true);
      }
      tickUfficio();
    }, 5000);
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
      <div class="rd-ufficio"></div>
      <div class="rd-spunti">${spuntiPanel()}</div>
      <div class="rd-radar">${radarPanel()}</div>
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
    montaStanza();
  }

  function lega() {
    const w = document.querySelector('.rd-wrap'); if (!w) return;
    legaSpunti(); legaRadar();
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
    st.msg = ''; await Promise.all([carica(), cercaOra(), caricaCosti(), caricaSpunti(), caricaRadar()]);
    if (!sel()) { const p = st.bozze.find(b => b.stato === 'bozza' || b.stato === 'approvata'); if (p) st.sel = p.id; }
    if (!document.getElementById('rd-uff-css')) { const s = document.createElement('style'); s.id = 'rd-uff-css'; s.textContent = UFF_CSS; document.head.appendChild(s); }
    paint(); tickUfficio();
  }
  window.renderRedazione = render;
})();
