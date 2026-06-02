# Seveso Monitor

Monitor in tempo reale del rischio esondazione del fiume Seveso per Milano e Brianza.

## Fonti dati

| Dato | Fonte | Frequenza |
|------|-------|-----------|
| Precipitazioni (mm) | Open-Meteo API (gratuita, no key) | Oraria |
| Livello idrometrico (cm) | ARPA Lombardia Open Data (Socrata) | 10 min |

## Stazioni idrometriche monitorate

| Stazione | ID sensore ARPA | Posizione |
|----------|-----------------|-----------|
| Lentate sul Seveso | 15700 | km 14 |
| Paderno Dugnano | 15598 | km 32 — stazione critica |
| Bresso | 15600 | km 41 — ingresso tombinatura |

> **Nota**: gli ID sensore vanno verificati sull'anagrafica ARPA aggiornata:
> `https://www.dati.lombardia.it/resource/nf78-nj6b.json?$where=nomestazione like '%SEVESO%'`

## Soglie di rischio

Calibrate sull'evento del **22 settembre 2025** (esondazione confermata, >80 mm/h a Paderno).

| Livello | mm/h | cm idrometrico | Evento storico |
|---------|------|----------------|----------------|
| Verde | < 10 | < 80 cm | Condizioni normali |
| Giallo | 10–25 | 80–150 cm | 28/08/2025: vasche attivate, no esondazione |
| Arancione | 25–60 | 150–220 cm | Soglia ARPA arancione |
| Rosso | > 60 | > 220 cm | 22/09/2025: esondazione a Niguarda, Isola, viale Zara |

## Deploy su Vercel (5 minuti)

### Prerequisiti
- Account Vercel gratuito: https://vercel.com
- Node.js installato (solo per Vercel CLI)

### Metodo 1 — Vercel CLI (consigliato)

```bash
npm i -g vercel
cd seveso-monitor
vercel --prod
```

Segui le istruzioni: scegli il team, conferma il progetto. Il deploy avviene in ~30 secondi.

### Metodo 2 — GitHub + Vercel (deploy automatico)

1. Crea un repo GitHub con i file di questo progetto
2. Vai su https://vercel.com/new
3. Importa il repo
4. Vercel rileva automaticamente la configurazione da `vercel.json`
5. Ogni push su `main` rideploya automaticamente

### Metodo 3 — Firebase Hosting

```bash
npm i -g firebase-tools
firebase login
firebase init hosting
# Public directory: public
# SPA: No
firebase deploy
```

Per Firebase, la funzione proxy `/api/arpa.js` va convertita in una Firebase Cloud Function (Node.js).

## Struttura del progetto

```
seveso-monitor/
├── api/
│   └── arpa.js          # Edge Function: proxy ARPA Lombardia
├── public/
│   └── index.html       # Frontend: pagina unica, mobile-first
├── vercel.json          # Configurazione routing Vercel
└── README.md
```

## Architettura

```
Browser → /api/arpa → ARPA Lombardia Socrata API
        ↘ Open-Meteo API (diretto, no proxy)
```

Il proxy è necessario solo per ARPA perché il dominio `dati.lombardia.it` non accetta chiamate CORS dirette da browser. Open-Meteo supporta CORS nativamente.

## Verifica degli ID sensore ARPA

Prima del deploy, verificare che gli ID sensore siano ancora attivi:

```bash
curl "https://www.dati.lombardia.it/resource/nf78-nj6b.json?\$where=nomestazione%20like%20'%25SEVESO%25'&\$select=idsensore,nomestazione,tipologia,storico"
```

Aggiornare gli ID in `api/arpa.js` se necessario.

## Prossimi sviluppi

- [ ] Push notification su allerta giallo/rosso (PWA + Web Push API)
- [ ] Grafico storico livello idrometrico ultime 24h
- [ ] Mappa dei quartieri a rischio (Niguarda, Isola, viale Zara, Ca' Granda)
- [ ] Integrazione bollettino ARPA ufficiale (scraping o RSS)
- [ ] Alert Telegram bot per residenti iscritti

## Disclaimer

Dati non ufficiali. Per emergenze seguire sempre le indicazioni della Protezione Civile del Comune di Milano.
Protezione Civile: 800 061 160 · Emergenze: 112

## Licenza

MIT — libero utilizzo, modifica e redistribuzione con attribuzione.
