'use strict';
// Download sicuro di pagine esterne per la Redazione (anti-SSRF).
// Regole: solo protocolli ammessi, solo porte 80/443, niente credenziali nell'indirizzo, niente reti interne
// (loopback, privati, link-local, metadata, riservati). Il controllo degli IP avviene nella risoluzione DNS usata DAVVERO
// dalla connessione (niente differenza tra "verificato" e "contattato", quindi niente DNS rebinding), e si ripete a ogni redirect.
// Limiti di tempo e di byte (anche dopo la decompressione).
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const blocco = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]
  .forEach(([a, n]) => blocco.addSubnet(a, n, 'ipv4'));
[['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]
  .forEach(([a, n]) => blocco.addSubnet(a, n, 'ipv6'));

// true se l'indirizzo NON e pubblico (o non e un indirizzo valido)
function ipVietato(ip) {
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const f = net.isIP(s);
  if (!f) return true;
  if (f === 4) return blocco.check(s, 'ipv4');
  // IPv6 che contiene un IPv4: ::ffff:a.b.c.d (mappato), 64:ff9b::a.b.c.d (NAT64), 2002:AABB:CCDD:: (6to4)
  const mapped = s.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipVietato(mapped[1]);
  const hex = s.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16); return ipVietato(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
  const sei = s.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sei) { const a = parseInt(sei[1], 16), b = parseInt(sei[2], 16); return ipVietato(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
  return blocco.check(s, 'ipv6');
}

function creaScaricatore(opz = {}) {
  const vieta = opz.vieta || ipVietato, porte = opz.porte || ['80', '443'];     // vieta e porte si cambiano solo nelle prove
  const lookupSicuro = (hostname, o, cb) => {
    const opts = typeof o === 'function' ? {} : (o || ''), done = typeof o === 'function' ? o : cb;
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return done(err);
      if (!addrs || !addrs.length) return done(new Error('indirizzo non risolvibile'));
      if (addrs.some(a => vieta(a.address))) return done(Object.assign(new Error('indirizzo non consentito (rete interna o riservata)'), { code: 'RETE_VIETATA' }));
      if (opts.all) return done(null, addrs);
      done(null, addrs[0].address, addrs[0].family);
    });
  };

  // ritorna { status, url, tipo, headers, text }; lancia Error con messaggio leggibile per limiti, rete interna, protocolli, redirect
  function scarica(url, o = {}) {
    const protocolli = o.protocolli || ['https:'], maxByte = o.maxByte || 2 * 1024 * 1024, timeout = o.timeout || 15000, maxRedirect = o.maxRedirect == null ? 4 : o.maxRedirect;
    const headers = { 'user-agent': 'Mozilla/5.0 (compatible; ICS-Redazione)', 'accept-encoding': 'gzip, deflate, br', ...(o.headers || {}) };
    return new Promise((resolve, reject) => {
      let chiuso = false, req = null;
      const fine = (err, val) => { if (chiuso) return; chiuso = true; clearTimeout(tm); if (req) req.destroy(); err ? reject(err) : resolve(val); };
      const tm = setTimeout(() => fine(new Error('tempo scaduto')), timeout);
      const vai = (indirizzo, salti) => {
        let u;
        try { u = new URL(indirizzo); } catch (_) { return fine(new Error('indirizzo non valido')); }
        if (!protocolli.includes(u.protocol)) return fine(new Error(protocolli.length === 1 && protocolli[0] === 'https:' ? 'solo indirizzi https' : 'protocollo non consentito'));
        if (u.username || u.password) return fine(new Error('indirizzo con credenziali non consentito'));
        const porta = u.port || (u.protocol === 'https:' ? '443' : '80');
        if (!porte.includes(porta)) return fine(new Error('porta non consentita'));
        const host = u.hostname.replace(/^\[|\]$/g, '');
        if (!host) return fine(new Error('indirizzo non valido'));
        if (net.isIP(host) && vieta(host)) return fine(new Error('indirizzo non consentito (rete interna o riservata)'));
        const mod = u.protocol === 'https:' ? https : http;
        req = mod.request({ protocol: u.protocol, hostname: host, port: porta, path: u.pathname + u.search, method: 'GET', headers, lookup: lookupSicuro, agent: false }, res => {
          const st = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(st) && res.headers.location) {
            res.resume();
            if (salti >= maxRedirect) return fine(new Error('troppi redirect'));
            let prossimo; try { prossimo = new URL(res.headers.location, u).toString(); } catch (_) { return fine(new Error('redirect non valido')); }
            return vai(prossimo, salti + 1);
          }
          const tipo = String(res.headers['content-type'] || '');
          if (o.tipi && st >= 200 && st < 300 && tipo && !o.tipi.test(tipo)) { res.resume(); return fine(Object.assign(new Error('formato non leggibile (' + tipo.split(';')[0] + ')'), { code: 'TIPO', tipo })); }
          const dichiarata = Number(res.headers['content-length']);
          if (dichiarata > maxByte) { res.resume(); return fine(new Error('risposta troppo grande')); }
          let flusso = res;
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          if (enc === 'gzip' || enc === 'x-gzip') flusso = res.pipe(zlib.createGunzip());
          else if (enc === 'deflate') flusso = res.pipe(zlib.createInflate());
          else if (enc === 'br') flusso = res.pipe(zlib.createBrotliDecompress());
          const pezzi = []; let tot = 0;
          flusso.on('data', c => { tot += c.length; if (tot > maxByte) { fine(new Error('risposta troppo grande')); return; } pezzi.push(c); });
          flusso.on('end', () => {
            const cs = (tipo.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
            let text; try { text = new TextDecoder(cs).decode(Buffer.concat(pezzi)); } catch (_) { text = Buffer.concat(pezzi).toString('utf8'); }
            fine(null, { status: st, ok: st >= 200 && st < 300, url: u.toString(), tipo, headers: res.headers, text });
          });
          flusso.on('error', e => fine(e));
          res.on('error', e => fine(e));
        });
        req.on('error', e => fine(e.code === 'RETE_VIETATA' ? e : new Error(e.message || 'errore di rete')));
        req.end();
      };
      vai(String(url || ''), 0);
    });
  }
  return { scarica };
}

module.exports = { ipVietato, creaScaricatore, scarica: creaScaricatore().scarica };
