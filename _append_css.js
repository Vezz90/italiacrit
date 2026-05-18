const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'design.css');

const block = `

/* ═══════════════════════════════════════════════════════════════
   VISUAL UNIFICATION v24 — Editorial sports media style
   All pages: dark headers, Inter Tight typography, red accent
   ═══════════════════════════════════════════════════════════════ */

/* ── A) Cinematic section-header (Risultati, Atleti, Team, Regolamento) ── */
.content-wrapper > .section-header:first-child,
.section-header:first-child {
  margin-top: -32px;
  margin-left: -24px;
  margin-right: -24px;
  margin-bottom: 36px;
  padding: 52px clamp(20px, 5vw, 80px) 44px;
  background: #0F172A;
  position: relative;
  overflow: hidden;
}
.content-wrapper > .section-header:first-child::before {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(to right, #E11D48 0%, transparent 60%);
}
.section-header h1 {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(2.2rem, 5vw, 5rem) !important;
  font-weight: 900 !important;
  color: #fff !important;
  letter-spacing: -0.03em !important;
  text-transform: uppercase !important;
  margin: 0 !important;
  line-height: 0.95 !important;
}
.section-header .section-line { display: none; }

/* ── B) Cinematic athlete-header ────────────────────────────── */
.athlete-header {
  background: linear-gradient(135deg, #0F172A 0%, #1e293b 100%);
  padding: 48px clamp(16px, 4vw, 64px) 40px;
  margin: -32px -24px 32px;
  position: relative;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.athlete-header-top .badge {
  background: rgba(255,255,255,0.08) !important;
  border: 1px solid rgba(255,255,255,0.15) !important;
}
.athlete-cognome {
  font-family: 'Inter Tight', 'Inter', sans-serif !important;
  font-size: clamp(2rem, 6vw, 5rem) !important;
  font-weight: 900 !important;
  color: #fff !important;
  text-transform: uppercase !important;
  letter-spacing: -0.03em !important;
  line-height: 0.9 !important;
}
.athlete-nome {
  font-family: 'Inter Tight', 'Inter', sans-serif !important;
  font-size: clamp(1rem, 3vw, 2rem) !important;
  font-weight: 400 !important;
  color: rgba(255,255,255,0.55) !important;
  text-transform: uppercase !important;
  letter-spacing: 0.05em !important;
  display: block !important;
}
.athlete-stats-bar {
  background: rgba(255,255,255,0.05) !important;
  border-top: 1px solid rgba(255,255,255,0.08) !important;
  border-radius: 0 !important;
  margin-left: clamp(-16px, -4vw, -64px) !important;
  margin-right: clamp(-16px, -4vw, -64px) !important;
  padding-left: clamp(16px, 4vw, 64px) !important;
  padding-right: clamp(16px, 4vw, 64px) !important;
}

/* ── C) Cinematic team-header ───────────────────────────────── */
.team-header {
  background: linear-gradient(135deg, #0F172A 0%, #1e293b 100%);
  padding: 48px clamp(16px, 4vw, 64px) 40px;
  margin: -32px -24px 32px;
  position: relative;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.team-name-display {
  font-family: 'Inter Tight', 'Inter', sans-serif !important;
  font-size: clamp(1.6rem, 4vw, 4rem) !important;
  font-weight: 900 !important;
  color: #fff !important;
  text-transform: uppercase !important;
  letter-spacing: -0.03em !important;
  line-height: 1 !important;
}
.team-stats-row {
  border-top: 1px solid rgba(255,255,255,0.08) !important;
  background: rgba(255,255,255,0.04) !important;
  margin-left: clamp(-16px, -4vw, -64px) !important;
  margin-right: clamp(-16px, -4vw, -64px) !important;
  padding-left: clamp(16px, 4vw, 64px) !important;
  padding-right: clamp(16px, 4vw, 64px) !important;
}

/* ── D) Cinematic race-header (gara page) ───────────────────── */
.race-header {
  background: linear-gradient(135deg, #0F172A 0%, #1e293b 100%);
  padding: 48px clamp(16px, 4vw, 64px) 40px;
  margin: -32px -24px 32px;
  position: relative;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.race-name-display {
  font-family: 'Inter Tight', 'Inter', sans-serif !important;
  font-size: clamp(1.4rem, 4vw, 3.5rem) !important;
  font-weight: 900 !important;
  color: #fff !important;
  text-transform: uppercase !important;
  letter-spacing: -0.02em !important;
  line-height: 1 !important;
}
.race-meta-row {
  margin-top: 12px !important;
}
.race-meta-row .badge {
  background: rgba(255,255,255,0.08) !important;
  border: 1px solid rgba(255,255,255,0.15) !important;
  color: rgba(255,255,255,0.75) !important;
}

/* ── E) Ranking table editorial style ───────────────────────── */
.ranking-table thead tr {
  background: #0F172A !important;
}
.ranking-table thead th {
  color: rgba(255,255,255,0.5) !important;
  font-size: 0.6rem !important;
  font-weight: 800 !important;
  letter-spacing: 0.15em !important;
  text-transform: uppercase !important;
  padding: 12px 8px !important;
  border-bottom: 1px solid rgba(255,255,255,0.1) !important;
}

/* ── F) Calendar item editorial style ───────────────────────── */
.cal-item {
  border-left: 3px solid transparent !important;
  transition: border-color 0.2s, transform 0.15s !important;
}
.cal-item:hover {
  border-left-color: #E11D48 !important;
  transform: translateX(3px) !important;
}
.cal-name {
  font-family: 'Inter Tight', 'Inter', sans-serif !important;
  font-weight: 700 !important;
}

/* ── G) Mid-page section headers ────────────────────────────── */
.section-header:not(:first-child) {
  border-left: 3px solid #E11D48;
  padding-left: 12px;
  margin-bottom: 20px;
}
.section-header:not(:first-child) h2,
.section-header:not(:first-child) h3 {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-weight: 800;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-primary);
}

/* ── H) Hero-band (Classifica top athletes) ─────────────────── */
.hero-band {
  background: linear-gradient(135deg, #0F172A, #1e293b) !important;
  border: 1px solid rgba(255,255,255,0.08) !important;
  position: relative;
}
.hero-band::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: #E11D48;
  border-radius: 2px 0 0 2px;
}
.hero-race-name {
  font-family: 'Inter Tight', 'Inter', sans-serif !important;
  font-weight: 800 !important;
  text-transform: uppercase !important;
}

/* ── PG-HEADER: Cinematic page banner for non-home pages ─────── */
.pg-header {
  background: #0F172A;
  padding: 52px clamp(20px, 5vw, 80px) 44px;
  margin: -32px -24px 36px;
  position: relative;
  overflow: hidden;
}
.pg-header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(to right, #E11D48 0%, transparent 55%);
}
.pg-eyebrow {
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  color: #E11D48;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.pg-title {
  font-family: 'Inter Tight', 'Inter', sans-serif;
  font-size: clamp(2.5rem, 6vw, 6rem);
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  margin: 0;
  line-height: 0.9;
}

/* ── I) Mobile fixes for dark headers ───────────────────────── */
@media (max-width: 768px) {
  .content-wrapper > .section-header:first-child,
  .section-header:first-child {
    margin-top: -20px;
    margin-left: -16px;
    margin-right: -16px;
    padding: 40px 20px 36px;
  }
  .athlete-header, .team-header, .race-header {
    margin: -20px -16px 24px;
    padding: 36px 16px 28px;
  }
  .athlete-stats-bar {
    margin-left: -16px !important;
    margin-right: -16px !important;
    padding-left: 16px !important;
    padding-right: 16px !important;
  }
  .team-stats-row {
    margin-left: -16px !important;
    margin-right: -16px !important;
    padding-left: 16px !important;
    padding-right: 16px !important;
  }
  .pg-header {
    margin: -20px -16px 28px;
    padding: 40px 20px 36px;
  }
  .pg-title { font-size: clamp(2rem, 12vw, 3.5rem); }
}
`;

fs.appendFileSync(cssPath, block, 'utf8');
console.log('CSS appended successfully.');
console.log('design.css size:', fs.statSync(cssPath).size, 'bytes');
