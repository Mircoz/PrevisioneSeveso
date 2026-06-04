# Seveso Monitor

**Monitoraggio civico e previsione del rischio esondazione del torrente Seveso per i quartieri nord di Milano.**

Un progetto civico, non ufficiale e open source che raccoglie dati pubblici già esistenti — precipitazioni e livelli idrometrici — e li traduce in informazione comprensibile per chi vive a Niguarda, Pratocentenaro, Ca'Granda, Isola, viale Zara e nei comuni a monte.

🔗 **Demo live:** https://previsione-seveso.vercel.app
📊 **Stato:** MVP funzionante · in evoluzione

---

## Indice

1. [Perché esiste](#perché-esiste)
2. [Cosa fa](#cosa-fa)
3. [Architettura](#architettura)
4. [Fonti dati](#fonti-dati)
5. [Il modello idrologico](#il-modello-idrologico)
6. [Soglie e calibrazione](#soglie-e-calibrazione)
7. [Struttura del progetto](#struttura-del-progetto)
8. [Deploy](#deploy)
9. [Configurazione](#configurazione)
10. [Limiti noti e onestà intellettuale](#limiti-noti-e-onestà-intellettuale)
11. [Roadmap](#roadmap)
12. [Licenza e disclaimer](#licenza-e-disclaimer)

---

## Perché esiste

Il Seveso è uno dei fiumi che esonda più spesso in Italia: **oltre 120 esondazioni in 50 anni**. Attraversa una delle aree più cementificate d'Europa, dove la pioggia non viene assorbita dal suolo e converge tutta nel fiume.

I dati per capire il rischio **esistono già**: ARPA Lombardia pubblica i livelli idrometrici, Open-Meteo fornisce le previsioni di pioggia. Ma sono dispersi su portali tecnici (SIDRO, LIRIS), espressi in linguaggio specialistico (percentuali di criticità, quote slm, zero idrometrico), e inaccessibili a un residente che alle 6 del mattino vuole solo sapere: **devo preoccuparmi adesso?**

Esiste un sistema di previsione professionale (SOL del Politecnico di Milano) che fa previsioni a 24–36 ore, ma la sua interfaccia è pensata per i tecnici della Protezione Civile, non per i cittadini.

**Seveso Monitor colma questo gap**: stessi dati, linguaggio umano, una sola domanda in cima alla pagina con una risposta a colori.

---

## Cosa fa

### Sopra la piega (risposta immediata)
- **Stato sintetico** a colori: Tutto bene 🟢 / Tieniti aggiornato 🟡 / Rischio alto 🟠 / Pericolo 🔴
- **3 indicatori chiave**: mm/h attuali, mm accumulati nelle ultime 3h, livello idrometrico a Paderno
- **Mappa interattiva** del bacino con tratti del fiume colorati per rischio e marker semaforici sui punti chiave

### Sotto la piega (dettaglio)
- **Cosa fare in caso di allerta** — istruzioni pratiche + numeri di emergenza
- **Livello del fiume** — tre stazioni ARPA con barra di posizionamento rispetto alle soglie
- **Andamento ultime 3h** — grafico del livello idrometrico costruito lato client
- **Dove sta piovendo** — grafico e griglia per i 9 comuni del bacino
- **Vasche di protezione** — stima della capacità residua delle vasche di laminazione
- **Modello idrologico 24h** — previsione del livello atteso a Paderno con banda di incertezza, effetto del canale scolmatore e contributo per zona del bacino
- **Storico eventi** — i precedenti documentati per dare contesto
- **Multilingua** IT/EN, **auto-refresh** ogni 10 minuti

---

## Architettura

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER (index.html — HTML + CSS + JS vanilla, zero build)   │
│                                                               │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  Open-Meteo  │   │  /api/arpa   │   │   localStorage   │  │
│  │  (diretto,   │   │  (proxy edge │   │  storico piogge  │  │
│  │   CORS ok)   │   │   function)  │   │  + livelli 3h    │  │
│  └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘  │
│         │                  │                    │            │
│         └──────────────────┴────────────────────┘            │
│                            │                                 │
│                  ┌─────────▼──────────┐                      │
│                  │  Modello idrologico │  (SCS-CN + routing)  │
│                  │  + render UI        │  Chart.js + Leaflet  │
│                  └────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
                             │
                  ┌──────────▼───────────┐
                  │  Vercel Edge Function │
                  │  api/arpa.js          │
                  │  → dati.lombardia.it  │  (bypassa il blocco CORS)
                  └───────────────────────┘
```

**Scelte progettuali:**

- **Nessun build step.** Un solo file `index.html` con CSS e JS inline. Apri, modifichi, fai commit. Niente npm, webpack, framework. Questo rende il progetto immediatamente forkabile e mantenibile da chiunque.
- **Nessun database.** Lo storico (precipitazioni e livelli delle ultime 3h) vive nel `localStorage` del browser dell'utente. Zero costi di backend, zero privacy concerns.
- **Una sola serverless function.** `api/arpa.js` esiste solo perché il dominio `dati.lombardia.it` blocca le richieste cross-origin dal browser. Open-Meteo invece è CORS-friendly e viene chiamato direttamente.
- **Resiliente ai guasti.** Se ARPA non risponde, il rischio si calcola sulle sole precipitazioni. Se il grafico idrometrico non ha dati, mostra un fallback con link a SIDRO. Ogni fetch ha timeout e fallback.

---

## Fonti dati

| Fonte | Cosa fornisce | Accesso | Note |
|---|---|---|---|
| **Open-Meteo** | Precipitazioni orarie e previsioni 48h per 9 punti del bacino | API REST diretta (no key, CORS ok) | `forecast?hourly=precipitation` |
| **ARPA Lombardia** (Open Data) | Livello idrometrico delle stazioni | Via Edge Function proxy | Dataset Socrata, vedi sotto |
| **localStorage** | Storico 3h di piogge e livelli | Browser dell'utente | Accumulato ad ogni refresh |

### Dataset ARPA utilizzati

| Dataset | ID Socrata | Contenuto | Latenza |
|---|---|---|---|
| Dati sensori meteo | `647i-nhxk` | Sensori meteo realtime (10 min) | Bassa, ma copertura idrometrica incerta |
| Livello idrometrico dal 2021 | `3e8b-w7ay` | Livelli idrometrici validati | Validazione fino al 30/6 di ogni anno |
| Anagrafica sensori | `nf78-nj6b` | Registro stazioni e ID sensori | Statica |

### Stazioni idrometriche monitorate

| ID sensore | Stazione | km dalla sorgente | Ruolo |
|---|---|---|---|
| `22307` | Seveso c.so Isonzo | 18 | Anticipo 3–4h su Milano |
| `8121` | Seveso a Paderno Dugnano Palazzolo | 32 | **Stazione critica** — alla presa del canale scolmatore |
| *(dinamico)* | Cusano / Cormano | 38 | Pre-Milano, ricerca per nome |

> **Nota su Paderno (8121):** è posizionata al nodo idraulico di Palazzolo, **a monte** della presa del Canale Scolmatore di Nord Ovest. Misura quindi il livello del Seveso *prima* che parte dell'acqua venga deviata verso il Ticino — il che la rende il punto ideale per stimare cosa arriverà a Milano.

### I 9 comuni del bacino (per le precipitazioni)

Cavallasca (sorgente) · Seveso · Cesano Maderno · Varedo · Paderno Dugnano · Cusano Milanino · Cormano · Bresso · Niguarda (Milano).

---

## Il modello idrologico

Il cuore tecnico del progetto è una catena modellistica a tre stadi che trasforma le previsioni di pioggia in una stima del livello idrometrico atteso a Paderno. Implementa, in forma semplificata ma fondata, lo stesso approccio degli studi ufficiali (Autorità di Bacino del Po, AIPo).

### Stadio 1 — Trasformazione pioggia → deflusso (SCS-CN)

Il metodo **Soil Conservation Service – Curve Number** è lo standard internazionale per stimare quanta pioggia diventa deflusso superficiale.

```
S  = (25400 / CN) - 254        # capacità massima di infiltrazione [mm]
Ia = 0.2 x S                    # perdita iniziale [mm]
Qe = (P - Ia)^2 / (P - Ia + S)  # deflusso effettivo [mm]   (per P > Ia)
```

Il **Curve Number** è calibrato per ciascuna delle 4 zone del bacino e corretto stagionalmente (suolo più saturo in autunno-inverno → CN più alto → più deflusso):

| Zona | Comuni | Area | Lag time | CN secco | CN saturo | % impermeabile |
|---|---|---|---|---|---|---|
| Montana | Cavallasca, Seveso | 45 km² | 4.0 h | 72 | 82 | 20% |
| Brianza | Cesano, Varedo | 82 km² | 2.5 h | 80 | 88 | 55% |
| Periurbana | Paderno, Cusano, Cormano | 60 km² | 1.5 h | 86 | 92 | 75% |
| Urbana | Bresso, Niguarda | 40 km² | 0.5 h | 91 | 95 | 90% |

La frazione impermeabile entra come media pesata: `CN = CN_base × (1 − urb) + 98 × urb`. La zona urbana, quasi totalmente impermeabile, è quella che amplifica di più le piene — la ragione fisica per cui il Seveso esonda così spesso.

### Stadio 2 — Routing idrologico (idrogramma triangolare)

Ogni zona genera un **idrogramma unitario triangolare** SCS in risposta al deflusso, con tempo al picco pari al lag time della zona:

```
Qp = 0.208 x A[km2] x Qe[mm] / Tp[h]   # portata al picco [m3/s]
Tb = 2.67 x Tp                          # base dell'idrogramma [h]
```

I contributi delle 4 zone vengono sommati con i rispettivi ritardi di corrivazione, più una componente di **recessione esponenziale** dalla portata attuale (τ = 12h) e un termine inerziale dalla velocità di salita misurata.

### Stadio 3 — Scala di deflusso (portata → livello)

Conversione portata → livello idrometrico a Paderno tramite legge di potenza, calibrata su tre punti storici documentati:

```
h[cm] = 8.5 x Q[m3/s]^0.72
```

| Evento | Portata stimata | Livello osservato |
|---|---|---|
| Baseflow estivo | ~1.5 m³/s | ~−20 cm |
| 31/10/2023 (esondazione) | ~80 m³/s | ~250 cm |
| 22/09/2025 (record) | ~200 m³/s | **404 cm** |

### Canale Scolmatore di Nord Ovest (CSNO)

Il modello tiene conto del canale scolmatore come **opera passiva**: si attiva per gravità quando il Seveso supera ~100 cm a Paderno, deviando fino a 30 m³/s verso il Ticino. Non esiste un sensore pubblico del canale, ma il suo comportamento è fisicamente determinato dal livello:

```
h < 100 cm   -> scolmatore inattivo, tutta l'acqua va a Milano
100-320 cm   -> attivo, devia linearmente fino a 30 m3/s
h > 320 cm   -> saturo (es. 22/09/2025: 404 cm -> esondazione nonostante scolmatore)
```

Il grafico di previsione mostra **due curve**: il livello lordo a Paderno e il livello effettivo verso Milano *dopo* la laminazione dello scolmatore.

### Vasche di laminazione (stima indiretta)

Le vasche (Parco Nord 250.000 m³, Senago 1.200.000 m³, Lentate non operativa) **non hanno sensori pubblici**. La capacità residua viene stimata indirettamente dall'accumulo di pioggia degli ultimi 5 giorni nel `localStorage`, sapendo che una vasca impiega fino a 6 giorni per svuotarsi dopo un evento. È dichiaratamente un'approssimazione.

### Output

La previsione a 24h include: livello centrale stimato, **banda di incertezza ±35%** (tipica per modelli non tarati su misure dirette di portata), soglie di attenzione/esondazione, contributo percentuale di ogni zona al picco, e stato del canale scolmatore.

---

## Soglie e calibrazione

### Soglie idrometriche a Paderno (cm)

| Soglia | Livello | Significato |
|---|---|---|
| Attenzione | > 100 cm | Livello in crescita, monitorare |
| Allerta | > 180 cm | Soglia di allerta |
| Pericolo | > 300 cm | Esondazione probabile |
| Tombinatura Milano | ~130 cm (~35 m³/s) | Capacità idraulica della tombinatura |

### Soglie precipitazioni (con decay temporale)

Il rischio da pioggia usa un **accumulo pesato esponenzialmente** (τ = 60 min): i mm caduti di recente pesano più di quelli di ore fa. Questo evita falsi allarmi quando ha smesso di piovere ma l'accumulo grezzo delle 3h è ancora alto.

| Rischio | Condizione |
|---|---|
| Rosso | max 1h ≥ 60 mm/h **oppure** accumulo 3h pesato ≥ 70 mm |
| Arancione | max 1h ≥ 31 mm/h **oppure** accumulo 3h pesato ≥ 40 mm |
| Giallo | max 1h ≥ 8 mm/h e accumulo pesato ≥ 12 mm, **oppure** max 1h ≥ 15 mm/h |
| Verde | altrimenti |

Calibrazione basata su: **31/10/2023** (31 mm/h → esondazione), **28/08/2025** (30–40 mm/h ma vasche capienti → nessuna esondazione), **22/09/2025** (>80 mm/h, 212 mm nel Comasco → esondazione record).

---

## Struttura del progetto

```
seveso-monitor/
├── index.html          # App completa: HTML + CSS + JS inline (~1900 righe)
├── api/
│   └── arpa.js         # Vercel Edge Function — proxy verso ARPA Lombardia
├── hydro-model.js      # Modello idrologico SCS-CN documentato (standalone/reference)
├── vercel.json         # Config Vercel ({ "version": 2 })
└── README.md           # Questo file
```

> `hydro-model.js` è la versione di riferimento, documentata e isolata, del modello idrologico. La versione effettivamente eseguita è inline in `index.html` per evitare un build step. Le due vanno tenute allineate.

---

## Deploy

Il progetto è pensato per **Vercel** (gratuito per uso personale), ma funziona su qualsiasi host che supporti funzioni serverless.

### Opzione A — GitHub + Vercel (consigliata)

1. Forka/crea il repository su GitHub
2. Vai su [vercel.com/new](https://vercel.com/new) e importa il repo
3. Nessuna configurazione necessaria: Vercel rileva automaticamente `api/` e `index.html`
4. Deploy → online in ~30 secondi

### Opzione B — Vercel CLI

```bash
npm i -g vercel
cd seveso-monitor
vercel --prod
```

### Struttura richiesta

`api/arpa.js` e `index.html` devono stare nella **root** del progetto (non in `/public`). Vercel tratta automaticamente i file in `api/` come serverless function e serve `index.html` come pagina statica.

---

## Configurazione

Tutta la configurazione è in cima a `index.html` e in `api/arpa.js`:

```javascript
// index.html — i 9 comuni del bacino
const COMUNI = [
  { name:"Cavallasca", lat:45.8314, lon:9.0514 },
  // ...
];

// api/arpa.js — stazioni idrometriche e soglie
const STAZIONI = [
  { id:"22307", label:"Seveso c.so Isonzo", km:18 },
  { id:"8121",  label:"Paderno Dugnano",    km:32 },
];
const SOGLIE = { giallo:100, arancione:180, rosso:300 };
```

> **Per adattare il progetto a un altro fiume/bacino:** servono i punti di campionamento pioggia (lat/lon), gli ID dei sensori idrometrici ARPA, i parametri delle zone (area, lag, CN) e la scala di deflusso calibrata sulla stazione critica. Vedi la sezione Roadmap per l'idea di rendere questo processo configurabile.

---

## Limiti noti e onestà intellettuale

Questo progetto è costruito sul principio di **dire sempre la verità sui propri limiti**. Non è uno strumento ufficiale e non deve sostituire i canali di allerta della Protezione Civile.

- **Non è una previsione idrologica ufficiale.** Il modello SCS-CN è semplificato e non tarato su misure dirette di portata. L'errore assoluto sul livello può essere ±50–80 cm. Sono affidabili la *direzione* del trend e l'*ordine di grandezza*, non il centimetro.
- **I dati idrometrici ARPA hanno latenza.** Il dataset validato (`3e8b-w7ay`) non è realtime; quello realtime (`647i-nhxk`) potrebbe non contenere tutti i sensori idrometrici. Quando i dati mancano, l'app lo dichiara e rimanda a SIDRO.
- **Vasche e scolmatore sono stimati, non misurati.** Nessun sensore pubblico li espone. Sono inferenze fisiche, dichiarate come tali.
- **Lo storico è locale.** Vive nel `localStorage` del browser: si azzera se l'utente cancella i dati o cambia dispositivo.
- **Per le emergenze, chiama sempre il 112.** Questo sito è un complemento informativo, non un sistema di allertamento certificato.

---

## Roadmap

Idee in ordine di impatto. Vedi anche `PLATFORM.md` per la visione di lungo periodo.

**Breve termine**
- [ ] Notifiche push (Web Push API) per il passaggio di soglia — la feature singola più utile
- [ ] Canale Telegram bot con avvisi automatici al cambio di livello
- [ ] Persistenza dello storico eventi su KV store (Vercel KV / Supabase free tier) per auto-calibrazione nel tempo

**Medio termine**
- [ ] Schema dati aperto e riusabile per altri bacini (config-as-data)
- [ ] Libreria del modello idrologico estratta come pacchetto npm indipendente
- [ ] Validazione del modello contro lo storico ARPA (backtesting automatico)

**Lungo termine**
- [ ] Granularità iperlocale per via/quartiere (Niguarda ≠ viale Sarca)
- [ ] Integrazione con feed dati ufficiali su richiesta a MM SpA / Comune di Milano
- [ ] Generalizzazione a una piattaforma multi-bacino (vedi PLATFORM.md)

---

## Licenza e disclaimer

**Progetto civico, non ufficiale, senza scopo di lucro.**

I dati provengono da Open-Meteo (CC-BY) e ARPA Lombardia / Regione Lombardia (Open Data). Questo strumento non è affiliato né approvato da ARPA, dal Comune di Milano, dalla Protezione Civile o da qualsiasi ente pubblico.

**In caso di emergenza chiama il 112.** Per le allerte meteo ufficiali consulta [ARPA Lombardia](https://www.arpalombardia.it) e il [sistema di allertamento regionale](https://allertalom.regione.lombardia.it).

---

*Costruito per i residenti di Milano nord. Se ti è utile, condividilo con i tuoi vicini.*
