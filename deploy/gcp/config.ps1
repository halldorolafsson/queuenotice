# Felles navn og hjelpefunksjoner for Køvarsel i Google Cloud.
# Leses inn av de andre skriptene: . .\deploy\gcp\config.ps1

$ErrorActionPreference = "Stop"

$PROJECT_ID = "runprice"
$PROJECT_NUMBER = "294460811969"
$REGION = "europe-north1"
# Cloud Scheduler finnes ikke i alle regioner; europe-west1 er trygt og påvirker bare hvor timeren bor.
$SCHEDULER_REGION = "europe-west1"

$SERVICE = "kovarsel"
$AR_REPO = "kovarsel"
$IMAGE_BASE = "$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/app"

# Deler Cloud SQL-instansen med neste-steg, men med egen database og egen databasebruker.
$SQL_INSTANCE = "neste-steg-db"
$CONNECTION_NAME = "${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
$DB_NAME = "kovarsel"
$DB_USER = "kovarsel_app"

$RUN_SA_NAME = "kovarsel-run"
$RUN_SA = "$RUN_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
$SCHEDULER_SA_NAME = "kovarsel-scheduler"
$SCHEDULER_SA = "$SCHEDULER_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

$MIGRATE_JOB = "kovarsel-migrate"
$POLL_JOB = "kovarsel-poll"
$USER_JOB = "kovarsel-user"
$SCHEDULE_NAME = "kovarsel-poll-5min"

# Cloud Run gir en fast adresse på formen https://TJENESTE-PROSJEKTNUMMER.REGION.run.app
$APP_URL = "https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"

$SECRETS = @{
  DATABASE_URL          = "kovarsel-database-url"
  VAPID_PRIVATE_KEY     = "kovarsel-vapid-private-key"
  SMTP_PASS             = "kovarsel-smtp-pass"
  GOOGLE_ROUTES_API_KEY = "kovarsel-google-routes-key"
}

$REPO_ROOT = (Resolve-Path "$PSScriptRoot\..\..").Path
$DOTENV = Join-Path $REPO_ROOT ".env"

# gcloud ligger ofte utenfor PATH på denne PC-en.
$sdkBin = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue) -and (Test-Path $sdkBin)) {
  $env:PATH = "$sdkBin;$env:PATH"
}

function Get-DotEnvValue([string]$Name) {
  if (-not (Test-Path $DOTENV)) { return $null }
  $line = Get-Content $DOTENV -Encoding UTF8 | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $value = $line.Substring($Name.Length + 1).Trim()
  if ($value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
  return $value
}

function Invoke-Gcloud {
  # Kjører gcloud og stopper ved feil.
  & gcloud @args
  if ($LASTEXITCODE -ne 0) { throw "gcloud feilet: gcloud $($args -join ' ')" }
}

function Test-GcloudResource {
  # Sant hvis describe-kommandoen finner ressursen. PowerShell 5.1 gjør stderr til feil når den omdirigeres.
  $ErrorActionPreference = "Continue"
  & gcloud @args --format="value(name)" 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Add-SecretVersion([string]$Name, [string]$Value) {
  # Sender verdien via standard input, slik at den aldri havner i kommandolinje, fil eller historikk.
  $cliPath = (Get-Command gcloud.cmd -ErrorAction Stop).Source
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $env:ComSpec
  $startInfo.Arguments = "/d /s /c `"`"$cliPath`" secrets versions add $Name --data-file=- --project=$PROJECT_ID --format=value(name) --quiet`""
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    [void]$process.Start()
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0 -or $output.Trim() -notmatch '/versions/([0-9]+)$') {
      throw "Kunne ikke lagre ny versjon av hemmeligheten $Name"
    }
    return $Matches[1]
  }
  finally {
    $process.Dispose()
  }
}

function Get-LatestSecretVersion([string]$Name) {
  $ErrorActionPreference = "Continue"
  $v = & gcloud secrets versions list $Name --project=$PROJECT_ID --filter="state:ENABLED" `
    --sort-by="~createTime" --limit=1 --format="value(name)" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
  return ($v -split '/')[-1]
}
