# Da progetto civico a piattaforma fondativa

> Analisi strategica: cosa servirebbe per trasformare Seveso Monitor da
> singolo sito su un fiume a **infrastruttura di base** su cui chiunque possa
> costruire un monitoraggio idraulico civico per qualsiasi bacino.

---

## La tesi

Oggi esistono due mondi che non si parlano:

1. **I sistemi ufficiali** (ARPA SIDRO/LIRIS, SOL del Politecnico, Protezione Civile): tecnicamente eccellenti, dati validati, modelli calibrati — ma con interfacce per addetti ai lavori e nessuna API pensata per terzi.
2. **I cittadini**: che durante un'allerta cercano disperatamente su Twitter l'ultimo aggiornamento dell'assessore, perché i portali ufficiali sono illeggibili.

In mezzo c'è il vuoto. Ogni volta che un cittadino-sviluppatore vuole costruire qualcosa di utile per il proprio fiume, riparte da zero: scopre quali dataset ARPA esistono, sbatte contro il blocco CORS, reinventa un modello idrologico, ridisegna soglie e UI.

**La tesi è che il valore non sta nel sito sul Seveso, ma nei mattoni riutilizzabili che lo compongono.** Se quei mattoni diventano standard, il prossimo monitoraggio — sul Lambro, sull'Olona, sul Bisagno a Genova, sul Seveso visto da un altro quartiere — nasce in un pomeriggio invece che in due mesi.

---

## I cinque mattoni fondativi

### 1. Schema di configurazione del bacino (config-as-data)

Il singolo asset più importante. Oggi i parametri del Seveso (zone, lag, CN, scala di deflusso, sensori) sono sparsi nel codice. Estraendoli in uno **schema dichiarativo standard**, un nuovo bacino diventa un file di configurazione, non un fork da riscrivere.

```jsonc
// basin.config.json — lo standard proposto
{
  "id": "seveso",
  "nome": "Torrente Seveso",
  "area_km2": 227,
  "citta_protetta": "Milano nord",
  "stazione_critica": { "sensore_id": "8121", "nome": "Paderno Dugnano" },
  "zone": [
    { "id": "montana", "area_km2": 45, "lag_h": 4.0, "cn_secco": 72, "cn_saturo": 82, "impermeabile": 0.20 }
    // ...
  ],
  "scala_deflusso": { "tipo": "power", "a": 8.5, "b": 0.72 },
  "soglie_cm": { "attenzione": 100, "allerta": 180, "pericolo": 300 },
  "opere": {
    "scolmatore": { "attivazione_cm": 100, "q_max_m3s": 30, "saturazione_cm": 320 },
    "vasche": [ { "nome": "Parco Nord", "vol_m3": 250000 } ]
  },
  "punti_pioggia": [ { "nome": "Cavallasca", "lat": 45.83, "lon": 9.05 } ],
  "eventi_calibrazione": [
    { "data": "2025-09-22", "picco_cm": 404, "esondazione": true }
  ]
}
```

Chi conosce il proprio fiume compila questo file; tutto il resto (modello, mappa, UI, soglie) si genera da qui. **Questo è ciò che dà le basi a tutte le altre piattaforme**: trasforma un progetto in un motore.

### 2. Libreria del modello idrologico (pacchetto indipendente)

Estrarre `hydro-model.js` come pacchetto npm/ESM autonomo, `@hydro-civic/scs-model`, con:
- input = `basin.config.json` + serie di pioggia
- output = idrogramma previsto + livello + incertezza
- zero dipendenze dal DOM, testabile, versionabile

Così il modello vive di vita propria: usabile in un sito, in un bot, in una pipeline di backtesting, in un notebook di ricerca. È il passaggio da "codice in un file HTML" a "componente software citabile".

### 3. Layer di accesso ai dati normalizzato

Il proxy `api/arpa.js` risolve un problema che **ogni** progetto su dati ARPA incontra: il blocco CORS e l'eterogeneità dei dataset Socrata. Generalizzarlo in un adapter normalizzato significa che nessuno deve più scoprire da sé che `647i-nhxk` è realtime ma incompleto e `3e8b-w7ay` è validato ma in ritardo.

