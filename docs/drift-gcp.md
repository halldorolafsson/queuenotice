# Drift i Google Cloud (GCP)

> Skriptene i `deploy/gcp/` oppretter ressurser i prosjektet `runprice` som kan koste noen kroner i måneden. Kjør dem selv når du har godkjent oppsettet.

## Anbefalt oppsett

```mermaid
flowchart LR
  U[Deg: mobil/PC] -->|HTTPS + innlogging| RUN[Cloud Run-tjeneste<br/>kovarsel<br/>API + webapp]
  SCH[Cloud Scheduler<br/>hvert 5. min] --> JOB[Cloud Run Job<br/>kovarsel-poll]
  RUN --> SQL[(Cloud SQL Postgres<br/>database kovarsel)]
  JOB --> SQL
  SM[Secret Manager] -.-> RUN
  SM -.-> JOB
  JOB --> SVV[Statens vegvesen]
  JOB --> PUSH[Push / SMTP]
```

| Del | Valg | Begrunnelse |
| --- | --- | --- |
| Region | `europe-north1` (Finland) | Nærmest, og samme region som neste-steg |
| Webtjeneste | Cloud Run, min. 0 instanser | Skalerer til null, så du betaler nesten bare når appen brukes |
| Overvåking | Cloud Scheduler → Cloud Run Job | Kjører hvert 5. minutt uavhengig av nettleseren. Ingen alltid-på-server og ingen åpen jobb-URL |
| Database | **Ny database i den eksisterende Cloud SQL-instansen til neste-steg** | Ingen ekstra instanskostnad. Bruk egen databasebruker med tilgang bare til `kovarsel` |
| Hemmeligheter | Secret Manager, med en bestemt versjon i Cloud Run | Som i neste-steg |
| Innlogging | Appens egen innlogging med e-post og passord | Cloud Run kan være offentlig (`--allow-unauthenticated`). IAP kan legges foran som et ekstra lag senere |

### Kostnadsanslag (personlig bruk)

| Post | Anslag per måned |
| --- | --- |
| Cloud Run-tjeneste (skalerer til null) | ≈ 0 kr (innenfor gratiskvoten) |
| Cloud Run Job (≈ 8 600 kjøringer à ~5–10 s) | ≈ 0–30 kr, avhengig av gratiskvote |
| Cloud Scheduler (1 jobb) | 0 kr (3 gratis jobber per faktureringskonto) |
| Cloud SQL | 0 kr ekstra ved deling. Egen minste instans ≈ 100–150 kr |
| Secret Manager, Artifact Registry, logger | Noen få kroner |
| Vegvesenet, NVDB, Kartverket, Web Push | Gratis |

Sett et **budsjettvarsel** på faktureringskontoen, for eksempel 100 kr per måned.

## Slik deployer du (skript)

Navnene står i [deploy/gcp/config.ps1](../deploy/gcp/config.ps1): prosjekt `runprice`, region `europe-north1`, Cloud SQL-instansen `neste-steg-db` (delt), database `kovarsel`, tjeneste `kovarsel`. Adressen blir `https://kovarsel-294460811969.europe-north1.run.app`.

```powershell
cd C:\dev\queuenotice
gcloud auth login                                   # hvis du ikke allerede er innlogget
.\deploy\gcp\01-setup.ps1                            # én gang: API-er, kontoer, database, hemmeligheter
.\deploy\gcp\02-deploy.ps1 -NotifyMode dry-run      # bygg + migreringer + tjeneste + jobb + planlegger
.\deploy\gcp\04-transfer-data.ps1                    # flytt lokal bruker og lister (stopp lokal app først)
#   eller: .\deploy\gcp\03-first-admin.ps1 -Email din@epost.no   # start med tom database
.\deploy\gcp\02-deploy.ps1 -NotifyMode live          # når alt er kontrollert: ekte varsler
```

- **Hemmeligheter:** `01-setup.ps1` lager et tilfeldig databasepassord og leser VAPID-privatnøkkel, SMTP-passord og Google-nøkkel fra lokal `.env`. Verdiene sendes rett til Secret Manager via standard input og vises aldri.
- **Miljøvariabler** uten hemmeligheter hentes også fra `.env`. `demo` fjernes alltid fra kildene i skyen.
- **Lokal app og sky samtidig:** de overvåker hver sin database. Med `live` begge steder får du doble varsler. Sett lokal `.env` til `NOTIFY_MODE=dry-run` når skyen er i drift.
- **Push:** abonnement gjelder én adresse. Aktiver push på nytt på hver enhet fra skyadressen.

