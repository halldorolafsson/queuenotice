# Flytter brukere, lister, strekninger og varslingsinnstillinger fra lokal database til Cloud SQL.
# Alternativ til 03-first-admin.ps1: passordet ditt og listene dine blir med.
#
#   .\deploy\gcp\04-transfer-data.ps1
#
# Krav: 02-deploy.ps1 er kjørt (tabellene finnes), måldatabasen er tom, og den lokale appen er stoppet.
# Bruker Cloud SQL Auth Proxy med din gcloud-innlogging; ingen databaseport åpnes mot internett.

. "$PSScriptRoot\config.ps1"

$npm = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
$port = 5439

if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
  throw "Den lokale appen kjører. Stopp den (Ctrl+C) før eksport, siden den lokale databasen ikke tåler to prosesser."
}

if (-not (Get-Command cloud-sql-proxy -ErrorAction SilentlyContinue)) {
  Write-Host "== Installerer Cloud SQL Auth Proxy som gcloud-komponent"
  # gcloud nekter å oppdatere seg selv med innebygd Python uten en kopi av den.
  $env:CLOUDSDK_PYTHON = (& gcloud components copy-bundled-python | Select-Object -Last 1)
  Invoke-Gcloud components install cloud-sql-proxy --quiet
}

Push-Location $REPO_ROOT
$proxy = $null
try {
  $exportFile = "backup/kovarsel-export-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
  Write-Host "== Eksporterer lokal database til $exportFile"
  node $npm run transfer -- export --output $exportFile
  if ($LASTEXITCODE -ne 0) { throw "Eksport feilet" }

  Write-Host "== Starter Cloud SQL Auth Proxy på 127.0.0.1:$port"
  $proxy = Start-Process -FilePath (Get-Command cloud-sql-proxy).Source `
    -ArgumentList "--gcloud-auth", "--port=$port", $CONNECTION_NAME -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 5

  # Samme passord som Cloud Run bruker, men via proxyen i stedet for Unix-socket.
  $cloudUrl = & gcloud secrets versions access latest --secret=$($SECRETS.DATABASE_URL) --project=$PROJECT_ID
  $password = ([uri]($cloudUrl -replace '\?.*$', '')).UserInfo.Split(':', 2)[1]
  $env:DATABASE_URL = "postgresql://${DB_USER}:${password}@127.0.0.1:$port/$DB_NAME"
  Remove-Variable cloudUrl, password

  Write-Host "== Prøvekjøring (ingenting lagres)"
  node $npm run transfer -- import --input $exportFile
  if ($LASTEXITCODE -ne 0) { throw "Prøvekjøringen feilet; ingenting er endret" }

  if ((Read-Host "Lagre dataene i Cloud SQL nå? (ja/nei)") -eq "ja") {
    node $npm run transfer -- import --input $exportFile --commit
    if ($LASTEXITCODE -ne 0) { throw "Importen feilet; ingenting er lagret" }
  }
  Write-Host "`nSlett eksportfilen når du har kontrollert at alt virker: $exportFile"
}
finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  if ($proxy -and -not $proxy.HasExited) { Stop-Process -Id $proxy.Id }
  Pop-Location
}
