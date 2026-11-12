# Bygger og deployer Køvarsel til Cloud Run. Kjøres etter 01-setup.ps1, og på nytt ved hver ny versjon.
#
#   .\deploy\gcp\02-deploy.ps1 -NotifyMode live      # vanlig utrulling i drift
#   .\deploy\gcp\02-deploy.ps1 -NotifyMode dry-run   # slår av ekte varsler
#   .\deploy\gcp\02-deploy.ps1 -NotifyMode live -Image <tidligere image>   # tilbakerulling uten bygg
#
# Rekkefølge: bygg image -> kjør migreringer -> deploy webtjeneste -> oppdater innhentingsjobb og planlegger.

param(
  # Påkrevd, slik at en utrulling aldri slår av ekte varsler ved et uhell.
  [Parameter(Mandatory = $true)][ValidateSet("dry-run", "live")][string]$NotifyMode,
  [string]$Image = ""
)

. "$PSScriptRoot\config.ps1"
Invoke-Gcloud config set project $PROJECT_ID

if (-not $Image) {
  $tag = Get-Date -Format "yyyyMMdd-HHmmss"
  $Image = "${IMAGE_BASE}:$tag"
  Write-Host "== Bygger $Image med Cloud Build"
  Invoke-Gcloud builds submit $REPO_ROOT --tag=$Image --project=$PROJECT_ID
}

Write-Host "== Miljøvariabler (uten hemmeligheter)"
$localSources = Get-DotEnvValue "TRAFFIC_SOURCES"
if (-not $localSources) { $localSources = "vegvesen" }
$sources = @($localSources -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne "demo" })
if ("google" -in $sources -and -not (Get-LatestSecretVersion $SECRETS.GOOGLE_ROUTES_API_KEY)) {
  Write-Warning "google er valgt, men nøkkelen mangler i Secret Manager. Fjerner google fra kildene."
  $sources = @($sources | Where-Object { $_ -ne "google" })
}
$envVars = [ordered]@{
  NODE_ENV          = "production"
  LOG_LEVEL         = "info"
  AUTH_MODE         = "password"
  APP_BASE_URL      = $APP_URL
  POLL_IN_PROCESS   = "false"
  NOTIFY_MODE       = $NotifyMode
  TRAFFIC_SOURCES   = ($sources -join ",")
}
foreach ($name in @("VEGVESEN_BBOX", "NVDB_CLIENT_ID", "MAX_NOTIFICATIONS_PER_DAY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_FROM", "GOOGLE_ROUTES_MIN_INTERVAL_MINUTES",
    "GOOGLE_ROUTES_MAX_CALLS_PER_DAY", "GOOGLE_ROUTES_MAX_CALLS_PER_MONTH", "GOOGLE_ROUTES_REQUIRE_SCHEDULE")) {
  $value = Get-DotEnvValue $name
  if ($value) { $envVars[$name] = $value }
}
# YAML-fil fordi verdier som "vegvesen,google" inneholder komma. Ligger utenfor prosjektmappen.
$envFile = Join-Path $env:TEMP "kovarsel-env.yaml"
$yaml = ($envVars.GetEnumerator() | ForEach-Object { "$($_.Key): '$($_.Value -replace "'", "''")'" }) -join "`n"
[System.IO.File]::WriteAllText($envFile, $yaml, (New-Object System.Text.UTF8Encoding $false))
Write-Host ($envVars.Keys -join ", ")

$secretArgs = @()
foreach ($entry in $SECRETS.GetEnumerator()) {
  $version = Get-LatestSecretVersion $entry.Value
  if ($version) { $secretArgs += "$($entry.Key)=$($entry.Value):$version" }
}
if (-not ($secretArgs | Where-Object { $_ -like "DATABASE_URL=*" })) { throw "DATABASE_URL mangler. Kjør 01-setup.ps1 først." }
$secretsFlag = "--set-secrets=" + ($secretArgs -join ",")
Write-Host "Hemmeligheter: $(($secretArgs | ForEach-Object { ($_ -split '=')[0] }) -join ', ')"

$common = @(
  "--image=$Image", "--region=$REGION", "--project=$PROJECT_ID", "--service-account=$RUN_SA",
  "--set-cloudsql-instances=$CONNECTION_NAME", "--env-vars-file=$envFile", $secretsFlag, "--memory=512Mi", "--cpu=1"
)

Write-Host "== Migreringer"
Invoke-Gcloud run jobs deploy $MIGRATE_JOB @common --command=node --args=dist/db/migrateCli.js `
  --task-timeout=300s --max-retries=0
Invoke-Gcloud run jobs execute $MIGRATE_JOB --region=$REGION --project=$PROJECT_ID --wait

Write-Host "== Webtjeneste"
Invoke-Gcloud run deploy $SERVICE @common --allow-unauthenticated --min-instances=0 --max-instances=1 `
  --concurrency=40 --timeout=60s --port=8080

$urls = & gcloud run services describe $SERVICE --region=$REGION --project=$PROJECT_ID --format="value(metadata.annotations.'run.googleapis.com/urls')"
if ($urls -and $urls -notmatch [regex]::Escape($APP_URL)) {
  Write-Warning "Tjenesten har adressen $url, ikke $APP_URL. Oppdater `$APP_URL i config.ps1 og kjør på nytt (lenker og informasjonskapsler bruker den)."
}

Write-Host "== Innhentingsjobb og planlegger"
Invoke-Gcloud run jobs deploy $POLL_JOB @common --command=node --args=dist/jobs/pollOnce.js `
  --task-timeout=180s --max-retries=0
Invoke-Gcloud run jobs add-iam-policy-binding $POLL_JOB --region=$REGION --project=$PROJECT_ID `
  --member="serviceAccount:$SCHEDULER_SA" --role="roles/run.invoker" --quiet --format=none

$runUri = "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/${POLL_JOB}:run"
$scheduleArgs = @("--location=$SCHEDULER_REGION", "--project=$PROJECT_ID", "--schedule=*/5 * * * *", "--time-zone=Europe/Oslo",
  "--uri=$runUri", "--http-method=POST", "--oauth-service-account-email=$SCHEDULER_SA")
if (Test-GcloudResource scheduler jobs describe $SCHEDULE_NAME --location=$SCHEDULER_REGION --project=$PROJECT_ID) {
  Invoke-Gcloud scheduler jobs update http $SCHEDULE_NAME @scheduleArgs
} else {
  Invoke-Gcloud scheduler jobs create http $SCHEDULE_NAME @scheduleArgs
}

Write-Host "== Kontroll"
$health = Invoke-WebRequest -UseBasicParsing "$APP_URL/health" -TimeoutSec 30
Write-Host "Helsesjekk: HTTP $($health.StatusCode)"
Write-Host ""
Write-Host "Ferdig. Appen: $APP_URL  (varsler: $NotifyMode)"
Write-Host "Første gang: lag administrator med .\deploy\gcp\03-first-admin.ps1, eller flytt lokale data (se docs/drift-gcp.md)."
