const https = require('https');
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false }, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res({ _raw: b, _status: r.statusCode }); } });
    }).on('error', rej);
  });
}
const API = 'https://www.xpix.it/wp-json/wp/v2';

(async () => {
  console.log('=== 1. Ricerca testuale "san giovanni valdarno" ===');
  const d1 = await get(API + '/pixy_album?search=san+giovanni+valdarno&per_page=20&_fields=id,name,slug,count');
  if (Array.isArray(d1)) { console.log(d1.length, 'risultati'); d1.forEach(x => console.log('  id=' + x.id, 'count=' + x.count, x.slug)); }
  else console.log('NON ARRAY:', JSON.stringify(d1).slice(0, 400));

  console.log('\n=== 2. Ricerca per "2026" orderby id desc (quello che fa il sync) ===');
  const d2 = await get(API + '/pixy_album?search=2026&per_page=100&orderby=id&order=desc&_fields=id,slug');
  if (Array.isArray(d2)) {
    console.log(d2.length, 'risultati');
    console.log('SGV presente:', d2.some(x => x.slug && x.slug.includes('san-giovanni-valdarno')));
    console.log('range id: max', Math.max(...d2.map(x => x.id)), 'min', Math.min(...d2.map(x => x.id)));
  } else console.log('NON ARRAY:', JSON.stringify(d2).slice(0, 400));

  console.log('\n=== 3. Lookup diretto per slug ===');
  const d3 = await get(API + '/pixy_album?slug=9-trofeo-citta-di-san-giovanni-valdarno-san-giovanni-valdarno-ar-2026&_fields=id,name,slug,count');
  if (Array.isArray(d3)) { console.log(d3.length, 'risultati'); d3.forEach(x => console.log('  id=' + x.id, 'count=' + x.count, x.name)); }
  else console.log('NON ARRAY:', JSON.stringify(d3).slice(0, 400));
})();
