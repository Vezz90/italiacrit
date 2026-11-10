'use strict';
// Prove del download sicuro. Si lanciano con:  node --test server/test-rete-sicura.js   (nessuna dipendenza, nessuna rete esterna)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { ipVietato, creaScaricatore, scarica } = require('./rete-sicura');

test('ipVietato: reti interne e riservate', () => {
  for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::a00:1', '2002:7f00:1::1', 'non-un-ip', '', null]) {
    assert.strictEqual(ipVietato(ip), true, 'doveva essere vietato: ' + ip);
  }
});
test('ipVietato: indirizzi pubblici ammessi', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4002:408::200e']) assert.strictEqual(ipVietato(ip), false, 'doveva essere ammesso: ' + ip);
});

test('rifiuta protocolli, porte e credenziali non ammessi', async () => {
  await assert.rejects(scarica('http://example.com/'), /solo indirizzi https/);
  await assert.rejects(scarica('ftp://example.com/'), /solo indirizzi https/);
  await assert.rejects(scarica('file:///etc/passwd'), /solo indirizzi https/);
  await assert.rejects(scarica('javascript:alert(1)'), /solo indirizzi https|non valido/);
  await assert.rejects(scarica('https://user:pass@example.com/'), /credenziali/);
  await assert.rejects(scarica('https://example.com:8443/'), /porta/);
  await assert.rejects(scarica('non un indirizzo'), /non valido/);
});
test('rifiuta localhost, IP privati, link-local e metadata (anche scritti in modi strani)', async () => {
  for (const u of ['https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://10.1.2.3/', 'https://192.168.0.10/', 'https://169.254.169.254/latest/meta-data/', 'https://[::ffff:127.0.0.1]/', 'https://2130706433/', 'https://0x7f.1/', 'https://0177.0.0.1/']) {
    await assert.rejects(scarica(u, { timeout: 3000 }), /non consentito|non valido|risolvibile|ENOTFOUND/, 'doveva essere bloccato: ' + u);
  }
  await assert.rejects(scarica('http://metadata.google.internal/', { protocolli: ['http:'], timeout: 3000 }), /non consentito|risolvibile|ENOTFOUND|getaddrinfo/);
});

// server finto locale: in prova si ammette SOLO 127.0.0.1 e la sua porta, cosi si verificano redirect, limiti e tempi
function serverFinto(gestore) {
  return new Promise(ok => { const s = http.createServer(gestore); s.listen(0, '127.0.0.1', () => ok({ s, porta: s.address().port })); });
}
const prova = porta => creaScaricatore({ vieta: ip => ip !== '127.0.0.1' && ipVietato(ip), porte: [String(porta)] });

test('percorsi normali: pagina letta, redirect interno seguito', async () => {
  const { s, porta } = await serverFinto((req, res) => {
    if (req.url === '/r') { res.writeHead(302, { location: '/ok' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<p>ciao è</p>');
  });
  try {
    const sc = prova(porta);
    const a = await sc.scarica(`http://127.0.0.1:${porta}/ok`, { protocolli: ['http:'] });
    assert.strictEqual(a.status, 200); assert.strictEqual(a.text, '<p>ciao è</p>');
    const b = await sc.scarica(`http://127.0.0.1:${porta}/r`, { protocolli: ['http:'] });
    assert.strictEqual(b.text, '<p>ciao è</p>');
  } finally { s.close(); }
});
test('redirect verso rete interna / metadata bloccato; troppi redirect fermati', async () => {
  const { s, porta } = await serverFinto((req, res) => {
    if (req.url === '/meta') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
    if (req.url === '/localhost') { res.writeHead(302, { location: 'http://[::1]:' + porta + '/' }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    res.end('x');
  });
  try {
    const sc = prova(porta), o = { protocolli: ['http:'] };
    await assert.rejects(sc.scarica(`http://127.0.0.1:${porta}/meta`, o), /non consentito|porta non consentita/);
    await assert.rejects(sc.scarica(`http://127.0.0.1:${porta}/localhost`, o), /non consentito/);
    await assert.rejects(sc.scarica(`http://127.0.0.1:${porta}/loop`, o), /troppi redirect/);
  } finally { s.close(); }
});
test('risposta troppo grande (dichiarata o no) e troppo lenta', async () => {
  const { s, porta } = await serverFinto((req, res) => {
    if (req.url === '/dichiarata') { res.writeHead(200, { 'content-type': 'text/html', 'content-length': 5000000 }); return res.end('x'); }
    if (req.url === '/flusso') { res.writeHead(200, { 'content-type': 'text/html' }); const t = setInterval(() => res.write('x'.repeat(4096)), 1); res.on('close', () => clearInterval(t)); return; }
    if (req.url === '/lenta') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('a'); return; }
    res.end('x');
  });
  try {
    const sc = prova(porta), o = { protocolli: ['http:'], maxByte: 50000 };
    await assert.rejects(sc.scarica(`http://127.0.0.1:${porta}/dichiarata`, o), /troppo grande/);
    await assert.rejects(sc.scarica(`http://127.0.0.1:${porta}/flusso`, o), /troppo grande/);
    await assert.rejects(sc.scarica(`http://127.0.0.1:${porta}/lenta`, { ...o, timeout: 400 }), /tempo scaduto/);
  } finally { s.close(); }
});
test('tipo di contenuto non ammesso scartato prima di leggere il corpo', async () => {
  const { s, porta } = await serverFinto((req, res) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF'); });
  try {
    await assert.rejects(prova(porta).scarica(`http://127.0.0.1:${porta}/f.pdf`, { protocolli: ['http:'], tipi: /html|text/i }), e => e.code === 'TIPO' && /application\/pdf/.test(e.message));
  } finally { s.close(); }
});
test('DNS: un nome che punta a un IP interno e bloccato al momento della connessione (anti rebinding)', async () => {
  // "localhost" si risolve in 127.0.0.1 / ::1: con la regola vera deve essere bloccato anche se il nome sembra innocuo
  await assert.rejects(creaScaricatore({ porte: ['80', '443', '8080'] }).scarica('http://localhost:8080/', { protocolli: ['http:'], timeout: 3000 }), /non consentito/);
});
