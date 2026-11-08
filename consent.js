/* Consenso cookie di Italia Cycling Stats.
 * Google Analytics NON viene caricato finché la persona non preme «Accetta».
 * Con «Rifiuta» non parte mai. La scelta si ricorda e si cambia da «Preferenze cookie» nel piè di pagina.
 * I cookie tecnici (login, tema, lingua) non richiedono consenso e non passano da qui. */
(function () {
  var GA_ID = 'G-1329Z3BXWE';
  var KEY = 'ics-cookie-consenso';

  function leggi() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function scrivi(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function avviaGA() {
    if (window.__icsGA) return;
    window.__icsGA = true;
    window['ga-disable-' + GA_ID] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // send_page_view:false — i page_view li invia app.js a ogni cambio pagina (sito a pagina singola)
    window.gtag('config', GA_ID, { send_page_view: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    if (typeof window._trackPageView === 'function') window._trackPageView();
  }

  function spegniGA() {
    window['ga-disable-' + GA_ID] = true;
    try { delete window.gtag; } catch (e) { window.gtag = undefined; }
    // cancella gli eventuali cookie di Analytics già presenti
    var host = location.hostname.split('.');
    var domini = ['', location.hostname, '.' + location.hostname];
    if (host.length > 2) domini.push('.' + host.slice(-2).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (n === '_ga' || n.indexOf('_ga_') === 0 || n === '_gid' || n.indexOf('_gat') === 0) {
        domini.forEach(function (d) {
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
        });
      }
    });
  }

  function chiudi() { var b = document.getElementById('ics-cookie-banner'); if (b) b.remove(); }

  function scegli(v) {
    scrivi(v);
    chiudi();
    if (v === 'ok') avviaGA(); else spegniGA();
  }

  function mostra() {
    if (document.getElementById('ics-cookie-banner')) return;
    var corrente = leggi();
    var b = document.createElement('div');
    b.id = 'ics-cookie-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Preferenze cookie');
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9000;max-width:720px;margin:0 auto;' +
      'background:var(--bg-card,#fff);color:var(--text-primary,#16181d);border:1px solid var(--border-subtle,#d6d9de);' +
      'border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.28);padding:14px 16px;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif';
    b.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px">Cookie</div>' +
      '<div style="color:var(--text-secondary,#4a4f58);margin-bottom:12px">Usiamo cookie tecnici per farti restare connesso. Con il tuo consenso usiamo anche Google Analytics, ' +
      'per capire quali pagine servono e migliorare il sito. Puoi cambiare idea quando vuoi. ' +
      '<a href="/privacy" style="color:var(--accent,#e8001d);text-decoration:underline">Informativa privacy e cookie</a></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button type="button" id="ics-cookie-no" style="flex:1 1 140px;padding:10px 14px;border-radius:8px;border:1px solid var(--border-subtle,#c4c8cf);background:var(--bg-elevated,#f1f2f4);color:inherit;font:inherit;font-weight:700;cursor:pointer">Rifiuta</button>' +
      '<button type="button" id="ics-cookie-ok" style="flex:1 1 140px;padding:10px 14px;border-radius:8px;border:1px solid var(--border-subtle,#c4c8cf);background:var(--bg-elevated,#f1f2f4);color:inherit;font:inherit;font-weight:700;cursor:pointer">Accetta</button>' +
      '</div>' +
      (corrente ? '<div style="margin-top:8px;font-size:12px;color:var(--text-muted,#6b7078)">Scelta attuale: ' + (corrente === 'ok' ? 'accettato' : 'rifiutato') + '.</div>' : '');
    document.body.appendChild(b);
    document.getElementById('ics-cookie-no').onclick = function () { scegli('no'); };
    document.getElementById('ics-cookie-ok').onclick = function () { scegli('ok'); };
  }

  window.icsCookiePrefs = mostra;

  if (leggi() === 'ok') avviaGA();
  var pronto = function () { if (!leggi()) mostra(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pronto); else pronto();
})();
