const fs = require('fs');
const html = fs.readFileSync('race_detail.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);

console.log('--- HEADERS ---');
console.log($('.titoloPagina').text().trim());

console.log('\n--- DATI ROW ---');
$('div.row').each((i, el) => {
  const text = $(el).text().trim().replace(/\s+/g, ' ');
  if(text.length < 200) console.log(text);
});

console.log('\n--- BLOCCHI DI DETTAGLIO ---');
$('h3, h4').each((i, el) => {
    console.log('TITOLO:', $(el).text().trim());
    let next = $(el).next();
    while (next.length && !next.is('h3') && !next.is('h4')) {
        console.log('  CONTENUTO:', next.text().trim().replace(/\s+/g, ' ').substring(0, 150));
        next = next.next();
    }
});
