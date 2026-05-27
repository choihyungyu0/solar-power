$ErrorActionPreference = "Stop"

$BackendBaseUrl = $env:SOLARMATE_BACKEND_URL
if ([string]::IsNullOrWhiteSpace($BackendBaseUrl)) {
  $BackendBaseUrl = "https://solarmate-climate-backend.onrender.com"
}
$BackendBaseUrl = $BackendBaseUrl.TrimEnd("/")

function ConvertTo-Utf8JsonFile {
  param(
    [Parameter(Mandatory = $true)] [object] $Payload
  )

  $json = if ($Payload -is [string]) { $Payload } else { $Payload | ConvertTo-Json -Depth 100 -Compress }
  $path = Join-Path $env:TEMP ("solarmate-final-smoke-{0}.json" -f ([guid]::NewGuid().ToString("N")))
  [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))

  return $path
}

function Get-BodyPreview {
  param([string] $Body)

  if ([string]::IsNullOrWhiteSpace($Body)) {
    return ""
  }

  if ($Body.Length -le 1200) {
    return $Body
  }

  return $Body.Substring(0, 1200)
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)] [string] $Method,
    [Parameter(Mandatory = $true)] [string] $Url,
    [object] $Payload = $null
  )

  $bodyPath = $null
  $curlArgs = @(
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    "180",
    "--write-out",
    "`n__HTTP_STATUS__:%{http_code}`n",
    "--request",
    $Method,
    "--header",
    "Accept: application/json"
  )

  if ($null -ne $Payload) {
    $bodyPath = ConvertTo-Utf8JsonFile -Payload $Payload
    $curlArgs += @(
      "--header",
      "Content-Type: application/json; charset=utf-8",
      "--data-binary",
      "@$bodyPath"
    )
  }

  try {
    $curlArgs += $Url
    $raw = & curl.exe @curlArgs
    $exitCode = $LASTEXITCODE
    $rawText = ($raw -join "`n").Trim()

    if ($exitCode -ne 0) {
      throw "curl.exe failed with exit code $exitCode. Output: $(Get-BodyPreview -Body $rawText)"
    }

    $statusMatch = [regex]::Match($rawText, "__HTTP_STATUS__:(\d+)")
    $statusCode = if ($statusMatch.Success) { [int] $statusMatch.Groups[1].Value } else { 0 }
    $body = [regex]::Replace($rawText, "`n?__HTTP_STATUS__:\d+\s*$", "").Trim()

    if ($statusCode -lt 200 -or $statusCode -ge 300) {
      throw "HTTP $statusCode $Method $Url failed. Body preview: $(Get-BodyPreview -Body $body)"
    }

    $json = if ($body) { $body | ConvertFrom-Json -ErrorAction Stop } else { $null }

    return [pscustomobject]@{
      StatusCode = $statusCode
      Json = $json
    }
  }
  finally {
    if ($bodyPath -and (Test-Path -LiteralPath $bodyPath)) {
      Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Assert-Condition {
  param(
    [Parameter(Mandatory = $true)] [bool] $Condition,
    [Parameter(Mandatory = $true)] [string] $Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

Write-Host "SolarMate final production smoke test"
Write-Host "Backend: $BackendBaseUrl"

$health = (Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/db-health").Json
Assert-Condition ($health.ok -eq $true) "DB health did not return ok:true."
Assert-Condition ($health.supabaseEnabled -eq $true) "Supabase write is not enabled."
Assert-Condition ($health.canConnect -eq $true) "Supabase tables are not fully connected."

$requiredTables = @(
  "analysis_results",
  "consultation_requests",
  "simulation_training_samples",
  "profit_reports",
  "subsidy_programs",
  "loan_scenarios"
)

foreach ($tableName in $requiredTables) {
  $tableProperty = $health.tables.PSObject.Properties[$tableName]
  Assert-Condition ($null -ne $tableProperty) "DB health response is missing table key: $tableName"
  Assert-Condition ($tableProperty.Value -eq $true) "DB health table check failed for: $tableName"
}

$analysisPayload = @'
{
  "longitude": 127.072254,
  "latitude": 37.202501,
  "selectedBuildingId": "final-production-smoke-test",
  "selectedAnalysisSessionId": "final-production-smoke-test-session",
  "selectedBuildingFeature": {
    "type": "Feature",
    "properties": {
      "bld_id": "final-production-smoke-test",
      "bld_nm": "최종 운영 스모크 테스트 건물",
      "address": "경기도 화성시 테스트 주소"
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[
        [127.07220, 37.20245],
        [127.07235, 37.20245],
        [127.07235, 37.20260],
        [127.07220, 37.20260],
        [127.07220, 37.20245]
      ]]
    }
  },
  "panelCapacityW": 640,
  "panelAngle": 35,
  "panelType": 1,
  "cellsPerPanel": 2,
  "mode": "fast",
  "isTest": true,
  "source": "manual-production-test"
}
'@

$analysis = (Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/climate-rooftop-analysis" -Payload $analysisPayload).Json
Assert-Condition ($analysis.ok -eq $true) "Climate analysis did not return ok:true."
Assert-Condition (-not [string]::IsNullOrWhiteSpace($analysis.analysisResultId)) "analysisResultId is missing."
Assert-Condition ($analysis.dbSaveStatus.analysisResultOk -eq $true) "analysis_results insert was not confirmed."
Assert-Condition ($analysis.dbSaveStatus.trainingSampleOk -eq $true) "simulation_training_samples insert was not confirmed."

$profitPayload = @{
  analysisResultId = $analysis.analysisResultId
  isTest = $true
  source = "manual-production-test"
  userFinanceInput = @{
    availableCashKrw = 5000000
    preferredLoanYears = 5
    loanCoverageRatio = 0.8
  }
}

$profit = (Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/ai-profit-report" -Payload $profitPayload).Json
Assert-Condition ($profit.ok -eq $true) "AI profit report did not return ok:true."
Assert-Condition (-not [string]::IsNullOrWhiteSpace($profit.profitReportId)) "profitReportId is missing."
Assert-Condition ($profit.report.subsidyMatrix.policyMode -eq "gyeonggi_home_solar_only") "Subsidy policy mode is not expected."
Assert-Condition ($profit.report.subsidyMatrix.stackingAllowed -eq $false) "Subsidy stacking must be false."

$consultationPayload = @{
  name = "테스트사용자"
  contact = "010-9999-0000"
  email = "test@example.com"
  consultationType = "최종 운영 스모크 테스트"
  content = "최종 운영 스모크 테스트 상담 신청입니다."
  roadAddress = "경기도 화성시 테스트 주소"
  jibunAddress = "경기도 화성시 테스트 지번"
  analysisResultId = $analysis.analysisResultId
  profitReportId = $profit.profitReportId
  privacyAgreed = $true
  thirdPartyAgreed = $false
  isTest = $true
  source = "manual-production-test"
  agentPayload = @{
    analysisResultId = $analysis.analysisResultId
    profitReportId = $profit.profitReportId
    profitReport = @{
      profitReportId = $profit.profitReportId
      summary = $profit.report.reportNarrative.summary
    }
  }
}

$consultation = (Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/consultations" -Payload $consultationPayload).Json
Assert-Condition ($consultation.ok -eq $true) "Consultation request did not return ok:true."
Assert-Condition (-not [string]::IsNullOrWhiteSpace($consultation.consultationRequestId)) "consultationRequestId is missing."

$summary = [ordered]@{
  backendBaseUrl = $BackendBaseUrl
  dbHealthOk = $health.ok
  supabaseEnabled = $health.supabaseEnabled
  canConnect = $health.canConnect
  analysisResultId = $analysis.analysisResultId
  trainingSampleSaved = $analysis.dbSaveStatus.trainingSampleOk
  profitReportId = $profit.profitReportId
  profitReportSaved = $profit.dbSaveStatus.profitReportOk
  loanScenarioSaved = $profit.dbSaveStatus.loanScenarioOk
  consultationRequestId = $consultation.consultationRequestId
  consultationMessage = $consultation.message
  source = "manual-production-test"
  isTest = $true
}

Write-Host ""
Write-Host "Summary:"
$summary | ConvertTo-Json -Depth 10

exit 0
