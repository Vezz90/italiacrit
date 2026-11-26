'use strict';
// Scraper che girano sul PC dell'amministratore: la dashboard scrive i comandi in kv_store, un piccolo programma sul PC
// (fuori da questo repository) li esegue e scrive qui il proprio stato. Il server non esegue nulla.
//   kv 'pc_scraper_stato'    scritto dal PC   (attivita, processi in corso, battito)
//   kv 'pc_scraper_comandi'  scritto da qui   (ultimi comandi)
//   kv 'pc_scraper_esiti'    scritto dal PC   (esito di ogni comando)

const ATTIVITA = ['italiacrit-auto-sync', 'ItaliaCrit-CX-Import', 'ItaliaCrit-TipoPista-Auto', 'ItaliaCrit-MembersCalendar', 'ItaliaCrit-SegreteriaGare',
  'ItaliaCrit-PCS-Scrape', 'ItaliaCrit-PCS-RaceFullResults', 'ItaliaCrit-PCS-ProOggi-Pianifica', 'ItaliaCrit-PCS-ProOggi'];
const AZIONI = ['avvia', 'ferma', 'accendi', 'spegni'];
const SCRIPT_RE = /^script:[a-z0-9_-]{1,60}\.(py|js)$/;     // avvii lanciati a mano: si possono solo fermare

function comandoValido(id, azione) {
  if (!AZIONI.includes(azione) || typeof id !== 'string') return false;
  return ATTIVITA.includes(id) || (azione === 'ferma' && SCRIPT_RE.test(id));
}

module.exports = function (app, { requireAdmin, getSupabase }) {
  async function leggi(chiave, vuoto) {
    const { data, error } = await getSupabase().from('kv_store').select('value').eq('key', chiave).maybeSingle();
    if (error) throw new Error(error.message);
    return (data && data.value) ?? vuoto;
  }
  app.get('/api/admin/pc-scrapers', requireAdmin, async (req, res) => {
    try {
      const [stato, comandi, esiti] = await Promise.all([leggi('pc_scraper_stato', null), leggi('pc_scraper_comandi', []), leggi('pc_scraper_esiti', {})]);
      res.set('Cache-Control', 'no-store');
      res.json({ ora: Date.now(), stato, comandi: comandi.slice(-8).map(c => ({ ...c, esito: esiti[c.n] || null })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/pc-scrapers/comando', requireAdmin, async (req, res) => {
    const { id, azione } = req.body || {};
    if (!comandoValido(id, azione)) return res.status(400).json({ error: 'Comando non valido' });
    try {
      const comandi = await leggi('pc_scraper_comandi', []);
      const c = { n: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, id, azione, quando: Date.now() };
      const { error } = await getSupabase().from('kv_store').upsert({ key: 'pc_scraper_comandi', value: [...comandi, c].slice(-30), updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      res.json({ ok: true, comando: c });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
module.exports.comandoValido = comandoValido;
