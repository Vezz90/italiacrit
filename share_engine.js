// SHARE ENGINE v4 — light design, Inter font, orange accent
const SHARE_PLATFORMS = {
  instagram: { w:1080, h:1350, label:'Instagram\nFeed', color:'#E1306C', cls:'plat-instagram' },
  story:     { w:1080, h:1920, label:'Story /\nReels', color:'#833AB4', cls:'plat-story' },
  facebook:  { w:1200, h:630,  label:'Facebook', color:'#1877F2', cls:'plat-facebook' },
  twitter:   { w:1200, h:675,  label:'Twitter/X', color:'#1DA1F2', cls:'plat-twitter' },
  whatsapp:  { w:1080, h:1080, label:'WhatsApp', color:'#25D366', cls:'plat-whatsapp' }
};
const SHARE_URL = 'italiacrit.it';
const SHARE_TAG = '#italiacrit #ciclismo';
window._shareGaraData = null; window._shareAtletaData = null; window._shareTeamData = null;
let _shareType, _sharePayload, _sharePlatKey = 'instagram';
let _shareLogoImg = null;

// ── Palette nuova (light, orange) ─────────────────────────
const C = {
  bg:       '#FFFFFF',
  bg2:      '#F5F7FA',
  bg3:      '#EEF1F4',
  text:     '#111827',
  text2:    '#6B7280',
  text3:    '#9CA3AF',
  accent:   '#FF6B00',
  accentDim:'rgba(255,107,0,0.1)',
  border:   'rgba(0,0,0,0.07)',
  gold:     '#D97706',
  silver:   '#6B7280',
  bronze:   '#92400E',
  it_green: '#009246',
  it_white: '#FFFFFF',
  it_red:   '#CE2B37',
};
const FONT = 'Inter, system-ui, -apple-system, sans-serif';

async function _getLogo() {
  if (_shareLogoImg) return _shareLogoImg;
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { _shareLogoImg = img; res(img); };
    img.onerror = () => res(null);
    img.src = 'assets/logo.jpeg';
  });
}

// Sfondo bianco con griglia leggera
function _bg(ctx, W, H) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // griglia sottile
  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.strokeStyle = C.text;
  ctx.lineWidth = 1;
  const step = Math.round(W * 0.06);
  for (let x = 0; x <= W; x += step) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y <= H; y += step) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
}

// Header: barra arancio + logo + nome sito
function _header(ctx, logo, W, H) {
  const bH = Math.round(H * 0.09);
  // Sfondo header bianco
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, bH);
  // Barra arancio in cima
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, W, Math.round(bH * 0.07));
  // Linea di separazione
  ctx.fillStyle = C.border;
  ctx.fillRect(0, bH - 1, W, 1);

  if (logo) {
    const lH = Math.round(bH * 0.68);
    const lW = Math.round(lH * logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, Math.round(bH * 0.2), Math.round((bH - lH) / 2), lW, lH);
  }
  const fs = Math.round(bH * 0.28);
  ctx.font = `800 ${fs}px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.textAlign = 'right';
  ctx.fillText('ITALIACRIT', W - Math.round(bH * 0.2), Math.round(bH * 0.58));
  ctx.font = `500 ${Math.round(fs * 0.55)}px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.fillText(SHARE_URL, W - Math.round(bH * 0.2), Math.round(bH * 0.83));
  ctx.textAlign = 'left';
}

