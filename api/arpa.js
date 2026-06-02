/**
 * Vercel Edge Function — proxy ARPA Lombardia
 *
 * Dataset usati:
 *   Dati sensori meteo (REALTIME, ogni 10 min):
 *     https://www.dati.lombardia.it/resource/647i-nhxk.json
 *     → tipologia "Livello Idrometrico" e "Precipitazione"
 *   Anagrafica stazioni:
 *     https://www.dati.lombardia.it/resource/nf78-nj6b.json
 *
 * Stazioni idrometriche Seveso confermate:
 *   22307 — Seveso c.so Isonzo
 *    8121 — Seveso a Paderno Dugnano Palazzolo (CRITICA)
 *   terza: cerca CUSANO o CORMANO
 *
 * Soglie calibrate su eventi reali (in METRI, non cm — ARPA pubblica in cm
 * ma i colmi storici sono citati in metri: 22/09/2025 Paderno = 4.04m = 404cm)
 */

export const config = { runtime: "edge" };
const BASE = "https://www.dati.lombardia.it/resource";

const STAZIONI = [
  { id: "22307", label: "Seveso c.so Isonzo",  km: 18, desc: "Anticipo 3–4 ore su Milano" },
  { id: "8121",  label: "Paderno Dugnano",      km: 32, desc: "Stazione critica — anticipo 1–2 ore" },
  { id: null,    label: "Cusano / Cormano",     km: 38, desc: "Zona pre-Milano — anticipo 30–60 min", cerca: ["CUSANO","CORMANO"] },
];

// Soglie in cm — calibrate su eventi storici ARPA documentati
// Normale estivo: -100 a +50 cm
// 22/09/2025: Paderno 404 cm, Niguarda 492 cm
// 31/10/2023: livello non documentato in cm ma equivalente ~200+ cm
// Soglia rossa ARPA ufficiale: tipicamente 200+ cm a Paderno
const SOGLIE = { verde: 50, giallo: 100, arancione: 180, rosso: 300 };

function rischioIdro(cm) {
  if (cm === null || isNaN(cm) || cm < -900) return "nd";
  if (cm > SOGLIE.rosso)     return "rosso";
  if (cm > SOGLIE.arancione) return "arancione";
  if (cm > SOGLIE.giallo)    return "giallo";
  if (cm > SOGLIE.verde)     return "verde_allerta"; // sopra zero ma non ancora allerta
  return "verde";
}

function rischioDisplay(r) {
  // Mappa a classe pill
  return r === "verde_allerta" ? "giallo" : r;
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

// Usa dataset 647i-nhxk (sensori meteo realtime) — più aggiornato
async function fetchLivelloRealtime(idsensore) {
  try {
    // Prima prova il dataset realtime (647i-nhxk)
    const url = `${BASE}/647i-nhxk.json?idsensore=${idsensore}&$order=data DESC&$limit=8`;
    const data = await ft(url);
    const validi = data
      .map(d => parseFloat(d.valore))
      .filter(v => !isNaN(v) && v > -9000);

    if (!validi.length) {
      // Fallback al dataset storico 3e8b-w7ay
      const url2 = `${BASE}/3e8b-w7ay.json?idsensore=${idsensore}&$order=data DESC&$limit=8`;
      const data2 = await ft(url2);
      const validi2 = data2.map(d => parseFloat(d.valore)).filter(v => !isNaN(v) && v > -9000);
      if (!validi2.length) return null;
      return buildDati(validi2, data2[0]?.data, idsensore);
    }
    return buildDati(validi, data[0]?.data, idsensore);
  } catch { return null; }
}

function buildDati(validi, timestamp, idsensore) {
  const ultimo = validi[0];
  const trend = validi.length >= 2 ? validi[0] - validi[validi.length - 1] : 0;
  const r = rischioIdro(ultimo);
  return {
    valore_cm:  Math.round(ultimo),
    trend_cm:   Math.round(trend * 10) / 10,
    timestamp,
    rischio:    rischioDisplay(r),
    rischio_raw: r,
    idsensore,
  };
}

async function trovaSensore(keywords) {
  try {
    const cond = keywords.map(k => `UPPER(nomestazione) LIKE '%${k}%'`).join(" OR ");
    const data = await ft(
      `${BASE}/nf78-nj6b.json?$where=tipologia='Livello Idrometrico' AND (${encodeURIComponent(cond)})&$select=idsensore,nomestazione,storico&$limit=10`
    );
    return data.filter(d => d.storico !== "S")[0] ?? null;
  } catch { return null; }
}

export default async function handler() {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "s-maxage=120, stale-while-revalidate=30", // cache più corta: 2 min
  };

  try {
    const stazioni = await Promise.all(STAZIONI.map(async s => {
      let id = s.id;
      let nomeReale = s.label;
      if (!id && s.cerca) {
        const trovato = await trovaSensore(s.cerca);
        if (trovato) { id = trovato.idsensore; nomeReale = trovato.nomestazione; }
      }
      const dati = id ? await fetchLivelloRealtime(id) : null;
      return { label: s.label, name: nomeReale, km: s.km, desc: s.desc, id: id ?? "n.d.", dati };
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
