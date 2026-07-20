/**
 * Ricostruzione automatica del percorso di una gara ("in stile Strava/Komoot")
 * a partire dal testo del comunicato FCI (race_details.json), che quasi mai
 * contiene un vero link Strava/Komoot (verificato: 2 su 946 gare) ma quasi
 * sempre riporta luogo di partenza e di arrivo in chiaro.
 *
 * Pipeline, tutta con servizi pubblici gratuiti (nessuna API key richiesta):
 *   1. estrazione di partenza/arrivo dal testo del comunicato
 *   2. geocodifica (Nominatim/OpenStreetMap) — prova prima l'indirizzo
 *      completo, poi ripiega sul solo comune se fallisce (indirizzi con nomi
 *      di locali/monumenti non standard, es. "Rist Sullivan Via Statale",
 *      spesso non vengono riconosciuti per esteso)
 *   3. instradamento ciclabile reale (OSRM, server demo pubblico) tra i due
 *      punti geocodificati
 *
 * Limite onesto da comunicare in UI: è un percorso INDICATIVO calcolato come
 * il tragitto ciclabile più ragionevole tra partenza e arrivo dichiarati,
 * non il tracciato esatto della gara (che spesso è più lungo/panoramico) —
 * non è quindi un sostituto di un vero file GPX ufficiale, quando esiste.
 * Le gare su circuito (partenza === arrivo, es. "MUGELLO CIRCUIT") non hanno
 * un percorso punto-a-punto: si geocodifica solo la sede per un segnaposto.
 */

'use strict';
const https = require('https');

// ── HTTP helper con User-Agent (richiesto dalla policy di Nominatim) ────────
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'italiacyclingstats.com route-builder (contatto: info@italiacyclingstats.com)', ...headers } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON non valido: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

// ── Estrazione partenza/arrivo dal testo del comunicato ─────────────────────
// Copre solo le gare in linea/circuito di UN giorno (il testo di una gara a
// tappe ripete più blocchi "Luogo Partenza/Arrivo", uno per tappa — fuori
// scope per questa prima versione, che gestisce il caso comune).
function extractWaypoints(raceDetail) {
  const html = Array.isArray(raceDetail?.info) ? raceDetail.info.join(' ') : (raceDetail?.info || '');
  if (!html) return null;
  const grab = (label) => (html.match(new RegExp(`${label}:</b>\\s*([^<\\r\\n]+)`, 'i')) || [])[1]?.trim() || '';
  const localita  = grab('Localit\\S');
  const provincia = grab('Provincia');
  const partenza  = grab('Luogo Partenza') || grab('Luogo Ritrovo');
  const arrivo    = grab('Luogo Arrivo');
  if (!partenza) return null;
  const isCircuit = !arrivo || arrivo.toUpperCase() === partenza.toUpperCase() || /CIRCUIT/i.test(partenza);
  return {
    localita, provincia,
    start: { label: partenza, query: [partenza, localita, provincia, 'Italia'].filter(Boolean).join(', ') },
    finish: isCircuit ? null : { label: arrivo, query: [arrivo, localita, provincia, 'Italia'].filter(Boolean).join(', ') },
    isCircuit,
  };
}

// ── Geocodifica con fallback a due livelli ──────────────────────────────────
async function geocode(point, fallbackLocalita) {
  if (!point) return null;
  const tryQuery = async (q) => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(q)}`;
    const r = await fetchJson(url);
    return (r && r[0]) ? { lat: parseFloat(r[0].lat), lon: parseFloat(r[0].lon) } : null;
  };
  let hit = await tryQuery(point.query).catch(() => null);
  if (!hit && fallbackLocalita) {
    await new Promise(r => setTimeout(r, 1100)); // rispetta 1 req/sec di Nominatim
    hit = await tryQuery(`${fallbackLocalita}, Italia`).catch(() => null);
  }
  return hit;
}

// ── Instradamento ciclabile reale tra due punti (OSRM demo pubblico) ────────
async function routeCycling(from, to) {
  const url = `https://router.project-osrm.org/route/v1/cycling/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const r = await fetchJson(url);
  const route = r?.routes?.[0];
  if (!route) return null;
  return {
    distanceKm: Math.round(route.distance / 100) / 10,
    geometry: route.geometry.coordinates, // [[lon,lat], ...]
  };
}

// ── Orchestrazione per una singola gara ──────────────────────────────────────
// Ritorna null se non c'è abbastanza testo per provarci, altrimenti un
// oggetto salvabile così com'è (anche parziale: es. solo il segnaposto di un
// circuito, se l'instradamento fallisce ma la geocodifica no).
async function buildRaceRoute(raceDetail) {
  const wp = extractWaypoints(raceDetail);
  if (!wp) return null;

  const startPos = await geocode(wp.start, wp.localita);
  if (!startPos) return null;
  await new Promise(r => setTimeout(r, 1100));

  if (wp.isCircuit) {
    return {
      isCircuit: true,
      start: { ...startPos, label: wp.start.label },
      finish: null, geometry: null, distanceKm: null,
      computedAt: new Date().toISOString(),
    };
  }

  const finishPos = await geocode(wp.finish, wp.localita);
  if (!finishPos) {
    // Solo la partenza è stata riconosciuta: meglio un segnaposto che niente.
    return {
      isCircuit: false,
      start: { ...startPos, label: wp.start.label },
      finish: null, geometry: null, distanceKm: null,
      computedAt: new Date().toISOString(),
    };
  }
  await new Promise(r => setTimeout(r, 1100));

  let route = null;
  try { route = await routeCycling(startPos, finishPos); } catch { /* instradamento non disponibile, teniamo comunque i due punti */ }

  return {
    isCircuit: false,
    start: { ...startPos, label: wp.start.label },
    finish: { ...finishPos, label: wp.finish.label },
    geometry: route?.geometry || null,
    distanceKm: route?.distanceKm || null,
    computedAt: new Date().toISOString(),
  };
}

module.exports = { extractWaypoints, geocode, routeCycling, buildRaceRoute };