## Utrulling av nye funksjoner

Appen kjører nå i drift med ekte varsler. En ny versjon går gjennom fem steg: utvikle lokalt, teste, rulle ut, kontrollere, og eventuelt rulle tilbake.

```mermaid
flowchart LR
  A[Utvikle lokalt<br/>dry-run] --> B[Tester, typesjekk<br/>og bygg]
  B --> C{Ny migrering?}
  C -- ja --> D[Sikkerhetskopi<br/>av Cloud SQL]
  C -- nei --> E[02-deploy.ps1<br/>-NotifyMode live]
  D --> E
  E --> F[Kontroller app,<br/>kilder og logger]
  F -- feil --> G[Rull tilbake]
```

### 1. Utvikle og test lokalt

Lokalt står `.env` i `NOTIFY_MODE=dry-run`, så du får ikke doble varsler mens skyen er i drift.

```powershell
$npm = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
node $npm run dev          # prøv endringen på http://localhost:5173
node $npm test             # alle tester må passere
node $npm run typecheck
node $npm run build        # samme bygg som Cloud Build gjør
```

Tips: legg prosjektet i Git (`git init`) og lag en commit før hver utrulling. Da vet du alltid hvilken kode som kjører i skyen.

### 2. Endringer i databasen (migreringer)

Migreringer kjøres automatisk av `02-deploy.ps1` **før** den nye tjenesteversjonen starter. Et kort øyeblikk kjører derfor den gamle koden mot den nye databasen. Regler:

- **Lag en ny fil** med neste nummer, f.eks. `backend/migrations/004_noe.sql`. Endre aldri en migrering som allerede er kjørt.
- **Bare legg til:** nye tabeller, nye kolonner med standardverdi, eller nye kolonner som kan være tomme. Slik tåler gammel kode den nye databasen.
- **Fjerning og omdøping** gjøres i to utrullinger: først kode som ikke bruker kolonnen, deretter en migrering som fjerner den.
- **Test lokalt først:** `node $npm test` kjører alle migreringer, også gjennom den samme Postgres-driveren som brukes i skyen (`pg.test.ts`).
- **Ta sikkerhetskopi** før migreringer som endrer eksisterende data:

  ```powershell
  gcloud sql backups create --instance=neste-steg-db --project=runprice --description="Før kovarsel 004"
  ```

  Sikkerhetskopien gjelder hele instansen, altså også neste-steg. Instansen har i tillegg daglig sikkerhetskopi og gjenoppretting til et tidspunkt (PITR) i sju dager.

### 3. Rull ut

```powershell
cd C:\dev\queuenotice
.\deploy\gcp\02-deploy.ps1 -NotifyMode live
```

Skriptet bygger et nytt image med tidsstempel, kjører migreringene, legger ut ny versjon av webtjenesten og oppdaterer innhentingsjobben. `-NotifyMode` er påkrevd. Med `dry-run` slås ekte varsler av i skyen.

- **Endret innstilling** (f.eks. `TRAFFIC_SOURCES`, Google-grenser, SMTP-avsender): endre i lokal `.env` og kjør `02-deploy.ps1`. Skriptet leser ikke-hemmelige verdier derfra, men tar aldri med `demo` eller lokal `NOTIFY_MODE`.
- **Ny eller endret hemmelighet** (passord, nøkkel): legg inn ny versjon, og kjør deretter `02-deploy.ps1`. Den tar alltid siste aktive versjon.

  ```powershell
  . .\deploy\gcp\config.ps1                     # gir hjelpefunksjonen Add-SecretVersion
  $s = Read-Host "Ny verdi" -AsSecureString     # lim inn i terminalen, ikke i chat
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  Add-SecretVersion kovarsel-smtp-pass $plain   # sendes uten linjeskift via standard input
  Remove-Variable s, plain
  ```

  Ikke send verdien med `|` til `gcloud`. PowerShell legger da til et linjeskift som blir en del av passordet.

- **Ny hemmelighet** som appen ikke har brukt før: legg den til i `$SECRETS` i `deploy/gcp/config.ps1` og kjør `01-setup.ps1` først.

### 4. Kontroller etter utrulling