// Footer: sfondo grigio chiaro + bandiera italiana + hashtag
function _footer(ctx, W, H) {
  const fH = Math.round(H * 0.055);
  const y = H - fH;
  ctx.fillStyle = C.bg2;
  ctx.fillRect(0, y, W, fH);
  ctx.fillStyle = C.border;
  ctx.fillRect(0, y, W, 1);
  // Bandiera italiana sottile in cima al footer
  const s = 3;
  ctx.fillStyle = C.it_green; ctx.fillRect(0, y, W / 3, s);
  ctx.fillStyle = C.it_white; ctx.fillRect(W / 3, y, W / 3, s);
  ctx.fillStyle = C.it_red;   ctx.fillRect(2 * W / 3, y, W / 3, s);
  const fs = Math.round(fH * 0.35);
  ctx.font = `500 ${fs}px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.textAlign = 'center';
  ctx.fillText(SHARE_TAG, W / 2, y + Math.round(fH * 0.68));
  ctx.textAlign = 'left';
}

function _wrap(ctx, txt, x, y, maxW, lH) {
  const words = txt.split(' '); let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lH; line = w; }
    else line = t;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lH;
}

function _posColor(i) {
  return i === 0 ? C.gold : i === 1 ? C.silver : i === 2 ? C.bronze : C.text3;
}

function _divider(ctx, W, pad, y) {
  ctx.fillStyle = C.border;
  ctx.fillRect(pad, y, W - pad * 2, 1);
  return y + 8;
}

// ── GARA CARD ─────────────────────────────────────────────
function _drawGara(ctx, W, H, d) {
  const { name, date, cat, mult, tipo, results } = d;
  const hB = Math.round(H * 0.09), fB = Math.round(H * 0.055), pad = Math.round(W * 0.048);
  let y = hB + Math.round(H * 0.04);

  // Label categoria gara
  const fsL = Math.round(W * 0.022);
  ctx.font = `600 ${fsL}px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText(cat.toUpperCase(), pad, y + fsL);
  y += fsL * 1.6;

  // Nome gara
  const fsT = Math.round(W * (name.length > 35 ? 0.036 : name.length > 20 ? 0.044 : 0.054));
  ctx.font = `800 ${fsT}px ${FONT}`;
  ctx.fillStyle = C.text;
  y = _wrap(ctx, name, pad, y + fsT, W - pad * 2, fsT * 1.1);

  // Meta
  const fsM = Math.round(W * 0.022);
  ctx.font = `500 ${fsM}px ${FONT}`;
  ctx.fillStyle = C.text2;
  ctx.fillText(`${date}  ·  ×${mult}  ·  ${tipo}`, pad, y);
  y += fsM * 1.5;
  y = _divider(ctx, W, pad, y);

  // Righe risultati
  const listH = H - fB - y - 4;
  const maxR = Math.min(results.length, 10);
  const rH = Math.round(listH / maxR);
  const fsPos = Math.round(rH * 0.52), fsName = Math.round(rH * 0.33), fsTeam = Math.round(rH * 0.22), fsPts = Math.round(rH * 0.40);

  results.slice(0, maxR).forEach((r, i) => {
    const ry = y + i * rH;
    // BG alternato
    if (i % 2 === 0) { ctx.fillStyle = C.bg2; ctx.fillRect(pad, ry, W - pad * 2, rH); }
    // BG top 3
    if (i < 3) {
      ctx.fillStyle = i === 0 ? 'rgba(217,119,6,0.07)' : i === 1 ? 'rgba(107,114,128,0.06)' : 'rgba(146,64,14,0.06)';
      ctx.fillRect(pad, ry, W - pad * 2, rH);
    }
    // Posizione
    ctx.font = `800 ${fsPos}px ${FONT}`;
    ctx.fillStyle = _posColor(i);
    ctx.fillText(i + 1, pad + 8, ry + rH * 0.7);
    const posW = ctx.measureText('00').width + 14;
    // Nome atleta
    ctx.font = `600 ${fsName}px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText((`${r.cognome || ''} ${r.nome || ''}`).substring(0, 28), pad + posW, ry + rH * 0.45);
    // Team
    ctx.font = `400 ${fsTeam}px ${FONT}`;
    ctx.fillStyle = C.text2;
    ctx.fillText((r.team || '').substring(0, 32), pad + posW, ry + rH * 0.76);
    // Punti
    ctx.font = `700 ${fsPts}px ${FONT}`;
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'right';
    ctx.fillText(`${r.punti_effettivi || 0} pt`, W - pad, ry + rH * 0.66);
    ctx.textAlign = 'left';
  });
}

// ── ATLETA CARD ───────────────────────────────────────────
function _drawAtleta(ctx, W, H, d) {
  const { cognome, nome, cat, team, punti, pos, p1, p2, p3, gare } = d;
  const hB = Math.round(H * 0.09), fB = Math.round(H * 0.055), pad = Math.round(W * 0.048);
  let y = hB + Math.round(H * 0.045);

  // Cognome
  const fsC = Math.round(W * (cognome.length > 12 ? 0.068 : 0.088));
  ctx.font = `800 ${fsC}px ${FONT}`;
  ctx.fillStyle = C.text;
  y = _wrap(ctx, cognome, pad, y + fsC, W - pad * 2, fsC * 1.05);

  // Nome
  const fsN = Math.round(fsC * 0.42);
  ctx.font = `500 ${fsN}px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText(nome, pad, y);
  y += fsN * 1.5;

  // Cat + Team
  const fsI = Math.round(W * 0.024);
  ctx.font = `600 ${fsI}px ${FONT}`;
  ctx.fillStyle = C.text2;
  ctx.fillText(cat, pad, y);
  y += fsI * 1.3;
  ctx.font = `400 ${fsI}px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.fillText(team.substring(0, 40), pad, y);
  y += fsI * 2;

  y = _divider(ctx, W, pad, y);

  // Punti + Pos
  const fsP = Math.round(W * 0.11);
  ctx.font = `800 ${fsP}px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText(punti, pad, y + fsP);
  const fsLb = Math.round(W * 0.019);
  ctx.font = `500 ${fsLb}px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.fillText('PUNTI STAGIONE', pad, y + fsP + fsLb * 1.5);

  if (pos && pos !== '-') {
    ctx.font = `800 ${fsP}px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(`${pos}°`, W - pad, y + fsP);
    ctx.font = `500 ${fsLb}px ${FONT}`;
    ctx.fillStyle = C.text3;
    ctx.fillText('IN CLASSIFICA', W - pad, y + fsP + fsLb * 1.5);
    ctx.textAlign = 'left';
  }

  // Stat bar
  const stH = Math.round(H * 0.12), stY = H - fB - stH - Math.round(H * 0.015);
  ctx.fillStyle = C.bg2;
  ctx.fillRect(pad, stY, W - pad * 2, stH);
  ctx.fillStyle = C.border;
  ctx.fillRect(pad, stY, W - pad * 2, 1);

  [['1°', C.gold, p1], ['2°', C.silver, p2], ['3°', C.bronze, p3], ['Gare', C.text2, gare]].forEach(([l, c, v], i) => {
    const sw = (W - pad * 2) / 4, sx = pad + i * sw + sw / 2;
    ctx.font = `800 ${Math.round(stH * 0.46)}px ${FONT}`;
    ctx.fillStyle = c;
    ctx.textAlign = 'center';
    ctx.fillText(v, sx, stY + Math.round(stH * 0.58));
    ctx.font = `500 ${Math.round(stH * 0.22)}px ${FONT}`;
    ctx.fillStyle = C.text3;
    ctx.fillText(l, sx, stY + Math.round(stH * 0.84));
  });
  ctx.textAlign = 'left';
}

// ── TEAM CARD ─────────────────────────────────────────────
function _drawTeam(ctx, W, H, d) {
  const { nome, cat, punti, pos, atleti } = d;
  const hB = Math.round(H * 0.09), fB = Math.round(H * 0.055), pad = Math.round(W * 0.048);
  let y = hB + Math.round(H * 0.04);

  // Nome team
  const fsN = Math.round(W * (nome.length > 20 ? 0.052 : 0.068));
  ctx.font = `800 ${fsN}px ${FONT}`;
  ctx.fillStyle = C.text;
  y = _wrap(ctx, nome, pad, y + fsN, W - pad * 2, fsN * 1.08);

  // Categoria
  ctx.font = `600 ${Math.round(W * 0.024)}px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText(cat, pad, y);
  y += Math.round(W * 0.024) * 1.6;

  y = _divider(ctx, W, pad, y);

  // Punti + pos
  const fsP = Math.round(W * 0.1);
  ctx.font = `800 ${fsP}px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText(punti, pad, y + fsP);
  const fsLb = Math.round(W * 0.018);
  ctx.font = `500 ${fsLb}px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.fillText('PUNTI', pad, y + fsP + fsLb * 1.5);

  if (pos) {
    ctx.font = `800 ${fsP}px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(`${pos}°`, W - pad, y + fsP);
    ctx.textAlign = 'left';
  }
  y += fsP + Math.round(H * 0.07);

  // Lista atleti
  const lMax = Math.min(atleti.length, 5);
  const lH = H - fB - y - 8;
  const rH = Math.round(lH / lMax);

  ctx.fillStyle = C.bg2;
  ctx.fillRect(pad, y, W - pad * 2, lH);
  ctx.fillStyle = C.border;
  ctx.fillRect(pad, y, W - pad * 2, 1);

  atleti.slice(0, lMax).forEach((a, i) => {
    const ry = y + i * rH;
    if (i % 2 !== 0) { ctx.fillStyle = C.bg3; ctx.fillRect(pad, ry, W - pad * 2, rH); }
    const fsA = Math.round(rH * 0.34), fsT = Math.round(rH * 0.22);
    ctx.font = `600 ${fsA}px ${FONT}`;
    ctx.fillStyle = i === 0 ? C.gold : C.text;
    ctx.fillText(`${i + 1}.  ${(a.cognome || '')} ${(a.nome || '')}`.substring(0, 32), pad + 8, ry + rH * 0.45);
    ctx.font = `400 ${fsT}px ${FONT}`;
    ctx.fillStyle = C.text2;
    ctx.fillText((a.team || a.team_attuale || '').substring(0, 36), pad + 8, ry + rH * 0.76);
    ctx.font = `700 ${Math.round(rH * 0.40)}px ${FONT}`;
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'right';
    ctx.fillText(a.puntiCat || 0, W - pad, ry + rH * 0.56);
    ctx.textAlign = 'left';
  });
}