```
adapter ARPA  ─┐
adapter Open-Meteo ─┼─→  formato unico { stazione, ts, valore, fonte, latenza }
adapter LIRIS ─┘
```

Un dizionario pubblico e mantenuto degli **ID sensore per fiume** (oggi reverse-engineered a fatica) sarebbe un bene comune di per sé.

### 4. Storico come bene comune (event store)

Oggi lo storico vive nel `localStorage` del singolo browser e si perde. Un **event store condiviso** minimale (append-only: ogni volta che il rischio supera una soglia, si registra timestamp + livello + pioggia) abilita tre cose che oggi mancano a *tutti*, compresi i sistemi ufficiali nella loro forma pubblica:

- **Auto-calibrazione**: più eventi osservati → soglie e CN affinati sui dati reali del bacino
- **Backtesting**: "il modello avrebbe previsto l'esondazione del 22/09?" diventa una query
- **Memoria civica**: un archivio pubblico e verificabile di cosa è successo e quando

Costo: vicino a zero (Vercel KV / Supabase free tier, append di poche righe per evento).

### 5. Canale di notifica disaccoppiato

Il modello calcola il rischio; *come* avvisare le persone deve essere un layer separato e pluggable: Web Push, bot Telegram, webhook, RSS. Disaccoppiare "calcolo del rischio" da "consegna dell'avviso" significa che lo stesso motore serve un sito, un canale Telegram di quartiere e un'integrazione con i pannelli a messaggio variabile del Comune, senza modifiche al cuore.

---

## Architettura obiettivo

```
        basin.config.json  (uno per fiume — il contratto)
                 │
   ┌─────────────┼──────────────┐
   │             │              │
data-adapters  hydro-model   thresholds
(ARPA, Meteo)  (@scs-model)  (soglie+decay)
   │             │              │
   └─────────────┼──────────────┘
                 ▼
          rischio calcolato
                 │
   ┌─────────────┼──────────────┬───────────────┐
   ▼             ▼              ▼               ▼
   UI web      Telegram      Web Push        event-store
 (questo sito)   bot         notifiche      (backtesting +
                                             auto-calibrazione)
```

Il sito attuale diventa **una** delle viste possibili sopra un nucleo riutilizzabile, non il prodotto.

---

## Perché è credibile (e non over-engineering)

Il progetto attuale **già contiene in nuce** tutti e cinque i mattoni — solo non ancora estratti:

| Mattone | Stato oggi | Lavoro per estrarlo |
|---|---|---|
| Config bacino | Parametri hardcoded ma completi | Spostarli in un JSON |
| Modello idrologico | `hydro-model.js` già isolato e documentato | Pubblicarlo come pacchetto |
| Data adapter | `api/arpa.js` funzionante | Generalizzare le fonti |
| Event store | `localStorage` (locale) | Spostare su KV condiviso |
| Notifiche | Assenti | Layer nuovo, ma standard (Web Push) |

Non è una riscrittura: è una **rifattorizzazione incrementale** di qualcosa che già funziona. Ogni passo ha valore autonomo anche se ci si ferma lì.

---

## Sequenza consigliata

1. **Estrai `basin.config.json`** dal Seveso. Subito: dimostra che il sito è un'istanza di qualcosa di più generale.
2. **Aggiungi l'event store** e inizia ad accumulare eventi reali. Il valore cresce nel tempo, quindi prima si parte meglio è.
3. **Notifiche Telegram**, perché è il canale a più alta penetrazione e più basso sforzo, e perché chiude il gap "devo aprire il sito durante l'emergenza".
4. **Backtesting** sullo storico ARPA: è ciò che trasforma le soglie da "stimate su 3 eventi" a "validate sui dati".
5. **Secondo bacino** (es. Lambro o Olona) come prova del nove: se nasce solo compilando un config, lo standard funziona.

---

## La metrica del successo

Non "quante persone visitano il sito del Seveso", ma:

> **Quanto tempo serve a una persona competente per mettere online un monitoraggio civico per un fiume che non abbiamo mai considerato.**

Se la risposta passa da *settimane* a *un pomeriggio*, allora il progetto è diventato fondativo.
