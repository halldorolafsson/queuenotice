# Varslingslogikk

Reglene ligger i `backend/src/domain/alertRules.ts` og er testet i `backend/test/alertRules.test.ts`.

## Hva kan utløse varsel

Hver aktiv melding eller reisetid som treffer en strekning, blir en **kandidat**. Den har en nøkkel (`ev:<kilde>:<id>` eller `tt:<kilde>:tt:<id>`), en kategori, en alvorlighetsgrad, en eventuell forsinkelse og et «fingeravtrykk» av teksten.

En kandidat varsles bare når **alle** disse er oppfylt:

1. Kilden har ferske data (vellykket henting nyere enn `STALE_AFTER_MINUTES`, standard 15).
2. Hendelsen er aktiv nå. Planlagte meldinger og perioder som ikke har startet, varsles ikke.
3. Kategorien er valgt under **Varsler**.
4. Retningen passer: begge retninger, din retning, eller ukjent retning hvis du har valgt det.
5. Forsinkelsen er over terskelen:
   - **Reisetider** varsles bare når målt forsinkelse er minst lik terskelen.
   - **Meldinger** med oppgitt forsinkelse under terskelen varsles ikke, **unntatt stengt veg**, som alltid varsles.
   - **Meldinger uten forsinkelse** varsles etter kategori.
6. Listen og strekningen er aktive, og klokka (Europe/Oslo) er innenfor listens tidsrom.

## Én melding per hendelse

`alert_state` husker per strekning og nøkkel om du har fått varsel, når det skjedde, og hvilken kategori, alvorlighetsgrad, forsinkelse og tekst varselet hadde. Samme hendelse gir ikke nytt varsel før noe vesentlig har endret seg.

## Ny melding ved vesentlig endring

| Endring | Ny melding |
| --- | --- |
| Endres til **stengt veg** | Straks |
| **Høyere alvorlighetsgrad** | Straks |
| Forsinkelsen endres med **minst 5 min og minst 30 %** | Tidligst 10 min etter forrige melding |
| Bare **teksten** er endret | Tidligst 30 min etter forrige melding |

## Når hendelsen er over

- En hendelse regnes som over når den ikke lenger finnes i en **vellykket** henting fra kilden, eller ikke lenger er aktiv.
- En kø fra reisetider regnes som over først når forsinkelsen er **under halve terskelen**. Det hindrer flimring rundt terskelen.
- Du får melding om at hendelsen er over bare hvis du fikk varsel om den, har valgt «Gi beskjed når en varslet hendelse er over», og det er innenfor tidsrommet.
- **Kildefeil eller utdaterte data tolkes aldri som at hendelsen er over.** Tilstanden står urørt til kilden svarer igjen.

## Tidsrom og pause

- Utenfor tidsrommet sendes ingenting. En hendelse som fortsatt er aktiv når tidsrommet starter, varsles da som ny.
- Er listen eller strekningen pauset, sendes ingenting, heller ikke melding om at noe er over.
- Tidsrom som går over midnatt (for eksempel 22:00–02:00) gjelder fra startdagen.

## Innhold i varselet

```text
Stengt veg – Tonstad – Ranheim
Strekning: E6 Tonstad – Ranheim (kjøreretning mot Ranheim)
Hendelse: Stengt veg. Vegarbeid, vegen er stengt.
Sted: E6 Grillstadtunnelen i Trondheim, Trøndelag
Forsinkelse: ca. 30 min (oppgitt av kilden)
Kilde: Statens vegvesen, oppdatert 15.10, 22:01
```

Varsler fra demodata får `[DEMO]` i tittelen og teksten «DEMODATA – ikke ekte trafikkinformasjon». Målte reisetider får tittelen «Målt forsinkelse».

## Kanaler

| | Push (Web Push) | E-post |
| --- | --- | --- |
| Kostnad | Gratis (VAPID) | Avhenger av SMTP-tjeneste |
| Hastighet | Sekunder | Sekunder til minutter |
| iPhone | iOS 16.4+, **bare som Hjem-skjerm-app**. Apple kan droppe abonnement etter lang tids inaktivitet. | Virker overalt |
| Android/PC | Chrome, Edge og Firefox | Virker overalt |
| Krav | HTTPS | SMTP-konto og avsenderdomene for god leveranse |

**Anbefaling:** Start med push, fordi trafikkvarsler må komme raskt og push er gratis. Legg til e-post som reserve. Utløpte push-abonnement (HTTP 404/410) fjernes automatisk.

I testmodus (`NOTIFY_MODE=dry-run`) logges alt med status «Ikke sendt (testmodus)», slik at du kan se nøyaktig hva som *ville* blitt sendt.
