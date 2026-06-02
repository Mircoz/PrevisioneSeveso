/**
 * Vercel Edge Function — proxy ARPA Lombardia
 *
 * Usa il dataset "Dati sensori meteo" (647i-nhxk) che è aggiornato
 * ogni 10 minuti in tempo reale, senza latenza di validazione.
 * Include sia precipitazioni che livello idrometrico.
 *
 * Per ottenere lo storico 3h del livello (necessario per il grafico
 * tipo SIDRO), aggiungiamo un $where sulla data degli ultimi 180 min.
 *
 * Stazioni idrometriche Seveso (idsensore da anagrafica nf78-nj6b):
 *   22307 — Seveso c.so Isonzo
 *    8121 — Paderno Dugnano Palazzolo (STAZIONE CRITICA)
 *   terza: Cusano / Cormano (ricerca dinamica)
 *
 * Soglie allerta ARPA (cm) calibrate su dati storici ufficiali:
 *   Paderno Dugnano: giallo ~100cm, arancione ~180cm, rosso ~300cm
 *   Al picco 22/09/2025: 404cm (record storico)
 *   Al picco 31/10/2023: circa 250-300cm stimato
 */

export const config = { runtime: "edge" };

const BASE = "https://www.dati.lombardia.it/resource";
const REALTIME = `${BASE}/647i-nhxk.json`;
const STORICO  = `${BASE}/3e8b-w7ay.json`;

// Stazioni idrometriche: ID verificati dall'anagrafica ARPA
const STAZIONI = [
  { id: "22307", label: "Seveso c.so Isonzo",  km: 18, desc: "Anticipo 3–4 ore su Milano" },
  { id: "8121",  label: "Paderno Dugnano",      km: 32, desc: "Stazione critica — anticipo 1–2 ore" },
  { id: null,    label: "Cusano / Cormano",     km: 38, desc: "Pre-Milano — anticipo 30–60 min", cerca: ["CUSANO","CORMANO"] },
];

// Soglie ufficiali ARPA in cm (riferite allo zero idrometrico convenzionale)
// Calibrate su eventi documentati da ARPA Lombardia
const SOGLIE = {
  giallo:    100,   // livello in crescita, monitorare
  arancione: 180,   // soglia allerta ARPA ufficiale
  rosso:     300,   // soglia pericolo — al 22/09/2025 Paderno ha raggiunto 404cm
};

function rischioIdro(cm) {
  if (cm === null || isNaN(cm) || cm < -900) return "nd";
  if (cm > SOGLIE.rosso)     return "rosso";
  if (cm > SOGLIE.arancione) return "arancione";
  if (cm > SOGLIE.giallo)    return "giallo";
  return "verde";
}

async function ft(url, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch (e) { clearTimeout(t); throw e; }
}

// Tenta prima dataset realtime, poi fallback su storico
async function fetchUltimoValore(idsensore) {
  for (const url of [
    `${REALTIME}?idsensore=${idsensore}&$order=data DESC&$limit=8`,
    `${STORICO}?idsensore=${idsensore}&$order=data DESC&$limit=8`,
  ]) {
    try {
      const data = await ft(url);
      const validi = data.map(d => parseFloat(d.valore)).filter(v => !isNaN(v) && v > -9000);
      if (validi.length) {
        const ultimo = validi[0];
        const trend = validi.length >= 2 ? validi[0] - validi[validi.length - 1] : 0;
        return {
          valore_cm: Math.round(ultimo),
          trend_cm:  Math.round(trend * 10) / 10,
          timestamp: data[0]?.data ?? null,
          rischio:   rischioIdro(ultimo),
        };
      }
    } catch {}
  }
  return null;
}

// Storico 3h per il grafico: ultimi 18 record (ogni 10 min = 3h)
async function fetchStorico3h(idsensore) {
  for (const url of [
    `${REALTIME}?idsensore=${idsensore}&$order=data DESC&$limit=18`,
    `${STORICO}?idsensore=${idsensore}&$order=data DESC&$limit=18`,
  ]) {
    try {
      const data = await ft(url);
      const punti = data
        .filter(d => parseFloat(d.valore) > -9000)
        .map(d => ({ ts: d.data, cm: Math.round(parseFloat(d.valore)) }))
        .reverse(); // cronologico
      if (punti.length > 0) return punti;
    } catch {}
  }
  return [];
}

async function trovaSensore(keywords) {
  try {
    const cond = keywords.map(k => `UPPER(nomestazione) LIKE '%${k}%'`).join(" OR ");
    const data = await ft(
      `${BASE}/nf78-nj6b.json?$where=tipologia='Livello Idrometrico' AND (${encodeURIComponent(cond)})&$limit=10`
    );
    return data.filter(d => d.storico !== "S")[0] ?? null;
  } catch { return null; }
}

export default async function handler() {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "s-maxage=120, stale-while-revalidate=30",
  };

  try {
    const stazioni = await Promise.all(STAZIONI.map(async s => {
      let id = s.id;
      if (!id && s.cerca) {
        const trovato = await trovaSensore(s.cerca);
        if (trovato) id = trovato.idsensore;
      }

      const [dati, storico] = await Promise.all([
        id ? fetchUltimoValore(id) : Promise.resolve(null),
        id ? fetchStorico3h(id)    : Promise.resolve([]),
      ]);

      return { label: s.label, km: s.km, desc: s.desc, id: id ?? "n.d.", dati, storico };
    }));

    const livelli = ["verde","giallo","arancione","rosso"];
    const rischioMax = stazioni
      .map(s => s.dati?.rischio ?? "verde")
      .reduce((max, r) => livelli.indexOf(r) > livelli.indexOf(max) ? r : max, "verde");

    return new Response(JSON.stringify({
      ok: true,
      aggiornato: new Date().toISOString(),
      rischio_aggregato: rischioMax,
      stazioni,
      soglie_cm: SOGLIE,
    }), { status: 200, headers });

  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message, stazioni: [] }),
      { status: 500, headers }
    );
  }
}
