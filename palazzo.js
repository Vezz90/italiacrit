/* ============================================================
   ICS — Palazzo 3D della Redazione (solo amministratori)
   Vista 3D dell'ufficio: un piano per categoria, gli addetti come ciclisti, scene dagli eventi veri.
   Si monta dentro la pagina Redazione (redazione.js) in un Shadow DOM; i dati arrivano dalla pagina,
   nessun token da incollare. Three.js r128 viene caricato da cdnjs solo quando serve.
   ============================================================ */
'use strict';

(function () {
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const CSS = `  * { box-sizing:border-box; }
  .scena { position:relative; margin:0 0 10px; height:min(78vh,720px); min-height:440px; border-radius:16px; overflow:hidden; background:#cfd9e8; box-shadow:0 10px 30px rgba(15,23,42,.18),0 0 0 1px var(--line); touch-action:pan-y; }
  .scena canvas { display:block; width:100%; height:100%; cursor:grab; } .scena canvas:active { cursor:grabbing; }
  .piani { position:absolute; right:12px; top:12px; display:flex; flex-direction:column; gap:5px; padding:8px; border-radius:14px; background:rgba(15,23,42,.82); color:#fff; box-shadow:0 8px 24px rgba(0,0,0,.3); z-index:5; }
  .piani b { font-size:10px; letter-spacing:.08em; text-transform:uppercase; opacity:.7; text-align:center; margin-bottom:2px; }
  .piani button { display:flex; align-items:center; gap:8px; border:0; border-radius:9px; padding:6px 10px 6px 6px; background:rgba(255,255,255,.1); color:#fff; font:600 12px system-ui; cursor:pointer; text-align:left; }
  .piani button:hover { background:rgba(255,255,255,.22); } .piani button.on { background:#4f46e5; }
  .piani i { font-style:normal; width:22px; height:22px; border-radius:50%; display:grid; place-items:center; font-size:11px; background:rgba(255,255,255,.18); }
  .piani button.on i { background:#fff; color:#4f46e5; }
  .piani .lati { display:grid; grid-template-columns:repeat(3,auto); gap:4px; margin-top:4px; }
  .nome { position:absolute; transform:translate(-50%,0); font:600 11px system-ui; padding:2px 8px; border-radius:99px; background:rgba(15,23,42,.8); color:#fff; white-space:nowrap; pointer-events:none; }
  .nome.sel { background:#f59e0b; color:#111827; z-index:4; } .nome.vez { background:#be123c; } .nome.lav::after { content:" ✎"; }
  .etich { position:absolute; transform:translate(0,-50%); font:700 12px system-ui; padding:3px 9px; border-radius:8px; background:rgba(255,255,255,.92); color:#0f172a; white-space:nowrap; pointer-events:none; box-shadow:0 2px 8px rgba(15,23,42,.18); }
  .etich small { font-weight:500; color:#64748b; margin-left:5px; }
  .bolla { position:absolute; transform:translate(-50%,-100%); max-width:230px; padding:7px 11px; border-radius:12px; background:#fff; color:#0f172a; font:500 12.5px/1.3 system-ui; box-shadow:0 6px 18px rgba(15,23,42,.25),0 0 0 1px rgba(15,23,42,.06); pointer-events:none; z-index:3; }
  .bolla.chiac { background:rgba(255,255,255,.88); box-shadow:none; border:1.5px dashed rgba(15,23,42,.35); }
  .bolla b { display:block; font-size:10.5px; color:#64748b; font-weight:600; margin-bottom:2px; }
  .card { position:absolute; left:12px; top:12px; width:min(300px,calc(100% - 150px)); max-height:calc(100% - 24px); overflow:auto; padding:12px; border-radius:14px; background:rgba(255,255,255,.96); color:#0f172a; box-shadow:0 10px 30px rgba(15,23,42,.3); z-index:6; display:none; }
  .card h4 { margin:0 0 1px; font-size:15px; } .card small { color:#64748b; display:block; }
  .card .x { position:absolute; right:8px; top:6px; border:0; background:none; font-size:20px; line-height:1; cursor:pointer; color:#64748b; }
  .card p { margin:8px 0; font-size:12.5px; padding:6px 8px; border-radius:8px; background:#f1f5f9; }
  .card .rig { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0; }
  .card button.b, .modal button.b { border:0; border-radius:8px; padding:6px 10px; font:600 12px system-ui; cursor:pointer; background:#e2e8f0; color:#0f172a; }
  .card button.b.on { background:#f59e0b; } .card button.go, .modal button.go { background:#4f46e5; color:#fff; }
  .card textarea { width:100%; font:13px system-ui; border:1px solid #cbd5e1; border-radius:8px; padding:6px 8px; resize:vertical; }
  .card label { font-size:11.5px; font-weight:700; color:#334155; display:block; margin-top:8px; }
  .card .pian { display:grid; grid-template-columns:repeat(8,1fr); gap:3px; } .card .pian button { padding:5px 0; border:0; border-radius:6px; background:#e2e8f0; font:700 11px system-ui; cursor:pointer; } .card .pian button.on { background:#4f46e5; color:#fff; }
  .modal { position:absolute; inset:0; z-index:9; display:none; align-items:center; justify-content:center; background:rgba(15,23,42,.45); }
  .modal > div { width:min(380px,92%); max-height:92%; overflow:auto; background:#fff; color:#0f172a; border-radius:16px; padding:16px; box-shadow:0 20px 50px rgba(0,0,0,.4); }
  .modal h4 { margin:0 0 8px; } .modal label { display:block; font-size:11.5px; font-weight:700; margin:10px 0 4px; color:#334155; }
  .sw { display:flex; gap:5px; flex-wrap:wrap; } .sw i { width:24px; height:24px; border-radius:50%; cursor:pointer; box-shadow:0 0 0 1px rgba(15,23,42,.2); } .sw i.on { box-shadow:0 0 0 3px #4f46e5; }
  .tog { display:flex; gap:12px; flex-wrap:wrap; font-size:12.5px; } .tog label { font-weight:500; margin:0; display:flex; gap:5px; align-items:center; }
  #avviso { position:absolute; inset:0; display:none; align-items:center; justify-content:center; text-align:center; padding:20px; color:#334155; }
  #lento { position:absolute; left:50%; bottom:10px; transform:translateX(-50%); display:none; align-items:center; gap:8px; padding:6px 8px 6px 12px; border-radius:99px; background:#b45309; color:#fff; font:600 12px system-ui; z-index:7; white-space:nowrap; }
  #lento button { border:0; border-radius:99px; padding:4px 10px; background:#fff; color:#92400e; font:700 11px system-ui; cursor:pointer; }
  #toast { position:absolute; left:50%; top:12px; transform:translateX(-50%); padding:6px 14px; border-radius:99px; background:rgba(15,23,42,.9); color:#fff; font:600 12.5px system-ui; z-index:10; display:none; max-width:90%; }
  #segui { position:absolute; left:50%; bottom:10px; transform:translateX(-50%); display:none; padding:6px 12px; border-radius:99px; background:#4f46e5; color:#fff; font:600 12px system-ui; z-index:7; border:0; cursor:pointer; }
  .sotto { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px; padding:0; }
  .box { background:rgba(128,128,128,.08); border:1px solid rgba(128,128,128,.28); border-radius:12px; padding:10px 12px; }
  .box h3 { margin:0 0 6px; font-size:.85rem; }
  .box ol { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:4px; font-size:.82rem; }
  .box time { opacity:.65; margin-right:6px; font-variant-numeric:tabular-nums; }
  @media (max-width:640px) { .card { top:auto; bottom:8px; left:8px; width:calc(100% - 16px); max-height:55%; } .piani button { padding:4px 8px 4px 4px; font-size:11px; } }
  :host { display:block; color:inherit; font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif; }
  .barra { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:0 0 8px; font-size:12px; opacity:.85; }
  .barra select { margin-left:auto; font:inherit; font-size:12px; padding:3px 6px; border-radius:8px; border:1px solid rgba(128,128,128,.4); background:rgba(128,128,128,.1); color:inherit; }
  .barra select option { color:#0f172a; }
  .gen { display:flex; gap:4px; } .gen button { border:1px solid rgba(128,128,128,.45); background:rgba(128,128,128,.12); color:inherit; border-radius:99px; padding:3px 14px; font:700 12px system-ui; cursor:pointer; } .gen button.on { background:#4f46e5; border-color:#4f46e5; color:#fff; }
`;
  const HTML = `<div class="barra"><span class="gen"><button type="button" data-g="M">Uomini</button><button type="button" data-g="F">Donne</button></span><span>Clicca un piano per mandarci Vezz · clicca un omino: Vezz gli va accanto · trascina per ruotare · rotella per avvicinarti</span>
  <select id="qual" title="Qualità grafica"><option value="auto">Qualità: automatica</option><option value="0">Qualità alta</option><option value="1">Qualità media</option><option value="2">Qualità bassa</option><option value="3">Qualità minima</option></select></div>
<div class="scena" id="scena">
  <div class="piani" id="piani"><b>Ascensore</b></div>
  <div class="card" id="card"></div>
  <div class="modal" id="modal"></div>
  <div id="toast"></div><div id="lento"><span>Il dispositivo fa fatica</span><button type="button" id="lento2d">Passa alla stanza 2D</button></div>
  <button id="segui" type="button">Smetti di seguire</button>
  <div id="avviso">Il 3D non è disponibile su questo dispositivo.</div>
</div>
<div class="sotto">
  <div class="box"><h3>Cosa si sono detti</h3><ol id="log"></ol></div>
  <div class="box"><h3>Come si usa</h3><small>Un piano per categoria: Uomini a sinistra, Donne a destra, due file di banchi con il cartello del ruolo a muro. <b>Vezz</b> è il tuo personaggio e riparte dall'ultimo piano dove sei stato: clicca un piano (o il pavimento) e ci va, clicca un omino e gli va accanto; lì si apre la scheda e gli dici cosa fare (compito diretto: parte una richiesta vera, a pagamento come un articolo). Puoi anche personalizzarlo. Fumetto pieno = fatto vero, tratteggiato = chiacchiere.</small></div>
</div>`;

  function carica() {
    if (window.THREE) return Promise.resolve(true);
    if (carica.p) return carica.p;
    carica.p = new Promise(res => { const s = document.createElement('script'); s.src = THREE_URL; s.onload = () => res(!!window.THREE); s.onerror = () => { carica.p = null; res(false); }; document.head.appendChild(s); });
    return carica.p;
  }
  function webgl() { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; } }

  // contenitore = elemento della pagina; ctx = { leggi(), agenteDiBozza(b), respDi(nome), inviaCompito(nome, testo) -> {id}|null, passa2D() }
  function monta(contenitore, ctx) {
  const root = contenitore.shadowRoot || contenitore.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + CSS + '</style>' + HTML;
  const host = root.getElementById('scena');
  if (!window.THREE) { root.getElementById('avviso').style.display = 'flex'; return null; }
  let morto = false;
  const FH = 4.6, NP = 6, AIS_Z = 3.9, CORR = 7.6;                 // altezza piano, numero piani, corsia davanti, corridoi laterali
  // posti: due file in profondita per lato (fondo e davanti), due colonne
  const SLOTP = [[-9.6, -2.9], [-5.6, -2.9], [-9.6, 1.4], [-5.6, 1.4], [5.6, -2.9], [9.6, -2.9], [5.6, 1.4], [9.6, 1.4]];

  // ---------- struttura del palazzo ----------
  const CATS = { ES1: ['Esord. 1°', '#7c3aed'], ES2: ['Esord. 2°', '#db2777'], AL: ['Allievi', '#d97706'], JUN: ['Juniores', '#16a34a'], ELI: ['Elite/U23', '#2563eb'] };
  const CATN = { ES1: 'Esordienti 1° anno', ES2: 'Esordienti 2° anno', AL: 'Allievi', JUN: 'Juniores', ELI: 'Elite / Under 23' };
  const PIANI = [
    { nome: 'Hall', sotto: 'Cassa e notizie', col: '#475569' },
    { nome: 'Esordienti', cats: ['ES1', 'ES2'] }, { nome: 'Allievi e Juniores', cats: ['AL', 'JUN'] }, { nome: 'Elite / Under 23', cats: ['ELI'] },
    { nome: 'Tech', sotto: 'Materiali e bici', col: '#ea580c' }, { nome: 'Direzione', sotto: 'Caporedattore e redazione', col: '#6d28d9' }
  ];
  PIANI.forEach((p, i) => { p.i = i; p.y = i * FH; if (p.cats) { p.col = CATS[p.cats[0]][1]; p.sotto = p.cats.map(c => CATS[c][0]).join(' · '); } p.attivo = true; });
  let pianoIniz = 0; try { pianoIniz = Math.max(0, Math.min(NP - 1, parseInt(localStorage.getItem('p3d-piano') || '0', 10) || 0)); } catch (e) { /* parte dalla hall */ }
  let genere = 'M'; try { genere = localStorage.getItem('p3d-genere') === 'F' ? 'F' : 'M'; } catch (e) { /* default */ }
  const PELLI = ['#f1c9a5', '#e8b98e', '#8d5a3b', '#f5d0b0', '#c68642', '#d8a06f', '#e0ac82', '#a9714b'];
  const CAPELLI = ['#4b5563', '#78350f', '#111827', '#92400e', '#374151', '#1f2937', '#422006', '#7c2d12'];
  const COLORI = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#f8fafc'];
  const scuro = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
  const DEFS = [];                                                // chi lavora dove (i nomi sono quelli veri del sito)
  Object.keys(CATS).forEach(cat => {
    const p = PIANI.findIndex(x => x.cats && x.cats.includes(cat)), latoCat = PIANI[p].cats.indexOf(cat), [nome, col] = CATS[cat];
    ['M', 'F'].forEach(sx => [['resp', 'Responsabile'], ['atleti', 'Atleti'], ['team', 'Team'], ['ric', 'Ricercatore']].forEach(([r, et], ri) => {
      const k = DEFS.length;
      DEFS.push({ nome: `${et} ${nome} ${sx}`, etich: et, piano: p, slot: latoCat * 4 + ri, ruolo: r, sesso: sx, cat,
        look: { maglia: r === 'resp' ? '#334155' : r === 'team' ? scuro(col, 0.62) : r === 'ric' ? '#0369a1' : col, accento: col, casco: r === 'team' ? '#f8fafc' : r === 'ric' ? '#e0f2fe' : col, lunga: r === 'resp', occhiali: true,
          pelle: PELLI[(k * 5 + 2) % 8], capelli: CAPELLI[(k * 3 + 1) % 8], coda: sx === 'F', copricapo: 'casco' } });
    }));
  });
  const STAFF = [
    ['Caporedattore', 5, 0, { maglia: '#7c3aed', capelli: '#4b5563', pelle: '#f1c9a5' }], ['Capo servizio', 5, 1, { maglia: '#475569', capelli: '#9ca3af', pelle: '#e0ac82' }],
    ['Cronista', 5, 2, { maglia: '#16a34a', capelli: '#78350f', pelle: '#e8b98e' }], ['Ricercatore', 5, 3, { maglia: '#0ea5e9', capelli: '#1f2937', pelle: '#f1c9a5', coda: true }],
    ['Analista', 5, 4, { maglia: '#65a30d', capelli: '#422006', pelle: '#d8a06f' }], ['Inviato speciale', 5, 5, { maglia: '#0d9488', capelli: '#374151', pelle: '#c68642' }],
    ['Redattore Tech', 4, 1, { maglia: '#ea580c', capelli: '#1f2937', pelle: '#d8a06f' }], ['Ricercatore Tech', 4, 5, { maglia: '#0891b2', capelli: '#422006', pelle: '#f1c9a5', coda: true }],
    ['Cassiere', 0, 4, { maglia: '#d97706', capelli: '#7c2d12', pelle: '#e0ac82' }]
  ];
  STAFF.forEach(([nome, piano, slot, l]) => DEFS.push({ nome, etich: nome, piano, slot, ruolo: 'staff', sesso: l.coda ? 'F' : 'M', cat: null, look: Object.assign({ accento: '#ffffff', casco: l.maglia, lunga: true, occhiali: false, copricapo: 'berretto' }, l) }));
  // Vezz: il personaggio dell'utente, senza banco
  const VEZZ0 = { maglia: '#be123c', casco: '#f8fafc', pelle: '#e8b98e', capelli: '#1f2937', occhiali: true, coda: false, lunga: false, copricapo: 'casco' };
  let vezzLook = Object.assign({}, VEZZ0); try { Object.assign(vezzLook, JSON.parse(localStorage.getItem('p3d-vezz') || '{}')); } catch (e) { /* default */ }
  DEFS.push({ nome: 'Vezz', etich: 'Vezz', piano: pianoIniz, slot: -1, ruolo: 'vezz', sesso: 'M', cat: null, look: Object.assign({}, vezzLook, { accento: '#fbbf24' }) });

  // ---------- renderer, camera, luci ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xcfd9e8);
  host.insertBefore(renderer.domElement, host.firstChild);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xcfd9e8, 90, 220);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaab6cb, 0.95));
  const sole = new THREE.DirectionalLight(0xffffff, 0.75); sole.castShadow = false; sole.shadow.mapSize.set(2048, 2048);
  Object.assign(sole.shadow.camera, { left: -16, right: 16, top: 7, bottom: -7, near: 1, far: 60 }); sole.shadow.bias = -0.0004; sole.shadow.normalBias = 0.04;
  scene.add(sole, sole.target);
  const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0.02 }, o || {}));
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const tondo = (r, m, sx, sy, sz) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m); o.scale.set(sx || 1, sy || 1, sz || 1); return o; };
  const ombra = o => { o.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); return o; };
  function capsula(r, h, m) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), m));
    const a = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), m); a.position.y = h / 2; g.add(a);
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), m); b.position.y = -h / 2; g.add(b); return g;
  }

  // ---------- piani, pareti, scrivanie ----------
  let dest = scene; const pianoG = [];
  function disegnaTarga(m, testo, sotto) {
    const c = m.userData.c, g = c.getContext('2d'), col = m.userData.col;
    g.fillStyle = col || '#0f172a'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 ' + Math.round(c.height * (sotto ? 0.34 : 0.5)) + 'px system-ui'; g.fillText(testo, c.width / 2, c.height * (sotto ? 0.5 : 0.68));
    if (sotto) { g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '500 ' + Math.round(c.height * 0.18) + 'px system-ui'; g.fillText(sotto, c.width / 2, c.height * 0.8); }
    m.userData.t.needsUpdate = true;
  }
  function targa(testo, sotto, w, h, x, y, z, col) {
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t })); m.position.set(x, y, z); m.userData = { c, t, col };
    disegnaTarga(m, testo, sotto); dest.add(m); return m;
  }
  const SCHERMI = [0, 1, 2, 3].map(i => { const c = document.createElement('canvas'); c.width = 96; c.height = 60; const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return { c, t, fase: i * 1.9 }; });
  function disegnaSchermi(tempo) {
    SCHERMI.forEach(s => {
      const g = s.c.getContext('2d'); g.fillStyle = '#0b1220'; g.fillRect(0, 0, 96, 60); g.fillStyle = '#38bdf8'; g.fillRect(0, 0, 96, 7);
      for (let i = 0; i < 5; i++) { const w = 22 + (Math.sin(s.fase + i * 1.7 + tempo * 1.4) + 1) * 26; g.fillStyle = 'rgba(226,232,240,.85)'; g.fillRect(6, 13 + i * 9, w, 3.5); }
      s.t.needsUpdate = true;
    });
  }
  const finestre = [];
  const matLegno = mat(0xe9d8bf), matGamba = mat(0x64748b), matMon = mat(0x1e293b), matSedia = mat(0x475569);
  const geoTop = new THREE.BoxGeometry(2.1, 0.08, 0.95), geoFianco = new THREE.BoxGeometry(0.06, 0.78, 0.9), geoBase = new THREE.BoxGeometry(0.62, 0.03, 0.42), geoLap = new THREE.BoxGeometry(0.64, 0.4, 0.025), geoLogo = new THREE.PlaneGeometry(0.14, 0.14), geoSch2 = new THREE.PlaneGeometry(0.58, 0.34);
  function scrivania(piano, x, z, k, colore) {
    const g = new THREE.Group(), y = piano.y;
    const top = new THREE.Mesh(geoTop, matLegno); top.position.set(0, 0.8, 0.9); g.add(top);
    [-1, 1].forEach(l => { const f = new THREE.Mesh(geoFianco, matGamba); f.position.set(l * 1.0, 0.4, 0.9); g.add(f); });
    const base = new THREE.Mesh(geoBase, matMon); base.position.set(0, 0.85, 0.62); g.add(base);
    const sch = new THREE.Mesh(geoLap, matMon); sch.position.set(0, 1.03, 0.82); sch.rotation.x = 0.2; g.add(sch);
    const logo = new THREE.Mesh(geoLogo, new THREE.MeshBasicMaterial({ color: new THREE.Color(colore || piano.col) })); logo.position.set(0, 1.04, 0.842); logo.rotation.x = 0.2; g.add(logo);
    const sm = new THREE.MeshBasicMaterial({ map: SCHERMI[k % 4].t }); const sc = new THREE.Mesh(geoSch2, sm); sc.position.set(0, 1.035, 0.793); sc.rotation.set(0.2, Math.PI, 0); g.add(sc);
    g.position.set(x, y, z); dest.add(ombra(g));
    const s = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 14), matSedia); seat.position.y = 0.5; s.add(seat);
    const dos = box(0.55, 0.55, 0.07, matSedia); dos.position.set(0, 0.85, -0.3); s.add(dos);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), matGamba); col.position.y = 0.25; s.add(col);
    s.position.set(x, y, z - 0.02); dest.add(ombra(s));
    return g;
  }
  const mescola = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();
  let tabellone = null;
  PIANI.forEach(p => {
    const y = p.y; const GP = new THREE.Group(); scene.add(GP); dest = GP; pianoG[p.i] = GP;
    const sol = box(27.4, 0.3, 10.8, mat(0xcbd5e1)); sol.position.set(0, y - 0.15, 0.4); sol.receiveShadow = true; sol.castShadow = true; dest.add(sol);
    const bordo = box(27.4, 0.18, 0.25, mat(new THREE.Color(p.col))); bordo.position.set(0, y + 0.0, 5.65); dest.add(bordo);
    const pav = box(26.6, 0.04, 10, mat(new THREE.Color(mescola(p.col, 0.85)), { roughness: 0.95 })); pav.position.set(0, y + 0.02, 0); pav.receiveShadow = true; dest.add(pav);
    const muro = box(27.4, FH - 0.3, 0.3, mat(new THREE.Color(mescola(p.col, 0.9)))); muro.position.set(0, y + FH / 2 - 0.15, -5.2); muro.receiveShadow = true; dest.add(muro);
    const zoc = box(27.4, 0.35, 0.34, mat(new THREE.Color(mescola(p.col, 0.55)))); zoc.position.set(0, y + 0.2, -5.0); dest.add(zoc);
    [-1, 1].forEach(l => { const w = box(0.3, FH - 0.3, 10.8, mat(0xf1f5f9)); w.position.set(l * 13.55, y + FH / 2 - 0.15, 0.4); dest.add(w); });
    const wins = [];
    [-9.5, -6, 6, 9.5].forEach(x => { const f = box(2.4, 1.05, 0.08, mat(0xbfdbfe, { emissive: 0xfde68a, emissiveIntensity: 0.1 })); f.position.set(x, y + 1.55, -5.0); dest.add(f); wins.push(f); });
    finestre.push(wins);
    // cartelli a muro: il piano (con Uomini/Donne) sopra l'ascensore; le categorie ai due lati; il ruolo sopra ogni banco
    p.targa = targa(p.nome, p.cats ? (genere === 'M' ? 'Uomini' : 'Donne') : p.sotto, 6, 1.2, 0, y + 3.72, -4.93, p.col);
    if (p.cats) p.cats.forEach((c, k) => targa(CATN[c], '', 4.2, 0.55, k ? 7.6 : -7.6, y + 3.87, -4.93, scuro(CATS[c][1], 0.8)));
    if (p.i === 0) tabellone = targa('Bozze 7 · Spunti 15', 'Costi 0,57 $ su 10 $', 4.8, 1.1, 7.5, y + 3.7, -4.93, '#0f172a');
    DEFS.filter(d => d.piano === p.i && d.slot >= 0 && (d.sesso === 'M' || !d.cat)).forEach(d => {          // una scrivania per posto (uomini e donne si siedono alla stessa)
      const [sx, sz] = SLOTP[d.slot], cc = d.cat ? CATS[d.cat][1] : p.col; scrivania(p, sx, sz, d.slot + p.i, cc); targa(d.etich, '', 2.1, 0.46, sx, y + (sz < 0 ? 3.25 : 2.74), -4.93, cc);
    });   // fila di fondo in alto, fila davanti sotto
    dest = scene;
  });
  const roof = box(27.8, 0.4, 11, mat(0x94a3b8)); roof.position.set(0, NP * FH + 0.05, 0.4); scene.add(roof); pianoG.roof = roof;
  const suolo = new THREE.Mesh(new THREE.PlaneGeometry(240, 120), mat(0xb7c4d6, { roughness: 1 })); suolo.rotation.x = -Math.PI / 2; suolo.position.set(0, -0.32, 20); suolo.receiveShadow = true; scene.add(suolo);
  function bici(x, z, col, y0) {
    const g = new THREE.Group(), m = mat(col, { roughness: 0.4 }), nero = mat(0x111827);
    [-0.62, 0.62].forEach(dx => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 24), nero); r.position.set(dx, 0.36, 0); g.add(r); });
    const tubo = (a, b) => { const v = new THREE.Vector3().subVectors(b, a), t = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, v.length(), 6), m); t.position.copy(a).add(b).multiplyScalar(0.5); t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); g.add(t); };
    const A = new THREE.Vector3(-0.62, 0.36, 0), B = new THREE.Vector3(0.62, 0.36, 0), S = new THREE.Vector3(-0.2, 0.72, 0), T = new THREE.Vector3(0.38, 0.72, 0), P = new THREE.Vector3(0.1, 0.36, 0);
    tubo(A, S); tubo(S, T); tubo(A, P); tubo(P, S); tubo(P, T); tubo(B, T);
    const sel = box(0.22, 0.04, 0.1, nero); sel.position.set(-0.22, 0.76, 0); g.add(sel);
    const man = box(0.04, 0.04, 0.3, nero); man.position.set(0.4, 0.8, 0); g.add(man);
    g.position.set(x, y0 || 0, z); g.rotation.y = 0.15; (pianoG[Math.round((y0 || 0) / FH)] || scene).add(ombra(g));
  }
  bici(-9.5, -3.9, 0xdc2626); bici(-7.9, -3.9, 0x2563eb); bici(-6.3, -3.9, 0xf59e0b); bici(9.4, -3.9, 0x16a34a); bici(11, -3.9, 0xdb2777);
  for (let i = 1; i < NP; i++) { if (i % 2) bici(-12.4, -3.4, [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b][i % 4], i * FH); else bici(12.4, -3.4, [0x2563eb, 0xdb2777, 0xf59e0b][i % 3], i * FH); }

  // ---------- ascensore ----------
  const CAB = { piano: 0, y: 0, target: 0, porta: 1, occupata: false };
  const cabinaG = new THREE.Group(); scene.add(cabinaG);
  (function () {
    const vetro = mat(0xbfe3ff, { transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1, depthWrite: false });
    const fondo = box(2.3, 3.1, 0.06, mat(0xe2e8f0)); fondo.position.set(0, 1.55, -1.9); cabinaG.add(fondo);
    [-1, 1].forEach(l => { const v = box(0.05, 3.1, 2.9, vetro); v.position.set(l * 1.15, 1.55, -0.5); cabinaG.add(v); });
    const pav = box(2.3, 0.1, 2.9, mat(0x64748b)); pav.position.set(0, 0.05, -0.5); cabinaG.add(pav);
    const tetto = box(2.3, 0.12, 2.9, mat(0x475569)); tetto.position.set(0, 3.12, -0.5); cabinaG.add(tetto);
    const lamp = box(1.4, 0.05, 0.5, new THREE.MeshBasicMaterial({ color: 0xfffbeb })); lamp.position.set(0, 3.05, -0.4); cabinaG.add(lamp);
    const corr = box(0.05, 0.05, 2.7, mat(0x94a3b8)); corr.position.set(0, 1.0, -1.85); cabinaG.add(corr);
    CAB.pL = box(0.58, 3.0, 0.06, mat(0x94a3b8, { metalness: 0.5, roughness: 0.4 })); CAB.pR = box(0.58, 3.0, 0.06, mat(0x94a3b8, { metalness: 0.5, roughness: 0.4 }));
    CAB.pL.position.set(-0.3, 1.5, 0.92); CAB.pR.position.set(0.3, 1.5, 0.92); cabinaG.add(CAB.pL, CAB.pR);
    const arch = box(2.5, 0.2, 0.12, mat(0x334155)); arch.position.set(0, 3.2, 0.95); cabinaG.add(arch);
    ombra(cabinaG);
    const vano = box(2.5, NP * FH, 3.2, new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.09, depthWrite: false })); vano.position.set(0, NP * FH / 2, -0.5); scene.add(vano);
  })();
  function aggiornaCabina(dt) {
    const yT = PIANI[CAB.target].y, ferma = Math.abs(CAB.y - yT) < 0.02;
    if (!ferma) {
      CAB.porta += (0 - CAB.porta) * Math.min(1, dt * 7);
      if (CAB.porta < 0.06) { const v = Math.min(Math.abs(yT - CAB.y), (1.2 + Math.min(Math.abs(yT - CAB.y), 6) * 1.6) * dt) * Math.sign(yT - CAB.y); CAB.y += v; }
    } else { CAB.y = yT; CAB.piano = CAB.target; CAB.porta += (1 - CAB.porta) * Math.min(1, dt * 5); }
    cabinaG.position.y = CAB.y;
    CAB.pL.position.x = -0.3 - 0.52 * CAB.porta; CAB.pR.position.x = 0.3 + 0.52 * CAB.porta;
  }
  const cabPronta = f => CAB.piano === f && CAB.target === f && CAB.porta > 0.93 && Math.abs(CAB.y - PIANI[f].y) < 0.03;

  // ---------- il ciclista ----------
  const casi = { occhi: mat(0x111827, { roughness: 0.2 }), nero: mat(0x1a202c), bianco: mat(0xf8fafc), scarpa: mat(0x111827), lente: mat(0x0b1220, { roughness: 0.15, metalness: 0.3 }) };
  function ciclista(look) {
    const det = new THREE.Group(), pelle = mat(look.pelle, { roughness: 0.55 }), maglia = mat(look.maglia, { roughness: 0.6 }), acc = mat(look.accento || '#fff', { roughness: 0.6 }), cap = mat(look.capelli, { roughness: 0.85 });
    const busto = capsula(0.165, 0.22, maglia); busto.scale.z = 0.76; busto.position.y = 1.2; det.add(busto);
    const fascia = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.06, 18), acc); fascia.scale.z = 0.78; fascia.position.y = 1.27; det.add(fascia);
    const spalle = tondo(0.12, maglia, 1.55, 0.75, 0.85); spalle.position.y = 1.45; det.add(spalle);
    const bacino = tondo(0.17, casi.nero, 1, 0.65, 0.8); bacino.position.y = 0.93; det.add(bacino);
    const collo = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), pelle); collo.position.y = 1.55; det.add(collo);
    const testa = new THREE.Group(); testa.position.y = 1.7; det.add(testa);
    testa.add(tondo(0.14, pelle, 1, 1.1, 1.05));
    [-1, 1].forEach(l => { const o = tondo(0.03, pelle, 0.6, 1, 1); o.position.set(l * 0.14, -0.01, 0); testa.add(o); });
    const naso = tondo(0.022, pelle, 1, 0.9, 1.1); naso.position.set(0, -0.02, 0.145); testa.add(naso);
    const sorr = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 12, Math.PI), mat(0x7f1d1d)); sorr.rotation.z = Math.PI; sorr.position.set(0, -0.075, 0.135); testa.add(sorr);
    if (look.occhiali) { const l = tondo(0.065, casi.lente, 1.9, 0.5, 0.75); l.position.set(0, 0.03, 0.105); testa.add(l); }
    else { [-1, 1].forEach(s => { const o = tondo(0.022, casi.occhi, 1, 1.2, 0.7); o.position.set(s * 0.055, 0.02, 0.13); testa.add(o); }); }
    if (look.copricapo === 'casco') {
      const c = tondo(0.165, mat(look.casco, { roughness: 0.35 }), 1, 0.86, 1.28); c.position.set(0, 0.05, -0.03); c.rotation.x = -0.12; testa.add(c);
      const st = tondo(0.168, casi.bianco, 1, 0.12, 1.29); st.position.set(0, 0.075, -0.03); testa.add(st);
    } else {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(look.casco, { roughness: 0.7 })); c.position.set(0, 0.04, -0.01); c.rotation.x = -0.1; testa.add(c);
      const v = tondo(0.1, mat(look.casco, { roughness: 0.7 }), 1.25, 0.15, 1); v.position.set(0, 0.05, 0.15); testa.add(v);
      if (!look.coda) { [-1, 1].forEach(s => { const b = tondo(0.04, cap, 0.8, 1.2, 1); b.position.set(s * 0.145, -0.03, -0.02); testa.add(b); }); }
    }
    if (look.coda) { const c = capsula(0.035, 0.12, cap); c.position.set(0, -0.02, -0.2); c.rotation.x = 0.5; testa.add(c); const f = tondo(0.04, acc, 1, 1, 1); f.position.set(0, 0.04, -0.17); testa.add(f); }
    const manica = look.lunga ? maglia : pelle;
    const braccio = l => {
      const sp = new THREE.Group(); sp.position.set(l * 0.205, 1.45, 0); det.add(sp);
      const su = capsula(0.052, 0.19, manica); su.position.y = -0.15; sp.add(su);
      if (!look.lunga) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.055, 0.12, 12), maglia); m.position.y = -0.07; sp.add(m); }
      const go = new THREE.Group(); go.position.y = -0.3; sp.add(go);
      const gi = capsula(0.044, 0.19, manica); gi.position.y = -0.14; go.add(gi);
      const m = tondo(0.05, pelle); m.position.y = -0.3; go.add(m);
      return { sp, go };
    };
    const gamba = l => {
      const an = new THREE.Group(); an.position.set(l * 0.095, 0.93, 0); det.add(an);
      const co = capsula(0.088, 0.26, casi.nero); co.position.y = -0.21; an.add(co);
      const gi = new THREE.Group(); gi.position.y = -0.43; an.add(gi);
      const st = capsula(0.066, 0.28, pelle); st.position.y = -0.21; gi.add(st);
      const calza = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.12, 12), casi.bianco); calza.position.y = -0.34; gi.add(calza);
      const pi = tondo(0.085, casi.scarpa, 1, 0.55, 1.8); pi.position.set(0, -0.44, 0.06); gi.add(pi);
      return { an, gi };
    };
    const bL = braccio(-1), bR = braccio(1), gL = gamba(-1), gR = gamba(1);
    ombra(det);
    const sem = new THREE.Group();                                  // versione semplice per le viste da lontano
    const c1 = capsula(0.2, 0.7, mat(look.maglia)); c1.position.y = 0.85; sem.add(c1);
    const c2 = tondo(0.17, pelle); c2.position.y = 1.65; sem.add(c2);
    const c3 = tondo(0.18, mat(look.casco), 1, 0.8, 1.2); c3.position.y = 1.72; sem.add(c3);
    return { det, sem, testa, bL, bR, gL, gR };
  }

  // ---------- gli agenti ----------
  const blobGeo = new THREE.CircleGeometry(0.4, 16), blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
  const agenti = DEFS.map(d => {
    const sp = d.slot >= 0 ? SLOTP[d.slot] : [-3, AIS_Z], p = PIANI[d.piano];
    const c = ciclista(d.look), g = new THREE.Group(); g.add(c.det, c.sem); scene.add(g);
    const blob = new THREE.Mesh(blobGeo, blobMat); blob.rotation.x = -Math.PI / 2; scene.add(blob);
    const a = Object.assign({}, d, { c, g, blob, x: sp[0], z: sp[1], sx: sp[0], sz: sp[1], corr: sp[0] < 0 ? -CORR : CORR, rot: 0, rotWant: 0, sit: d.slot >= 0 ? 1 : 0, stato: d.slot >= 0 ? 'siede' : 'fermo', path: [], fase: Math.random() * 6, bolla: null, bordo: false, ypiano: p.y, casa: d.piano, piano: d.piano, det: true, imp: 0, lavoraVero: '', compito: null });
    a.tag = document.createElement('div'); a.tag.className = 'nome' + (d.ruolo === 'vezz' ? ' vez' : ''); a.tag.textContent = d.nome; host.appendChild(a.tag);
    return a;
  });
  const per = n => agenti.find(a => a.nome === n);
  const fuori = a => !!a.cat && a.sesso !== genere;                // gli addetti dell'altro sesso non si vedono
  const vezz = per('Vezz');
  const yDi = a => (a.bordo ? CAB.y : PIANI[a.piano].y);

  function posa(a, dt) {
    const c = a.c, sit = a.sit, cam = a.stato === 'cammina' ? 1 : 0;
    a.fase += dt * (cam ? 7.5 : 1.3);
    const s = Math.sin(a.fase), lavora = a.stato === 'siede', amp = a.lavoraVero || a.compito ? 1.7 : 1;
    a.g.position.set(a.x, yDi(a) - 0.43 * sit, a.z); a.g.rotation.y = a.rot;
    c.det.visible = a.det; c.sem.visible = !a.det;
    if (!a.det) return;
    [c.gL, c.gR].forEach((m, i) => {
      const passo = cam ? Math.sin(a.fase + (i ? Math.PI : 0)) * 0.65 : 0;
      m.an.rotation.x = -1.5 * sit + passo * (1 - sit); m.gi.rotation.x = 1.5 * sit + (cam ? Math.max(0, -passo) * 0.9 + 0.1 : 0);
    });
    a.g.position.y += cam ? Math.abs(Math.sin(a.fase)) * 0.035 : s * 0.004;
    const ty = lavora ? Math.sin(a.fase * 5) * 0.09 * amp : 0;
    [c.bL, c.bR].forEach((m, i) => {
      const lato = i ? 1 : -1, sw = cam ? Math.sin(a.fase + (i ? 0 : Math.PI)) * 0.6 : 0;
      m.sp.rotation.x = -0.55 * sit + sw + (lavora ? ty * lato : 0); m.go.rotation.x = -1.05 * sit - (cam ? 0.35 : 0.05) - (lavora ? ty * 0.6 * lato : 0);
      m.sp.rotation.z = 0;
    });
    if (a.parla && a.bolla) { c.bR.sp.rotation.x = -0.4 + Math.sin(a.fase * 3) * 0.3; c.bR.go.rotation.x = -1.2; c.bR.sp.rotation.z = -0.35; }
    c.testa.rotation.x = lavora ? 0.15 + Math.sin(a.fase * 0.7) * 0.03 : 0;
    c.testa.rotation.y = lavora ? Math.sin(a.fase * 0.4) * 0.14 : (a.parla ? Math.sin(a.fase * 0.9) * 0.2 : 0);
  }
  function muovi(a, dt) {
    if (a.stato === 'cammina' && a.path.length) {
      const [tx, tz] = a.path[0], dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz), v = 2.3 * dt;
      if (d <= v) { a.x = tx; a.z = tz; a.path.shift(); }
      else { a.x += dx / d * v; a.z += dz / d * v; let dr = Math.atan2(dx, dz) - a.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); a.rot += dr * Math.min(1, dt * 10); }
    }
    const meta = a.stato === 'siede' ? 1 : 0;
    a.sit += Math.sign(meta - a.sit) * Math.min(Math.abs(meta - a.sit), dt * 3);
    if (a.stato === 'siede') { a.rot += (a.rotWant - a.rot) * Math.min(1, dt * 6); a.x += (a.sx - a.x) * Math.min(1, dt * 6); a.z += (a.sz - a.z) * Math.min(1, dt * 6); }
  }

  // ---------- percorsi: dal posto al corridoio laterale, poi la corsia davanti, poi l'ascensore al centro ----------
  function route(a, qx, qz, posto) {
    const pts = [], aisT = Math.abs(qz - AIS_Z) < 0.4 && !posto, aisC = Math.abs(a.z - AIS_Z) < 0.4;
    const tcx = qx < 0 ? -CORR : CORR, ccx = a.x < 0 ? -CORR : CORR;
    if (aisC) { if (aisT) pts.push([qx, qz]); else pts.push([tcx, AIS_Z], [tcx, qz]); }
    else {
      if (Math.abs(a.x - ccx) > 0.05) pts.push([ccx, a.z]);
      if (aisT) pts.push([ccx, AIS_Z], [qx, qz]);
      else if (tcx === ccx) pts.push([tcx, qz]);
      else pts.push([ccx, AIS_Z], [tcx, AIS_Z], [tcx, qz]);
    }
    if (posto && Math.abs(qx - tcx) > 0.05) pts.push([qx, qz]);
    return pts;
  }

  // ---------- scene: ogni scena e una sequenza di passi ----------
  let DT = 0.033;
  function* aspetta(sec) { let t = 0; while (t < sec) { t += DT; yield; } }
  function* finche(cond) { while (!cond()) yield; }
  function* cammina(a, pts) { a.path = pts.map(p => p.slice()); a.stato = 'cammina'; while (a.path.length) yield; a.stato = 'fermo'; }
  function* alzati(a) { a.stato = 'alzato'; a.rotWant = 0; while (a.sit > 0.03) yield; }
  function* siediti(a) { yield* cammina(a, route(a, a.sx, a.sz, true)); a.stato = 'siede'; while (a.sit < 0.97) yield; }
  const volto = (a, b) => { a.rot = Math.atan2(b.x - a.x, (b.z || 0) + 0.3 - a.z); };
  const giraVersoCorridoio = a => { a.rotWant = Math.sign(a.corr - a.sx) * 1.05; };
  function* dici(a, testo, vero, sec) {
    if (a.bolla) a.bolla.el.remove();
    const el = document.createElement('div'); el.className = 'bolla' + (vero ? '' : ' chiac'); el.innerHTML = '<b>' + a.nome + '</b>' + testo; host.appendChild(el);
    a.bolla = { el }; a.parla = true; yield* aspetta(sec); a.parla = false; el.remove(); a.bolla = null;
  }
  function logga(da, a, t1, t2) {
    const li = document.createElement('li'), h = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = '<time>' + h + '</time><b>' + da + '</b> a <b>' + a + '</b>: ' + t1 + (t2 ? ' «' + t2 + '»' : '');
    const ol = root.getElementById('log'); ol.insertBefore(li, ol.firstChild); while (ol.children.length > 8) ol.removeChild(ol.lastChild);
  }
  function* viaggia(a, daP, aP) {                                  // fino all'ascensore, su o giu, poi fuori
    yield* finche(() => !CAB.occupata); CAB.occupata = true;
    CAB.target = daP;
    yield* cammina(a, route(a, 0, AIS_Z, false));
    yield* finche(() => cabPronta(daP));
    yield* cammina(a, [[0, 0.3]]);
    a.bordo = true; a.rot = 0; yield* aspetta(0.5);
    CAB.target = aP;
    yield* finche(() => cabPronta(aP));
    a.bordo = false; a.piano = aP; if (a === vezz) salvaPiano();
    yield* cammina(a, [[0, AIS_Z]]);
    CAB.occupata = false;
  }
  function* scenaConversa(A, B, t1, t2, vero) {
    yield* alzati(A);
    if (A.piano !== B.piano) yield* viaggia(A, A.piano, B.piano);
    yield* cammina(A, route(A, B.corr, B.sz, false));
    volto(A, B); giraVersoCorridoio(B); logga(A.nome, B.nome, t1, ''); yield* dici(A, t1, vero, 3.4); yield* dici(B, t2, vero, 2.8);
    B.rotWant = 0;
    if (A.piano !== A.casa) yield* viaggia(A, A.piano, A.casa);
    yield* siediti(A);
    A.imp = 0; B.imp = 0;
  }
  function* prendi(a) { yield* finche(() => !a.imp && a.stato === 'siede' && a.piano === a.casa && !a.bolla); a.imp = 1; }
  function* scenaCompito(ag, testo, bozzaId) {                     // Vezz va di persona dall'addetto, gli consegna il compito
    yield* prendi(ag);
    if (vezz.piano !== ag.piano) yield* viaggia(vezz, vezz.piano, ag.piano);
    yield* cammina(vezz, route(vezz, ag.corr, ag.sz, false));
    volto(vezz, ag); giraVersoCorridoio(ag);
    const breve = testo.length > 110 ? testo.slice(0, 107) + '…' : testo;
    logga('Vezz', ag.nome, 'compito diretto', breve);
    yield* dici(vezz, breve, true, 3.6); yield* dici(ag, 'Ricevuto: ci lavoro subito.', true, 2.4);
    ag.compito = { testo: breve, id: bozzaId, t: 0 }; vezz.occupato = false; ag.rotWant = 0;
    extra.push(lavoraCompito(ag));
  }
  function* lavoraCompito(ag) {                                    // finche la bozza vera e in scrittura l'addetto resta al lavoro
    const c = ag.compito;
    while (c.t < 1500) { c.t += DT; const s = DATI.stati[c.id]; if (c.t > 25 && s && s !== 'in_generazione') break; yield; }
    const s = DATI.stati[c.id], t = c.testo; ag.compito = null;
    if (s === 'errore') { logga(ag.nome, 'Vezz', 'compito non riuscito', t); yield* dici(ag, 'Non sono riuscito: guarda l’errore nelle Bozze.', true, 4); avvisa(ag.nome + ': compito non riuscito'); }
    else if (s && s !== 'in_generazione') { logga(ag.nome, 'Vezz', 'compito finito', t); yield* dici(ag, 'Fatto: «' + t.slice(0, 60) + '» è nelle Bozze, da rivedere.', true, 4); avvisa(ag.nome + ' ha finito il compito'); }
    else { yield* dici(ag, 'Ci sto ancora lavorando: lo trovi nelle Bozze appena finisce.', true, 4); }
    ag.imp = 0;
  }
  const SC_INTRA = [['atleti', 'resp', 'Ho una bozza su un atleta del reparto.', 'Bene, la controllo.', 1], ['team', 'resp', 'Il bilancio delle squadre è pronto.', 'Lo leggo subito.', 1], ['ric', 'atleti', 'Ho trovato 3 notizie sulla gara di domenica.', 'Perfetto, le uso.', 1],
    ['resp', 'team', 'Ricontrolla i punti delle squadre.', 'Ricevuto.', 1], ['atleti', 'team', 'Un caffè?', 'Volentieri.', 0], ['ric', 'resp', 'Hai visto che nebbia stamattina?', 'Ottima per le fughe.', 0]];
  const SC_STAFF = {
    5: [['Caporedattore', 'Capo servizio', 'Ordine fisso di oggi: bilanci e gare.', 'Lo passo ai reparti.', 1], ['Cronista', 'Capo servizio', 'La cronaca di domenica è pronta.', 'La controllo ora.', 1], ['Analista', 'Caporedattore', 'Ho 5 spunti nuovi dai dati.', 'Quali per le Juniores?', 1],
      ['Inviato speciale', 'Caporedattore', 'Una richiesta libera è in coda.', 'Dalle la priorità.', 1], ['Ricercatore', 'Cronista', 'Nuove notizie nel radar.', 'Le uso per la gara.', 1], ['Cronista', 'Analista', 'Hai visto la nebbia?', 'Stamattina, sì.', 0]],
    4: [['Ricercatore Tech', 'Redattore Tech', 'Nel radar Tech è arrivata una novità sulle ruote.', 'Ottimo, la leggo.', 1], ['Redattore Tech', 'Ricercatore Tech', 'Cerca altre fonti sul nuovo gruppo.', 'Subito.', 1]]
  };
  const eventi = [];                                               // fatti veri dal sito: [chi, con chi, frase, risposta]
  function scegliScena() {
    const libere = agenti.filter(a => a.ruolo !== 'vezz' && !fuori(a) && !a.imp && a.stato === 'siede' && a.piano === a.casa && !a.bolla), r = Math.random();
    const trova = (nome) => libere.find(a => a.nome === nome);
    let A, B, t;
    if (eventi.length) { const e = eventi.shift(); A = trova(e[0]); B = trova(e[1]); t = e; if (!A || !B) { if (eventi.length < 6) eventi.push(e); return null; } }
    else if (focus != null && r < 0.85 && PIANI[focus].cats) {        // il piano che guardi: conversazione tra gli addetti di una sua categoria
      const cs = PIANI[focus].cats, cat = lato ? (cs[lato === 'R' ? 1 : 0] || cs[0]) : cs[Math.floor(Math.random() * cs.length)], s = SC_INTRA[Math.floor(Math.random() * SC_INTRA.length)];
      A = libere.find(a => a.cat === cat && a.ruolo === s[0]); B = libere.find(a => a.cat === cat && a.ruolo === s[1]); t = s;
    } else if (focus != null && r < 0.85 && SC_STAFF[focus]) {       // Direzione / Tech: i loro scambi
      const l = SC_STAFF[focus], s = l[Math.floor(Math.random() * l.length)]; A = trova(s[0]); B = trova(s[1]); t = s;
    } else if (r < 0.5) {
      const cands = Object.keys(CATS), cat = cands[Math.floor(Math.random() * cands.length)], s = SC_INTRA[Math.floor(Math.random() * SC_INTRA.length)];
      A = libere.find(a => a.cat === cat && a.ruolo === s[0]); B = libere.find(a => a.cat === cat && a.ruolo === s[1]); t = s;
    } else if (!CAB.occupata) {                                    // fra piani diversi: ascensore
      const resp = libere.filter(a => a.ruolo === 'resp');
      const ch = [
        () => { const x = resp[Math.floor(Math.random() * resp.length)]; return x && [x.nome, 'Caporedattore', x.nome.replace('Responsabile ', 'Reparto ') + ': bozza controllata e confermata.', 'Ottimo, grazie.', 1]; },
        () => { const x = resp[Math.floor(Math.random() * resp.length)]; return x && ['Caporedattore', x.nome, 'Ordine del direttore: un bilancio per la tua categoria.', 'Si parte, uno alla volta.', 1]; },
        () => ['Redattore Tech', 'Capo servizio', 'Pezzo Tech pronto: fonti nominate, niente prove.', 'Controllo numeri e fonti.', 1],
        () => ['Cassiere', 'Caporedattore', 'Spesa del mese: ' + DATI.costoTxt + '.', 'Siamo larghi.', 1],
        () => ['Ricercatore Tech', 'Cronista', 'Ti segnalo una novità sulle ruote da seguire.', 'Grazie, la guardo.', 1]
      ];
      const v = ch[Math.floor(Math.random() * ch.length)](); if (!v) return null; A = trova(v[0]); B = trova(v[1]); t = v;
    }
    if (typeof A === 'string') A = trova(A); if (typeof B === 'string') B = trova(B);
    if (!A || !B || A === B) return null;
    A.imp = 1; B.imp = 1;
    return scenaConversa(A, B, t[2], t[3], t[4]);
  }
  let scenaCorr = null, prossima = 1.5; const extra = [];
  function stepScena(dt) {
    DT = dt;
    for (let i = extra.length - 1; i >= 0; i--) if (extra[i].next().done) extra.splice(i, 1);
    if (!scenaCorr) { prossima -= dt; if (prossima <= 0) { scenaCorr = scegliScena(); prossima = scenaCorr ? 1 : 0.4; } return; }
    if (scenaCorr.next().done) { scenaCorr = null; prossima = 1 + Math.random() * 1.5; }
  }

  // ---------- Vezz e compiti: comandi dell'utente ----------
  function avvisa(t) { const e = root.getElementById('toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(avvisa.t); avvisa.t = setTimeout(() => { e.style.display = 'none'; }, 2600); }
  function* vaiVezzA(x, z) { yield* cammina(vezz, route(vezz, x, z, false)); vezz.occupato = false; }
  function salvaPiano() { try { localStorage.setItem('p3d-piano', String(vezz.piano)); } catch (e) { /* senza memoria locale */ } }
  function* vezzVaAlPiano(n) {                                     // Vezz prende l'ascensore (la camera lo segue) e a destinazione la vista passa al piano
    if (vezz.piano !== n) { seguiA(vezz); yield* viaggia(vezz, vezz.piano, n); }
    vezz.occupato = false; salvaPiano();
    if (follow === vezz) fermaSegui();
    vaiAlPiano(n, null);
  }
  function* vezzVaDa(a) {                                          // Vezz va accanto all'addetto cliccato; li' si apre la scheda per dirgli cosa fare
    sel = a;
    if (vezz.piano !== a.piano) { seguiA(vezz); yield* viaggia(vezz, vezz.piano, a.piano); }
    yield* cammina(vezz, route(vezz, a.corr, a.sz, false));
    volto(vezz, a); vezz.occupato = false; salvaPiano();
    if (follow === vezz) fermaSegui();
    vaiAlPiano(a.piano, PIANI[a.piano].cats ? (a.corr < 0 ? 'L' : 'R') : null);
    apriCard(a);
  }
  function mandaVezz(i) {
    if (vezz.piano === i && !vezz.occupato) { vaiAlPiano(i); return true; }
    const ok = comandoVezz(vezzVaAlPiano(i)); if (ok) avvisa('Vezz va al piano «' + PIANI[i].nome + '»'); return ok;
  }
  function cliccaOmino(a) {
    if (a === vezz) { apriCard(a); return; }
    if (vezz.occupato) { avvisa('Vezz è ancora in cammino: aspetta un attimo'); return; }
    if (vezz.piano === a.piano && Math.hypot(vezz.x - a.corr, vezz.z - a.sz) < 1.3) { apriCard(a); return; }   // e gia accanto a lui
    if (comandoVezz(vezzVaDa(a))) avvisa('Vezz va da ' + a.nome);
  }
  function* vezzAlPiano(n) {
    if (vezz.piano !== n) yield* viaggia(vezz, vezz.piano, n);
    vezz.occupato = false;
  }
  function comandoVezz(gen) { if (vezz.occupato) { avvisa('Vezz è ancora impegnato'); return false; } vezz.occupato = true; vezz.path = []; extra.push(gen); return true; }
  async function daiCompito(ag, testo) {
    if (testo.trim().length < 8) { avvisa('Scrivi cosa deve fare (almeno una frase)'); return false; }
    if (ag.compito || ag.compitoInCoda) { avvisa(ag.nome + ' ha già un compito'); return false; }
    if (vezz.occupato) { avvisa('Vezz è ancora impegnato: riprova tra un attimo'); return false; }
    ag.compitoInCoda = true;
    let r = null; try { r = await ctx.inviaCompito(ag.nome, testo.trim()); } catch (e) { r = null; }
    if (!r || !r.id) { ag.compitoInCoda = false; return false; }
    vezz.occupato = true; extra.push((function* () { yield* scenaCompito(ag, testo.trim(), r.id); ag.compitoInCoda = false; })());
    avvisa('Vezz porta il compito a ' + ag.nome); return true;
  }
  function snap(x, z) { return (z > 3.2 || Math.abs(x) < 2) ? [Math.max(-CORR, Math.min(CORR, x)), AIS_Z] : [x < 0 ? -CORR : CORR, Math.max(-3.5, Math.min(3.2, z))]; }

  // ---------- camera, piani, selezione ----------
  let focus = null, lato = null, aspetto = 1.6, sel = null, follow = null, guida = true;
  const T16 = Math.tan(16 * Math.PI / 180);
  const cam = { look: new THREE.Vector3(0, 17, 0), dist: 80, az: 0, el: 0.12 }, mira = { look: new THREE.Vector3(0, 17, 0), dist: 80, az: 0, el: 0.12 };
  const distPiano = () => (lato ? Math.max(11, 8.2 / (T16 * aspetto)) : Math.max(22, 14.9 / (T16 * aspetto))), distTutto = () => Math.max(NP * FH / 2 / T16 * 1.12, 14.5 / (T16 * aspetto));
  const Q = { tier: 0, modo: 'auto', ombre: true };
  function luce(i) {
    const y = i == null ? NP * FH / 2 : PIANI[i].y;
    sole.castShadow = i != null && Q.ombre;                         // in vista da lontano niente ombre vere: bastano le macchie sotto gli omini
    sole.position.set(-7, y + 13, 16); sole.target.position.set(0, y + 1.5, 0);
    sole.shadow.camera.top = 7; sole.shadow.camera.bottom = -7; sole.shadow.camera.far = 70; sole.shadow.camera.updateProjectionMatrix();
  }
  function applicaPiano(i) {                                       // mostra/nasconde i piani e aggiorna i pulsanti (non muove la camera)
    focus = i;
    if (barraLato) { barraLato.style.display = i == null || follow || !PIANI[i].cats ? 'none' : ''; if (i != null && PIANI[i].cats) { const cs = PIANI[i].cats; barraLato.children[1].textContent = CATS[cs[0]][0]; barraLato.children[2].textContent = cs[1] ? CATS[cs[1]][0] : ''; barraLato.children[2].style.display = cs[1] ? '' : 'none'; } }
    pianoG.forEach((G, j) => { G.visible = i == null || j <= i; }); pianoG.roof.visible = i == null;
    etichette.forEach((e, j) => { e.dataset.nascosta = (i != null && j > i) ? '1' : ''; });
    pulsanti.forEach((b, k) => b.classList.toggle('on', (i == null && k === NP) || k === NP - 1 - i));
    luce(i);
  }
  function fermaSegui() { follow = null; root.getElementById('segui').style.display = 'none'; if (cardAg) aggiornaCard(true); }
  function vaiAlPiano(i, l) {
    fermaSegui(); lato = i == null ? null : (l || null);
    applicaPiano(i);
    if (barraLato) [...barraLato.children].forEach(b => b.classList.toggle('on', (b.dataset.l || '') === (lato || '')));
    mira.look.set(lato === 'L' ? -6.8 : lato === 'R' ? 6.8 : 0, i == null ? NP * FH / 2 : PIANI[i].y + 1.7, i == null ? 0 : 0.5); mira.dist = i == null ? distTutto() : distPiano(); mira.el = i == null ? 0.1 : 0.58; mira.az = 0;
    if (i != null && !CAB.occupata) CAB.target = i;
    prossima = Math.min(prossima, 0.7);
  }
  function seguiA(a) {
    follow = a; lato = null; mira.dist = 13; mira.el = 0.42; mira.az = 0;
    const s = root.getElementById('segui'); s.textContent = 'Smetti di seguire ' + a.nome; s.style.display = 'block'; applicaPiano(Math.max(0, Math.min(NP - 1, Math.round(yDi(a) / FH))));
    if (cardAg) aggiornaCard(true);
  }
  root.getElementById('segui').onclick = () => { fermaSegui(); vaiAlPiano(focus); };
  const bar = root.getElementById('piani'), pulsanti = []; let barraLato = null;
  for (let i = NP - 1; i >= 0; i--) { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = '<i>' + i + '</i>' + PIANI[i].nome; b.onclick = () => mandaVezz(i); bar.appendChild(b); pulsanti.push(b); }
  { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = '<i>⌂</i>Tutto il palazzo'; b.onclick = () => vaiAlPiano(null); bar.appendChild(b); pulsanti.push(b); }
  barraLato = document.createElement('div'); barraLato.className = 'lati'; barraLato.style.display = 'none';
  [['', 'Tutto il piano'], ['L', 'Sinistra'], ['R', 'Destra']].forEach(([l, t]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.l = l; b.textContent = t; b.style.justifyContent = 'center'; b.style.padding = '6px 8px'; b.onclick = () => vaiAlPiano(focus, l || null); barraLato.appendChild(b); });
  bar.appendChild(barraLato);
  const etichette = PIANI.map(p => { const e = document.createElement('div'); e.className = 'etich'; e.innerHTML = p.nome + '<small>' + p.sotto + '</small>'; e.style.borderLeft = '4px solid ' + p.col; host.appendChild(e); return e; });

  function setGenere(g, init) {
    genere = g; try { localStorage.setItem('p3d-genere', g); } catch (e) { /* senza memoria locale */ }
    root.querySelectorAll('[data-g]').forEach(b => b.classList.toggle('on', b.dataset.g === g));
    PIANI.forEach(q => { if (q.cats && q.targa) disegnaTarga(q.targa, q.nome, g === 'M' ? 'Uomini' : 'Donne'); });
    if (!init) {
      if (follow && fuori(follow)) { fermaSegui(); vaiAlPiano(focus); }
      if (cardAg && fuori(cardAg)) { card.style.display = 'none'; cardAg = null; sel = null; }
      prossima = Math.min(prossima, 0.7); avvisa(g === 'M' ? 'Palazzo degli uomini' : 'Palazzo delle donne');
    }
  }
  root.querySelectorAll('[data-g]').forEach(b => { b.onclick = () => setGenere(b.dataset.g); });

  // ---------- scheda dell'omino ----------
  const card = root.getElementById('card'); let cardAg = null;
  const statoTesto = a => a.compito ? '✎ Compito: ' + a.compito.testo : a.lavoraVero ? '✎ ' + a.lavoraVero : a.errore ? '⚠ ' + a.dato : a.bolla ? 'Sta parlando' : a.stato === 'siede' ? 'Alla scrivania' : a.bordo ? 'In ascensore' : 'In movimento';
  function apriCard(a) {
    cardAg = a; sel = a; const vz = a.ruolo === 'vezz', p = PIANI[a.piano];
    card.innerHTML = '<button class="x" aria-label="chiudi">×</button><h4>' + a.nome + '</h4><small>' + (vz ? 'Il tuo personaggio' : a.ruolo === 'staff' ? 'Redazione' : a.etich + ' · ' + CATS[a.cat][0] + (a.sesso === 'F' ? ' · Donne' : ' · Uomini')) + '</small>' +
      '<p id="cSt"></p><div class="rig"><button class="b" id="cSegui" type="button"></button>' + (vz ? '<button class="b" id="cPers" type="button">Personalizza</button><button class="b" id="cGuida" type="button"></button>' : '<button class="b" id="cVai" type="button">Vai da lui (Vezz)</button>') + '</div>' +
      (vz ? '<label>Manda Vezz al piano</label><div class="pian" id="cPiani"></div><small style="margin-top:6px">Con «Guida con clic» attivo, clicca il pavimento del piano di Vezz: ci va a piedi.</small>'
        : '<label>Compito diretto, senza passare dal direttore</label><textarea id="cTesto" rows="3" maxlength="400" placeholder="Es. Scrivi il profilo di un giovane Juniores da tenere d’occhio"></textarea><div class="rig"><button class="b go" id="cInvia" type="button">Dai il compito</button></div><small>Parte una richiesta vera: l’addetto scrive una bozza (come un articolo, circa 0,06-0,30 $). Vezz glielo porta di persona.</small>');
    card.style.display = 'block'; card.querySelector('.x').onclick = () => { card.style.display = 'none'; cardAg = null; sel = null; };
    card.querySelector('#cSegui').onclick = () => { if (follow === a) { fermaSegui(); vaiAlPiano(focus); } else seguiA(a); };
    if (vz) {
      card.querySelector('#cPers').onclick = apriEditor;
      const g = card.querySelector('#cGuida'); const sg = () => { g.textContent = 'Guida con clic: ' + (guida ? 'sì' : 'no'); g.classList.toggle('on', guida); }; sg(); g.onclick = () => { guida = !guida; sg(); avvisa(guida ? 'Clicca il pavimento per far camminare Vezz' : 'Guida spenta'); };
      const cp = card.querySelector('#cPiani'); PIANI.forEach((q, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = i; b.title = q.nome; b.onclick = () => mandaVezz(i); cp.appendChild(b); });
    } else {
      card.querySelector('#cVai').onclick = () => { if (comandoVezz((function* () { if (vezz.piano !== a.piano) yield* viaggia(vezz, vezz.piano, a.piano); yield* cammina(vezz, route(vezz, a.corr, a.sz, false)); volto(vezz, a); vezz.occupato = false; })())) avvisa('Vezz va da ' + a.nome); };
      card.querySelector('#cInvia').onclick = async () => { const t = card.querySelector('#cTesto'); if (await daiCompito(a, t.value)) t.value = ''; };
    }
    aggiornaCard(true);
  }
  function aggiornaCard(forza) {
    if (!cardAg) return; const a = cardAg, st = card.querySelector('#cSt'), sg = card.querySelector('#cSegui');
    const t = statoTesto(a) + ' · ' + PIANI[a.piano].nome + (a.dato && !a.errore ? '<br><small>' + String(a.dato).replace(/</g, '&lt;') + '</small>' : '');
    if (forza || st.dataset.t !== t) { st.innerHTML = t; st.dataset.t = t; }
    if (sg) sg.textContent = follow === a ? 'Smetti di seguire' : 'Segui'; if (sg) sg.classList.toggle('on', follow === a);
  }
  // ---------- l'editor di Vezz ----------
  function apriEditor() {
    const m = root.getElementById('modal'); m.style.display = 'flex';
    const sw = (chiave, lista) => '<div class="sw" data-k="' + chiave + '">' + lista.map(c => '<i data-c="' + c + '" style="background:' + c + '" class="' + (vezzLook[chiave] === c ? 'on' : '') + '"></i>').join('') + '</div>';
    const tg = (chiave, et) => '<label><input type="checkbox" data-t="' + chiave + '" ' + (vezzLook[chiave] ? 'checked' : '') + '>' + et + '</label>';
    m.innerHTML = '<div><h4>Il tuo personaggio: Vezz</h4><label>Pelle</label>' + sw('pelle', PELLI) + '<label>Capelli</label>' + sw('capelli', CAPELLI.concat(['#e5e7eb', '#b45309', '#f59e0b'])) + '<label>Maglia</label>' + sw('maglia', COLORI.concat(['#be123c'])) + '<label>Casco / berretto</label>' + sw('casco', COLORI) +
      '<label>Dettagli</label><div class="tog">' + tg('occhiali', 'Occhiali') + tg('coda', 'Coda di cavallo') + tg('lunga', 'Maniche lunghe') + '<label><input type="checkbox" data-t="berretto" ' + (vezzLook.copricapo === 'berretto' ? 'checked' : '') + '>Berretto invece del casco</label></div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end"><button class="b" id="eReset" type="button">Ripristina</button><button class="b go" id="eOk" type="button">Fatto</button></div></div>';
    m.querySelectorAll('.sw i').forEach(i => { i.onclick = () => { vezzLook[i.parentNode.dataset.k] = i.dataset.c; i.parentNode.querySelectorAll('i').forEach(x => x.classList.toggle('on', x === i)); rifaiVezz(); }; });
    m.querySelectorAll('input[data-t]').forEach(i => { i.onchange = () => { if (i.dataset.t === 'berretto') vezzLook.copricapo = i.checked ? 'berretto' : 'casco'; else vezzLook[i.dataset.t] = i.checked; rifaiVezz(); }; });
    m.querySelector('#eOk').onclick = () => { m.style.display = 'none'; try { localStorage.setItem('p3d-vezz', JSON.stringify(vezzLook)); } catch (e) { /* senza memoria locale */ } avvisa('Vezz salvato'); };
    m.querySelector('#eReset').onclick = () => { vezzLook = Object.assign({}, VEZZ0); rifaiVezz(); apriEditor(); };
    if (!follow) seguiA(vezz);                                     // vedi le modifiche addosso a Vezz
  }
  function rifaiVezz() { vezz.g.remove(vezz.c.det, vezz.c.sem); vezz.c = ciclista(Object.assign({}, vezzLook, { accento: '#fbbf24' })); vezz.g.add(vezz.c.det, vezz.c.sem); }
  rifaiVezz();

  // ---------- mouse e tocco ----------
  let drag = null, mosso = false, zoomAttivo = false;
  const rc = new THREE.Raycaster();
  function agenteSotto(e) {
    const r = renderer.domElement.getBoundingClientRect(); rc.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
    const h = rc.intersectObjects(agenti.filter(a => a.g.visible).map(a => a.g), true); if (!h.length) return null;
    let o = h[0].object; while (o && !agenti.some(a => a.g === o)) o = o.parent; return o ? agenti.find(a => a.g === o) : null;
  }
  renderer.domElement.addEventListener('pointerleave', () => { zoomAttivo = false; });
  renderer.domElement.addEventListener('pointercancel', () => { drag = null; });
  renderer.domElement.addEventListener('pointerdown', e => { zoomAttivo = true; drag = { x: e.clientX, y: e.clientY, az: mira.az, el: mira.el }; mosso = false; renderer.domElement.setPointerCapture(e.pointerId); });
  renderer.domElement.addEventListener('pointermove', e => { if (!drag) return; if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) mosso = true; if (mosso) { mira.az = Math.max(-0.9, Math.min(0.9, drag.az - (e.clientX - drag.x) * 0.006)); mira.el = Math.max(0.05, Math.min(1.1, drag.el + (e.clientY - drag.y) * 0.004)); } });
  renderer.domElement.addEventListener('pointerup', e => {
    drag = null; if (mosso) return;
    const hit = agenteSotto(e); if (hit) { cliccaOmino(hit); return; }
    const r = renderer.domElement.getBoundingClientRect(); rc.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (focus != null && guida && vezz.piano === focus && Math.abs(d.y) > 1e-4) {                     // Vezz cammina dove clicchi
      const t = (PIANI[focus].y + 0.05 - o.y) / d.y, x = o.x + d.x * t, z = o.z + d.z * t;
      if (t > 0 && Math.abs(x) < 13.5 && z > -5 && z < 5.6) { const [sx, sz] = snap(x, z); comandoVezz(vaiVezzA(sx, sz)); return; }
    }
    if (follow || Math.abs(d.z) < 1e-4) return;
    const t = (0.5 - o.z) / d.z, y = o.y + d.y * t, i = Math.floor((y + 0.3) / FH);
    if (i >= 0 && i < NP && i !== focus) mandaVezz(i);
  });
  renderer.domElement.addEventListener('wheel', e => { if (!zoomAttivo) return; e.preventDefault(); mira.dist = Math.max(6, Math.min(140, mira.dist * (1 + Math.sign(e.deltaY) * 0.09))); }, { passive: false });
  function misura() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; aspetto = w / h; camera.updateProjectionMatrix(); if (!follow) { if (focus != null) mira.dist = distPiano(); else mira.dist = distTutto(); } }
  const ro = new ResizeObserver(misura); ro.observe(host);

  // ---------- qualita e prestazioni ----------
  const selQ = root.getElementById('qual'), lento = root.getElementById('lento'); root.getElementById('lento2d').onclick = () => { if (ctx.passa2D) ctx.passa2D(); };
  function applicaQualita() {
    const dpr = window.devicePixelRatio || 1, pr = [Math.min(dpr, 2), Math.min(dpr, 1.5), 1, 0.75][Q.tier], ms = [2048, 1024, 1024, 512][Q.tier];
    renderer.setPixelRatio(pr); Q.ombre = Q.tier < 2; sole.shadow.mapSize.set(ms, ms); if (sole.shadow.map) { sole.shadow.map.dispose(); sole.shadow.map = null; }
    luce(focus); lento.style.display = Q.tier >= 3 ? 'flex' : 'none'; misura();
  }
  selQ.onchange = () => { Q.modo = selQ.value; if (Q.modo !== 'auto') Q.tier = Number(Q.modo); else Q.tier = (window.matchMedia('(max-width:700px)').matches || /Mobi|Android/i.test(navigator.userAgent)) ? 1 : 0; ema = 0.016; applicaQualita(); };
  let ema = 0.016, giri = 0, riposo = 0, visibile = true;
  let io = null; if (window.IntersectionObserver) { io = new IntersectionObserver(es => { visibile = es[0].isIntersecting; }, { threshold: 0.01 }); io.observe(host); }
  function controllaFps(draw, tempo) {
    if (window.__virt != null || Q.modo !== 'auto') return; ema += (Math.min(draw, 0.25) - ema) * 0.06; giri++; riposo -= tempo;
    if (giri > 90 && riposo <= 0 && ema > 0.042 && Q.tier < 3) { Q.tier++; ema = 0.02; riposo = 4; applicaQualita(); }
  }

  // ---------- dati: arrivano dalla pagina Redazione (gia caricati dal sito, nessun token da incollare) ----------
  const DATI = { bozze: 0, spunti: 0, spesa: 0, limite: 10, costoTxt: '—', stati: {}, pronti: false };
  const usd = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function aggiornaTabellone() { DATI.costoTxt = usd(DATI.spesa) + ' $ su ' + usd(DATI.limite) + ' $'; disegnaTarga(tabellone, 'Bozze ' + DATI.bozze + ' · Spunti ' + DATI.spunti, 'Costi ' + DATI.costoTxt); }
  function aggiorna() {
    let d; try { d = ctx.leggi(); } catch (e) { return; }
    if (!d) return;
    const bozze = d.bozze || [], costi = d.costi, sp = (d.spunti && d.spunti.spunti) || [];
    DATI.bozze = bozze.filter(x => x.stato === 'bozza').length; DATI.spunti = sp.filter(x => x.stato === 'nuovo').length;
    DATI.spesa = (costi && costi.spesa_mese) || 0; DATI.limite = (costi && costi.config && Number(costi.config.limite_mensile_usd)) || 10;
    aggiornaTabellone();
    const mappa = {}; (d.agenti || []).forEach(x => { mappa[x.nome] = x; });
    agenti.forEach(a => {
      const x = mappa[a.nome]; if (!x) return;
      a.lavoraVero = x.stato === 'lavora' ? x.testo : ''; a.dato = x.stato === 'lavora' ? '' : x.testo; a.errore = x.stato === 'errore';
    });
    const prima = DATI.stati, ora = {}; bozze.forEach(x => { ora[x.id] = x.stato; });
    if (DATI.pronti) bozze.forEach(x => { if (prima[x.id] === 'in_generazione' && x.stato === 'bozza') { const n = ctx.agenteDiBozza(x); eventi.push([n, ctx.respDi(n), 'Bozza pronta: ' + (x.soggetto || 'articolo'), 'La controllo ora.', 1]); } });
    DATI.stati = ora; DATI.pronti = true;
  }

  // ---------- il ciclo ----------
  const v3 = new THREE.Vector3();
  function proietta(x, y, z, el, dx) {
    v3.set(x, y, z).project(camera); const px = (v3.x * 0.5 + 0.5) * host.clientWidth, py = (-v3.y * 0.5 + 0.5) * host.clientHeight;
    el.style.left = (px + (dx || 0)) + 'px'; el.style.top = py + 'px'; el.style.display = v3.z < 1 && px > -50 && px < host.clientWidth + 50 ? '' : 'none';
  }
  const anello = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 36), new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false })); anello.rotation.x = -Math.PI / 2; anello.renderOrder = 5; anello.visible = false; scene.add(anello);
  let ultimo = performance.now(), tAttivo = 0, tCard = 0;
  function frame(now) {
    const grezzo = (now - ultimo) / 1000, dt = Math.max(0, Math.min(0.05, grezzo)); ultimo = now; const t = now / 1000; const k = Math.min(1, dt * 4);
    if (follow) {                                                  // la camera segue l'omino, anche in ascensore
      const y = yDi(follow); mira.look.set(follow.x, y + 1.2, follow.z);
      const f = Math.max(0, Math.min(NP - 1, Math.round(y / FH))); if (f !== focus) applicaPiano(f);
    }
    cam.look.lerp(mira.look, follow ? Math.min(1, dt * 6) : k); cam.dist += (mira.dist - cam.dist) * k; cam.az += (mira.az - cam.az) * k; cam.el += (mira.el - cam.el) * k;
    camera.position.set(cam.look.x + Math.sin(cam.az) * Math.cos(cam.el) * cam.dist, cam.look.y + Math.sin(cam.el) * cam.dist, cam.look.z + Math.cos(cam.az) * Math.cos(cam.el) * cam.dist); camera.lookAt(cam.look);
    aggiornaCabina(dt); stepScena(dt);
    tAttivo -= dt; if (tAttivo <= 0) { tAttivo = 6; PIANI.forEach(p => { p.attivo = Math.random() < 0.75; }); }
    PIANI.forEach((p, i) => finestre[i].forEach(f => { f.material.emissiveIntensity += ((p.attivo ? 0.75 : 0.08) - f.material.emissiveIntensity) * Math.min(1, dt * 3); }));
    const blobOn = !sole.castShadow;
    agenti.forEach(a => {
      muovi(a, dt); const y = yDi(a), yf = focus == null ? -999 : PIANI[focus].y; a.det = Math.abs(y - yf) < 2.6; posa(a, dt);
      if (a.stato === 'fermo' && !scenaCorr && a.ruolo !== 'vezz' && !a.imp) a.stato = 'siede';
      const sopra = focus != null && y > PIANI[focus].y + 1; const nasc = fuori(a); a.g.visible = !sopra && !nasc;
      a.blob.visible = blobOn && !sopra && !nasc; if (a.blob.visible) a.blob.position.set(a.x, y + 0.05, a.z);
      const forza = a === vezz || a === sel || a === follow, mostra = !sopra && !nasc && (forza || (a.det && focus != null));
      a.tag.style.display = mostra ? '' : 'none';
      if (mostra) {
        const txt = (lato || forza) ? a.nome : a.etich; if (a.tag.dataset.t !== txt) { a.tag.dataset.t = txt; a.tag.textContent = txt; }
        a.tag.classList.toggle('sel', a === sel); a.tag.classList.toggle('lav', !!(a.lavoraVero || a.compito));
        proietta(a.x, y - 0.43 * a.sit + 0.02, a.z, a.tag); a.tag.style.marginTop = '4px';
      }
      if (a.bolla) { proietta(a.x, y + 2.15 - 0.43 * a.sit, a.z, a.bolla.el); if (sopra || nasc) a.bolla.el.style.display = 'none'; }
    });
    if (sel && sel.g.visible) { anello.visible = true; anello.position.set(sel.x, yDi(sel) + 0.07, sel.z); } else anello.visible = false;
    tCard -= dt; if (tCard <= 0) { tCard = 0.4; aggiornaCard(false); }
    PIANI.forEach((p, i) => { proietta(-13.9, p.y + 1.1, 3.0, etichette[i]); if (etichette[i].dataset.nascosta) etichette[i].style.display = 'none'; });
    disegnaSchermi(t);
    renderer.render(scene, camera);
    controllaFps(grezzo, dt);
  }
  function giro(now) { if (morto) return; if (!contenitore.isConnected) { distruggi(); return; } requestAnimationFrame(giro); if (window.__virt == null && visibile && !document.hidden && host.clientWidth) frame(now); else ultimo = now; }
  Q.tier = (window.matchMedia('(max-width:700px)').matches || /Mobi|Android/i.test(navigator.userAgent)) ? 1 : 0; applicaQualita();
  setGenere(genere, true); misura(); vaiAlPiano(vezz.piano); CAB.piano = CAB.target = vezz.piano; CAB.y = PIANI[vezz.piano].y; cam.dist = mira.dist; cam.look.copy(mira.look);
  requestAnimationFrame(giro);

  function distruggi() {
    if (morto) return; morto = true; clearTimeout(avvisa.t);
    try { ro.disconnect(); if (io) io.disconnect(); } catch (e) { /* gia chiuso */ }
    try { renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) { /* gia chiuso */ }
    agenti.forEach(a => { if (a.bolla) a.bolla.el.remove(); });
    if (window.__p3d && window.__p3d.agenti === agenti) delete window.__p3d;
  }
  window.__p3d = { setGenere, fuori, mandaVezz, cliccaOmino, agenti, PIANI, CAB, frame, vaiAlPiano, mira, cam, scena: () => scenaCorr, avvia: () => { scenaCorr = scegliScena(); return !!scenaCorr; }, camera, renderer, vezz, route, apriCard, seguiA, daiCompito, comandoVezz, vezzAlPiano, extra, get focus() { return focus; }, get follow() { return follow; }, Q, DATI, eventi, aggiornaTabellone, aggiorna, SLOTP };
  return { aggiorna, distruggi };

  }
  window.PalazzoRedazione = { carica, webgl, monta };
})();