// ── CLASSIFICA CARD ───────────────────────────────────────
function _drawClass(ctx, W, H, d) {
  const { catLabel: cL, rows, scope, region } = d;
  const hB = Math.round(H * 0.09), fB = Math.round(H * 0.055), pad = Math.round(W * 0.048);
  let y = hB + Math.round(H * 0.025);

  // Scope label
  const scopeTxt = scope === 'regionale' ? `REGIONALE — ${(region || '').toUpperCase()}` : 'NAZIONALE';
  const fsSc = Math.round(W * 0.024);
  ctx.font = `700 ${fsSc}px ${FONT}`;
  ctx.fillStyle = scope === 'regionale' ? C.gold : C.accent;
  ctx.fillText(scopeTxt, pad, y + fsSc);
  y += fsSc * 1.7;

  // Label "CLASSIFICA"
  const fsLb = Math.round(W * 0.028);
  ctx.font = `400 ${fsLb}px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.fillText('CLASSIFICA', pad, y + fsLb);
  y += fsLb * 1.1;

  // Categoria
  const fsC = Math.round(W * 0.06);
  ctx.font = `800 ${fsC}px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.fillText(cL.toUpperCase(), pad, y + fsC);
  y += fsC * 1.1;

  // Accent line
  ctx.fillStyle = C.accent;
  ctx.fillRect(pad, y, W - pad * 2, 3);
  y += 11;

  // Righe classifica
  const avail = H - fB - y - 4;
  const maxR = Math.min(rows.length, 10);
  const rH = Math.round(avail / maxR);
  const fsPos = Math.round(rH * 0.52), fsName = Math.round(rH * 0.34), fsTeam = Math.round(rH * 0.22), fsPts = Math.round(rH * 0.44);

  rows.slice(0, maxR).forEach((r, i) => {
    const ry = y + i * rH;
    if (i % 2 === 0) { ctx.fillStyle = C.bg2; ctx.fillRect(pad, ry, W - pad * 2, rH); }
    // Pos
    ctx.font = `800 ${fsPos}px ${FONT}`;
    ctx.fillStyle = _posColor(i);
    ctx.fillText(r.pos, pad + 6, ry + rH * 0.73);
    const pW = ctx.measureText('00').width + 12;
    // Nome
    ctx.font = `600 ${fsName}px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText((`${r.cognome || ''} ${r.nome || ''}`).trim().substring(0, 26), pad + pW, ry + rH * 0.44);
    // Team
    ctx.font = `400 ${Math.round(fsName * 0.72)}px ${FONT}`;
    ctx.fillStyle = C.text2;
    ctx.fillText((r.team || '').substring(0, 28), pad + pW, ry + rH * 0.78);
    // Punti
    ctx.font = `700 ${fsPts}px ${FONT}`;
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'right';
    ctx.fillText(r.punti, W - pad, ry + rH * 0.7);
    ctx.textAlign = 'left';
  });
}

// ── Generatore canvas ─────────────────────────────────────
async function generateShareCanvas(type, payload, platKey) {
  const p = SHARE_PLATFORMS[platKey] || SHARE_PLATFORMS.instagram;
  const canvas = document.createElement('canvas');
  canvas.width = p.w; canvas.height = p.h;
  const ctx = canvas.getContext('2d');
  const logo = await _getLogo();
  _bg(ctx, p.w, p.h);
  _header(ctx, logo, p.w, p.h);
  _footer(ctx, p.w, p.h);
  if (type === 'gara')        _drawGara(ctx, p.w, p.h, payload);
  else if (type === 'atleta') _drawAtleta(ctx, p.w, p.h, payload);
  else if (type === 'team')   _drawTeam(ctx, p.w, p.h, payload);
  else if (type === 'class')  _drawClass(ctx, p.w, p.h, payload);
  return canvas;
}

// ── SVG loghi social ──────────────────────────────────────
const _SVGS = {
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.213 5.567zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  whatsapp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,
  story: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="3"/><line x1="9" y1="6" x2="15" y2="6"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
};

// ── Modale principale ─────────────────────────────────────
window.showShareModal = async function(type, payload) {
  _shareType = type; _sharePayload = payload; _sharePlatKey = 'instagram';
  const titles = { gara:'Risultati Gara', atleta:'Profilo Atleta', team:'Profilo Team', class:'Classifica' };
  const platBtns = [
    { k:'instagram', label:'Instagram\nFeed', sz:'1080×1350' },
    { k:'story',     label:'Story /\nReels',  sz:'1080×1920' },
    { k:'facebook',  label:'Facebook',        sz:'1200×630'  },
    { k:'twitter',   label:'Twitter/X',       sz:'1200×675'  },
    { k:'whatsapp',  label:'WhatsApp',        sz:'1080×1080' },
  ].map(({ k, label, sz }) => {
    const p = SHARE_PLATFORMS[k];
    return `<button class="share-plat-btn ${p.cls} ${k === 'instagram' ? 'active' : ''}" id="sp-${k}" onclick="window.setSharePlat('${k}')" title="${sz}">
      ${_SVGS[k] || ''}
      <span class="share-plat-label">${label.replace('\n', '<br>')}</span>
    </button>`;
  }).join('');

  document.body.insertAdjacentHTML('beforeend', `
  <div class="share-modal-overlay" id="share-overlay" onclick="if(event.target===this)window.closeShareModal()">
    <div class="share-modal" role="dialog">
      <div class="share-modal-header">
        <span class="share-modal-title">📤 ${titles[type] || 'Condividi'}</span>
        <button class="share-modal-close" onclick="window.closeShareModal()">✕</button>
      </div>
      <div class="share-platforms">${platBtns}</div>
      <div class="share-size-label" id="share-size-lbl">Instagram Feed · 1080×1350 (4:5)</div>
      <div class="share-preview-wrap">
        <div class="share-generating" id="share-loading"><div class="share-spinner"></div> Generazione...</div>
        <img id="share-canvas-preview" style="display:none" alt="Anteprima"/>
      </div>
      <div class="share-actions">
        <button class="share-action-btn share-action-download" id="share-dl-btn" onclick="window.downloadShareCard()">⬇ Scarica PNG</button>
        <button class="share-action-btn share-action-native ${navigator.share ? '' : 'hidden'}" onclick="window.nativeShare()">↗ Condividi</button>
      </div>
    </div>
  </div>`);
  await _refreshPreview();
};

window.closeShareModal = function() { const e = document.getElementById('share-overlay'); if (e) e.remove(); };

window.setSharePlat = async function(k) {
  _sharePlatKey = k;
  document.querySelectorAll('.share-plat-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('sp-' + k); if (btn) btn.classList.add('active');
  const sizes = { instagram:'1080×1350 (4:5)', story:'1080×1920 (9:16)', facebook:'1200×630 (1.91:1)', twitter:'1200×675 (16:9)', whatsapp:'1080×1080 (1:1)' };
  const names = { instagram:'Instagram Feed', story:'Story / Reels', facebook:'Facebook', twitter:'Twitter/X', whatsapp:'WhatsApp' };
  const lbl = document.getElementById('share-size-lbl');
  if (lbl) lbl.textContent = `${names[k]} · ${sizes[k]}`;
  await _refreshPreview();
};

async function _refreshPreview() {
  const loading = document.getElementById('share-loading');
  const preview = document.getElementById('share-canvas-preview');
  if (!loading || !preview) return;
  loading.style.display = 'flex'; preview.style.display = 'none';
  try {
    const canvas = await generateShareCanvas(_shareType, _sharePayload, _sharePlatKey);
    preview.src = canvas.toDataURL('image/png');
    loading.style.display = 'none'; preview.style.display = 'block';
  } catch(e) { loading.innerHTML = '❌ Errore: ' + e.message; console.error(e); }
}

window.downloadShareCard = async function() {
  const canvas = await generateShareCanvas(_shareType, _sharePayload, _sharePlatKey);
  const a = document.createElement('a');
  const p = SHARE_PLATFORMS[_sharePlatKey];
  a.download = `italiacrit-${_shareType}-${_sharePlatKey}-${p.w}x${p.h}.png`;
  a.href = canvas.toDataURL('image/png'); a.click();
};

window.nativeShare = async function() {
  try {
    const canvas = await generateShareCanvas(_shareType, _sharePayload, _sharePlatKey);
    canvas.toBlob(async blob => {
      const f = new File([blob], `italiacrit-${_shareType}.png`, { type:'image/png' });
      await navigator.share({ title:'ItaliacritResultati', files:[f] });
    }, 'image/png');
  } catch(e) { console.warn(e); }
};

// ── Trigger functions ─────────────────────────────────────
window.triggerShareGara = function() { if (window._shareGaraData) window.showShareModal('gara', window._shareGaraData); };
window.triggerShareAtleta = function() { if (window._shareAtletaData) window.showShareModal('atleta', window._shareAtletaData); };
window.triggerShareTeam = function() { if (window._shareTeamData) window.showShareModal('team', window._shareTeamData); };
window.shareClassifica = async function() {
  const { rankGender, rankCat, rankFilter, rankRegion, rankMonth } = window;
  if (!window.globalData) return;
  const scope = rankRegion ? 'regionale' : 'nazionale';
  const catL = window.catLabel ? window.catLabel(rankCat || '') : rankCat;
  const athletes = window._lastRankRows || [];
  window.showShareModal('class', { catLabel: catL, rows: athletes.slice(0, 10), scope, region: rankRegion });
};
