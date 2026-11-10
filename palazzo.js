/* ============================================================
   ICS — Redazione 3D (solo amministratori)
   Una sola grande redazione open space su un unico livello, quattro aree (giovanile, Elite/U23, Tech, Direzione),
   gli addetti come ciclisti, scene dagli eventi veri. Si monta dentro la pagina Redazione (redazione.js) in un Shadow DOM;
   i dati arrivano dalla pagina, nessun token da incollare. Three.js r128 viene caricato da cdnjs solo quando serve.
   ============================================================ */
'use strict';

(function () {
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const CSS = `  * { box-sizing:border-box; }
  :host { display:block; color:inherit; font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif; }
  .scena { position:relative; margin:0 0 10px; height:min(80vh,760px); min-height:460px; border-radius:16px; overflow:hidden; background:linear-gradient(#dde4ec,#ece7de); box-shadow:0 10px 30px rgba(28,25,23,.2),0 0 0 1px var(--line); touch-action:pan-y; }
  .scena canvas { display:block; width:100%; height:100%; cursor:grab; } .scena canvas:active { cursor:grabbing; }
  .nav { position:absolute; left:12px; top:12px; display:flex; flex-direction:column; gap:7px; z-index:5; max-width:calc(100% - 70px); }
  .aree { display:flex; flex-wrap:wrap; gap:3px; padding:4px; border-radius:13px; background:rgba(38,36,34,.82); backdrop-filter:blur(6px); box-shadow:0 8px 22px rgba(0,0,0,.25); }
  .aree button { display:flex; align-items:center; gap:6px; border:0; border-radius:9px; padding:7px 11px; background:transparent; color:#f5efe4; font:600 12px system-ui; cursor:pointer; white-space:nowrap; }
  .aree button i { width:9px; height:9px; border-radius:50%; background:var(--c,#a8a29e); box-shadow:0 0 0 2px rgba(255,255,255,.25); }
  .aree button:hover { background:rgba(255,255,255,.14); } .aree button.on { background:#f59e0b; color:#1c1917; } .aree button.on i { box-shadow:0 0 0 2px rgba(28,25,23,.35); }
  .filtro { display:flex; gap:2px; padding:3px; width:max-content; border-radius:99px; background:rgba(38,36,34,.82); backdrop-filter:blur(6px); }
  .filtro button { border:0; border-radius:99px; padding:5px 12px; background:transparent; color:#f5efe4; font:600 11.5px system-ui; cursor:pointer; } .filtro button.on { background:#f5efe4; color:#1c1917; }
  .imp { position:absolute; right:12px; top:12px; z-index:6; display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .imp > button { width:36px; height:36px; border:0; border-radius:50%; background:rgba(38,36,34,.82); color:#f5efe4; font-size:17px; cursor:pointer; backdrop-filter:blur(6px); }
  .imp .menu { display:none; padding:10px 12px; border-radius:12px; background:rgba(38,36,34,.94); color:#f5efe4; font:12px system-ui; box-shadow:0 8px 22px rgba(0,0,0,.3); }
  .imp .menu label { display:block; font-weight:700; margin-bottom:5px; } .imp .menu select { font:12px system-ui; padding:4px 6px; border-radius:7px; border:0; width:100%; }
  .nome { position:absolute; transform:translate(-50%,0); font:600 11px system-ui; padding:2px 8px; border-radius:99px; background:rgba(38,36,34,.82); color:#fff; white-space:nowrap; pointer-events:none; }
  .nome.sel { background:#f59e0b; color:#1c1917; z-index:4; } .nome.vez { background:#be123c; } .nome.lav::after { content:" ✎"; }
  .zona { position:absolute; transform:translate(-50%,-50%); font:700 11px system-ui; letter-spacing:.04em; padding:4px 11px 4px 9px; border-radius:99px; background:rgba(255,251,244,.92); color:#292524; border-left:5px solid var(--c,#999); white-space:nowrap; pointer-events:none; box-shadow:0 2px 10px rgba(28,25,23,.2); }
  .bolla { position:absolute; transform:translate(-50%,-100%); max-width:230px; padding:7px 11px; border-radius:12px; background:#fff; color:#1c1917; font:500 12.5px/1.3 system-ui; box-shadow:0 6px 18px rgba(28,25,23,.28),0 0 0 1px rgba(28,25,23,.06); pointer-events:none; z-index:3; }
  .bolla.chiac { background:rgba(255,255,255,.88); box-shadow:none; border:1.5px dashed rgba(28,25,23,.35); }
  .bolla b { display:block; font-size:10.5px; color:#78716c; font-weight:600; margin-bottom:2px; }
  .card { position:absolute; left:12px; top:112px; width:min(300px,calc(100% - 24px)); max-height:calc(100% - 124px); overflow:auto; padding:12px; border-radius:14px; background:rgba(255,253,249,.97); color:#1c1917; box-shadow:0 10px 30px rgba(28,25,23,.32); z-index:6; display:none; }
  .card h4 { margin:0 0 1px; font-size:15px; } .card small { color:#78716c; display:block; }
  .card .x { position:absolute; right:8px; top:6px; border:0; background:none; font-size:20px; line-height:1; cursor:pointer; color:#78716c; }
  .card p { margin:8px 0; font-size:12.5px; padding:6px 8px; border-radius:8px; background:#f5f1ea; }
  .card .rig { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0; }
  .card button.b, .modal button.b { border:0; border-radius:8px; padding:6px 10px; font:600 12px system-ui; cursor:pointer; background:#e7e2d9; color:#1c1917; }
  .card button.b.on { background:#f59e0b; } .card button.go, .modal button.go { background:#292524; color:#fff; }
  .card textarea { width:100%; font:13px system-ui; border:1px solid #d6d0c4; border-radius:8px; padding:6px 8px; resize:vertical; }
  .card label { font-size:11.5px; font-weight:700; color:#44403c; display:block; margin-top:8px; }
  .modal { position:absolute; inset:0; z-index:9; display:none; align-items:center; justify-content:center; background:rgba(28,25,23,.45); }
  .modal > div { width:min(380px,92%); max-height:92%; overflow:auto; background:#fff; color:#1c1917; border-radius:16px; padding:16px; box-shadow:0 20px 50px rgba(0,0,0,.4); }
  .modal h4 { margin:0 0 8px; } .modal label { display:block; font-size:11.5px; font-weight:700; margin:10px 0 4px; color:#44403c; }
  .sw { display:flex; gap:5px; flex-wrap:wrap; } .sw i { width:24px; height:24px; border-radius:50%; cursor:pointer; box-shadow:0 0 0 1px rgba(28,25,23,.2); } .sw i.on { box-shadow:0 0 0 3px #f59e0b; }
  .tog { display:flex; gap:12px; flex-wrap:wrap; font-size:12.5px; } .tog label { font-weight:500; margin:0; display:flex; gap:5px; align-items:center; }
  #avviso { position:absolute; inset:0; display:none; align-items:center; justify-content:center; text-align:center; padding:20px; color:#44403c; }
  #lento { position:absolute; left:50%; bottom:10px; transform:translateX(-50%); display:none; align-items:center; gap:8px; padding:6px 8px 6px 12px; border-radius:99px; background:#b45309; color:#fff; font:600 12px system-ui; z-index:7; white-space:nowrap; }
  #lento button { border:0; border-radius:99px; padding:4px 10px; background:#fff; color:#92400e; font:700 11px system-ui; cursor:pointer; }
  #toast { position:absolute; left:50%; bottom:14px; transform:translateX(-50%); padding:6px 14px; border-radius:99px; background:rgba(38,36,34,.92); color:#fff; font:600 12.5px system-ui; z-index:10; display:none; max-width:90%; }
  #segui { position:absolute; left:50%; bottom:52px; transform:translateX(-50%); display:none; padding:7px 14px; border-radius:99px; background:#292524; color:#fff; font:600 12px system-ui; z-index:7; border:0; cursor:pointer; box-shadow:0 6px 16px rgba(0,0,0,.3); }
  .sotto { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px; padding:0; }
  .box { background:rgba(128,128,128,.08); border:1px solid rgba(128,128,128,.28); border-radius:12px; padding:10px 12px; }
  .box h3 { margin:0 0 6px; font-size:.85rem; }
  .box ol { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:4px; font-size:.82rem; }
  .box time { opacity:.65; margin-right:6px; font-variant-numeric:tabular-nums; }
  @media (max-width:640px) { .scena { height:72vh; } .aree button { padding:6px 9px; font-size:11.5px; } .card { top:auto; bottom:8px; left:8px; width:calc(100% - 16px); max-height:55%; } .nav { max-width:calc(100% - 60px); } }
`;
  const HTML = `<div class="scena" id="scena">
  <div class="nav"><div class="aree" id="aree"></div><div class="filtro" id="filtro"><button type="button" data-g="T">Tutti</button><button type="button" data-g="M">Uomini</button><button type="button" data-g="F">Donne</button></div></div>
  <div class="imp"><button type="button" id="ingr" aria-label="Qualità grafica" title="Qualità grafica">⚙</button><div class="menu" id="menuq"><label for="qual">Qualità grafica</label><select id="qual" title="Qualità grafica"><option value="auto">Automatica</option><option value="0">Alta</option><option value="1">Media</option><option value="2">Bassa</option><option value="3">Minima</option></select></div></div>
  <div class="card" id="card"></div>
  <div class="modal" id="modal"></div>
  <div id="toast"></div><div id="lento"><span>Il dispositivo fa fatica</span><button type="button" id="lento2d">Passa alla stanza 2D</button></div>
  <button id="segui" type="button">Smetti di seguire</button>
  <div id="avviso">Il 3D non è disponibile su questo dispositivo.</div>
</div>
<div class="sotto">
  <div class="box"><h3>Cosa si sono detti</h3><ol id="log"></ol></div>
  <div class="box"><h3>Come si usa</h3><small>Una sola redazione, quattro aree: scegli un'area in alto per avvicinarti, trascina per ruotare, rotella per zoomare. <b>Vezz</b> è il tuo personaggio, al centro della Direzione: clicca il pavimento e ci va a piedi, clicca un omino e gli va accanto; lì si apre la scheda e gli dici cosa fare (compito diretto: parte una richiesta vera, a pagamento come un articolo). Il filtro Uomini/Donne attenua l'altro gruppo senza nasconderlo. Fumetto pieno = fatto vero, tratteggiato = chiacchiere. Pallino ambra = al lavoro, verde = ha finito, rosso = errore.</small></div>
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
  // ---------- pianta: un solo livello di 56 x 38, origine al centro; x verso est, z verso sud (verso la camera) ----------
  const XMIN = -28, XMAX = 28, ZMIN = -19, ZMAX = 19;
  const CATS = { ES1: ['Esord. 1°', '#7c3aed'], ES2: ['Esord. 2°', '#db2777'], AL: ['Allievi', '#d97706'], JUN: ['Juniores', '#16a34a'], ELI: ['Elite/U23', '#2563eb'] };
  const CATN = { ES1: 'Esordienti 1° anno', ES2: 'Esordienti 2° anno', AL: 'Allievi', JUN: 'Juniores', ELI: 'Elite / Under 23' };
  // le quattro aree: rettangolo [x0, z0, x1, z1], punto di vista, ingombro (larghezza e profondita in unita) per inquadrarle
  const AREE = [
    { id: 'tutto', nome: 'Tutta la redazione', look: [0, 0.6, 1.2], ew: 62, ed: 41, col: '#f59e0b' },
    { id: 'giovanile', nome: 'Ciclismo giovanile', sigla: 'A', look: [-18, 0.6, 0], ew: 23, ed: 39, col: '#0d9488', rect: [-28, -19, -8, 19], ancora: [-18, 4.6, -19] },
    { id: 'elite', nome: 'Elite e Under 23', sigla: 'B', look: [18, 0.6, -9.5], ew: 23, ed: 21, col: '#2563eb', rect: [8, -19, 28, 0], ancora: [18, 4.6, -19] },
    { id: 'tech', nome: 'Tech', sigla: 'C', look: [18, 0.6, 9.5], ew: 23, ed: 21, col: '#ea580c', rect: [8, 0, 28, 19], ancora: [18, 3.4, 0] },
    { id: 'direzione', nome: 'Direzione', sigla: 'D', look: [0, 0.6, 0], ew: 18, ed: 39, col: '#6d28d9', rect: [-8, -19, 8, 19], ancora: [0, 4.6, -19] }
  ];
  const areaDi = id => AREE.find(a => a.id === id);
  let filtro = 'T'; try { const f = localStorage.getItem('p3d-filtro'); if (f === 'M' || f === 'F') filtro = f; } catch (e) { /* default: tutti */ }
  const PELLI = ['#f1c9a5', '#e8b98e', '#8d5a3b', '#f5d0b0', '#c68642', '#d8a06f', '#e0ac82', '#a9714b'];
  const CAPELLI = ['#4b5563', '#78350f', '#111827', '#92400e', '#374151', '#1f2937', '#422006', '#7c2d12'];
  const COLORI = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#f8fafc'];
  const scuro = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
  const mescola = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();

  // ---------- chi lavora dove (i nomi sono quelli veri del sito) ----------
  // ogni isola da 4: Responsabile e Atleti a nord (guardano a sud), Team e Ricercatore a sud (guardano a nord)
  const DEFS = [];
  const POD_A = { ES1: -14.25, ES2: -4.75, AL: 4.75, JUN: 14.25 };
  const RUOLI = [['resp', 'Responsabile', -1.3, -1.9, 1], ['atleti', 'Atleti', 1.3, -1.9, 1], ['team', 'Team', -1.3, 1.9, -1], ['ric', 'Ricercatore', 1.3, 1.9, -1]];
  Object.keys(CATS).forEach(cat => {
    const [nome, col] = CATS[cat], elite = cat === 'ELI', cz = elite ? -13 : POD_A[cat];
    ['M', 'F'].forEach(sx => RUOLI.forEach(([r, et, dx, dz, dir]) => {
      const cx = elite ? (sx === 'M' ? 13 : 23) : (sx === 'M' ? -23 : -13), k = DEFS.length;
      DEFS.push({ nome: `${et} ${nome} ${sx}`, etich: et, area: elite ? 'elite' : 'giovanile', ruolo: r, sesso: sx, cat, seat: [cx + dx, cz + dz], dir, pod: [cx, cz], col,
        look: { maglia: r === 'resp' ? '#334155' : r === 'team' ? scuro(col, 0.62) : r === 'ric' ? '#0369a1' : col, accento: col, casco: r === 'team' ? '#f8fafc' : r === 'ric' ? '#e0f2fe' : col, lunga: r === 'resp', occhiali: true,
          pelle: PELLI[(k * 5 + 2) % 8], capelli: CAPELLI[(k * 3 + 1) % 8], coda: sx === 'F', copricapo: 'casco' } });
    }));
  });
  const STAFF = [
    ['Caporedattore', 'direzione', -3.6, -6.5, { maglia: '#7c3aed', capelli: '#4b5563', pelle: '#f1c9a5' }], ['Capo servizio', 'direzione', 3.6, -6.5, { maglia: '#475569', capelli: '#9ca3af', pelle: '#e0ac82' }],
    ['Cronista', 'direzione', -3.6, 6, { maglia: '#16a34a', capelli: '#78350f', pelle: '#e8b98e' }], ['Inviato speciale', 'direzione', 3.6, 6, { maglia: '#0d9488', capelli: '#374151', pelle: '#c68642' }],
    ['Ricercatore', 'direzione', -3.6, 11, { maglia: '#0ea5e9', capelli: '#1f2937', pelle: '#f1c9a5', coda: true }], ['Analista', 'direzione', 3.6, 11, { maglia: '#65a30d', capelli: '#422006', pelle: '#d8a06f' }],
    ['Cassiere', 'direzione', 3.6, 15.4, { maglia: '#d97706', capelli: '#7c2d12', pelle: '#e0ac82' }],
    ['Redattore Tech', 'tech', 13, 5.5, { maglia: '#ea580c', capelli: '#1f2937', pelle: '#d8a06f' }], ['Ricercatore Tech', 'tech', 23, 5.5, { maglia: '#0891b2', capelli: '#422006', pelle: '#f1c9a5', coda: true }]
  ];
  STAFF.forEach(([nome, area, x, z, l]) => DEFS.push({ nome, etich: nome, area, ruolo: 'staff', sesso: l.coda ? 'F' : 'M', cat: null, seat: [x, z], dir: 1, col: areaDi(area).col,
    look: Object.assign({ accento: '#ffffff', casco: l.maglia, lunga: true, occhiali: false, copricapo: 'berretto' }, l) }));
  // Vezz: il personaggio dell'utente, alla scrivania di coordinamento al centro della Direzione
  const VEZZ0 = { maglia: '#be123c', casco: '#f8fafc', pelle: '#e8b98e', capelli: '#1f2937', occhiali: true, coda: false, lunga: false, copricapo: 'casco' };
  let vezzLook = Object.assign({}, VEZZ0); try { Object.assign(vezzLook, JSON.parse(localStorage.getItem('p3d-vezz') || '{}')); } catch (e) { /* default */ }
  DEFS.push({ nome: 'Vezz', etich: 'Vezz', area: 'direzione', ruolo: 'vezz', sesso: 'M', cat: null, seat: [0, -1.2], dir: 1, col: '#be123c', look: Object.assign({}, vezzLook, { accento: '#fbbf24' }) });

  // ---------- renderer, camera, luci ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xe3e7ec);
  host.insertBefore(renderer.domElement, host.firstChild);
  const scene = new THREE.Scene();
  const FOV = 26, T26 = Math.tan(FOV / 2 * Math.PI / 180);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 420);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8d8272, 0.95));
  const sole = new THREE.DirectionalLight(0xffefd9, 0.85); sole.castShadow = false; sole.shadow.mapSize.set(2048, 2048);
  sole.position.set(-24, 36, 28); sole.target.position.set(0, 0, 0);
  Object.assign(sole.shadow.camera, { left: -44, right: 44, top: 32, bottom: -32, near: 5, far: 120 }); sole.shadow.bias = -0.0005; sole.shadow.normalBias = 0.05;
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

  // ---------- griglia di camminamento (celle da mezza unita) e ricerca del percorso ----------
  const CELLA = 0.5, GX = Math.round((XMAX - XMIN) / CELLA), GZ = Math.round((ZMAX - ZMIN) / CELLA), MARG = 0.25;
  const blocc = new Uint8Array(GX * GZ);
  function ostacolo(x0, z0, x1, z1) {                              // blocca le celle il cui centro sta nel rettangolo, allargato di un margine
    const i0 = Math.max(0, Math.floor((x0 - MARG - XMIN) / CELLA)), i1 = Math.min(GX - 1, Math.floor((x1 + MARG - XMIN) / CELLA));
    const j0 = Math.max(0, Math.floor((z0 - MARG - ZMIN) / CELLA)), j1 = Math.min(GZ - 1, Math.floor((z1 + MARG - ZMIN) / CELLA));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = XMIN + (i + 0.5) * CELLA, cz = ZMIN + (j + 0.5) * CELLA;
      if (cx >= x0 - MARG && cx <= x1 + MARG && cz >= z0 - MARG && cz <= z1 + MARG) blocc[j * GX + i] = 1;
    }
  }
  ostacolo(XMIN - 2, ZMIN - 2, XMIN + 0.3, ZMAX + 2); ostacolo(XMAX - 0.3, ZMIN - 2, XMAX + 2, ZMAX + 2); ostacolo(XMIN - 2, ZMIN - 2, XMAX + 2, ZMIN + 0.3); ostacolo(XMIN - 2, ZMAX - 0.3, XMAX + 2, ZMAX + 2);
  const ci = x => Math.max(0, Math.min(GX - 1, Math.floor((x - XMIN) / CELLA))), cj = z => Math.max(0, Math.min(GZ - 1, Math.floor((z - ZMIN) / CELLA)));
  const cxm = i => XMIN + (i + 0.5) * CELLA, czm = j => ZMIN + (j + 0.5) * CELLA;
  const libera = (i, j) => i >= 0 && j >= 0 && i < GX && j < GZ && !blocc[j * GX + i];
  function piuVicina(x, z) {                                       // la cella libera piu vicina a un punto
    const i0 = ci(x), j0 = cj(z); if (libera(i0, j0)) return [i0, j0];
    for (let r = 1; r < 16; r++) {
      let best = null, bd = 1e9;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) { if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || !libera(i, j)) continue; const d = Math.hypot(cxm(i) - x, czm(j) - z); if (d < bd) { bd = d; best = [i, j]; } }
      if (best) return best;
    }
    return [i0, j0];
  }
  function vede(x0, z0, x1, z1) {                                  // linea di vista libera tra due punti?
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 0.2));
    for (let k = 1; k < n; k++) { const t = k / n; if (!libera(ci(x0 + (x1 - x0) * t), cj(z0 + (z1 - z0) * t))) return false; }
    return true;
  }
  function cammino(x0, z0, x1, z1) {                               // A* a 8 direzioni + tiro teso: ritorna i punti da raggiungere (l'ultimo e esattamente la meta)
    const s = piuVicina(x0, z0), g = piuVicina(x1, z1), N = GX * GZ, sid = s[1] * GX + s[0], gid = g[1] * GX + g[0];
    const gS = new Float32Array(N).fill(1e9), prev = new Int32Array(N).fill(-1), chiuso = new Uint8Array(N), hF = [], hI = [];
    const su = (f, id) => { let k = hF.length; hF.push(f); hI.push(id); while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= hF[k]) break; [hF[p], hF[k]] = [hF[k], hF[p]]; [hI[p], hI[k]] = [hI[k], hI[p]]; k = p; } };
    const giu = () => { const id = hI[0], lf = hF.pop(), li = hI.pop(); if (hF.length) { hF[0] = lf; hI[0] = li; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hF.length && hF[l] < hF[m]) m = l; if (r < hF.length && hF[r] < hF[m]) m = r; if (m === k) break; [hF[m], hF[k]] = [hF[k], hF[m]]; [hI[m], hI[k]] = [hI[k], hI[m]]; k = m; } } return id; };
    const eur = (i, j) => { const dx = Math.abs(i - g[0]), dy = Math.abs(j - g[1]); return (dx + dy) - 0.586 * Math.min(dx, dy); };
    gS[sid] = 0; su(eur(s[0], s[1]), sid);
    const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let trovato = false;
    while (hF.length) {
      const id = giu(); if (chiuso[id]) continue; chiuso[id] = 1;
      if (id === gid) { trovato = true; break; }
      const i = id % GX, j = (id / GX) | 0;
      for (const [di, dj] of D8) {
        const ni = i + di, nj = j + dj; if (!libera(ni, nj)) continue;
        if (di && dj && (!libera(i + di, j) || !libera(i, j + dj))) continue;      // niente tagli d'angolo
        const nid = nj * GX + ni, c = gS[id] + (di && dj ? 1.414 : 1);
        if (c < gS[nid]) { gS[nid] = c; prev[nid] = id; su(c + eur(ni, nj), nid); }
      }
    }
    if (!trovato) return [[x1, z1]];
    const celle = []; for (let id = gid; id !== -1; id = prev[id]) celle.push([cxm(id % GX), czm((id / GX) | 0)]);
    celle.reverse();
    const pts = [[x0, z0], ...celle], out = []; let cur = 0;
    while (cur < pts.length - 1) {
      let k = pts.length - 1; while (k > cur + 1 && !vede(pts[cur][0], pts[cur][1], pts[k][0], pts[k][1])) k--;
      out.push(pts[k]); cur = k;
    }
    const ult = out[out.length - 1];
    if (!ult || Math.hypot(ult[0] - x1, ult[1] - z1) > 0.05) out.push([x1, z1]); else out[out.length - 1] = [x1, z1];
    return out;
  }

  // ---------- textures e cartelli ----------
  function tex(w, h, disegna, ripeti) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; disegna(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (ripeti) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ripeti[0], ripeti[1]); }
    return t;
  }
  function disegnaTarga(m, testo, sotto) {
    const c = m.userData.c, g = c.getContext('2d'), col = m.userData.col;
    g.fillStyle = col || '#292524'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 ' + Math.round(c.height * (sotto ? 0.34 : 0.5)) + 'px system-ui'; g.fillText(testo, c.width / 2, c.height * (sotto ? 0.5 : 0.68));
    if (sotto) { g.fillStyle = 'rgba(255,255,255,.78)'; g.font = '500 ' + Math.round(c.height * 0.18) + 'px system-ui'; g.fillText(sotto, c.width / 2, c.height * 0.8); }
    m.userData.t.needsUpdate = true;
  }
  function targa(testo, sotto, w, h, x, y, z, col, rotY) {
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t })); m.position.set(x, y, z); m.rotation.y = rotY || 0; m.userData = { c, t, col };
    disegnaTarga(m, testo, sotto); scene.add(m); return m;
  }
  function pannello(w, h, x, y, z, rotY, tm) {                      // pannello con cornice scura e una texture
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY || 0;
    const cor = box(w + 0.18, h + 0.18, 0.08, matAntr); cor.position.z = -0.05; g.add(cor);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tm })); g.add(p); scene.add(g); return g;
  }
  const SCHERMI = [0, 1, 2, 3].map(i => { const c = document.createElement('canvas'); c.width = 96; c.height = 60; const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return { c, t, fase: i * 1.9 }; });
  const matAntr = mat(0x34373c, { metalness: 0.35, roughness: 0.5 }), matGamba = mat(0x6b7280, { metalness: 0.3, roughness: 0.5 }), matMon = mat(0x1e293b), matSedia = mat(0x44403c), matLegno = mat(0xc9a273, { roughness: 0.6 });
  const matVetro = new THREE.MeshStandardMaterial({ color: 0xcfe6f5, transparent: true, opacity: 0.17, roughness: 0.08, metalness: 0.15, depthWrite: false, side: THREE.DoubleSide });
  const matBianco = mat(0xf3eee6, { roughness: 0.8 });

  // ---------- il pavimento, le vetrate, le travi ----------
  (function () {
    const legno = tex(512, 512, (g, w, h) => {
      const toni = ['#d3b88e', '#cdb287', '#d8bf96', '#c9ae83', '#d0b58a'];
      for (let i = 0; i < 8; i++) {
        g.fillStyle = toni[i % 5]; g.fillRect(i * 64, 0, 64, h);
        for (let k = 0; k < 26; k++) { g.fillStyle = 'rgba(110,70,35,' + (0.04 + ((k * 7 + i * 3) % 5) * 0.012) + ')'; g.fillRect(i * 64 + ((k * 37 + i * 11) % 60), ((k * 53 + i * 29) % h), 1.4, 24 + ((k * 17) % 70)); }
        g.fillStyle = 'rgba(70,45,20,.2)'; g.fillRect(i * 64, 0, 1.2, h);
        for (let b = 0; b < 3; b++) g.fillRect(i * 64, ((i * 131 + b * 211) % h), 64, 1.2);
      }
    }, [7, 4.75]);
    const suolo = new THREE.Mesh(new THREE.PlaneGeometry(260, 180), mat(0xcdd3d6, { roughness: 1 })); suolo.rotation.x = -Math.PI / 2; suolo.position.set(0, -0.62, 6); suolo.receiveShadow = true; scene.add(suolo);
    const sol = box(58.8, 0.6, 40.8, mat(0x3a3d42)); sol.position.set(0, -0.33, 0); sol.receiveShadow = true; scene.add(sol);
    const pav = new THREE.Mesh(new THREE.PlaneGeometry(56, 38), new THREE.MeshStandardMaterial({ map: legno, roughness: 0.55, metalness: 0.03 })); pav.rotation.x = -Math.PI / 2; pav.receiveShadow = true; scene.add(pav);
    AREE.slice(1).forEach(a => {                                      // un velo di colore per area
      const [x0, z0, x1, z1] = a.rect, v = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color: a.col, transparent: true, opacity: 0.06, depthWrite: false }));
      v.rotation.x = -Math.PI / 2; v.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); scene.add(v);
    });
    // vetrate sul perimetro: alte a nord, a est e a ovest; solo un parapetto a sud (verso la camera)
    const montante = (x, z, h) => { const m = box(0.2, h, 0.2, matAntr); m.position.set(x, h / 2, z); m.castShadow = true; scene.add(m); };
    const lastra = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matVetro); m.position.set(x, y, z); m.renderOrder = 3; scene.add(m); };
    const rail = (w, d, x, y, z) => { const m = box(w, 0.1, d, matAntr); m.position.set(x, y, z); scene.add(m); };
    lastra(56.6, 4.1, 0.1, 0, 2.05, ZMIN - 0.1); rail(56.8, 0.22, 0, 4.1, ZMIN - 0.1);
    lastra(0.1, 4.1, 38.6, XMIN - 0.1, 2.05, 0); rail(0.22, 38.8, XMIN - 0.1, 4.1, 0);
    lastra(0.1, 4.1, 38.6, XMAX + 0.1, 2.05, 0); rail(0.22, 38.8, XMAX + 0.1, 4.1, 0);
    lastra(56.6, 1.05, 0.1, 0, 0.55, ZMAX + 0.1); rail(56.8, 0.18, 0, 1.08, ZMAX + 0.1);
    for (let x = -28; x <= 28; x += 7) { montante(x, ZMIN - 0.1, 4.1); montante(x, ZMAX + 0.1, 1.08); }
    for (let z = -19; z <= 19; z += 6.33) { montante(XMIN - 0.1, z, 4.1); montante(XMAX + 0.1, z, 4.1); }
    // soffitto aperto: solo due travi sottili sopra i varchi principali, per dare la scala senza coprire la vista
    [-8, 8].forEach(x => { const b = box(0.14, 0.18, 38.4, matAntr); b.position.set(x, 4.2, 0); scene.add(b); });
  })();

  // ---------- pareti divisorie basse e trasparenti, con i varchi ----------
  function parete(x0, z0, x1, z1) {
    const lungo = Math.hypot(x1 - x0, z1 - z0), orizz = Math.abs(z1 - z0) < 1e-6, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const v = new THREE.Mesh(new THREE.BoxGeometry(orizz ? lungo : 0.07, 1.15, orizz ? 0.07 : lungo), matVetro); v.position.set(cx, 0.65, cz); v.renderOrder = 3; scene.add(v);
    const r = box(orizz ? lungo : 0.12, 0.06, orizz ? 0.12 : lungo, matAntr); r.position.set(cx, 1.25, cz); scene.add(r);
    const b = box(orizz ? lungo : 0.12, 0.08, orizz ? 0.12 : lungo, matAntr); b.position.set(cx, 0.06, cz); scene.add(b);
    const led = box(orizz ? lungo : 0.05, 0.03, orizz ? 0.05 : lungo, new THREE.MeshBasicMaterial({ color: 0xffd08a })); led.position.set(cx, 0.03, cz); scene.add(led);             // filo di luce calda alla base
    [[x0, z0], [x1, z1]].forEach(p => { const m = box(0.14, 1.28, 0.14, matAntr); m.position.set(p[0], 0.64, p[1]); scene.add(m); });
    ostacolo(orizz ? x0 : x0 - 0.1, orizz ? z0 - 0.1 : z0, orizz ? x1 : x1 + 0.1, orizz ? z1 + 0.1 : z1);
  }
  [[-19, -11.5], [-7.5, -2], [2, 7.5], [11.5, 19]].forEach(([a, b]) => parete(-8, a, -8, b));      // area A | Direzione (varchi alle righe e al centro)
  [[-19, -10], [-6, -2], [2, 6], [10, 19]].forEach(([a, b]) => parete(8, a, 8, b));                // Direzione | B e C
  [[8, 15], [21, 28]].forEach(([a, b]) => parete(a, 0, b, 0));                                     // B | C

  // ---------- scrivanie, sedie, schermi: tutto istanziato (poche chiamate grafiche per 50 postazioni) ----------
  const POSTAZIONI = DEFS.map((d, k) => ({ x: d.seat[0], z: d.seat[1], dir: d.dir, col: d.col || '#78716c', k }));
  (function () {
    const n = POSTAZIONI.length, Tm = new THREE.Matrix4(), Lm = new THREE.Matrix4(), M = new THREE.Matrix4(), qx = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const parti = [
      [new THREE.BoxGeometry(2.1, 0.08, 0.95), matLegno, [[0, 0.8, 0.9]]], [new THREE.BoxGeometry(0.06, 0.78, 0.9), matGamba, [[-1.0, 0.4, 0.9], [1.0, 0.4, 0.9]]],
      [new THREE.BoxGeometry(0.62, 0.03, 0.42), matMon, [[0, 0.85, 0.62]]], [new THREE.BoxGeometry(0.64, 0.4, 0.025), matMon, [[0, 1.03, 0.82, 0.2]]],
      [new THREE.CylinderGeometry(0.3, 0.3, 0.07, 14), matSedia, [[0, 0.5, -0.02]]], [new THREE.BoxGeometry(0.55, 0.55, 0.07), matSedia, [[0, 0.85, -0.32]]], [new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), matGamba, [[0, 0.25, -0.02]]],
      [new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff }), [[0, 1.04, 0.842, 0.2, true]]]
    ];
    parti.forEach(([geo, m, locs]) => {
      const im = new THREE.InstancedMesh(geo, m, n * locs.length); let id = 0;
      POSTAZIONI.forEach(p => {
        Tm.makeRotationY(p.dir > 0 ? 0 : Math.PI); Tm.setPosition(p.x, 0, p.z);
        locs.forEach(l => { qx.setFromAxisAngle(ax, l[3] || 0); Lm.compose(pos.set(l[0], l[1], l[2]), qx, one); M.multiplyMatrices(Tm, Lm); im.setMatrixAt(id, M); if (l[4]) im.setColorAt(id, new THREE.Color(p.col)); id++; });
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false; im.castShadow = !l0(locs); im.receiveShadow = true; scene.add(im);
    });
    function l0(locs) { return !!locs[0][4]; }
    POSTAZIONI.forEach(p => {                                          // lo schermo di ogni scrivania (4 texture animate condivise)
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = p.dir > 0 ? 0 : Math.PI;
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ map: SCHERMI[p.k % 4].t })); sc.position.set(0, 1.035, 0.793); sc.rotation.set(0.2, Math.PI, 0); g.add(sc); scene.add(g);
    });
  })();
  // ingombri: isole da 4 e scrivanie singole (gli addetti si siedono fuori dall'ingombro, sulla sedia)
  DEFS.forEach(d => { if (d.cat) { if (d.ruolo === 'resp') ostacolo(d.pod[0] - 2.4, d.pod[1] - 1.6, d.pod[0] + 2.4, d.pod[1] + 1.6); } else ostacolo(d.seat[0] - 1.05, d.seat[1] + 0.45, d.seat[0] + 1.05, d.seat[1] + 1.35); });

  // ---------- arredo e identita delle aree ----------
  const RANK = tex(1024, 220, () => {}), tabelloni = [];
  (function () {
    // tappeti sotto le isole + cartello di categoria sul pavimento
    DEFS.forEach(d => {
      if (!d.cat || d.ruolo !== 'resp') return;
      const [cx, cz] = d.pod, col = CATS[d.cat][1];
      const bordo = new THREE.Mesh(new THREE.PlaneGeometry(7.1, 6.1), mat(scuro(col, 0.7), { roughness: 1 })); bordo.rotation.x = -Math.PI / 2; bordo.position.set(cx, 0.016, cz); bordo.receiveShadow = true; scene.add(bordo);
      const tap = new THREE.Mesh(new THREE.PlaneGeometry(6.7, 5.7), mat(mescola(col, 0.78), { roughness: 1 })); tap.rotation.x = -Math.PI / 2; tap.position.set(cx, 0.022, cz); tap.receiveShadow = true; scene.add(tap);
      const t = tex(512, 128, (g, w, h) => { g.fillStyle = 'rgba(255,252,246,.0)'; g.fillRect(0, 0, w, h); g.fillStyle = scuro(col, 0.62); g.textAlign = 'center'; g.font = '700 46px system-ui'; g.fillText(CATN[d.cat], w / 2, 56); g.font = '600 32px system-ui'; g.fillStyle = scuro(col, 0.8); g.fillText(d.sesso === 'M' ? 'UOMINI' : 'DONNE', w / 2, 100); });
      const etic = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); etic.rotation.x = -Math.PI / 2; etic.position.set(cx, 0.03, cz + 3.55); scene.add(etic);
    });
    // piante in vaso agli angoli e ai varchi
    const vaso = mat(0x57534e), fogl = [mat(0x4d7c3a, { roughness: 0.9 }), mat(0x5f9448, { roughness: 0.9 }), mat(0x3f6a30, { roughness: 0.9 })];
    [[-26.9, -17.8], [26.9, -17.8], [26.9, 17.8], [-26.9, 17.8], [-7.2, -17.8], [7.2, -17.8], [7.2, 17.8], [-7.2, 17.8], [26.9, -1.4], [9.2, 17.8]].forEach(([x, z], i) => {
      const g = new THREE.Group(), p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.55, 14), vaso); p.position.y = 0.27; g.add(p);
      [[0, 1.0, 0, 0.5], [0.22, 1.3, 0.1, 0.38], [-0.2, 1.2, -0.12, 0.34]].forEach(([dx, dy, dz, r], k) => { const f = tondo(r, fogl[(i + k) % 3], 1, 1.1, 1); f.position.set(dx, dy, dz); g.add(f); });
      g.position.set(x, 0, z); scene.add(ombra(g)); ostacolo(x - 0.45, z - 0.45, x + 0.45, z + 0.45);
    });
    // bici appoggiate alla parete ovest (area giovanile)
    [[-16.2, 0xdc2626], [-6.4, 0x2563eb], [3.6, 0xf59e0b], [13.2, 0x16a34a]].forEach(([z, c]) => bici(-27.0, z, Math.PI / 2, c));
    // maglie incorniciate alla parete ovest e a nord della Direzione
    const maglia = (c1, c2) => tex(128, 160, (g, w, h) => { g.fillStyle = '#f5f0e6'; g.fillRect(0, 0, w, h); g.fillStyle = c1; g.beginPath(); g.moveTo(30, 24); g.lineTo(52, 14); g.lineTo(76, 14); g.lineTo(98, 24); g.lineTo(116, 52); g.lineTo(98, 62); g.lineTo(92, 50); g.lineTo(92, 138); g.lineTo(36, 138); g.lineTo(36, 50); g.lineTo(30, 62); g.lineTo(12, 52); g.closePath(); g.fill(); g.fillStyle = c2; g.fillRect(36, 84, 56, 12); });
    [[-12, '#db2777', '#fde68a'], [-1.5, '#facc15', '#111827'], [10, '#16a34a', '#f8fafc']].forEach(([z, a, b]) => { const p = pannello(0.9, 1.12, XMIN + 0.14, 2.2, z, Math.PI / 2, maglia(a, b)); });
    [[-5, '#f59e0b', '#111827'], [5, '#2563eb', '#f8fafc']].forEach(([x, a, b]) => pannello(0.9, 1.12, x, 2.5, ZMIN + 0.16, 0, maglia(a, b)));
    // Direzione: bacheca grande dietro la scrivania di Vezz, tavolo riunioni, podio
    tabelloni.push({ m: targa('Bozze 0 · Spunti 0', 'Costi 0,00 $ su 10 $', 5.6, 1.5, 0, 2.7, -3.55, '#292524', 0), tipo: 'bacheca' });
    [-2.9, 2.9].forEach(x => { const p = box(0.1, 2.6, 0.1, matAntr); p.position.set(x, 1.3, -3.6); p.castShadow = true; scene.add(p); });
    ostacolo(-3, -3.7, 3, -3.4);
    const tv = box(8.4, 0.07, 2.4, mat(0xcfe6f5, { transparent: true, opacity: 0.55, roughness: 0.1 })); tv.position.set(0, 0.78, -13); tv.renderOrder = 2; scene.add(tv);
    [[-3.6, -13], [3.6, -13]].forEach(([x, z]) => { const l = box(0.2, 0.78, 2.0, matAntr); l.position.set(x, 0.39, z); l.castShadow = true; scene.add(l); });
    ostacolo(-4.3, -14.2, 4.3, -11.8);
    [-3, -1, 1, 3].forEach(x => { sediaStat(x, -14.55, 0); sediaStat(x, -11.45, Math.PI); });
    pannello(3.6, 1.7, 0, 2.2, ZMIN + 0.24, 0, tex(512, 240, (g, w, h) => { g.fillStyle = '#f5efe4'; g.fillRect(0, 0, w, h); g.fillStyle = '#6d28d9'; g.font = '700 44px system-ui'; g.textAlign = 'center'; g.fillText('RIUNIONI', w / 2, 100); g.fillStyle = '#78716c'; g.font = '500 26px system-ui'; g.fillText('sala di redazione', w / 2, 150); }));
    const pod = new THREE.Group(); [[0, 0.5, 0, 1.2], [-1.15, 0.33, 0.1, 1.05], [1.15, 0.22, 0.1, 1.05]].forEach(([dx, h, dz, w], i) => { const s = box(w, h, 1.0, mat([0xe5e7eb, 0xfacc15, 0xd6a77a][i === 0 ? 1 : i === 1 ? 0 : 2])); s.position.set(dx, h / 2, dz); pod.add(s); });
    pod.position.set(5.9, 0, -2.4); scene.add(ombra(pod)); ostacolo(4.1, -3.0, 7.7, -1.6);
    const coppa = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, 0.3, 12), mat(0xfacc15, { metalness: 0.6, roughness: 0.3 })); coppa.position.set(5.9, 0.65, -2.4); scene.add(coppa);
    // cassa: tabellone dei costi dietro al Cassiere
    tabelloni.push({ m: targa('Costi', '0,00 $ su 10,00 $', 3.4, 1.4, 3.6, 2.15, 13.55, '#92400e', 0), tipo: 'costi' });
    [2.0, 5.2].forEach(x => { const p = box(0.08, 2.0, 0.08, matAntr); p.position.set(x, 1.0, 13.58); scene.add(p); });
    ostacolo(1.9, 13.45, 5.3, 13.7);
    // Elite/U23: muro delle classifiche e tavolo di analisi
    pannello(15.5, 2.5, 18, 2.55, ZMIN + 0.2, 0, RANK);
    const tav = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.08, 28), mat(0xe8e0d3)); tav.position.set(18, 0.9, -4.5); tav.castShadow = true; scene.add(tav);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.9, 12), matAntr); col.position.set(18, 0.45, -4.5); scene.add(col);
    [0.35, 0.6, 0.45, 0.8, 0.5].forEach((h, i) => { const b = box(0.2, h, 0.2, mat(0xf59e0b, { emissive: 0xb45309, emissiveIntensity: 0.6 })); b.position.set(17.1 + i * 0.45, 0.94 + h / 2, -4.5); scene.add(b); });
    ostacolo(16.3, -6.2, 19.7, -2.8);
    // Tech: banco officina con bici sui cavalletti, vetrina dei materiali, scaffale di ruote, schermo del radar
    const banco = box(12, 0.9, 1.4, mat(0xcbb08a)); banco.position.set(18, 0.45, 16.2); banco.castShadow = true; banco.receiveShadow = true; scene.add(banco);
    const piano = box(12.2, 0.07, 1.5, matGamba); piano.position.set(18, 0.93, 16.2); scene.add(piano);
    ostacolo(12, 15.5, 24, 16.9);
    [[14.2, 0xea580c], [21.8, 0x0891b2]].forEach(([x, c]) => { bici(x, 14.3, 0, c, 0.28); const st = box(1.1, 0.28, 0.5, matAntr); st.position.set(x, 0.14, 14.3); scene.add(st); ostacolo(x - 0.7, 13.9, x + 0.7, 14.7); });
    const vetrina = box(4.2, 0.85, 1.8, mat(0xe8e0d3)); vetrina.position.set(18, 0.43, 10.3); vetrina.castShadow = true; scene.add(vetrina);
    [[-1.3, 0], [-0.4, 0.1], [0.5, -0.1]].forEach(([dx], i) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 24), mat(0x111827)); r.rotation.x = Math.PI / 2 - 0.3; r.position.set(18 + dx, 0.95, 10.3); scene.add(r); });
    const cas = tondo(0.22, mat(0xea580c), 1, 0.8, 1.15); cas.position.set(19.7, 1.0, 10.3); scene.add(cas);
    ostacolo(15.9, 9.4, 20.1, 11.2);
    const scaf = box(0.5, 2.6, 14, mat(0xcbb08a)); scaf.position.set(XMAX - 0.45, 1.3, 10.5); scaf.castShadow = true; scene.add(scaf);
    for (let k = 0; k < 6; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 24), mat(k % 2 ? 0x111827 : 0x64748b)); r.position.set(XMAX - 0.95, 1.15 + (k % 2) * 0.9, 4.6 + k * 1.9); r.rotation.y = Math.PI / 2; scene.add(r); }
    ostacolo(XMAX - 1.0, 3.2, XMAX, 17.8);
    pannello(3.4, 1.5, XMAX - 0.15, 3.4, 11, -Math.PI / 2, tex(512, 220, (g, w, h) => { g.fillStyle = '#1c1917'; g.fillRect(0, 0, w, h); g.fillStyle = '#fb923c'; g.font = '700 42px system-ui'; g.textAlign = 'center'; g.fillText('RADAR NOVITÀ', w / 2, 92); g.fillStyle = '#d6d3d1'; g.font = '500 26px system-ui'; g.fillText('tecnica · bici · materiali', w / 2, 142); }));
    // Direzione: l'angolo caffe, per dare vita al centro
    const tavolino = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 20), mat(0xe8e0d3)); tavolino.position.set(-5.9, 0.72, 15.6); scene.add(tavolino);
    const gamba = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.2, 0.7, 10), matAntr); gamba.position.set(-5.9, 0.35, 15.6); scene.add(gamba); ostacolo(-6.6, 14.9, -5.2, 16.3);
  })();
  function sediaStat(x, z, rot) {
    const g = new THREE.Group(), s = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 14), matSedia); s.position.y = 0.5; g.add(s);
    const d = box(0.55, 0.55, 0.07, matSedia); d.position.set(0, 0.85, -0.32); g.add(d); const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), matGamba); c.position.y = 0.25; g.add(c);
    g.position.set(x, 0, z); g.rotation.y = rot; scene.add(ombra(g));
  }
  function bici(x, z, rotY, col, y0) {
    const g = new THREE.Group(), m = mat(col, { roughness: 0.4 }), nero = mat(0x111827);
    [-0.62, 0.62].forEach(dx => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 24), nero); r.position.set(dx, 0.36, 0); g.add(r); });
    const tubo = (a, b) => { const v = new THREE.Vector3().subVectors(b, a), t = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, v.length(), 6), m); t.position.copy(a).add(b).multiplyScalar(0.5); t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); g.add(t); };
    const A = new THREE.Vector3(-0.62, 0.36, 0), B = new THREE.Vector3(0.62, 0.36, 0), S = new THREE.Vector3(-0.2, 0.72, 0), Tt = new THREE.Vector3(0.38, 0.72, 0), P = new THREE.Vector3(0.1, 0.36, 0);
    tubo(A, S); tubo(S, Tt); tubo(A, P); tubo(P, S); tubo(P, Tt); tubo(B, Tt);
    const sel = box(0.22, 0.04, 0.1, nero); sel.position.set(-0.22, 0.76, 0); g.add(sel);
    const man = box(0.04, 0.04, 0.3, nero); man.position.set(0.4, 0.8, 0); g.add(man);
    g.position.set(x, y0 || 0, z); g.rotation.y = rotY; scene.add(ombra(g)); if (!y0) ostacolo(rotY ? x - 0.3 : x - 0.75, rotY ? z - 0.75 : z - 0.3, rotY ? x + 0.3 : x + 0.75, rotY ? z + 0.75 : z + 0.3);
    return g;
  }
  function disegnaSchermi(tempo) {
    SCHERMI.forEach(s => {
      const g = s.c.getContext('2d'); g.fillStyle = '#0b1220'; g.fillRect(0, 0, 96, 60); g.fillStyle = '#38bdf8'; g.fillRect(0, 0, 96, 7);
      for (let i = 0; i < 5; i++) { const w = 22 + (Math.sin(s.fase + i * 1.7 + tempo * 1.4) + 1) * 26; g.fillStyle = 'rgba(226,232,240,.85)'; g.fillRect(6, 13 + i * 9, w, 3.5); }
      s.t.needsUpdate = true;
    });
  }
  function disegnaClassifica(tempo) {                                  // il muro delle classifiche: barre che respirano (a 4 fotogrammi al secondo)
    const c = RANK.image, g = c.getContext('2d');
    g.fillStyle = '#1c1917'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#fb923c'; g.fillRect(0, 0, c.width, 8);
    g.fillStyle = '#f5efe4'; g.font = '700 34px system-ui'; g.fillText('CLASSIFICHE · ELITE E UNDER 23', 30, 56);
    for (let i = 0; i < 7; i++) { const w = 180 + (7 - i) * 70 + Math.sin(tempo * 1.1 + i) * 22; g.fillStyle = i === 0 ? '#fbbf24' : 'rgba(245,239,228,.78)'; g.fillRect(30, 82 + i * 19, w, 11); g.fillStyle = 'rgba(245,239,228,.5)'; g.fillRect(30 + w + 10, 84 + i * 19, 36, 7); }
    RANK.needsUpdate = true;
  }
  disegnaClassifica(0);

  // ---------- il ciclista (gli stessi personaggi di sempre; i materiali sono per-personaggio, cosi il filtro puo attenuarli uno a uno) ----------
  const mkCasi = () => ({ occhi: mat(0x111827, { roughness: 0.2 }), nero: mat(0x1a202c), bianco: mat(0xf8fafc), scarpa: mat(0x111827), lente: mat(0x0b1220, { roughness: 0.15, metalness: 0.3 }) });
  function ciclista(look) {
    const casi = mkCasi();
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
  const lampGeo = new THREE.SphereGeometry(0.1, 10, 8);
  const yDi = () => 0;
  const agenti = DEFS.map(d => {
    const c = ciclista(d.look), g = new THREE.Group(); g.add(c.det, c.sem); scene.add(g);
    const blob = new THREE.Mesh(blobGeo, blobMat); blob.rotation.x = -Math.PI / 2; scene.add(blob);
    const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xf59e0b })); lamp.position.y = 2.25; lamp.visible = false; g.add(lamp);
    const rotSeat = d.dir > 0 ? 0 : Math.PI;
    const a = Object.assign({}, d, { c, g, blob, lamp, x: d.seat[0], z: d.seat[1], sx: d.seat[0], sz: d.seat[1], rot: rotSeat, rotSeat, rotWant: rotSeat, sit: 1, stato: 'siede', path: [], fase: Math.random() * 6, bolla: null, det: false, imp: 0, lavoraVero: '', compito: null, fatto: 0, dim: false });
    a.tag = document.createElement('div'); a.tag.className = 'nome' + (d.ruolo === 'vezz' ? ' vez' : ''); a.tag.textContent = d.nome; a.tag.style.display = 'none'; host.appendChild(a.tag);
    const ms = new Set(); g.traverse(o => { if (o.isMesh && o !== lamp && o.material) ms.add(o.material); }); a.mats = [...ms];
    // dove si mette chi viene a parlargli: accanto alla sedia, dal lato libero
    const cand = [[a.sx + 1.5, a.sz], [a.sx - 1.5, a.sz], [a.sx, a.sz - d.dir * 1.4], [a.sx, a.sz + d.dir * 1.4]];
    const ok = cand.find(p => libera(ci(p[0]), cj(p[1]))), pv = ok || (() => { const q = piuVicina(a.sx, a.sz); return [cxm(q[0]), czm(q[1])]; })();
    a.vis = pv;
    return a;
  });
  const per = n => agenti.find(a => a.nome === n);
  const vezz = per('Vezz');
  const dimma = (a, on) => {
    if (a.dim === on) return; a.dim = on;
    a.mats.forEach(m => { m.transparent = on; m.opacity = on ? 0.26 : 1; m.depthWrite = !on; m.needsUpdate = true; });
    a.blob.visible = !on;
  };

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
      const [tx, tz] = a.path[0], dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz), v = 2.4 * dt;
      if (d <= v) { a.x = tx; a.z = tz; a.path.shift(); }
      else { a.x += dx / d * v; a.z += dz / d * v; let dr = Math.atan2(dx, dz) - a.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); a.rot += dr * Math.min(1, dt * 10); }
    }
    const meta = a.stato === 'siede' ? 1 : 0;
    a.sit += Math.sign(meta - a.sit) * Math.min(Math.abs(meta - a.sit), dt * 3);
    if (a.stato === 'siede') {
      let dr = a.rotWant - a.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      a.rot += dr * Math.min(1, dt * 6); a.x += (a.sx - a.x) * Math.min(1, dt * 6); a.z += (a.sz - a.z) * Math.min(1, dt * 6);
    }
  }
  const percorso = (a, x, z) => cammino(a.x, a.z, x, z);

  // ---------- scene: ogni scena e una sequenza di passi ----------
  let DT = 0.033;
  function* aspetta(sec) { let t = 0; while (t < sec) { t += DT; yield; } }
  function* finche(cond) { while (!cond()) yield; }
  function* cammina(a, pts) { a.path = pts.map(p => p.slice()); a.stato = 'cammina'; while (a.path.length) yield; a.stato = 'fermo'; }
  function* alzati(a) { a.stato = 'alzato'; a.rotWant = a.rot; while (a.sit > 0.03) yield; }
  function* siediti(a) { yield* cammina(a, percorso(a, a.sx, a.sz)); a.rotWant = a.rotSeat; a.stato = 'siede'; while (a.sit < 0.97) yield; }
  const verso = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  const volto = (a, b) => { a.rot = verso(a, b); };
  function* dici(a, testo, vero, sec) {
    if (a.bolla) a.bolla.el.remove();
    const el = document.createElement('div'); el.className = 'bolla' + (vero ? '' : ' chiac'); const nb = document.createElement('b'); nb.textContent = a.nome; el.append(nb, document.createTextNode(String(testo))); host.appendChild(el);
    a.bolla = { el }; a.parla = true; yield* aspetta(sec); a.parla = false; el.remove(); a.bolla = null;
  }
  function logga(da, a, t1, t2) {
    const li = document.createElement('li'), h = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const mk = (tag, t) => { const e = document.createElement(tag); e.textContent = t; return e; };
    li.append(mk('time', h), mk('b', da), document.createTextNode(' a '), mk('b', a), document.createTextNode(': ' + t1 + (t2 ? ' «' + t2 + '»' : '')));
    const ol = root.getElementById('log'); ol.insertBefore(li, ol.firstChild); while (ol.children.length > 8) ol.removeChild(ol.lastChild);
  }

  const RIUNIONE = { centro: [0, -13], posti: [[-3, -14.55, 0], [-1, -14.55, 0], [1, -14.55, 0], [3, -14.55, 0], [-3, -11.45, Math.PI], [-1, -11.45, Math.PI], [1, -11.45, Math.PI], [3, -11.45, Math.PI], [-5.2, -13, Math.PI / 2], [5.2, -13, -Math.PI / 2]] };
  function* scenaConversa(A, B, t1, t2, vero) {
    yield* alzati(A);
    yield* cammina(A, percorso(A, B.vis[0], B.vis[1]));
    volto(A, B); B.rotWant = verso(B, A); logga(A.nome, B.nome, t1, ''); yield* dici(A, t1, vero, 3.4); yield* dici(B, t2, vero, 2.8);
    B.rotWant = B.rotSeat;
    yield* siediti(A);
    A.imp = 0; B.imp = 0;
  }
  // riunione al tavolo di piu agenti (predisposta: percorsi, posti e ritorno funzionano; le scene collettive vere si innestano qui)
  function* scenaRiunione(lista, sec) {
    const posti = RIUNIONE.posti.slice(0, lista.length), arrivati = [];
    lista.forEach((a, i) => { a.imp = 1; extra.push((function* () { yield* alzati(a); yield* cammina(a, percorso(a, posti[i][0], posti[i][1])); a.rot = posti[i][2]; arrivati.push(a); })()); });
    yield* finche(() => arrivati.length === lista.length);
    yield* aspetta(sec || 8);
    lista.forEach(a => extra.push((function* () { yield* siediti(a); a.imp = 0; })()));
  }
  function* prendi(a) { yield* finche(() => !a.imp && a.stato === 'siede' && !a.bolla); a.imp = 1; }
  function* scenaCompito(ag, testo, bozzaId) {                     // Vezz va di persona dall'addetto, gli consegna il compito
    yield* prendi(ag);
    yield* alzati(vezz);
    yield* cammina(vezz, percorso(vezz, ag.vis[0], ag.vis[1]));
    volto(vezz, ag); ag.rotWant = verso(ag, vezz);
    const breve = testo.length > 110 ? testo.slice(0, 107) + '…' : testo;
    logga('Vezz', ag.nome, 'compito diretto', breve);
    yield* dici(vezz, breve, true, 3.6); yield* dici(ag, 'Ricevuto: ci lavoro subito.', true, 2.4);
    ag.compito = { testo: breve, id: bozzaId, t: 0 }; vezz.occupato = false; ag.rotWant = ag.rotSeat;
    extra.push(lavoraCompito(ag));
  }
  function* lavoraCompito(ag) {                                    // finche la bozza vera e in scrittura l'addetto resta al lavoro
    const c = ag.compito;
    while (c.t < 40000) { c.t += DT; const s = DATI.stati[c.id]; if (c.t > 25 && s && s !== 'in_generazione') break; yield; }
    const s = DATI.stati[c.id], t = c.testo; ag.compito = null;
    if (s === 'errore') { logga(ag.nome, 'Vezz', 'compito non riuscito', t); yield* dici(ag, 'Non sono riuscito: guarda l’errore nelle Bozze.', true, 4); avvisa(ag.nome + ': compito non riuscito'); }
    else if (s && s !== 'in_generazione') { logga(ag.nome, 'Vezz', 'compito finito', t); ag.fatto = 7; yield* dici(ag, 'Fatto: «' + t.slice(0, 60) + '» è nelle Bozze, da rivedere.', true, 4); avvisa(ag.nome + ' ha finito il compito'); }
    else { yield* dici(ag, 'Ci sto ancora lavorando: lo trovi nelle Bozze appena finisce.', true, 4); }
    ag.imp = 0;
  }
  const SC_INTRA = [['atleti', 'resp', 'Ho una bozza su un atleta del reparto.', 'Bene, la controllo.', 1], ['team', 'resp', 'Il bilancio delle squadre è pronto.', 'Lo leggo subito.', 1], ['ric', 'atleti', 'Ho trovato 3 notizie sulla gara di domenica.', 'Perfetto, le uso.', 1],
    ['resp', 'team', 'Ricontrolla i punti delle squadre.', 'Ricevuto.', 1], ['atleti', 'team', 'Un caffè?', 'Volentieri.', 0], ['ric', 'resp', 'Hai visto che nebbia stamattina?', 'Ottima per le fughe.', 0]];
  const SC_STAFF = {
    direzione: [['Caporedattore', 'Capo servizio', 'Ordine fisso di oggi: bilanci e gare.', 'Lo passo ai reparti.', 1], ['Cronista', 'Capo servizio', 'La cronaca di domenica è pronta.', 'La controllo ora.', 1], ['Analista', 'Caporedattore', 'Ho 5 spunti nuovi dai dati.', 'Quali per le Juniores?', 1],
      ['Inviato speciale', 'Caporedattore', 'Una richiesta libera è in coda.', 'Dalle la priorità.', 1], ['Ricercatore', 'Cronista', 'Nuove notizie nel radar.', 'Le uso per la gara.', 1], ['Cronista', 'Analista', 'Hai visto la nebbia?', 'Stamattina, sì.', 0]],
    tech: [['Ricercatore Tech', 'Redattore Tech', 'Nel radar Tech è arrivata una novità sulle ruote.', 'Ottimo, la leggo.', 1], ['Redattore Tech', 'Ricercatore Tech', 'Cerca altre fonti sul nuovo gruppo.', 'Subito.', 1]]
  };
  const eventi = [];                                               // fatti veri dal sito: [chi, con chi, frase, risposta]
  function scegliScena() {
    const libere = agenti.filter(a => a.ruolo !== 'vezz' && !a.imp && a.stato === 'siede' && !a.bolla), r = Math.random();
    const trova = nome => libere.find(a => a.nome === nome), rnd = l => l[Math.floor(Math.random() * l.length)];
    const intra = cats => { const cat = rnd(cats), sx = Math.random() < 0.5 ? 'M' : 'F', s = rnd(SC_INTRA); return [libere.find(a => a.cat === cat && a.sesso === sx && a.ruolo === s[0]), libere.find(a => a.cat === cat && a.sesso === sx && a.ruolo === s[1]), s]; };
    let A, B, t;
    if (eventi.length) { const e = eventi.shift(); A = trova(e[0]); B = trova(e[1]); t = e; if (!A || !B) { if (eventi.length < 6) eventi.push(e); return null; } }
    else if (focus === 'giovanile' && r < 0.85) { const x = intra(['ES1', 'ES2', 'AL', 'JUN']); A = x[0]; B = x[1]; t = x[2]; }
    else if (focus === 'elite' && r < 0.85) { const x = intra(['ELI']); A = x[0]; B = x[1]; t = x[2]; }
    else if ((focus === 'direzione' || focus === 'tech') && r < 0.85) { const s = rnd(SC_STAFF[focus]); A = trova(s[0]); B = trova(s[1]); t = s; }
    else if (r < 0.5) { const x = intra(Object.keys(CATS)); A = x[0]; B = x[1]; t = x[2]; }
    else {                                                         // tra aree diverse: i responsabili e lo staff si parlano attraversando la redazione
      const resp = libere.filter(a => a.ruolo === 'resp');
      const ch = [
        () => { const x = rnd(resp); return x && [x.nome, 'Caporedattore', x.nome.replace('Responsabile ', 'Reparto ') + ': bozza controllata e confermata.', 'Ottimo, grazie.', 1]; },
        () => { const x = rnd(resp); return x && ['Caporedattore', x.nome, 'Ordine del direttore: un bilancio per la tua categoria.', 'Si parte, uno alla volta.', 1]; },
        () => ['Redattore Tech', 'Capo servizio', 'Pezzo Tech pronto, da controllare.', 'Controllo numeri e fonti.', 1],
        () => ['Cassiere', 'Caporedattore', 'Spesa del mese: ' + DATI.costoTxt + '.', 'Siamo larghi.', 1],
        () => ['Ricercatore Tech', 'Cronista', 'Ti segnalo una novità sulle ruote da seguire.', 'Grazie, la guardo.', 1]
      ];
      const v = rnd(ch)(); if (!v) return null; A = trova(v[0]); B = trova(v[1]); t = v;
    }
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
  function* vaiVezzA(x, z) { yield* alzati(vezz); yield* cammina(vezz, percorso(vezz, x, z)); vezz.occupato = false; }
  function* vezzVaDa(a) { sel = a; yield* alzati(vezz); yield* cammina(vezz, percorso(vezz, a.vis[0], a.vis[1])); volto(vezz, a); vezz.occupato = false; if (follow === vezz) fermaSegui(); apriCard(a); }
  function* vezzAllaScrivania() { yield* siediti(vezz); vezz.occupato = false; }
  function cliccaOmino(a) {
    if (a === vezz) { apriCard(a); return; }
    if (vezz.occupato) { avvisa('Vezz è ancora in cammino: aspetta un attimo'); return; }
    if (Math.hypot(vezz.x - a.vis[0], vezz.z - a.vis[1]) < 1.0 && vezz.stato !== 'siede') { apriCard(a); return; }   // e gia accanto a lui
    if (comandoVezz(vezzVaDa(a))) avvisa('Vezz va da ' + a.nome);
  }
  function comandoVezz(gen) { if (vezz.occupato) { avvisa('Vezz è ancora impegnato'); return false; } vezz.occupato = true; vezz.path = []; extra.push(gen); return true; }
  let inviando = false;
  async function daiCompito(ag, testo) {
    if (testo.trim().length < 8) { avvisa('Scrivi cosa deve fare (almeno una frase)'); return false; }
    if (inviando) { avvisa('Sto già inviando un compito: un attimo'); return false; }
    if (ag.compito || ag.compitoInCoda) { avvisa(ag.nome + ' ha già un compito'); return false; }
    if (vezz.occupato) { avvisa('Vezz è ancora impegnato: riprova tra un attimo'); return false; }
    inviando = true; ag.compitoInCoda = true; vezz.occupato = true;                    // tutto riservato PRIMA dell'attesa: due clic ravvicinati non partono in parallelo
    let r = null; try { r = await ctx.inviaCompito(ag.nome, testo.trim()); } catch (e) { r = null; }
    inviando = false;
    if (!r || !r.id) { ag.compitoInCoda = false; vezz.occupato = false; return false; }
    extra.push((function* () { yield* scenaCompito(ag, testo.trim(), r.id); ag.compitoInCoda = false; })());
    avvisa('Vezz porta il compito a ' + ag.nome); return true;
  }

  // ---------- camera, aree, selezione ----------
  let focus = 'tutto', aspetto = 1.6, sel = null, follow = null, guida = true;
  const cam = { look: new THREE.Vector3(0, 0.6, 1.2), dist: 90, az: 0.42, el: 0.72 }, mira = { look: new THREE.Vector3(0, 0.6, 1.2), dist: 90, az: 0.42, el: 0.72 };
  const distPer = (ew, ed, el) => Math.max((ew / 2) / (T26 * aspetto), ((ed * Math.sin(el) + 3.5) / 2) / T26) * 1.06;
  const Q = { tier: 0, modo: 'auto', ombre: true };
  const barraAree = root.getElementById('aree'), btnAree = [];
  AREE.forEach(a => { const b = document.createElement('button'); b.type = 'button'; b.dataset.a = a.id; const i = document.createElement('i'); i.style.setProperty('--c', a.col); b.append(i, document.createTextNode(a.nome)); b.onclick = () => vaiArea(a.id); barraAree.appendChild(b); btnAree.push(b); });
  function fermaSegui() { follow = null; root.getElementById('segui').style.display = 'none'; if (cardAg) aggiornaCard(true); }
  function vaiArea(id) {
    fermaSegui(); const a = areaDi(id) || AREE[0]; focus = a.id;
    mira.az = a.id === 'tutto' ? 0.42 : 0.3; mira.el = a.id === 'tutto' ? 0.72 : 0.62; mira.look.set(a.look[0], a.look[1], a.look[2]); mira.dist = distPer(a.ew, a.ed, mira.el);
    btnAree.forEach(b => b.classList.toggle('on', b.dataset.a === a.id)); prossima = Math.min(prossima, 0.7);
  }
  function seguiA(a) {
    follow = a; mira.dist = 15; mira.el = 0.6; mira.az = 0.3; focus = 'tutto'; btnAree.forEach(b => b.classList.remove('on'));
    const s = root.getElementById('segui'); s.textContent = 'Smetti di seguire ' + a.nome; s.style.display = 'block';
    if (cardAg) aggiornaCard(true);
  }
  root.getElementById('segui').onclick = () => vaiArea('tutto');
  const zone = AREE.slice(1).map(a => { const e = document.createElement('div'); e.className = 'zona'; e.style.setProperty('--c', a.col); e.textContent = a.sigla + ' · ' + a.nome; host.appendChild(e); return { a, e }; });

  // ---------- filtro Uomini / Donne / Tutti: attenua, non nasconde ----------
  const btnFiltro = [...root.querySelectorAll('#filtro [data-g]')];
  function setFiltro(g, init) {
    filtro = g; try { localStorage.setItem('p3d-filtro', g); } catch (e) { /* senza memoria locale */ }
    btnFiltro.forEach(b => b.classList.toggle('on', b.dataset.g === g));
    agenti.forEach(a => dimma(a, !!a.cat && g !== 'T' && a.sesso !== g));
    if (!init) avvisa(g === 'T' ? 'Tutti in evidenza' : g === 'M' ? 'In evidenza gli uomini' : 'In evidenza le donne');
  }
  btnFiltro.forEach(b => { b.onclick = () => setFiltro(b.dataset.g); });

  // ---------- scheda dell'omino ----------
  const card = root.getElementById('card'); let cardAg = null;
  const statoTesto = a => a.compito ? '✎ Compito: ' + a.compito.testo : a.lavoraVero ? '✎ ' + a.lavoraVero : a.errore ? '⚠ ' + a.dato : a.bolla ? 'Sta parlando' : a.stato === 'siede' ? 'Alla scrivania' : 'In movimento';
  function apriCard(a) {
    cardAg = a; sel = a; const vz = a.ruolo === 'vezz';
    card.innerHTML = '<button class="x" aria-label="chiudi">×</button><h4></h4><small></small>' +
      '<p id="cSt"></p><div class="rig"><button class="b" id="cSegui" type="button"></button>' + (vz ? '<button class="b" id="cPers" type="button">Personalizza</button><button class="b" id="cGuida" type="button"></button><button class="b" id="cTorna" type="button">Alla scrivania</button>' : '<button class="b" id="cVai" type="button">Vai da lui (Vezz)</button>') + '</div>' +
      (vz ? '<label>Manda Vezz in un’area</label><div class="rig" id="cAree"></div><small style="margin-top:6px">Con «Guida con clic» attivo, clicca il pavimento: Vezz ci va a piedi.</small>'
        : '<label>Compito diretto, senza passare dal direttore</label><textarea id="cTesto" rows="3" maxlength="400" placeholder="Es. Scrivi il profilo di un giovane Juniores da tenere d’occhio"></textarea><div class="rig"><button class="b go" id="cInvia" type="button">Dai il compito</button></div><small>Parte una richiesta vera: l’addetto scrive una bozza (come un articolo, circa 0,06-0,30 $). Vezz glielo porta di persona.</small>');
    card.querySelector('h4').textContent = a.nome;
    card.querySelector('small').textContent = vz ? 'Il tuo personaggio' : a.ruolo === 'staff' ? 'Redazione · ' + areaDi(a.area).nome : a.etich + ' · ' + CATS[a.cat][0] + (a.sesso === 'F' ? ' · Donne' : ' · Uomini');
    card.style.display = 'block'; card.querySelector('.x').onclick = () => { card.style.display = 'none'; cardAg = null; sel = null; };
    card.querySelector('#cSegui').onclick = () => { if (follow === a) vaiArea(focus === 'tutto' ? 'tutto' : focus); else seguiA(a); };
    if (vz) {
      card.querySelector('#cPers').onclick = apriEditor;
      const g = card.querySelector('#cGuida'); const sg = () => { g.textContent = 'Guida con clic: ' + (guida ? 'sì' : 'no'); g.classList.toggle('on', guida); }; sg(); g.onclick = () => { guida = !guida; sg(); avvisa(guida ? 'Clicca il pavimento per far camminare Vezz' : 'Guida spenta'); };
      card.querySelector('#cTorna').onclick = () => { if (comandoVezz(vezzAllaScrivania())) avvisa('Vezz torna alla scrivania'); };
      const ca = card.querySelector('#cAree'); AREE.slice(1).forEach(q => { const b = document.createElement('button'); b.type = 'button'; b.className = 'b'; b.textContent = q.sigla + ' · ' + q.nome.replace('Ciclismo ', '').replace(' e Under 23', '/U23'); b.onclick = () => { if (comandoVezz(vaiVezzA(q.look[0], q.look[2]))) avvisa('Vezz va in ' + q.nome); }; ca.appendChild(b); });
    } else {
      card.querySelector('#cVai').onclick = () => { if (comandoVezz(vezzVaDa(a))) avvisa('Vezz va da ' + a.nome); };
      card.querySelector('#cInvia').onclick = async () => { const t = card.querySelector('#cTesto'); if (await daiCompito(a, t.value)) t.value = ''; };
    }
    aggiornaCard(true);
  }
  function aggiornaCard(forza) {
    if (!cardAg) return; const a = cardAg, st = card.querySelector('#cSt'), sg = card.querySelector('#cSegui');
    const nota = a.dato && !a.errore ? String(a.dato) : '', t = statoTesto(a) + ' · ' + areaDi(a.area).nome + (nota ? ' | ' + nota : '');
    if (forza || st.dataset.t !== t) {
      st.textContent = statoTesto(a) + ' · ' + areaDi(a.area).nome;
      if (nota) { st.appendChild(document.createElement('br')); const sm = document.createElement('small'); sm.textContent = nota; st.appendChild(sm); }
      st.dataset.t = t;
    }
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
    const h = rc.intersectObjects(agenti.map(a => a.g), true); if (!h.length) return null;
    let o = h[0].object; while (o && !agenti.some(a => a.g === o)) o = o.parent; return o ? agenti.find(a => a.g === o) : null;
  }
  renderer.domElement.addEventListener('pointerleave', () => { zoomAttivo = false; });
  renderer.domElement.addEventListener('pointercancel', () => { drag = null; });
  renderer.domElement.addEventListener('pointerdown', e => { zoomAttivo = true; drag = { x: e.clientX, y: e.clientY, az: mira.az, el: mira.el }; mosso = false; renderer.domElement.setPointerCapture(e.pointerId); });
  renderer.domElement.addEventListener('pointermove', e => { if (!drag) return; if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) mosso = true; if (mosso) { mira.az = Math.max(-1.2, Math.min(1.2, drag.az - (e.clientX - drag.x) * 0.006)); mira.el = Math.max(0.35, Math.min(1.25, drag.el + (e.clientY - drag.y) * 0.004)); } });
  renderer.domElement.addEventListener('pointerup', e => {
    drag = null; if (mosso) return;
    const hit = agenteSotto(e); if (hit) { cliccaOmino(hit); return; }
    if (!guida) return;
    const r = renderer.domElement.getBoundingClientRect(); rc.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (Math.abs(d.y) > 1e-4) {                                                                      // Vezz cammina dove clicchi
      const t = (0.05 - o.y) / d.y, x = o.x + d.x * t, z = o.z + d.z * t;
      if (t > 0 && x > XMIN + 0.5 && x < XMAX - 0.5 && z > ZMIN + 0.5 && z < ZMAX - 0.5) comandoVezz(vaiVezzA(x, z));
    }
  });
  renderer.domElement.addEventListener('wheel', e => { if (!zoomAttivo) return; e.preventDefault(); mira.dist = Math.max(6, Math.min(150, mira.dist * (1 + Math.sign(e.deltaY) * 0.09))); }, { passive: false });
  function misura() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; aspetto = w / h; camera.updateProjectionMatrix(); if (!follow) { const a = areaDi(focus) || AREE[0]; mira.dist = distPer(a.ew, a.ed, mira.el); } }
  const ro = new ResizeObserver(misura); ro.observe(host);

  // ---------- qualita e prestazioni ----------
  const selQ = root.getElementById('qual'), lento = root.getElementById('lento'); root.getElementById('lento2d').onclick = () => { if (ctx.passa2D) ctx.passa2D(); };
  const menuQ = root.getElementById('menuq'); root.getElementById('ingr').onclick = () => { menuQ.style.display = menuQ.style.display === 'block' ? 'none' : 'block'; };
  function applicaQualita() {
    const dpr = window.devicePixelRatio || 1, pr = [Math.min(dpr, 2), Math.min(dpr, 1.5), 1, 0.75][Q.tier], ms = [2048, 1024, 1024, 512][Q.tier];
    renderer.setPixelRatio(pr); Q.ombre = Q.tier < 2; sole.castShadow = Q.ombre; sole.shadow.mapSize.set(ms, ms); if (sole.shadow.map) { sole.shadow.map.dispose(); sole.shadow.map = null; }
    agenti.forEach(a => { a.blob.visible = !Q.ombre && !a.dim; });
    lento.style.display = Q.tier >= 3 ? 'flex' : 'none'; misura();
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
  function aggiornaTabellone() {
    DATI.costoTxt = usd(DATI.spesa) + ' $ su ' + usd(DATI.limite) + ' $';
    tabelloni.forEach(t => { if (t.tipo === 'bacheca') disegnaTarga(t.m, 'Bozze ' + DATI.bozze + ' · Spunti ' + DATI.spunti, 'Costi ' + DATI.costoTxt); else disegnaTarga(t.m, 'Costi', DATI.costoTxt); });
  }
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
      const era = !!a.lavoraVero, err = x.stato === 'errore';
      a.lavoraVero = x.stato === 'lavora' ? x.testo : ''; a.dato = x.stato === 'lavora' ? '' : x.testo; a.errore = err;
      if (era && !a.lavoraVero && !err) a.fatto = 7;                                                     // ha appena finito: pallino verde per qualche secondo
    });
    const prima = DATI.stati, ora = {}; bozze.forEach(x => { ora[x.id] = x.stato; });
    if (DATI.pronti) bozze.forEach(x => { if (prima[x.id] === 'in_generazione' && x.stato === 'bozza') { const n = ctx.agenteDiBozza(x); eventi.push([n, ctx.respDi(n), 'Bozza pronta: ' + (x.soggetto || 'articolo'), 'La controllo ora.', 1]); } });
    DATI.stati = ora; DATI.pronti = true;
  }

  // ---------- il ciclo ----------
  const v3 = new THREE.Vector3();
  function proietta(x, y, z, el, dx) {
    v3.set(x, y, z).project(camera); const px = (v3.x * 0.5 + 0.5) * host.clientWidth, py = (-v3.y * 0.5 + 0.5) * host.clientHeight;
    el.style.left = (px + (dx || 0)) + 'px'; el.style.top = py + 'px'; el.style.display = v3.z < 1 && px > -50 && px < host.clientWidth + 50 && py > -30 && py < host.clientHeight + 30 ? '' : 'none';
  }
  const anello = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 36), new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false })); anello.rotation.x = -Math.PI / 2; anello.renderOrder = 5; anello.visible = false; scene.add(anello);
  let ultimo = performance.now(), tCard = 0, tClass = 0;
  function frame(now) {
    const grezzo = (now - ultimo) / 1000, dt = Math.max(0, Math.min(0.05, grezzo)); ultimo = now; const t = now / 1000; const k = Math.min(1, dt * 4);
    if (follow) mira.look.set(follow.x, 1.1, follow.z);                // la camera segue l'omino
    cam.look.lerp(mira.look, follow ? Math.min(1, dt * 6) : k); cam.dist += (mira.dist - cam.dist) * k; cam.az += (mira.az - cam.az) * k; cam.el += (mira.el - cam.el) * k;
    camera.position.set(cam.look.x + Math.sin(cam.az) * Math.cos(cam.el) * cam.dist, cam.look.y + Math.sin(cam.el) * cam.dist, cam.look.z + Math.cos(cam.az) * Math.cos(cam.el) * cam.dist); camera.lookAt(cam.look);
    stepScena(dt);
    // livello di dettaglio: il personaggio completo solo per i piu vicini al punto che guardi, gli altri in versione semplice
    const vicini = agenti.map(a => [Math.hypot(a.x - cam.look.x, a.z - cam.look.z), a]).sort((p, q) => p[0] - q[0]);
    const maxDet = [24, 14, 6, 0][Q.tier], raggio = Math.max(11, cam.dist * 0.62);
    vicini.forEach(([dd, a], i) => { a.det = (cam.dist < 70 && i < maxDet && dd < raggio) || ((a === sel || a === follow) && Q.tier < 3 && cam.dist < 90); });
    const tutti = cam.dist >= 60;
    agenti.forEach(a => {
      muovi(a, dt); posa(a, dt); a.c.sem.scale.setScalar(cam.dist > 60 ? 1.3 : 1);
      if (a.stato === 'fermo' && !scenaCorr && a.ruolo !== 'vezz' && !a.imp) a.stato = 'siede';
      const blobOn = !sole.castShadow && !a.dim; a.blob.visible = blobOn; if (blobOn) a.blob.position.set(a.x, 0.05, a.z);
      // indicatori di stato: pallino ambra = al lavoro, verde = ha finito, rosso = errore
      a.fatto = Math.max(0, a.fatto - dt);
      const lamp = a.errore ? 0xef4444 : (a.lavoraVero || a.compito) ? 0xf59e0b : a.fatto > 0 ? 0x22c55e : 0;
      a.lamp.visible = !!lamp && !a.dim; if (lamp) { a.lamp.material.color.setHex(lamp); a.lamp.scale.setScalar(lamp === 0xf59e0b ? 1.15 + Math.sin(t * 5) * 0.3 : 1.1); }
      const forza = a === vezz || a === sel || a === follow, lav = !!(a.lavoraVero || a.compito);
      const mostra = forza || (!a.dim && (lav || !tutti));
      if (mostra) {
        a.tag.style.display = '';
        const txt = (forza || cam.dist < 30) ? a.nome : a.etich; if (a.tag.dataset.t !== txt) { a.tag.dataset.t = txt; a.tag.textContent = txt; }
        a.tag.classList.toggle('sel', a === sel); a.tag.classList.toggle('lav', lav);
        proietta(a.x, -0.43 * a.sit + 0.02, a.z, a.tag); a.tag.style.marginTop = '4px';
      } else a.tag.style.display = 'none';
      if (a.bolla) proietta(a.x, 2.15 - 0.43 * a.sit, a.z, a.bolla.el);
    });
    if (sel) { anello.visible = true; anello.position.set(sel.x, 0.07, sel.z); } else anello.visible = false;
    tCard -= dt; if (tCard <= 0) { tCard = 0.4; aggiornaCard(false); }
    zone.forEach(z => { proietta(z.a.ancora[0], z.a.ancora[1], z.a.ancora[2], z.e); if (cam.dist < 32) z.e.style.display = 'none'; });
    disegnaSchermi(t); tClass -= dt; if (tClass <= 0) { tClass = 0.25; disegnaClassifica(t); }
    renderer.render(scene, camera);
    controllaFps(grezzo, dt);
  }
  function giro(now) { if (morto) return; if (!contenitore.isConnected) { distruggi(); return; } requestAnimationFrame(giro); if (window.__virt == null && visibile && !document.hidden && host.clientWidth) frame(now); else ultimo = now; }
  Q.tier = (window.matchMedia('(max-width:700px)').matches || /Mobi|Android/i.test(navigator.userAgent)) ? 1 : 0; applicaQualita();
  setFiltro(filtro, true); misura(); vaiArea('tutto'); cam.look.copy(mira.look); cam.dist = mira.dist; cam.az = mira.az; cam.el = mira.el;
  requestAnimationFrame(giro);

  function distruggi() {
    if (morto) return; morto = true; clearTimeout(avvisa.t);
    try { ro.disconnect(); if (io) io.disconnect(); } catch (e) { /* gia chiuso */ }
    try {                                                                // libera geometrie, materiali e texture della scena
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); if (o.isInstancedMesh) o.dispose(); });
      renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss();
    } catch (e) { /* gia chiuso */ }
    agenti.forEach(a => { if (a.bolla) a.bolla.el.remove(); a.tag.remove(); });
    zone.forEach(z => z.e.remove());
    if (window.__p3d && window.__p3d.agenti === agenti) delete window.__p3d;
  }
  window.__p3d = { agenti, AREE, vaiArea, setFiltro, cliccaOmino, daiCompito, comandoVezz, vezz, frame, cam, mira, camera, renderer, scene, scena: () => scenaCorr, avvia: () => { scenaCorr = scegliScena(); return !!scenaCorr; }, percorso, cammino, blocc, GX, GZ, XMIN, ZMIN, CELLA, libera, ci, cj, extra, apriCard, seguiA,
    vaiVezzA, vezzAllaScrivania, riunione: (nomi, sec) => { const l = nomi.map(per).filter(Boolean); extra.push(scenaRiunione(l, sec)); return l.length; }, RIUNIONE, Q, DATI, eventi, aggiornaTabellone, aggiorna, tabelloni, get focus() { return focus; }, get follow() { return follow; }, get filtro() { return filtro; } };
  return { aggiorna, distruggi };

  }
  window.PalazzoRedazione = { carica, webgl, monta };
})();
