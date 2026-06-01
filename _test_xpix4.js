const https = require('https');
function get(url) {
  return new Promise((res) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b }));
    }).on('error', e => res({ error: e.message }));
  });
}
const API = 'https://www.xpix.it/wp-json/wp/v2';

(async () => {
  console.log('=== A. pa_album per ID desc, pagina 1 ===');
  const a = await get(API + '/pa_album?per_page=10&orderby=id&order=desc&_fields=id,name,slug,count');
  console.log('HTTP', a.status, '| total:', a.headers['x-wp-total']);
  if (a.status === 200) JSON.parse(a.body).forEach(x => console.log('  id=' + x.id, 'count=' + x.count, x.slug));
  else console.log(a.body.slice(0, 300));

  console.log('\n=== B. ricerca SGV in pa_album ===');
  const b = await get(API + '/pa_album?search=san+giovanni+valdarno&per_page=10&_fields=id,name,slug,count');
  console.log('HTTP', b.status);
  if (b.status === 200) JSON.parse(b.body).forEach(x => console.log('  id=' + x.id, 'count=' + x.count, x.slug));

  console.log('\n=== C. prodotti di un album (per recuperare le foto) ===');
  // Prendo il primo album e cerco i product collegati
  if (b.status === 200) {
    const arr = JSON.parse(b.body);
    if (arr.length) {
      const albId = arr[0].id;
      console.log('Album scelto:', arr[0].slug, 'id', albId);
      const c = await get(API + '/product?pa_album=' + albId + '&per_page=3&_fields=id,name,images,featured_media');
      console.log('HTTP', c.status, '| total:', c.headers['x-wp-total']);
      console.log((c.body || '').slice(0, 800));
    }
  }
})();
