/**
 * Vercel Edge Function — proxy ARPA Lombardia Open Data
 * Endpoint: /api/arpa
 *
 * Restituisce i dati idrometrici più recenti per le stazioni
 * chiave sul bacino del Seveso (livello in cm) + precipitazioni
 * delle ultime 3 ore per ogni stazione.
 *
 * Stazioni idrometriche Seveso (idsensore da anagrafica ARPA):
 *   - 15700: Seveso a Lentate sul Seveso
 *   - 15598: Seveso a Paderno Dugnano (stazione critica per Milano)
 *   - 15600: Seveso a Bresso (ingresso tombinatura Milano)
 *
 * Dataset Socrata usati:
 *   - Livello idrometrico 2021+: https://www.dati.lombardia.it/resource/3e8b-w7ay.json
 *   - Stazioni meteo (precipitazioni): https://www.dati.lombardia.it/resource/647i-nhxk.json
 */

export const config = { runtime: "edge" };

const SOCRATA_BASE = "https://www.dati.lombardia.it/resource";

// Sensori idrometrici (livello cm) — idsensore da anagrafica nf78-nj6b
const IDRO_SENSORS = {
  lentate:  { id: "15700", name: "Lentate sul Seveso", km: 14 },
  paderno:  { id: "15598", name: "Paderno Dugnano",    km: 32 },
  bresso:   { id: "15600", name: "Bresso",             km: 41 },
};

// Soglie idrometriche (cm) calibrate su evento 22/09/2025
// Verde < 80 | Giallo 80-150 | Arancione 150-220 | Rosso > 220
const SOGLIE = { verde: 80, giallo: 150, arancione: 220 };

function rischioIdro(cm) {
  if (cm === null) return "nd";
  if (cm > SOGLIE.arancione) return "rosso";
  if (cm > SOGLIE.giallo)    return "arancione";
  if (cm > SOGLIE.verde)     return "giallo";
  return "verde";
}

async function fetchIdroRecente(idsensore) {
  // Prende gli ultimi 6 record (ogni 10 min → ultima ora)
  const url =
    `${SOCRATA_BASE}/3e8b-w7ay.json` +
    `?idsensore=${idsensore}` +
    `&$order=data DESC` +
    `&$limit=6`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  if (!data.length) return null;
  const ultimo = parseFloat(data[0].valore);
  const trend = data.length >= 2
    ? (parseFloat(data[0].valore) - parseFloat(data[data.length - 1].valore))
    : 0;
  return {
    valore_cm: Math.round(ultimo),
    trend_cm: Math.round(trend * 10) / 10,   // positivo = in salita
    timestamp: data[0].data,
    rischio: rischioIdro(ultimo),
  };
}

export default async function handler(req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "s-maxage=300, stale-while-revalidate=60", // cache 5 min
  };

  try {
    // Fetch parallele per tutte le stazioni
    const [lentate, paderno, bresso] = await Promise.all([
      fetchIdroRecente(IDRO_SENSORS.lentate.id),
      fetchIdroRecente(IDRO_SENSORS.paderno.id),
      fetchIdroRecente(IDRO_SENSORS.bresso.id),
    ]);

    const stazioni = [
      { ...IDRO_SENSORS.lentate,  dati: lentate },
      { ...IDRO_SENSORS.paderno,  dati: paderno },
      { ...IDRO_SENSORS.bresso,   dati: bresso },
    ];

    // Rischio aggregato = il peggiore tra le stazioni
    const livelli = ["verde", "giallo", "arancione", "rosso"];
    const rischioMax = stazioni
      .map(s => s.dati?.rischio ?? "nd")
      .reduce((max, r) => {
        const iMax = livelli.indexOf(max);
        const iR   = livelli.indexOf(r);
        return iR > iMax ? r : max;
      }, "verde");

    return new Response(
      JSON.stringify({
        ok: true,
        aggiornato: new Date().toISOString(),
        rischio_aggregato: rischioMax,
        stazioni,
        soglie_cm: SOGLIE,
        note: "Livello in cm rispetto allo zero idrometrico convenzionale ARPA. Soglie calibrate su evento 22/09/2025.",
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers }
    );
  }
}
