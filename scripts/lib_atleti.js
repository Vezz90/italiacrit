/**
 * Riconoscimento dei corridori PCS fra gli atleti gia' presenti in ICS.
 * Fonti (in ordine di priorita'): athletes.json (atleti FCI 2026) > ciclismo_athletes (archivio ciclismo.info)
 * > extra_roster.json / profili pcs_atleta (creati da vecchie importazioni PCS).
 *
 * Regole:
 *  1. nome identico (senza ordine, senza accenti): "Rossi Mario" == "MARIO ROSSI"
 *  2. nome PCS contenuto in quello ICS o viceversa (secondo nome mancante: "Gaggioli Luciano" -> "GAGGIOLI LUCIANO WILLIAM"),
 *     solo se i nomi hanno almeno 2 parole e la differenza e' al massimo 2 parole
 * Se piu' atleti dello stesso livello di priorita' sono candidati il corridore NON viene collegato (ambiguo).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(Boolean);
const keyOf = s => tokens(s).sort().join(' ');

async function buildIndex(sb) {
  const people = [];                       // {id, toks:Set, key, prio}
  const add = (id, name, prio) => { if (!id || !name) return; const t = tokens(name); if (!t.length) return; people.push({ id, toks: new Set(t), n: t.length, key: t.slice().sort().join(' '), prio }); };
  const ath = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'athletes.json'), 'utf8'));
  for (const [id, a] of Object.entries(ath)) add(id, `${a.cognome} ${a.nome}`, 1);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('ciclismo_athletes').select('atleta_id,nome_completo').range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) add(r.atleta_id, r.nome_completo || String(r.atleta_id).replace(/_/g, ' '), 2);
    if (!data || data.length < 1000) break;
  }
  try { for (const b of Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'extra_roster.json'), 'utf8')))) for (const a of (b.atleti || [])) add(a.atleta_id, `${a.cognome} ${a.nome}`, 3); } catch (_) {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('entity_overrides').select('entity_id,new_value').eq('entity_type', 'pcs_atleta').eq('field', 'profile').range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) { try { const v = JSON.parse(r.new_value); add(r.entity_id, `${v.cognome} ${v.nome}`, 3); } catch (_) {} }
    if (!data || data.length < 1000) break;
  }
  const byKey = new Map(), byTok = new Map();
  for (const p of people) {
    if (!byKey.has(p.key)) byKey.set(p.key, []);
    byKey.get(p.key).push(p);
    for (const t of p.toks) { if (!byTok.has(t)) byTok.set(t, []); byTok.get(t).push(p); }
  }
  // sceglie il candidato migliore: priorita' piu' alta (numero piu' basso); a parita', vince l'unico nome identico; altrimenti ambiguo
  const choose = (exact, subset) => {
    const all = [...exact.map(p => ({ p, ex: true })), ...subset.map(p => ({ p, ex: false }))];
    if (!all.length) return null;
    const best = Math.min(...all.map(x => x.p.prio));
    const top = all.filter(x => x.p.prio === best);
    const ids = [...new Set(top.map(x => x.p.id))];
    if (ids.length === 1) return ids[0];
    const exIds = [...new Set(top.filter(x => x.ex).map(x => x.p.id))];
    return exIds.length === 1 ? exIds[0] : null;
  };
  return {
    size: people.length,
    match(name) {
      const t = tokens(name);
      if (!t.length) return null;
      const exact = byKey.get(t.slice().sort().join(' ')) || [];
      if (t.length < 2) return choose(exact, []);
      // nomi contenuti uno nell'altro (secondo nome presente solo da una parte)
      const subset = [];
      const seen = new Set();
      for (const w of t) for (const p of (byTok.get(w) || [])) {
        if (seen.has(p)) continue; seen.add(p);
        if (p.key === t.slice().sort().join(' ')) continue;
        const superset = t.every(x => p.toks.has(x)) && p.n <= t.length + 2;
        const inner = p.n >= 2 && p.n < t.length && p.n >= t.length - 2 && [...p.toks].every(x => t.includes(x));
        if (superset || inner) subset.push(p);
      }
      return choose(exact, subset);
    },
  };
}
module.exports = { buildIndex, norm, tokens, keyOf };
