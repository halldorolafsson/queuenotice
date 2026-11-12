export function About() {
  return (
    <>
      <h1>Om data og varsler</h1>
      <section className="card">
        <h2>Hvor kommer dataene fra?</h2>
        <p>
          <strong>Statens vegvesen</strong> (DATEX II via åpen WFS): trafikkmeldinger om ulykker, stengte veger, vegarbeid,
          kolonnekjøring og lignende, og målte reisetider på utvalgte strekninger (i Trøndelag rundt Trondheim). Data hentes hvert
          5. minutt. Meldingene vises med Vegvesenets egen norske tekst.
        </p>
        <p className="muted small">
          Inneholder data under Norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen. Vegens geometri
          hentes fra Nasjonal vegdatabank (NVDB), og stedssøk fra Kartverket.
        </p>
        <p>
          <strong translate="no">Google Maps</strong> (når det er slått på): estimert reisetid med sanntidstrafikk for hele
          strekningen din, sammenlignet med normal reisetid. Gir ikke meldinger om ulykker eller stengninger. Spørres bare
          innenfor tidsrommet du har valgt, med tak på antall kall.
        </p>
      </section>
      <section className="card">
        <h2>Hva betyr statusene?</h2>
        <dl>
          <dt>Registrert hendelse</dt>
          <dd>Kilden har en aktiv melding på strekningen, eller målt forsinkelse over terskelen din.</dd>
          <dt>Ingen registrerte hendelser</dt>
          <dd>
            Ferske data, men ingen meldinger her. Det betyr <em>ikke</em> at det er fri flyt – det kan være kø som ingen har meldt.
          </dd>
          <dt>Utdaterte data / Kildefeil</dt>
          <dd>Vi har ikke klart å hente ferske data. Status er ukjent, og varsler om at noe er over sendes ikke.</dd>
          <dt>Pauset</dt>
          <dd>Overvåking er slått av for listen eller strekningen.</dd>
        </dl>
      </section>
      <section className="card">
        <h2>Kø, forsinkelse og hendelser</h2>
        <p>
          En ulykke eller et vegarbeid er en <em>hendelse som kan gi kø</em>, ikke bekreftet kø. «Oppgitt forsinkelse» er Vegvesenets
          estimat i meldingen. «Målt forsinkelse» er beregnet fra faktiske reisetidsmålinger og finnes bare der Vegvesenet måler.
        </p>
      </section>
      <section className="card">
        <h2>Push på iPhone</h2>
        <p>
          Push fungerer på iPhone fra iOS 16.4, men bare når appen er lagt til på Hjem-skjermen (Del → Legg til på Hjem-skjerm) og
          åpnet derfra. På Android og PC fungerer push direkte i Chrome, Edge og Firefox.
        </p>
      </section>
      <section className="card">
        <h2>Demodata</h2>
        <p>
          Når demokilden er slått på, finnes faste eksempelmeldinger langs E6 Sluppen–Moholt i Trondheim. De er alltid merket DEMO og
          er aldri ekte trafikkinformasjon.
        </p>
      </section>
    </>
  );
}
