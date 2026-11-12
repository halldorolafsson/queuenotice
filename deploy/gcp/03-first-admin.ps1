# Lager første administrator i skyen med en invitasjonslenke.
#
#   .\deploy\gcp\03-first-admin.ps1 -Email halldor.olafssen@gmail.com
#
# Kjører brukerkommandoen som en Cloud Run-jobb mot Cloud SQL og skriver ut lenken fra jobbloggen.
# Lenken virker én gang i 48 timer. Bruk heller 04-transfer-data.ps1 hvis du vil flytte lokale lister.

param([Parameter(Mandatory = $true)][string]$Email)

. "$PSScriptRoot\config.ps1"

$image = & gcloud run services describe $SERVICE --region=$REGION --project=$PROJECT_ID `
  --format="value(spec.template.spec.containers[0].image)"
if (-not $image) { throw "Fant ikke tjenesten $SERVICE. Kjør 02-deploy.ps1 først." }
$dbVersion = Get-LatestSecretVersion $SECRETS.DATABASE_URL

Invoke-Gcloud run jobs deploy $USER_JOB --image=$image --region=$REGION --project=$PROJECT_ID `
  --service-account=$RUN_SA --set-cloudsql-instances=$CONNECTION_NAME `
  --set-secrets="DATABASE_URL=$($SECRETS.DATABASE_URL):$dbVersion" `
  --set-env-vars="APP_BASE_URL=$APP_URL" `
  --command=node --args="dist/cli/users.js,invite,$Email,--admin" --max-retries=0 --task-timeout=120s
Invoke-Gcloud run jobs execute $USER_JOB --region=$REGION --project=$PROJECT_ID --wait

Write-Host "Henter lenken fra loggen (kan ta noen sekunder) ..."
Start-Sleep -Seconds 10
$lines = & gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=$USER_JOB" `
  --project=$PROJECT_ID --limit=20 --freshness=10m --format="value(textPayload)"
$link = $lines | Where-Object { $_ -match "/#/invitasjon/" } | Select-Object -First 1
if ($link) { Write-Host "`nÅpne denne lenken og velg passord:`n$link" } else { Write-Warning "Fant ikke lenken ennå. Se jobbloggen i Cloud Console." }

# Jobben inneholder e-postadressen i argumentene; slett den når den er brukt.
Invoke-Gcloud run jobs delete $USER_JOB --region=$REGION --project=$PROJECT_ID --quiet