1. Skriptet avslutter med `Helsesjekk: HTTP 200`.
2. Åpne appen. Under **Oversikt → Datakilder** skal alle kilder stå som «OK» innen 5 minutter.
3. Sjekk at innhentingsjobben går og ikke feiler:

   ```powershell
   gcloud run jobs executions list --job=kovarsel-poll --region=europe-north1 --project=runprice --limit=3
   gcloud logging read 'resource.labels.job_name="kovarsel-poll" AND severity>=WARNING' --project=runprice --freshness=30m --limit=20
   ```

4. Feil i webtjenesten:

   ```powershell
   gcloud logging read 'resource.labels.service_name="kovarsel" AND severity>=ERROR' --project=runprice --freshness=30m --limit=20
   ```

### 5. Rull tilbake

Webtjenesten beholder tidligere versjoner (revisjoner). Bytt tilbake på sekunder:

```powershell
gcloud run revisions list --service=kovarsel --region=europe-north1 --project=runprice
gcloud run services update-traffic kovarsel --to-revisions=kovarsel-00002-fgw=100 --region=europe-north1 --project=runprice
```

Innhentingsjobben rulles tilbake ved å legge ut et tidligere image på nytt. Det bygger ingenting og kjører bare migreringer som mangler:

```powershell
gcloud artifacts docker images list europe-north1-docker.pkg.dev/runprice/kovarsel/app --include-tags --project=runprice
.\deploy\gcp\02-deploy.ps1 -NotifyMode live -Image europe-north1-docker.pkg.dev/runprice/kovarsel/app:20261017-000554
```

Migreringer rulles ikke tilbake automatisk. Fordi de bare legger til, fungerer den gamle koden videre. Må data rettes, lag en ny migrering, eller gjenopprett fra sikkerhetskopi.

### Sjekkliste

- [ ] `node $npm test`, `typecheck` og `build` er grønne
- [ ] Nye migreringer bare legger til, og har nytt nummer
- [ ] Sikkerhetskopi er tatt hvis eksisterende data endres
- [ ] `.\deploy\gcp\02-deploy.ps1 -NotifyMode live` er kjørt, og helsesjekken er OK
- [ ] Datakildene er «OK», og innhentingsjobben feiler ikke

## Hva skriptene gjør (manuelle kommandoer)

Forutsetninger: `gcloud` er installert og innlogget, og prosjektet er valgt (`gcloud config set project PROSJEKT`).

### 1. Database (i eksisterende instans)

```powershell
gcloud sql databases create kovarsel --instance=INSTANS
gcloud sql users create kovarsel --instance=INSTANS --password=-   # leser passord fra stdin
```

### 2. Hemmeligheter

```powershell
# DATABASE_URL med Unix-socket for Cloud SQL:
# postgresql://kovarsel:PASSORD@localhost/kovarsel?host=/cloudsql/PROSJEKT:europe-north1:INSTANS
gcloud secrets create kovarsel-database-url --replication-policy=automatic
gcloud secrets versions add kovarsel-database-url --data-file=-
gcloud secrets create kovarsel-vapid-private --replication-policy=automatic
gcloud secrets versions add kovarsel-vapid-private --data-file=-
# Ved Google Routes: kovarsel-google-routes-key (og GOOGLE_ROUTES_API_KEY=kovarsel-google-routes-key:1 i --set-secrets)
# Ved e-post: kovarsel-smtp-pass
```

Gi tjenestekontoen som kjører Cloud Run, rollen `roles/secretmanager.secretAccessor` på disse hemmelighetene og `roles/cloudsql.client` på prosjektet.

### 3. Bygg image

```powershell
gcloud artifacts repositories create kovarsel --repository-format=docker --location=europe-north1
gcloud builds submit --tag europe-north1-docker.pkg.dev/PROSJEKT/kovarsel/app:VERSJON .
```

### 4. Kjør migreringer (egen jobb, før ny app-versjon)

```powershell
gcloud run jobs create kovarsel-migrate --region=europe-north1 `
  --image=europe-north1-docker.pkg.dev/PROSJEKT/kovarsel/app:VERSJON `
  --command=node --args=dist/db/migrateCli.js `
  --set-cloudsql-instances=PROSJEKT:europe-north1:INSTANS `
  --set-secrets=DATABASE_URL=kovarsel-database-url:1 `
  --set-env-vars=NODE_ENV=production
