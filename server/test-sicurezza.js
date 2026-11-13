// Prove di sicurezza: escJs (XSS nei gestori onclick) e controllo degli indirizzi push.
// Si estraggono le funzioni dai file reali, cosi' il test guarda il codice vero.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const srvSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const grab = (src, re) => { const m = src.match(re); assert.ok(m, 'funzione non trovata: ' + re); return m[0]; };

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(grab(appSrc, /function esc\(s\) \{[\s\S]*?\n\}\n/) + grab(appSrc, /function escJs\(s\) \{[\s\S]*?\n\}\n/), ctx);

// come fa il browser: legge l'attributo HTML, ne decodifica le entita', poi esegue il JavaScript
const decode = h => h.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esegui = (valore, escFn) => {
  const html = `window._f('${ctx[escFn](valore)}')`;
  const sandbox = { window: { _f: v => { sandbox.ricevuto = v; } }, boom: () => { sandbox.boom = true; } };
  vm.createContext(sandbox);
  vm.runInContext(decode(html), sandbox);
  return sandbox;
};

test('esc() da solo lascia uscire dalla stringa (il problema)', () => {
  assert.strictEqual(esegui("x');boom();//", 'esc').boom, true, 'con esc() il codice iniettato viene eseguito');
});

test('escJs: un nome malevolo resta un semplice testo', () => {
  for (const nome of ["x');boom();//", "\\');boom();//", 'a"b', "o'brien", 'riga\nnuova', '</script><img src=x onerror=boom()>', '\u2028boom()']) {
    const r = esegui(nome, 'escJs');
    assert.notStrictEqual(r.boom, true, 'codice eseguito per: ' + nome);
    assert.strictEqual(r.ricevuto, nome.replace(/[\u2028\u2029]/g, ' '), 'il testo deve arrivare intatto: ' + nome);
  }
});

const ctxS = { URL };
vm.createContext(ctxS);
vm.runInContext(grab(srvSrc, /const _PUSH_HOSTS = [\s\S]*?\nfunction isAllowedPushEndpoint[\s\S]*?\n\}\n/).replace(/^const /gm, 'var '), ctxS);
const ok = ep => vm.runInContext('isAllowedPushEndpoint', ctxS)(ep);

test('push: solo i servizi dei browser, solo https', () => {
  for (const u of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://wns2-par02p.notify.windows.com/w/?token=1']) assert.strictEqual(ok(u), true, u);
  for (const u of ['http://fcm.googleapis.com/x', 'https://evil.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com:8443/x', 'https://u@fcm.googleapis.com/x', '', null, 'x'.repeat(2000)]) assert.strictEqual(ok(u), false, String(u).slice(0, 40));
});

test('test-scrape richiede l\'amministratore', () => {
  assert.match(srvSrc, /app\.get\('\/api\/cron\/test-scrape', requireAdmin,/);
});
