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

(async () => {
  // A. pa_album recenti
  const a = await get(API + '/pa_album?per_page=10&orderby=id&order=desc&_fields=id,name,slug,count');
  log('A. pa_album id desc — HTTP', a.status, 'total', a.headers['x-wp-total']);
  if (a.status === 200) JSON.parse(a.body).forEach(x => log('   id=' + x.id, 'count=' + x.count, x.slug));

  // B. ricerca SGV
  const b = await get(API + '/pa_album?search=san+giovanni&per_page=10&_fields=id,name,slug,count');
  log('B. ricerca san giovanni — HTTP', b.status);
  let sgvAlbum = null;
  if (b.status === 200) {
    const arr = JSON.parse(b.body);
    arr.forEach(x => log('   id=' + x.id, 'count=' + x.count, x.slug));
    sgvAlbum = arr.find(x => x.slug.includes('2026')) || arr[0];
  }

  // C. prodotti dell'album SGV — prova diversi parametri
  if (sgvAlbum) {
    log('\nC. Album scelto: id=' + sgvAlbum.id + ' ' + sgvAlbum.slug);
    for (const param of ['pa_album=' + sgvAlbum.id, 'attribute=pa_album&attribute_term=' + sgvAlbum.id]) {
      const c = await get(API + '/product?' + param + '&per_page=3&_fields=id,name,images');
      log('   product?' + param + ' — HTTP', c.status, 'total', c.headers['x-wp-total'] || '-');
      if (c.status === 200) {
        const prods = JSON.parse(c.body);
        log('     prodotti trovati:', prods.length);
        if (prods[0]) log('     primo prodotto keys:', Object.keys(prods[0]).join(','));
        if (prods[0] && prods[0].images) log('     images[0]:', JSON.stringify(prods[0].images[0]).slice(0, 200));
      }
    }
  }
  fs.writeFileSync('_xpix_out.txt', out.join('\n'));
})();
