# Trafikkilder

Undersøkt 15.10.2026. «Verifisert» betyr at vi har gjort faktiske kall fra denne PC-en eller lest gjeldende offisiell dokumentasjon.

## Viktig skille

| Type | Eksempel | Hvordan appen viser det |
| --- | --- | --- |
| **Målt forsinkelse** | Vegvesenets reisetider: faktisk mot normal reisetid | «Målt forsinkelse +12 min» |
| **Oppgitt forsinkelse** | `impactDelayTime` i en trafikkmelding (estimat) | «Oppgitt forsinkelse ca. 30 min (estimat fra kilden)» |
| **Hendelse som kan gi kø** | Ulykke, vegarbeid, stengt veg, kolonnekjøring | Vises som hendelse, ikke som bekreftet kø |
| **Ingen melding** | — | «Ingen registrerte hendelser – betyr ikke nødvendigvis fri flyt» |

## 1. Statens vegvesen – primærkilde i MVP (verifisert)

**Trafikkmeldinger og reisetider (DATEX II 3.1)**

- **Data:** Ulykker, havarerte kjøretøy, vegarbeid, stengte veger, omkjøring, feltstengning, lysregulering, kolonnekjøring, føreforhold og ferjeinformasjon (`SituationSimple`). Reisetider med faktisk og forventet tid i sekunder (`TravelTimeSimple`).
- **Dekning:** Hele landet. Vi henter et utsnitt for Trøndelag med `bbox=8.5,62.2,14.5,65.5`. Ved test 15.10.2026 inneholdt utsnittet 346 meldingsposter (≈150 situasjoner) og 26 reisetidsstrekninger rundt Trondheim (E6 Okstadbakken–Ranheim, Rv706, Fv6690 med flere).
- **Tilgang:**
  - *Åpen WFS (brukes):* `https://ogckart-sn1.atlas.vegvesen.no/datex_3_1/ows`, GeoJSON med geometri. Krever ingen nøkkel. Vegvesenet ber om at brukere identifiserer seg på e-post til datex@vegvesen.no.
  - *REST/SOAP (alternativ):* `datex-server-get-v3-1.atlas.vegvesen.no`, XML med Basic Auth. Krever gratis registrering på vegvesen.no («Bestill tilgang til DATEX»). Vi fikk HTTP 401 uten tilgang, som forventet.
- **Kostnad:** Gratis.
- **Vilkår:** NLOD. Kilden må oppgis, og det gjør appen nederst på oversikten. Informasjonen må ikke forvrenges, og **norske meldinger skal ikke oversettes**, så vi viser originalteksten. Brukernavn og passord til REST-tjenesten skal ikke deles videre (gjelder ikke WFS).
- **Oppdatering:** Reisetider hvert 5. minutt ifølge dokumentasjonen. Meldinger oppdateres løpende. Vi henter hvert 5. minutt.
- **Tidsstempler:** `startTime`, `endTime`, `lastUpdateTime` og `activePeriods` (konkrete perioder, for eksempel «tirsdager 22–06»), samt `validAtTime` for reisetider.
- **Kjente begrensninger:**
  - Feeden inneholder også **planlagte** meldinger fram i tid. Appen skiller mellom aktiv, planlagt og utløpt ved hjelp av perioder og start/slutt.
  - `SituationSimple` har ikke kjøreretning. Den hentes fra den fullstendige `Situation`-meldingen (`alertCAffectedDirection`: `both`/`aligned`/`opposite`), med ett oppslag per ny versjon. Noen meldinger, for eksempel i tunneler, har ingen retningsinformasjon.
  - Mange reisetidsstrekninger mangler målinger i perioder (`actualTime` er tom). Appen viser da «mangler ferske målinger».
  - Reisetider finnes bare på utvalgte strekninger. Utenfor disse finnes ingen målt forsinkelse fra Vegvesenet.
  - Vegvesenet merker reisetidene `travelTimeType: estimated`, fordi de beregnes fra passeringer. Vi omtaler dem som «målt reisetid», siden de bygger på faktiske passeringer og ikke på modellprognoser.
- **Feiltilfeller:** Tidsavbrudd (20 s), 5xx og 429 gir to nye forsøk (etter 1 s og 3 s). En kilde som feiler, markeres med «Kildefeil». Hendelser regnes aldri som over på grunnlag av en mislykket henting.

**NVDB API Les v4** (vegens geometri)

- `/vegnett/api/v4/posisjon` finner nærmeste punkt på en bestemt veg (maks 200 m). `/vegnett/api/v4/beta/vegnett/rute` gir sammenhengende rute langs vegen mellom to punkter.
- Åpent og gratis, men krever headeren `X-Client`. Testet: E6 Okstadbakken–Ranheim ga 10,8 km, 68 segmenter, status `KOMPLETT`. Ruteendepunktet er merket **beta**.
- Ligger et valgt sted mer enn 200 m fra vegen, faller appen tilbake til rett linje og sier tydelig fra.

## 2. Google Maps Platform – Routes API (bygd, krever nøkkel)

