const https = require('https');
function get(url) {
  return new Promise((res) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b }));
    }).on('error', e => res({ error: e.message }));
  });
}

(async () => {
  // 1. Lista tutte le taxonomy disponibili
  console.log('=== TAXONOMIES ===');
  const tax = await get('https://www.xpix.it/wp-json/wp/v2/taxonomies');
  if (tax.status === 200) {
    const obj = JSON.parse(tax.body);
    Object.keys(obj).forEach(k => console.log(' ', k, '→ rest_base:', obj[k].rest_base, '| types:', obj[k].types));
  } else console.log('HTTP', tax.status, tax.body.slice(0,200));

  // 2. Lista tutti i post types
  console.log('\n=== POST TYPES ===');
  const types = await get('https://www.xpix.it/wp-json/wp/v2/types');
  if (types.status === 200) {
    const obj = JSON.parse(types.body);
    Object.keys(obj).forEach(k => console.log(' ', k, '→ rest_base:', obj[k].rest_base));
  } else console.log('HTTP', types.status);
})();
