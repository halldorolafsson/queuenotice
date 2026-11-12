# Engangsoppsett av Køvarsel i Google Cloud. Trygt å kjøre flere ganger:
# det som allerede finnes, hoppes over.
#
#   .\deploy\gcp\01-setup.ps1
#
# Oppretter: API-er, Artifact Registry, to tjenestekontoer, database og databasebruker
# i eksisterende Cloud SQL-instans, og hemmeligheter i Secret Manager (verdier fra lokal .env).
# Kostnad: hemmeligheter og containerlager koster noen få kroner i måneden. Ingen ny databaseinstans.

. "$PSScriptRoot\config.ps1"

Write-Host "== Prosjekt og innlogging"
Invoke-Gcloud config set project $PROJECT_ID
$account = & gcloud auth list --filter="status:ACTIVE" --format="value(account)"
if (-not $account) { throw "Ingen aktiv gcloud-innlogging. Kjør: gcloud auth login" }
Write-Host "Innlogget som $account"
$billing = & gcloud billing projects describe $PROJECT_ID --format="value(billingEnabled)"
if ($billing -ne "True") { throw "Fakturering er ikke aktiv for $PROJECT_ID" }

Write-Host "== API-er"
Invoke-Gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com `
  artifactregistry.googleapis.com cloudbuild.googleapis.com iam.googleapis.com logging.googleapis.com `
  cloudscheduler.googleapis.com --project=$PROJECT_ID

Write-Host "== Artifact Registry"
if (-not (Test-GcloudResource artifacts repositories describe $AR_REPO --location=$REGION --project=$PROJECT_ID)) {
  Invoke-Gcloud artifacts repositories create $AR_REPO --repository-format=docker --location=$REGION `
    --description="Container-images for Køvarsel" --project=$PROJECT_ID
}

Write-Host "== Tjenestekontoer"
if (-not (Test-GcloudResource iam service-accounts describe $RUN_SA --project=$PROJECT_ID)) {
  Invoke-Gcloud iam service-accounts create $RUN_SA_NAME --display-name="Køvarsel Cloud Run" --project=$PROJECT_ID
}
if (-not (Test-GcloudResource iam service-accounts describe $SCHEDULER_SA --project=$PROJECT_ID)) {
  Invoke-Gcloud iam service-accounts create $SCHEDULER_SA_NAME --display-name="Køvarsel planlegger" --project=$PROJECT_ID
}
Invoke-Gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RUN_SA" `
  --role="roles/cloudsql.client" --condition=None --quiet --format=none

Write-Host "== Database i $SQL_INSTANCE"
if (-not (Test-GcloudResource sql databases describe $DB_NAME --instance=$SQL_INSTANCE --project=$PROJECT_ID)) {
  Invoke-Gcloud sql databases create $DB_NAME --instance=$SQL_INSTANCE --project=$PROJECT_ID
}

Write-Host "== Hemmeligheter"
foreach ($secret in $SECRETS.Values) {
  if (-not (Test-GcloudResource secrets describe $secret --project=$PROJECT_ID)) {
    Invoke-Gcloud secrets create $secret --replication-policy=automatic --project=$PROJECT_ID
  }
}

# Databasepassordet lages og lagres bare hvis hemmeligheten ikke har en versjon fra før.
if (-not (Get-LatestSecretVersion $SECRETS.DATABASE_URL)) {
  $dbPassword = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
  $userExists = & gcloud sql users list --instance=$SQL_INSTANCE --project=$PROJECT_ID --format="value(name)" | Where-Object { $_ -eq $DB_USER }
  if ($userExists) {
    Invoke-Gcloud sql users set-password $DB_USER --instance=$SQL_INSTANCE --password=$dbPassword --project=$PROJECT_ID
  } else {
    Invoke-Gcloud sql users create $DB_USER --instance=$SQL_INSTANCE --password=$dbPassword --project=$PROJECT_ID
  }
  $socket = [System.Uri]::EscapeDataString("/cloudsql/$CONNECTION_NAME")
  $databaseUrl = "postgresql://${DB_USER}:${dbPassword}@localhost:5432/${DB_NAME}?host=$socket"
  $v = Add-SecretVersion $SECRETS.DATABASE_URL $databaseUrl
  Remove-Variable dbPassword, databaseUrl
  Write-Host "DATABASE_URL lagret som versjon $v"
} else {
  Write-Host "DATABASE_URL finnes fra før"
}

foreach ($name in @("VAPID_PRIVATE_KEY", "SMTP_PASS", "GOOGLE_ROUTES_API_KEY")) {
  $secret = $SECRETS[$name]
  $local = Get-DotEnvValue $name
  if (-not $local) { Write-Host "$name mangler i .env; hopper over"; continue }
  if (Get-LatestSecretVersion $secret) { Write-Host "$name finnes fra før i Secret Manager"; continue }
  $v = Add-SecretVersion $secret $local
  Write-Host "$name lagret som versjon $v"
}

foreach ($secret in $SECRETS.Values) {
  Invoke-Gcloud secrets add-iam-policy-binding $secret --member="serviceAccount:$RUN_SA" `
    --role="roles/secretmanager.secretAccessor" --project=$PROJECT_ID --condition=None --quiet --format=none
}

Write-Host ""
Write-Host "Oppsett ferdig. Neste steg: .\deploy\gcp\02-deploy.ps1"
