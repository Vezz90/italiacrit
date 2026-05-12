const fs = require('fs');
const html = fs.readFileSync('race_detail.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);

console.log($('h1').text().trim());
console.log($('h2').text().trim());

const ptexts = [];
$('p').each((i, el) => ptexts.push($(el).text().trim().replace(/\s+/g, ' ')));
console.log("PARAGRAPHS:", ptexts.slice(0, 10));

const spans = [];
$('span').each((i, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if(t) spans.push(t);
});
console.log("SPANS:", spans.slice(0, 20));

console.log("TEXT IN DIVS:");
$('div.row').each((i, el) => {
    console.log($(el).text().trim().replace(/\s+/g, ' '));
});
