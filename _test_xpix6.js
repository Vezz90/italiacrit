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
const ALB = 8964; // SGV 2026
const SLUG = '9-trofeo-citta-di-san-giovanni-valdarno-san-giovanni-valdarno-ar-2026';

(async () => {
  // Vari modi di filtrare product per attributo pa_album
  const tries = [
    'pa_album=' + SLUG,                       // by slug
    'filter[pa_album]=' + ALB,
    'product_attribute=' + ALB,
    'attribute=pa_album&attribute_term=' + SLUG,
  ];
  for (const t of tries) {
    const r = await get(API + '/product?' + t + '&per_page=2&_fields=id,name');
    log('product?' + t + ' → HTTP ' + r.status + ' total=' + (r.headers['x-wp-total'] || '-'));
  }

  // Forse i prodotti sono accessibili e hanno un campo che lega all'album. Prendo 1 prodotto a caso e ne ispeziono i campi
  const p = await get(API + '/product?per_page=1');
  if (p.status === 200) {
    const prod = JSON.parse(p.body)[0];
    log('\nCampi di un product:', Object.keys(prod).join(','));
    if (prod.pa_album) log('  pa_album:', JSON.stringify(prod.pa_album));
    // Cerca campi che contengono "album"
    Object.keys(prod).forEach(k => { if (/album|attribut|image|media/i.test(k)) log('  ' + k + ':', JSON.stringify(prod[k]).slice(0, 200)); });
  }

  // Prova la WooCommerce Store API (pubblica, no auth)
  const w = await get('https://www.xpix.it/wp-json/wc/store/v1/products?per_page=2&attributes[0][attribute]=pa_album&attributes[0][slug]=' + SLUG);
  log('\nStore API filtro album → HTTP ' + w.status + ' total=' + (w.headers['x-wp-total'] || '-'));
  if (w.status === 200) {
    const prods = JSON.parse(w.body);
    log('  prodotti:', prods.length);
    if (prods[0]) {
      log('  primo prodotto campi:', Object.keys(prods[0]).join(','));
      if (prods[0].images) log('  images[0].src:', prods[0].images[0] && prods[0].images[0].src);
    }
  }
  fs.writeFileSync('_xpix_out.txt', out.join('\n'));
})();
