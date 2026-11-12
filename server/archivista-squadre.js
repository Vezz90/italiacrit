'use strict';
// Archivista Squadre: per ogni collegamento "squadra A (stagione N) -> squadra B (stagione N+1)" raccoglie le PROVE dai dati del sito.
// Qui non c'e nessuna AI e nessuna decisione: solo fatti calcolati (rose, atleti in comune, dove sono andati gli altri, collegamenti vicini).
// Le prove vanno poi allo studio dell'AI e al secondo esaminatore; la decisione automatica e un passo successivo e separato.

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const PAROLE_SOCIETA = new Set(['TEAM', 'ASD', 'A', 'S', 'D', 'SSD', 'SRL', 'GS', 'G', 'SC', 'UC', 'U', 'C', 'CLUB', 'CICLISTICA', 'CICLISTICO', 'CICLISMO', 'SPORTIVA', 'DILETTANTISTICA', 'VELO', 'GRUPPO', 'SOCIETA', 'CYCLING', 'RACING', 'PRO', 'CT', 'DI', 'DEL', 'DELLA', 'DE', 'LA', 'IL', 'E']);
const parole = n => norm(n).split(' ').filter(w => w.length > 2 && !PAROLE_SOCIETA.has(w));
const bello = s => String(s || '').toLowerCase().replace(/(^|[\s'\-.])([a-zàèéìòù])/g, (m, a, b) => a + b.toUpperCase()).trim();

// i collegamenti riguardano tutte le categorie (Esordienti, Allievi, Juniores, Elite, donne): una societa e la stessa anche se i suoi atleti salgono di categoria,
// quindi la rosa di una squadra e l'insieme dei suoi atleti classificati in qualunque categoria
const CAT_TUTTE = ['ESORDIENTI1', 'ESORDIENTI2', 'ALLIEVI', 'JUNIORES', 'ELITE_UNDER23', 'DONNE_ESORDIENTI', 'DONNE_ALLIEVE', 'DONNE_JUNIORES'];

function creaArchivista({ getData }) {
  const _rose = new Map();
  // rose di un anno: nome normalizzato della squadra -> { nome, atleti: [{id, nome, punti, pos}] }
  async function roseDelAnno(anno, categorie) {
    const k = anno + '|' + categorie.join(',');
    if (_rose.has(k)) return _rose.get(k);
    const out = new Map();
    let cl = null; try { cl = await getData(`ciclismo-storico/${anno}/classifica.json`); } catch (_) { /* anno non presente */ }
    for (const cat of categorie) for (const r of ((cl && cl.classifica && cl.classifica[cat]) || [])) {
      const t = norm(r.team); if (!t) continue;
      const s = out.get(t) || { nome: String(r.team).trim(), atleti: [] };
      const id = r.atleta_id || norm(r.nome_completo); if (s.atleti.some(x => x.id === id)) continue;
      s.atleti.push({ id: r.atleta_id || norm(r.nome_completo), nome: bello(r.nome_completo), punti: r.punti || 0, pos: r.pos || 0 });
      out.set(t, s);
    }
    _rose.set(k, out); return out;
  }

  // tutte le prove su un collegamento { team_from, season_from, team_to, season_to }
  async function raccogliProve(caso, { categorie = CAT_TUTTE, collegamenti = [] } = {}) {
    const a0 = Number(caso.season_from), a1 = Number(caso.season_to);
    const [rA, rB] = await Promise.all([roseDelAnno(a0, categorie), roseDelAnno(a1, categorie)]);
    const kf = norm(caso.team_from), kt = norm(caso.team_to);
    const prima = rA.get(kf), dopo = rB.get(kt);
    const lista = s => (s ? [...s.atleti].sort((x, y) => y.punti - x.punti) : []);
    const P = lista(prima), N = lista(dopo);
    const idP = new Set(P.map(x => x.id)), idN = new Set(N.map(x => x.id));
    const comuni = P.filter(x => idN.has(x.id));
    const piccola = Math.min(P.length, N.length);
    // dove sono finiti gli atleti della squadra "prima" nell'anno dopo, e da dove arrivano quelli della squadra "dopo"
    const conta = (atleti, mappa, escludi) => {
      const m = new Map();
      for (const [k, s] of mappa) { if (k === escludi) continue; const n = s.atleti.filter(x => atleti.has(x.id)).length; if (n) m.set(s.nome, n); }
      return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([nome, n]) => ({ squadra: bello(nome), atleti: n }));
    };
    const pw = new Set(parole(caso.team_from)), nw = new Set(parole(caso.team_to));
    const nomiComuni = [...pw].filter(w => nw.has(w));
    // altri collegamenti confermati che toccano le due squadre (catena di nomi)
    const tocca = l => [norm(l[0]), norm(l[2])].some(k => k === kf || k === kt);
    const catena = collegamenti.filter(tocca).filter(l => !(norm(l[0]) === kf && norm(l[2]) === kt)).slice(0, 8).map(l => ({ da: bello(l[0]), anno_da: l[1], a: bello(l[2]), anno_a: l[3] }));
    return {
      collegamento: { da: bello(caso.team_from), stagione_da: a0, a: bello(caso.team_to), stagione_a: a1 },
      rosa_prima: { atleti: P.length, migliori: P.slice(0, 12).map(x => ({ atleta: x.nome, punti: x.punti })) },
      rosa_dopo: { atleti: N.length, migliori: N.slice(0, 12).map(x => ({ atleta: x.nome, punti: x.punti })) },
      atleti_in_comune: { numero: comuni.length, sul_totale_della_rosa_piu_piccola: piccola ? Math.round(comuni.length / piccola * 100) / 100 : 0, nomi: comuni.slice(0, 15).map(x => x.nome),
        punti_dei_comuni_sul_totale_della_rosa_prima: P.length ? Math.round(comuni.reduce((s, x) => s + x.punti, 0) / Math.max(1, P.reduce((s, x) => s + x.punti, 0)) * 100) / 100 : 0 },
      la_squadra_prima_esiste_ancora_dopo: rB.has(kf) ? { atleti: rB.get(kf).atleti.length } : false,
      la_squadra_dopo_esisteva_gia_prima: rA.has(kt) ? { atleti: rA.get(kt).atleti.length } : false,
      dove_sono_andati_gli_atleti_del_prima: conta(idP, rB, kt),
      da_dove_arrivano_gli_atleti_del_dopo: conta(idN, rA, kf),
      parole_del_nome_in_comune: nomiComuni.map(bello),
      altri_collegamenti_confermati_vicini: catena,
      dati_completi: !!(prima && dopo),
      nota: 'rose ricostruite dalle classifiche individuali di fine stagione (ciclismo.info); una squadra senza classificati in un anno risulta vuota',
    };
  }
  return { raccogliProve, roseDelAnno };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Il processo: ricerca sul web -> due esaminatori indipendenti -> regole di sicurezza nel codice -> decisione o "caso difficile" per l'admin.
// Nessun abbinamento viene salvato se i due esaminatori non sono d'accordo, se il web contraddice, o se le prove del sito lo smentiscono.
// ---------------------------------------------------------------------------------------------------------------------------------
const SOGLIA_SICUREZZA = 85;
const SOGLIE = [95, 90, 85, 80, 75];                                         // sotto 75 non si scende mai, qualunque cosa dica l'esame

function leggiJson(testo) {
  const t = String(testo || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { return null; }
}
const VERDETTI = new Set(['stessa', 'diversa', 'incerto']), FONTI = new Set(['si', 'no', 'contraddice', 'assente']);
function pulisciEsito(j) {
  if (!j || !VERDETTI.has(j.verdetto)) return null;
  const sic = Math.max(0, Math.min(100, Number(j.sicurezza) || 0));
  return { verdetto: j.verdetto, sicurezza: sic, fonte_conferma: FONTI.has(j.fonte_conferma) ? j.fonte_conferma : 'assente',
    motivi: (Array.isArray(j.motivi) ? j.motivi : []).map(x => String(x).slice(0, 300)).slice(0, 6), cosa_manca: String(j.cosa_manca || '').slice(0, 300) };
}

const REGOLE_ESAME = `Devi decidere se due nomi di squadra, in due stagioni consecutive, sono la STESSA società (cambio di nome, di sponsor o di sigla; fusione o passaggio di gestione che mantiene la continuità della società) oppure società DIVERSE.
Fatti importanti:
- Molti atleti in comune NON bastano: un blocco di corridori può trasferirsi in una società rivale senza che sia la stessa società.
- Se la vecchia squadra esiste ancora nell'anno dopo con una rosa propria, di norma NON è una rinomina.
- Pochi atleti in comune da soli non escludono la continuità: le società giovanili cambiano spesso rosa.
- Nei casi con pochi atleti in comune pesa molto la ricerca sul web: comunicati, cambi di sponsor, fusioni, pagine delle società.
- Usa SOLO le PROVE DAL SITO e gli APPUNTI DELLA RICERCA qui sotto. Non usare la memoria. Se i dati non bastano, rispondi "incerto": è una risposta onesta e preferita a un'ipotesi.
Rispondi SOLO con un oggetto JSON, senza altro testo:
{"verdetto":"stessa"|"diversa"|"incerto","sicurezza":0-100,"fonte_conferma":"si"|"no"|"contraddice"|"assente","motivi":["..."],"cosa_manca":"..."}
"fonte_conferma" si riferisce al TUO verdetto: "si" se la ricerca web lo sostiene da sola; "contraddice" se la ricerca web sostiene il verdetto OPPOSTO al tuo; "no" se il web non trova nulla di utile; "assente" se non c'è ricerca.`;

function promptEsaminatore(ruolo, prove, appunti) {
  const intro = ruolo === 'B'
    ? 'Sei il revisore scettico di una banca dati del ciclismo giovanile italiano. Il tuo compito è cercare le ragioni per cui i due nomi NON siano la stessa società, e arrenderti solo se non ne trovi.'
    : 'Sei l\'archivista di una banca dati del ciclismo giovanile italiano. Valuti con attenzione e senza fretta.';
  return `${intro}\n\n${REGOLE_ESAME}\n\nPROVE DAL SITO:\n${JSON.stringify(prove)}\n\nAPPUNTI DELLA RICERCA WEB (possono essere vuoti):\n${appunti || '(nessuna ricerca)'}`;
}

// la domanda al web nomina SOLO le squadre (mai gli atleti): per tutti, minorenni compresi
function domandaWeb(prove) {
  const c = prove.collegamento;
  return `Società ciclistiche italiane (ciclismo giovanile e dilettantistico). Il nome «${c.da}» nella stagione ${c.stagione_da} e il nome «${c.a}» nella stagione ${c.stagione_a}: sono la stessa società che ha cambiato nome, sponsor o sigla (o si è fusa mantenendo la continuità), oppure due società diverse? Cerca comunicati, pagine ufficiali della società, notizie di cambi di sponsor o di denominazione. Riporta solo ciò che trovi, indicando se è una conferma, una smentita o se non trovi nulla; non fare ipotesi.`;
}

// regole di sicurezza: stanno nel codice, non nei prompt. Restituisce { decisione: 'stessa'|'diversa'|'difficile', perche }
function decidi(prove, a, b, soglia = SOGLIA_SICUREZZA) {
  if (!a || !b) return { decisione: 'difficile', perche: 'un esaminatore non ha risposto in modo leggibile' };
  if (a.verdetto !== b.verdetto) return { decisione: 'difficile', perche: 'i due esaminatori non sono d\'accordo' };
  if (a.verdetto === 'incerto') return { decisione: 'difficile', perche: 'entrambi gli esaminatori sono incerti' };
  if (Math.min(a.sicurezza, b.sicurezza) < soglia) return { decisione: 'difficile', perche: `sicurezza sotto ${soglia}` };
  if (a.fonte_conferma === 'contraddice' || b.fonte_conferma === 'contraddice') return { decisione: 'difficile', perche: 'la ricerca web sostiene il verdetto opposto' };
  const ic = prove.atleti_in_comune || {}, esiste = prove.la_squadra_prima_esiste_ancora_dopo;
  const webSi = a.fonte_conferma === 'si' && b.fonte_conferma === 'si';
  if (a.verdetto === 'stessa') {
    if (esiste && esiste.atleti >= 3) return { decisione: 'difficile', perche: 'la vecchia squadra esiste ancora con una rosa propria: potrebbe non essere una rinomina' };
    const forte = (ic.numero || 0) >= 5 && (ic.sul_totale_della_rosa_piu_piccola || 0) >= 0.6;
    if (!webSi && !forte) return { decisione: 'difficile', perche: 'continuità non confermata né dal web né da una forte continuità di atleti' };
    return { decisione: 'stessa', perche: webSi ? 'confermata dal web e concordata da entrambi gli esaminatori' : 'forte continuità di atleti e nessuna smentita' };
  }
  // 'diversa'
  if (!webSi && (ic.numero || 0) >= 3) return { decisione: 'difficile', perche: 'ci sono atleti in comune e il web non conferma che le società siano diverse' };
  return { decisione: 'diversa', perche: webSi ? 'il web conferma che sono società diverse' : 'nessun legame né nei dati né sul web' };
}

function creaProcesso({ getData, sb, rawQuery, chiama, registraCosto, consenti }) {
  const arch = creaArchivista({ getData });
  const q = async (sql, par) => { const r = await rawQuery(sql, par); return (r && r.rows) || []; };

  // ricerca web: Perplexity (se c'e la chiave su Render) per le ricerche piu importanti, altrimenti la ricerca di Claude
  async function cercaWeb(prove) {
    const dom = domandaWeb(prove), key = process.env.PERPLEXITY_API_KEY;
    if (key) {
      if (consenti) await consenti('archivio_web');                              // prima di OGNI chiamata a pagamento: se il limite e raggiunto si ferma
      try {
        const modello = process.env.PERPLEXITY_MODEL || 'sonar-pro';
        const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: modello, temperature: 0.1, messages: [{ role: 'system', content: 'Rispondi in italiano, in modo sintetico e solo con fatti verificabili trovati sul web. Se non trovi nulla, scrivilo.' }, { role: 'user', content: dom }] }), signal: AbortSignal.timeout(90000) });
        const j = await r.json();
        if (!r.ok) throw new Error('Perplexity ' + r.status);
        const u = j.usage || {}, costo = (u.prompt_tokens || 0) / 1e6 * 3 + (u.completion_tokens || 0) / 1e6 * 15 + 0.01;     // stima: da verificare sul listino
        if (registraCosto) await registraCosto({ modello: 'perplexity-' + modello, uso: 'archivio_web', token_in: u.prompt_tokens || 0, token_out: u.completion_tokens || 0, ricerche: 1, costo });
        return { motore: 'perplexity', appunti: String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').slice(0, 6000), fonti: (j.citations || []).slice(0, 10) };
      } catch (e) { /* ripiego sulla ricerca di Claude */ }
    }
    const res = await chiama(dom + '\n\nRispondi con appunti brevi (massimo 12 righe), senza dare un verdetto.', true, 'archivio_web', { maxUses: 3 });
    return { motore: 'claude', appunti: String(res.text || '').slice(0, 6000), fonti: (res.fonti || []).map(f => f.url).slice(0, 10) };
  }

  async function esamina(caso, collegamenti, soglia) {
    const prove = await arch.raccogliProve(caso, { collegamenti });
    const web = await cercaWeb(prove).catch(e => { if (/limite mensile|disattivata|non configurata/i.test(e.message)) throw e; return { motore: 'nessuno', appunti: '', fonti: [], errore: e.message }; });
    const [ra, rb] = await Promise.all([
      chiama(promptEsaminatore('A', prove, web.appunti), false, 'archivio_esaminatore').then(r => pulisciEsito(leggiJson(r.text))),
      chiama(promptEsaminatore('B', prove, web.appunti), false, 'archivio_esaminatore').then(r => pulisciEsito(leggiJson(r.text))),
    ]);
    const d = decidi(prove, ra, rb, soglia);
    return { decisione: d.decisione, perche: d.perche, prove_grezze: prove, esaminatore_a: ra, esaminatore_b: rb, web: { motore: web.motore, fonti: web.fonti, errore: web.errore || null }, prove_sintesi: {
      in_comune: prove.atleti_in_comune.numero, rapporto: prove.atleti_in_comune.sul_totale_della_rosa_piu_piccola, rose: [prove.rosa_prima.atleti, prove.rosa_dopo.atleti], vecchia_esiste_ancora: !!prove.la_squadra_prima_esiste_ancora_dopo, dati_completi: prove.dati_completi } };
  }

  async function kvLeggi(k, def) { try { const { data } = await sb().from('kv_store').select('value').eq('key', k).maybeSingle(); return (data && data.value) ?? def; } catch (_) { return def; } }
  async function kvScrivi(k, v) { const { error } = await sb().from('kv_store').upsert({ key: k, value: v, updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); }

  // pseudocasuale ripetibile: l'esame usa sempre lo stesso campione se non si cambia il seme
  const prng = seme => { let x = seme >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };

  // campione per l'esame: casi GIA decisi dall'admin (confermati = "stessa"; respinti = "diversa") piu controlli negativi costruiti (due squadre senza atleti in comune)
  async function campioneEsame(nConf, nNeg, seme) {
    const rnd = prng(seme || 7);
    const righe = await q(`SELECT id, team_from, season_from, team_to, season_to, status FROM team_lineage WHERE status IN ('confirmed','rejected') ORDER BY id`);
    const mescola = l => l.map(x => [rnd(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const conf = righe.filter(r => r.status === 'confirmed' && Number(r.season_to) <= 2025);
    const scelti = mescola(conf).slice(0, nConf).map(r => ({ ...r, atteso: 'stessa' }));
    const resp = righe.filter(r => r.status === 'rejected' && Number(r.season_to) <= 2025).map(r => ({ ...r, atteso: 'diversa' }));
    const neg = [];
    for (const c of mescola(conf)) {
      if (neg.length >= nNeg) break;
      const [rA, rB] = await Promise.all([arch.roseDelAnno(Number(c.season_from), CAT_TUTTE), arch.roseDelAnno(Number(c.season_to), CAT_TUTTE)]);
      const prima = rA.get(norm(c.team_from)); if (!prima) continue;
      const idP = new Set(prima.atleti.map(x => x.id));
      const altre = [...rB.values()].filter(s => norm(s.nome) !== norm(c.team_to) && norm(s.nome) !== norm(c.team_from) && s.atleti.length >= 4 && !s.atleti.some(x => idP.has(x.id)));
      if (!altre.length) continue;
      const t = altre[Math.floor(rnd() * altre.length)];
      neg.push({ id: 'neg-' + c.id, team_from: c.team_from, season_from: c.season_from, team_to: t.nome, season_to: c.season_to, atteso: 'diversa', costruito: true });
    }
    return [...scelti, ...resp, ...neg];
  }

  const job = { attivo: false };
  const registraJob = (tipo, tot) => Object.assign(job, { attivo: true, tipo, tot, fatti: 0, errori: 0, iniziato: new Date().toISOString(), fine: null, ultimo: null });
  const bloccante = m => /limite mensile|disattivata|non configurata/i.test(m);

  async function eseguiPool(casi, lavoro, paralleli) {
    let i = 0;
    await Promise.all(Array.from({ length: paralleli }, async () => {
      while (job.attivo && i < casi.length) {
        const c = casi[i++];
        try { await lavoro(c); } catch (e) { job.errori++; job.ultimo = e.message; if (bloccante(e.message)) job.attivo = false; }
        job.fatti++;
      }
    }));
  }

  // ESAME: nessun dato viene modificato. Misura gli errori sui casi che l'admin ha gia deciso.
  async function avviaEsame({ nConf = 80, nNeg = 30, seme = 7 } = {}) {
    if (job.attivo) throw new Error('un lavoro dell\'Archivista è già in corso');
    const lin = await getData('team_lineage.json').catch(() => []);
    const casi = await campioneEsame(nConf, nNeg, seme);
    if (!casi.length) throw new Error('nessun caso per l\'esame');
    registraJob('esame', casi.length);
    const esiti = [];
    (async () => {
      await eseguiPool(casi, async c => {
        const e = await esamina(c, lin);
        const { prove_grezze: pg, ...resto } = e;
        esiti.push({ id: c.id, da: c.team_from, a: c.team_to, anni: [c.season_from, c.season_to], atteso: c.atteso, costruito: !!c.costruito, ...resto, prove_grezze: { atleti_in_comune: pg.atleti_in_comune, la_squadra_prima_esiste_ancora_dopo: pg.la_squadra_prima_esiste_ancora_dopo } });
      }, 3);
      // calibrazione: per ogni soglia di sicurezza si rifanno le decisioni sugli esiti grezzi e si contano gli errori (nessuna nuova chiamata a pagamento)
      const tabella = SOGLIE.map(sg => {
        const dec = esiti.map(x => ({ x, d: decidi(x.prove_grezze, x.esaminatore_a, x.esaminatore_b, sg).decisione }));
        const auto = dec.filter(y => y.d !== 'difficile'), err = auto.filter(y => y.d !== y.x.atteso);
        const errDifficili = err.filter(y => !y.x.costruito).length;
        return { soglia: sg, decisi_da_soli: auto.length, errori: err.length, errori_su_casi_veri: errDifficili };
      });
      const buone = tabella.filter(t => t.decisi_da_soli >= 40 && t.errori === 0);
      const scelta = buone.length ? buone.reduce((m, t) => (t.soglia < m.soglia ? t : m)) : null;
      const sg = scelta ? scelta.soglia : SOGLIA_SICUREZZA;
      const finali = esiti.map(x => ({ x, d: decidi(x.prove_grezze, x.esaminatore_a, x.esaminatore_b, sg).decisione }));
      const auto = finali.filter(y => y.d !== 'difficile'), errori = auto.filter(y => y.d !== y.x.atteso);
      const ok = !!scelta;
      await kvScrivi('archivio_squadre_esame', { ts: new Date().toISOString(), casi: esiti.length, soglia_scelta: sg, decisi_da_soli: auto.length, passati_all_admin: esiti.length - auto.length, errori: errori.length, ok, tabella_soglie: tabella,
        regola: 'sceglie la soglia di sicurezza più bassa con almeno 40 decisioni da sola e nessun errore sui casi già decisi da te',
        soglia: 'almeno 40 decisioni da sola e nessun errore',
        errori_dettaglio: errori.slice(0, 20).map(y => ({ da: y.x.da, a: y.x.a, anni: y.x.anni, atteso: y.x.atteso, deciso: y.d, a_motivi: y.x.esaminatore_a && y.x.esaminatore_a.motivi, b_motivi: y.x.esaminatore_b && y.x.esaminatore_b.motivi })),
        difficili_dettaglio: finali.filter(y => y.d === 'difficile').slice(0, 30).map(y => ({ da: y.x.da, a: y.x.a, anni: y.x.anni, atteso: y.x.atteso, perche: decidi(y.x.prove_grezze, y.x.esaminatore_a, y.x.esaminatore_b, sg).perche })) });
      job.attivo = false; job.fine = new Date().toISOString();
    })().catch(e => { job.attivo = false; job.fine = new Date().toISOString(); job.ultimo = e.message; });
    return { casi: casi.length };
  }

  // LOTTO VERO: decide da solo SOLO se l'ultimo esame e stato superato; salva nel registro, con possibilita di annullare.
  async function avviaLotto({ n = 25 } = {}) {
    if (job.attivo) throw new Error('un lavoro dell\'Archivista è già in corso');
    const esame = await kvLeggi('archivio_squadre_esame', null);
    if (!esame || !esame.ok) throw new Error('l\'esame di prova non è stato superato: l\'Archivista non può ancora decidere da solo');
    const lin = await getData('team_lineage.json').catch(() => []);
    const da = await q(`SELECT id, team_from, season_from, team_to, season_to FROM team_lineage WHERE status = 'pending' AND season_to::int <= 2025 ORDER BY id LIMIT $1`, [Math.max(1, Math.min(100, Number(n) || 25))]);
    if (!da.length) throw new Error('nessun caso in attesa');
    registraJob('lotto', da.length);
    (async () => {
      await eseguiPool(da, async c => {
        const e = await esamina(c, lin, esame.soglia_scelta);
        const reg = await kvLeggi('archivio_squadre_registro', []);
        const voce = { id: c.id, ts: new Date().toISOString(), da: c.team_from, a: c.team_to, anni: [c.season_from, c.season_to], decisione: e.decisione, perche: e.perche, esaminatore_a: e.esaminatore_a, esaminatore_b: e.esaminatore_b, web: e.web, prove: e.prove_sintesi, soglia: esame.soglia_scelta, annullata: false, applicata: false };
        if (e.decisione === 'stessa' || e.decisione === 'diversa') {
          const r = await q(`UPDATE team_lineage SET status = $1, reviewed_at = NOW() WHERE id = $2 AND status = 'pending' RETURNING id`, [e.decisione === 'stessa' ? 'confirmed' : 'rejected', c.id]);
          voce.applicata = r.length > 0;
        }
        reg.unshift(voce); await kvScrivi('archivio_squadre_registro', reg.slice(0, 1500));
      }, 1);                                                                     // uno alla volta: il registro si aggiorna in sequenza
      job.attivo = false; job.fine = new Date().toISOString();
    })().catch(e => { job.attivo = false; job.fine = new Date().toISOString(); job.ultimo = e.message; });
    return { casi: da.length };
  }

  async function annulla(idCaso) {
    const reg = await kvLeggi('archivio_squadre_registro', []);
    const v = reg.find(x => String(x.id) === String(idCaso) && x.applicata && !x.annullata);
    if (!v) throw new Error('decisione dell\'Archivista non trovata o già annullata');
    await q(`UPDATE team_lineage SET status = 'pending', reviewed_at = NULL, reviewed_by = NULL WHERE id = $1`, [Number(idCaso)]);
    v.annullata = true; v.annullata_il = new Date().toISOString(); await kvScrivi('archivio_squadre_registro', reg);
    return { ok: true };
  }

  async function stato() {
    const [esame, reg, conta] = await Promise.all([kvLeggi('archivio_squadre_esame', null), kvLeggi('archivio_squadre_registro', []), q(`SELECT status, COUNT(*)::int AS n FROM team_lineage GROUP BY status`)]);
    const per = Object.fromEntries(conta.map(r => [r.status, r.n]));
    return { esame, in_attesa: per.pending || 0, confermate: per.confirmed || 0, respinte: per.rejected || 0, lavoro: { ...job },
      perplexity: !!process.env.PERPLEXITY_API_KEY,
      registro: reg.slice(0, 60).map(x => ({ id: x.id, ts: x.ts, da: x.da, a: x.a, anni: x.anni, decisione: x.decisione, perche: x.perche, applicata: x.applicata, annullata: x.annullata })),
      difficili: reg.filter(x => x.decisione === 'difficile' && !x.annullata).slice(0, 40).map(x => ({ id: x.id, da: x.da, a: x.a, anni: x.anni, perche: x.perche, in_comune: x.prove && x.prove.in_comune })) };
  }
  return { esamina, avviaEsame, avviaLotto, annulla, stato, cercaWeb };
}

module.exports = { creaArchivista, creaProcesso, decidi, pulisciEsito, leggiJson, promptEsaminatore, norm, parole };

