const https = require('https');
const fs = require('fs');
function get(url) {
  return new Promise((res) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b }));
    }).on('error', e => res({ error: e.message }));
  });
}
const API = 'https://www.xpix.it/wp-json/wp/v2';
const out = [];
const log = (...a) => out.push(a.join(' '));
const ALB = 8964;

(async () => {
  // Filtro product per pa_album = term ID
  const r = await get(API + '/product?pa_album=' + ALB + '&per_page=100&_fields=id,featured_media,images');
  log('product?pa_album=' + ALB + ' → HTTP ' + r.status + ' total=' + (r.headers['x-wp-total']||'-'));
  if (r.status === 200) {
    const prods = JSON.parse(r.body);
    log('  prodotti:', prods.length);
    if (prods[0]) {
      log('  primo prodotto:', JSON.stringify(prods[0]).slice(0, 400));
    }
    // Estrai featured_media ids
    const mids = prods.map(p => p.featured_media).filter(Boolean).slice(0, 5);
    log('  featured_media ids (primi 5):', mids.join(','));
    if (mids.length) {
      const m = await get(API + '/media?include=' + mids.join(',') + '&per_page=' + mids.length + '&_fields=id,source_url');
      if (m.status === 200) {
        JSON.parse(m.body).forEach(x => log('    media', x.id, '→', x.source_url));
      }
    }
  } else log('  body:', r.body.slice(0, 300));
  fs.writeFileSync('_xpix_out.txt', out.join('\n'));
})();
