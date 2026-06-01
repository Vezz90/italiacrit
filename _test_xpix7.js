const https = require('https');
const fs = require('fs');
function req(url, method='GET') {
  return new Promise((res) => {
    const u = new URL(url);
    https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b }));
    }).on('error', e => res({ error: e.message })).end();
  });
}
const API = 'https://www.xpix.it/wp-json/wp/v2';
const out = [];
const log = (...a) => out.push(a.join(' '));
const ALB = 8964;
const SLUG = '9-trofeo-citta-di-san-giovanni-valdarno-san-giovanni-valdarno-ar-2026';

(async () => {
  // 1. OPTIONS sul product endpoint per vedere i query param accettati
  const opt = await req(API + '/product', 'OPTIONS');
  if (opt.status === 200) {
    const schema = JSON.parse(opt.body);
    const params = schema.endpoints && schema.endpoints[0] && schema.endpoints[0].args;
    log('Query params accettati da /product:');
    if (params) Object.keys(params).forEach(k => log('  -', k));
  } else log('OPTIONS product HTTP', opt.status);

  // 2. _links di un prodotto
  const p = await req(API + '/product?per_page=1');
  if (p.status === 200) {
    const prod = JSON.parse(p.body)[0];
    log('\n_links di un prodotto:');
    if (prod._links) Object.keys(prod._links).forEach(k => log('  ', k, '→', JSON.stringify(prod._links[k]).slice(0,150)));
  }

  // 3. Store API products con attribute by term id
  const w2 = await req('https://www.xpix.it/wp-json/wc/store/v1/products?per_page=2&attributes[0][attribute]=pa_album&attributes[0][term_id]=' + ALB);
  log('\nStore API by term_id → HTTP ' + w2.status + ' total=' + (w2.headers['x-wp-total']||'-'));
  // 4. Store API products con category filter generico per capire formato
  const w3 = await req('https://www.xpix.it/wp-json/wc/store/v1/products/attributes');
  log('Store attributes list → HTTP ' + w3.status);
  if (w3.status === 200) log('  ' + w3.body.slice(0, 400));

  fs.writeFileSync('_xpix_out.txt', out.join('\n'));
})();
