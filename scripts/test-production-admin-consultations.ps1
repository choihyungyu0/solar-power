$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BackendBaseUrl = $env:SOLARMATE_BACKEND_URL
if ([string]::IsNullOrWhiteSpace($BackendBaseUrl)) {
  $BackendBaseUrl = "https://solarmate-climate-backend.onrender.com"
}
$BackendBaseUrl = $BackendBaseUrl.TrimEnd("/")

$AdminKey = $env:SOLARMATE_ADMIN_KEY
if ([string]::IsNullOrWhiteSpace($AdminKey)) {
  Write-Host "SOLARMATE_ADMIN_KEY environment variable is missing."
  Write-Host "Set it for this shell, then run:"
  Write-Host "powershell -ExecutionPolicy Bypass -File .\scripts\test-production-admin-consultations.ps1"
  exit 1
}

$AllowedStatuses = @("received", "contacted", "waiting_documents", "proposal_sent", "closed")

function Get-BodyPreview {
  param(
    [string] $Body
  )

  if ([string]::IsNullOrEmpty($Body)) {
    return ""
  }

  if ($Body.Length -le 800) {
    return $Body
  }

  return $Body.Substring(0, 800)
}

function Invoke-AdminJsonRequest {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("GET", "PATCH")]
    [string] $Method,

    [Parameter(Mandatory = $true)]
    [string] $Path,

    [object] $Body = $null
  )

  $uri = "$BackendBaseUrl$Path"
  $statusMarker = "__SOLARMATE_HTTP_STATUS__:"
  $bodyPath = $null
  $curlArgs = @(
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    "180",
    "--request",
    $Method,
    "--header",
    "Accept: application/json",
    "--header",
    "X-SolarMate-Admin-Key: $AdminKey",
    "--write-out",
    "`n$statusMarker%{http_code}"
  )

  if ($null -ne $Body) {
    $bodyPath = [System.IO.Path]::GetTempFileName()
    $bodyJson = $Body | ConvertTo-Json -Depth 20
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($bodyPath, $bodyJson, $utf8NoBom)
    $curlArgs += @(
      "--header",
      "Content-Type: application/json; charset=utf-8",
      "--data-binary",
      "@$bodyPath"
    )
  }

  try {
    $curlArgs += $uri
    $curlOutput = & curl.exe @curlArgs 2>&1
    $curlExitCode = $LASTEXITCODE
    $rawOutput = ($curlOutput | Out-String)

    if ($curlExitCode -ne 0) {
      Write-Host "Request failed: $Method $uri"
      Write-Host "curl.exe exit code: $curlExitCode"
      if (-not [string]::IsNullOrWhiteSpace($rawOutput)) {
        Write-Host "Response preview:"
        Write-Host (Get-BodyPreview -Body $rawOutput)
      }

      return [pscustomobject]@{
        Ok = $false
        StatusCode = $null
        Json = $null
        Body = $rawOutput
      }
    }

    $markerIndex = $rawOutput.LastIndexOf($statusMarker)

    if ($markerIndex -lt 0) {
      Write-Host "Request failed: $Method $uri"
      Write-Host "Error: HTTP status marker was not found."

      return [pscustomobject]@{
        Ok = $false
        StatusCode = $null
        Json = $null
        Body = $rawOutput
      }
    }

    $content = $rawOutput.Substring(0, $markerIndex).Trim()
    $statusText = $rawOutput.Substring($markerIndex + $statusMarker.Length).Trim()
    $statusCode = $null

    if ($statusText -match "^(\d{3})") {
      $statusCode = [int]$Matches[1]
    }

    $json = $null
    if (-not [string]::IsNullOrWhiteSpace($content)) {
      $json = $content | ConvertFrom-Json -ErrorAction Stop
    }

    $statusOk = $null -ne $statusCode -and $statusCode -ge 200 -and $statusCode -lt 300

    if (-not $statusOk) {
      Write-Host "Request failed: $Method $uri"
      if ($null -ne $statusCode) {
        Write-Host "HTTP status: $statusCode"
      }
      if (-not [string]::IsNullOrWhiteSpace($content)) {
        Write-Host "Response preview:"
        Write-Host (Get-BodyPreview -Body $content)
      }
    }

    return [pscustomobject]@{
      Ok = $statusOk
      StatusCode = $statusCode
      Json = $json
      Body = $content
    }
  }
  catch {
    Write-Host "Request failed: $Method $uri"
    Write-Host "Error: $($_.Exception.Message)"

    return [pscustomobject]@{
      Ok = $false
      StatusCode = $null
      Json = $null
      Body = ""
    }
  }
  finally {
    if ($bodyPath -and (Test-Path -LiteralPath $bodyPath)) {
      Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host "Testing SolarMate production admin consultation flow against $BackendBaseUrl"

$listResponse = Invoke-AdminJsonRequest -Method "GET" -Path "/api/admin/consultations"
if (-not $listResponse.Ok) {
  Write-Host "Admin consultation list test failed."
  exit 1
}

$listBody = if ($listResponse.Body) { $listResponse.Body.TrimStart() } else { "" }
if (-not $listBody.StartsWith("[")) {
  Write-Host "Admin consultation list response was not an array."
  exit 1
}

$rows = if ($listBody.Trim() -eq "[]") { @() } else { @($listResponse.Json) }
$count = $rows.Count
$first = if ($count -gt 0) { $rows[0] } else { $null }

Write-Host ""
Write-Host "Summary:"
Write-Host ("count: {0}" -f $count)
Write-Host ("first id: {0}" -f ($(if ($first) { $first.id } else { "-" })))
Write-Host ("first status: {0}" -f ($(if ($first) { $first.status } else { "-" })))
Write-Host ("first consultationType: {0}" -f ($(if ($first) { $first.consultationType } else { "-" })))

if ($null -eq $first) {
  Write-Host ""
  Write-Host "No rows found. PATCH status test skipped."
  exit 0
}

$originalStatus = [string]$first.status
if (-not ($AllowedStatuses -contains $originalStatus)) {
  Write-Host "First row has unsupported original status: $originalStatus"
  exit 1
}

$firstId = [string]$first.id
$patchToContacted = Invoke-AdminJsonRequest `
  -Method "PATCH" `
  -Path "/api/admin/consultations/$firstId/status" `
  -Body @{ status = "contacted" }

if (-not ($patchToContacted.Ok -and $patchToContacted.Json.ok -eq $true -and $patchToContacted.Json.status -eq "contacted")) {
  Write-Host "PATCH to contacted failed."
  exit 1
}

$patchBack = Invoke-AdminJsonRequest `
  -Method "PATCH" `
  -Path "/api/admin/consultations/$firstId/status" `
  -Body @{ status = $originalStatus }

if (-not ($patchBack.Ok -and $patchBack.Json.ok -eq $true -and $patchBack.Json.status -eq $originalStatus)) {
  Write-Host "PATCH back to original status failed."
  exit 1
}

Write-Host ""
Write-Host "Status update test: contacted -> $originalStatus restored"
exit 0