gcloud run jobs execute kovarsel-migrate --region=europe-north1 --wait
```

### 5. Webtjenesten

```powershell
gcloud run deploy kovarsel --region=europe-north1 `
  --image=europe-north1-docker.pkg.dev/PROSJEKT/kovarsel/app:VERSJON `
  --allow-unauthenticated --min-instances=0 --max-instances=1 `
  --set-cloudsql-instances=PROSJEKT:europe-north1:INSTANS `
  --set-secrets=DATABASE_URL=kovarsel-database-url:1,VAPID_PRIVATE_KEY=kovarsel-vapid-private:1 `
  --set-env-vars=NODE_ENV=production,AUTH_MODE=password,APP_BASE_URL=https://ADRESSE,POLL_IN_PROCESS=false,NOTIFY_MODE=dry-run,TRAFFIC_SOURCES=vegvesen,VAPID_PUBLIC_KEY=...,VAPID_SUBJECT=mailto:din@gmail.com
```

`APP_BASE_URL` må være den offentlige HTTPS-adressen. Den brukes i invitasjonslenker og slår på `Secure` for informasjonskapselen.

`--max-instances=1` gjør at den minnebaserte begrensningen av innloggingsforsøk og forespørsler holder. Ved flere instanser må den byttes ut med en delt begrensning.

**Første administrator i skyen:** kjør brukerkommandoen som en engangsjobb med samme image og database:

```powershell
gcloud run jobs create kovarsel-user --region=europe-north1 `
  --image=europe-north1-docker.pkg.dev/PROSJEKT/kovarsel/app:VERSJON `
  --command=node --args=dist/cli/users.js,invite,din@gmail.com,--admin `
  --set-cloudsql-instances=PROSJEKT:europe-north1:INSTANS `
  --set-secrets=DATABASE_URL=kovarsel-database-url:1 --set-env-vars=APP_BASE_URL=https://ADRESSE
gcloud run jobs execute kovarsel-user --region=europe-north1 --wait
```

Lenken står i jobbens logg. Åpne den og velg passord. Slett jobben etterpå.

**Valgfritt ekstra lag:** IAP foran tjenesten (`--no-allow-unauthenticated --iap`) gjør at bare utvalgte Google-kontoer når innloggingssiden i det hele tatt.

### 6. Overvåkingsjobb og planlegger

```powershell
gcloud run jobs create kovarsel-poll --region=europe-north1 `
  --image=europe-north1-docker.pkg.dev/PROSJEKT/kovarsel/app:VERSJON `
  --command=node --args=dist/jobs/pollOnce.js --task-timeout=180s --max-retries=0 `
  --set-cloudsql-instances=PROSJEKT:europe-north1:INSTANS `
  --set-secrets=DATABASE_URL=kovarsel-database-url:1,VAPID_PRIVATE_KEY=kovarsel-vapid-private:1 `
  --set-env-vars=NODE_ENV=production,NOTIFY_MODE=dry-run,TRAFFIC_SOURCES=vegvesen,VAPID_PUBLIC_KEY=...,VAPID_SUBJECT=mailto:din@gmail.com

gcloud scheduler jobs create http kovarsel-poll-5min --location=europe-north1 `
  --schedule="*/5 * * * *" --time-zone="Europe/Oslo" `
  --uri="https://run.googleapis.com/v2/projects/PROSJEKT/locations/europe-north1/jobs/kovarsel-poll:run" `
  --http-method=POST --oauth-service-account-email=SCHEDULER-SA@PROSJEKT.iam.gserviceaccount.com
```

Tjenestekontoen til planleggeren trenger rollen `roles/run.invoker` på jobben.

### 7. Slå på ekte varsler

Bytt `NOTIFY_MODE=live` på både tjenesten og jobben, når du har godkjent det.

## Overvåking og feilsøking

- Loggene er strukturert JSON med `severity` og `message`, og vises direkte i Cloud Logging.
  - Søk etter `"Henting fra trafikkilde feilet"` for kildeproblemer og `"Varsel feilet"` for utsending.
  - `"Innhenting fullført"` viser en oppsummering per runde: kilder, antall strekninger og varsler.
- Tabellen `poll_runs` lagrer oppsummering og feil for hver runde. `source_status` viser siste vellykkede henting per kilde.
- Lag gjerne en logg-basert varsling i Cloud Monitoring når `"Innhenting feilet"` dukker opp, eller når `kovarsel-poll` feiler flere ganger på rad.

## Alternativ uten Scheduler og Job

Én alltid-på Cloud Run-instans med `POLL_IN_PROCESS=true` og `--min-instances=1 --no-cpu-throttling`. Det er enklere, men koster mer (≈ 150–250 kr per måned), fordi instansen aldri skalerer ned.
