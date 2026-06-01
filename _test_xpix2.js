const https = require('https');
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' }, rejectUnauthorized: false }, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b }));
    }).on('error', e => res({ error: e.message }));
  });
}
const API = 'https://www.xpix.it/wp-json/wp/v2';

(async () => {
  console.log('--- A. pixy_album senza filtri ---');
  const a = await get(API + '/pixy_album?per_page=5');
  console.log('HTTP', a.status, '| total-header:', a.headers && a.headers['x-wp-total']);
  console.log('body primi 600:', (a.body || a.error || '').slice(0, 600));

  console.log('\n--- B. lista tutte le taxonomy ---');
  const b = await get(API.replace('/wp/v2', '') + '/wp/v2/types');
  console.log('HTTP', b.status);

  console.log('\n--- C. root wp-json ---');
  const c = await get('https://www.xpix.it/wp-json/wp/v2/pixy_album');
  console.log('HTTP', c.status, '| total:', c.headers && c.headers['x-wp-total']);
  console.log('body:', (c.body || '').slice(0, 300));
})();