- **Data:** `computeRoutes` med `routingPreference: TRAFFIC_AWARE` gir `duration` (med sanntidstrafikk) og `staticDuration` (historisk normal). Forsinkelse = `duration − staticDuration`. Dette er et **estimat** fra Googles trafikkmodell, ikke en melding. Routes API gir **ikke** ulykker, vegarbeid eller stengninger; de kommer fortsatt fra Vegvesenet.
- **Dekning:** Hele Norge, alle veger. Det er den største fordelen sammenlignet med Vegvesenets reisetider.
- **Tilgang:** Google Cloud-prosjekt med **fakturering aktivert**, Routes API slått på, og en API-nøkkel begrenset til Routes API.
- **Pris (gjeldende prisliste, 10/2026):** Trafikkbevisste kall faktureres som *Routes: Compute Routes Pro*. 5 000 kall per måned er gratis, deretter 10 USD per 1 000 kall.
  - Eksempel: 2 strekninger hvert 10. minutt i 2 timer per hverdag ≈ 2 × 12 × 22 = 528 kall per måned.
  - Samme hvert 5. minutt hele døgnet ≈ 17 000 kall per måned ≈ 120 USD. Derfor kreves tidsrom som standard.
- **Grenser:** 3 000 kall i minuttet. Vilkårene begrenser mellomlagring og krever at «Google Maps» står ved innholdet. Les «Google Maps Platform EEA Terms of Service» og «Road Safety Requirements», siden fakturaadressen er i EØS.

**Slik er det bygd** (`backend/src/traffic/googleRoutes.ts`):

- Ett kall per strekning og retning: fra start til slutt langs vegens geometri, med opptil 8 «via»-punkter slik at Google må følge samme veg og ikke velger en annen rute.
- Er Googles rute mer enn 25 % (+ 500 m) lengre enn strekningen, forkastes estimatet og vises som «Google foreslo en annen rute (kan skyldes stengning eller omkjøring)».
- Resultatet lagres som en reisetid knyttet til **akkurat den strekningen**, merket «estimert». Oversikten viser det separat fra Vegvesenets målte reisetider, med «Google Maps» som kildemerking.
- Varsler bruker samme terskel og regler som målte reisetider, med tittelen «Estimert forsinkelse».
- Estimater slettes etter 24 timer.

**Kostnadsvern (alle i `.env`):**

| Innstilling | Standard | Virkning |
| --- | --- | --- |
| `GOOGLE_ROUTES_REQUIRE_SCHEDULE` | `true` | Bare lister med valgt tidsrom spørres |
| `GOOGLE_ROUTES_MIN_INTERVAL_MINUTES` | `10` | Minst 10 min mellom kall per strekning og retning |
| `GOOGLE_ROUTES_MAX_CALLS_PER_DAY` | `150` | Stopper for dagen; kilden vises som «Kildefeil» med forklaring |
| `GOOGLE_ROUTES_MAX_CALLS_PER_MONTH` | `4500` | Holder deg under gratiskvoten på 5 000 |

Pauserte strekninger og tid utenfor tidsrommet gir ingen kall. Kall telles i tabellen `api_usage` før de sendes, slik at også feilede kall regnes med. Sett i tillegg en daglig kvote og et budsjettvarsel i Google Cloud Console som et ekstra, hardt tak.

## 3. Politiet – politiloggen (ikke bygd)

- Politiloggen vises på politiet.no og i egne apper, og inneholder trafikkhendelser (for eksempel «kjørestans på E6 ved Fiborgtangen», sett 15.10.2026).
- `api.politiet.no` finnes i DNS, men tilkoblingen feilet fra dette nettverket. Vi fant **ingen offentlig dokumentert API eller vilkår** i data.norge.no. Nettsiden skal ikke skrapes.
- **Anbefaling:** Spør Politiet om det finnes en offentlig API og hvilke vilkår som gjelder, før noe bygges. Datamodellen er klar: meldinger fra flere kilder slås sammen (`domain/dedupe.ts`), og Vegvesenet foretrekkes.

## 4. Lokalaviser i Trøndelag (ikke bygd)

- Adresseavisen, Trønder-Avisa, NRK Trøndelag og andre publiserer trafikksaker, men det meste ligger bak betalingsmur eller er redaksjonelt innhold uten API for gjenbruk.
- RSS-feeder kan finnes, men bruk i en app krever at vilkårene tillater det. Tekst og overskrifter er opphavsrettslig beskyttet. Vi skal ikke omgå betalingsmurer.
- **Anbefaling:** Lav prioritet. Hvis det ønskes: bare lenker eller overskrifter fra feeder med vilkår som tillater det, vist som «nyhet», aldri som bekreftet trafikkstatus.

## Utvidbarhet

**Skru kilder av og på:**

- *Serveren* bestemmer hvilke kilder som finnes, med `TRAFFIC_SOURCES` i `.env` (lokalt) eller i `02-deploy.ps1` (skyen).
- *Hver bruker* kan slå av kilder for sine egne strekninger under **Varsler → Datakilder**. En avslått kilde brukes ikke i oversikt eller varsler. Google spørres heller ikke for den brukerens strekninger, så det koster ingenting. Minst én kilde må være på.
- Bruker du bare Google, mister du meldinger om stengte veger, ulykker og vegarbeid. Da får du bare estimert forsinkelse.

En ny kilde implementerer `TrafficSource` (`backend/src/traffic/types.ts`) og registreres i `traffic/registry.ts`. Kilden leverer normaliserte `TrafficEvent`/`TravelTime` med `source`-felt. Matching, deduplisering, status og varsling fungerer da uten endringer.
