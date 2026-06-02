/**
 * Vercel Edge Function — proxy ARPA Lombardia Open Data
 * Endpoint: /api/arpa
 *
 * Cerca dinamicamente le stazioni idrometriche sul Seveso
 * nell'anagrafica ARPA, poi recupera i valori più recenti.
 *
 * Dataset Socrata:
 *   Anagrafica: https://www.dati.lombardia.it/resource/nf78-nj6b.json
 *   Livelli:    https://www.dati.lombardia.it/resource/3e8b-w7ay.json
 */

export const config = { runtime: "edge" };

const BASE = "https://www.dati.lombardia.it/resource";

// Stazioni note sul Seveso — nomi come appaiono nell'anagrafica ARPA
// Il proxy le cerca dinamicamente, questi sono i fallback
const STAZIONI_SEVESO = [
  { cerca: "SEVESO", label: "Seveso",          km: 18 },
  { cerca: "PADERNO", label: "Paderno Dugnano", km: 32 },
  { cerca: "BRESSO",  label: "Bresso",          km: 41 },
];

// Soglie idrometriche calibrate su eventi storici (cm)
const SOGLIE = { verde: 60, giallo: 120, arancione: 200 };

function rischioIdro(cm) {
  if (cm === null || cm < 0) return "nd";
  if (cm > SOGLIE.arancione) return "rosso";
  if (cm > SOGLIE.giallo)    return "arancione";
  if (cm > SOGLIE.verde)     return "giallo";
  return "verde";
}

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function cercaSensori() {
  // Recupera tutti i sensori di tipo "Livello Idrometrico"
  // con nome stazione contenente parole chiave del Seveso
  const query = encodeURIComponent(
    `tipologia='Livello Idrometrico' AND (UPPER(nomestazione) LIKE '%SEVESO%' OR UPPER(nomestazione) LIKE '%PADERNO%' OR UPPER(nomestazione) LIKE '%BRESSO%')`
  );
  const url = `${BASE}/nf78-nj6b.json?$where=${query}&$select=idsensore,nomestazione,storico&$limit=20`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) return [];
  const data = await r.json();
  // Filtra solo sensori attivi (storico=N)
  return data.filter(d => d.storico === "N" || !d.storico);
}

async function fetchLivello(idsensore) {
  const url = `${BASE}/3e8b-w7ay.json?idsensore=${idsensore}&$order=data DESC&$limit=6`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) return null;
  const data = await r.json();
  if (!data.length) return null;
  const valori = data.map(d => parseFloat(d.valore)).filter(v => !isNaN(v) && v > -9000);
  if (!valori.length) return null;
  const ultimo = valori[0];
  const trend = valori.length >= 2 ? valori[0] - valori[valori.length - 1] : 0;
  return {
    valore_cm: Math.round(ultimo),
    trend_cm: Math.round(trend * 10) / 10,
    timestamp: data[0].data,
    rischio: rischioIdro(ultimo),
  };
}

export default async function handler(req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
  };

  try {
    // 1. Cerca sensori attivi nell'anagrafica
    const sensoriTrovati = await cercaSensori();

    // 2. Per ogni stazione cercata, trova il sensore corrispondente
    const stazioni = await Promise.all(
      STAZIONI_SEVESO.map(async (s) => {
        const match = sensoriTrovati.find(t =>
          t.nomestazione?.toUpperCase().includes(s.cerca)
        );
        const idsensore = match?.idsensore ?? null;
        const dati = idsensore ? await fetchLivello(idsensore) : null;
        return {
          name: match?.nomestazione ?? s.label,
          label: s.label,
          km: s.km,
          id: idsensore ?? "n.d.",
          dati,
        };
      })
    );

    const livelli = ["verde", "giallo", "arancione", "rosso"];
    const rischioMax = stazioni
      .map(s => s.dati?.rischio ?? "verde")
      .reduce((max, r) => {
        return livelli.indexOf(r) > livelli.indexOf(max) ? r : max;
      }, "verde");

    return new Response(
      JSON.stringify({
        ok: true,
        aggiornato: new Date().toISOString(),
        rischio_aggregato: rischioMax,
        stazioni,
        soglie_cm: SOGLIE,
        sensori_trovati: sensoriTrovati.length,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message, stazioni: [] }),
      { status: 500, headers }
    );
  }
}
