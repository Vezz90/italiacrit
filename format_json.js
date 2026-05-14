const fs = require('fs');

const d = JSON.parse(fs.readFileSync('data/race_details.json'));

const labels = [
    'Località:', 'Provincia:', 'Categoria:', 'Categorie Ammesse:', 'Categoria Geografica:',
    'Specifica Gara:', 'Tipo di Gara:', 'Tipo di Programma:', 'Direttore di Corsa:', 
    'Vice Direttore di Corsa:', 'Approvazione:', 'Nome:', 'Indirizzo:', 'CAP:', 'Città:', 
    'Telefono:', 'Email:', 'Luogo:', 'Iscrizioni Dal - Al:', 'Tipo:', 'Prova:', 'Data:', 
    'Descrizione:', 'Luogo Ritrovo:', 'Indirizzo Ritrovo:', 'Orario Ritrovo:', 
    'Luogo Partenza:', 'Orario Partenza:', 'Luogo Arrivo:', 'Orario Arrivo:', 
    'Luogo Verifica:', 'Punto Incontro DS:', 'Lunghezza KM:', 'Note:'
];

const labelRegex = new RegExp('(' + labels.join('|') + ')', 'g');

for (let id in d) {
    let infos = d[id].info;
    let cleanInfo = [];
    
    infos.forEach(block => {
        if (block.includes('BICIMPARO') || block.includes('Twitter feed') || block.includes('Retweet on Twitter')) return;
        
        let formatted = block.replace(/Home \/ Ricerca Gare \/ Dettaglio Gara \/ Dettaglio Gara/g, '');
        formatted = formatted.replace(/📅 AGGIUNGI QUESTA GARA AL CALENDARIO/g, '');
        
        formatted = formatted.replace(labelRegex, '<br><b>$1</b>');
        
        // Fix some double spacing and missing spacing
        formatted = formatted.replace(/<br>\s*<br>/g, '<br>');
        
        cleanInfo.push(formatted.trim());
    });
    
    // prendiamo il blocco più lungo, che solitamente è quello che contiene tutto il testo formattato in modo completo.
    if (cleanInfo.length > 0) {
        let bestBlock = cleanInfo.reduce((a, b) => a.length > b.length ? a : b, '');
        d[id].info = [bestBlock];
    } else {
        d[id].info = [];
    }
}

fs.writeFileSync('data/race_details.json', JSON.stringify(d, null, 2));
console.log('JSON cleaned!');
