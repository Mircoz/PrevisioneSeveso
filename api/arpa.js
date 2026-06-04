/**
 * Vercel Edge Function — proxy ARPA Lombardia + modello idrologico Seveso
 *
 * Dati idrometrici: dataset 647i-nhxk (realtime) con fallback su 3e8b-w7ay
 * Stazioni: 22307 (Seveso c.so Isonzo), 8121 (Paderno Dugnano Palazzolo)
 *
 * Soglie calibrate da documenti ufficiali AdbPo 2020 e dati eventi reali:
 *   - Capacità tombinatura Milano: 30-40 m³/s (esondazione certa oltre)
 *   - Paderno: 404 cm = ~200 m³/s (evento 22/09/2025, TR > 100 anni)
 *   - Paderno: ~250 cm = ~80 m³/s (evento 31/10/2023, esondazione)
 *   - Paderno: ~100 cm = inizio allerta
 */

export const config = { runtime: "edge" };
const BASE = "https://www.dati.lombardia.it/resource";

const STAZIONI = [
  { id: "22307", label: "Seveso c.so Isonzo",  km: 18, desc: "Anticipo 3–4 ore su Milano" },
  { id: "8121",  label: "Paderno Dugnano",      km: 32, desc: "Stazione critica — anticipo 1–2 ore" },
  { id: null,    label: "Cusano / Cormano",     km: 38, desc: "Pre-Milano — anticipo 30–60 min", cerca: ["CUSANO","CORMANO"] },
];

// Soglie cm ARPA — da eventi storici documentati e studi AdbPo
const SOGLIE = { giallo: 100, arancione: 180, rosso: 300 };

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

async function fetchLivello(id) {
  for (const ds of ["647i-nhxk", "3e8b-w7ay"]) {
    try {
      const data = await ft(`${BASE}/${ds}.json?idsensore=${id}&$order=data DESC&$limit=20`);
      const validi = data.map(d => ({ v: parseFloat(d.valore), ts: d.data }))
                        .filter(d => !isNaN(d.v) && d.v > -9000);
      if (!validi.length) continue;
      const ultimo = validi[0].v;
      const trend  = validi.length >= 2 ? validi[0].v - validi[validi.length-1].v : 0;
      // Calcola velocità di salita (cm/h) — indicatore critico per previsione
      const dt_h = validi.length >= 2
        ? (new Date(validi[0].ts) - new Date(validi[validi.length-1].ts)) / 3600000
        : 1;
      const velocita_cm_h = dt_h > 0 ? Math.round((trend / dt_h) * 10) / 10 : 0;
      return {
        valore_cm:     Math.round(ultimo),
        trend_cm:      Math.round(trend * 10) / 10,
        velocita_cm_h, // cm/h — chiave per previsione breve termine
        timestamp:     validi[0].ts,
        rischio:       rischioIdro(ultimo),
        serie:         validi.slice(0, 18).map(d => ({ ts: d.ts, cm: Math.round(d.v) })).reverse(),
      };
    } catch {}
  }
  return null;
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
        const found = await trovaSensore(s.cerca);
        if (found) id = found.idsensore;
      }
      const dati = id ? await fetchLivello(id) : null;
      return { label: s.label, km: s.km, desc: s.desc, id: id ?? "n.d.", dati };
    }));

    const livelli = ["verde","giallo","arancione","rosso"];
    const rischioMax = stazioni
      .map(s => s.dati?.rischio ?? "verde")
      .filter(r => r !== "nd")
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
