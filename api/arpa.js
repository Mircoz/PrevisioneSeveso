/**
 * Vercel Edge Function — proxy ARPA Lombardia
 * Stazioni idrometriche Seveso confermate dall'anagrafica:
 *   22307 — Seveso c.so Isonzo (km ~18)
 *    8121 — Seveso a Paderno Dugnano Palazzolo (km ~32)
 *   Bresso: il Seveso è già tombinato, nessun sensore fisico
 *   → Usiamo Cusano Milanino (più vicina a Milano disponibile)
 *
 * Soglie idrometriche (cm) calibrate su eventi storici:
 *   22/09/2025: livello record, esondazione confermata
 *   31/10/2023: 31 mm/h → esondazione Niguarda
 */

export const config = { runtime: "edge" };
const BASE = "https://www.dati.lombardia.it/resource";

// Stazioni confermate — ID verificati dall'anagrafica nf78-nj6b
const STAZIONI = [
  { id: "22307", label: "Seveso c.so Isonzo",      km: 18, desc: "Anticipo 3–4 ore su Milano" },
  { id: "8121",  label: "Paderno Dugnano",          km: 32, desc: "Stazione critica — anticipo 1–2 ore" },
  // Terza stazione: cerchiamo qualsiasi sensore attivo con CUSANO o CORMANO
  { id: null,    label: "Cusano / Cormano",         km: 38, desc: "Anticipo 30–60 minuti", cerca: ["CUSANO","CORMANO","NIGUARDA"] },
];

const SOGLIE = { verde: 50, giallo: 120, arancione: 190 };

function rischioIdro(cm) {
  if (cm === null || isNaN(cm) || cm < -500) return "nd";
  if (cm > SOGLIE.arancione) return "rosso";
  if (cm > SOGLIE.giallo)    return "arancione";
  if (cm > SOGLIE.verde)     return "giallo";
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

async function fetchLivello(idsensore) {
  try {
    const data = await ft(`${BASE}/3e8b-w7ay.json?idsensore=${idsensore}&$order=data DESC&$limit=8`);
    const validi = data
      .map(d => parseFloat(d.valore))
      .filter(v => !isNaN(v) && v > -9000);
    if (!validi.length) return null;
    const ultimo = validi[0];
    const trend = validi.length >= 2 ? validi[0] - validi[validi.length - 1] : 0;
    return {
      valore_cm: Math.round(ultimo),
      trend_cm:  Math.round(trend * 10) / 10,
      timestamp: data[0]?.data,
      rischio:   rischioIdro(ultimo),
    };
  } catch { return null; }
}

async function trovaSensore(keywords) {
  // Cerca nell'anagrafica un sensore idrometrico attivo
  const cond = keywords.map(k => `UPPER(nomestazione) LIKE '%${k}%'`).join(" OR ");
  try {
    const data = await ft(
      `${BASE}/nf78-nj6b.json?$where=tipologia='Livello Idrometrico' AND (${encodeURIComponent(cond)})&$select=idsensore,nomestazione,storico&$limit=10`
    );
    const attivi = data.filter(d => d.storico !== "S");
    return attivi[0] ?? null;
  } catch { return null; }
}

export default async function handler() {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
  };

  try {
    const stazioni = await Promise.all(STAZIONI.map(async s => {
      let id = s.id;
      let nomeReale = s.label;

      // Se non abbiamo ID fisso, cerca dinamicamente
      if (!id && s.cerca) {
        const trovato = await trovaSensore(s.cerca);
        if (trovato) { id = trovato.idsensore; nomeReale = trovato.nomestazione; }
      }

      const dati = id ? await fetchLivello(id) : null;
      return { label: s.label, name: nomeReale, km: s.km, desc: s.desc, id: id ?? "n.d.", dati };
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
    return new Response(JSON.stringify({ ok: false, error: err.message, stazioni: [] }), { status: 500, headers });
  }
}
