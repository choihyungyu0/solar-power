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
  $path = Join-Path $env:TEMP ("solarmate-profit-flow-{0}.json" -f ([guid]::NewGuid().ToString("N")))
  [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))

  return $path
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)] [string] $Method,
    [Parameter(Mandatory = $true)] [string] $Url,
    [object] $Payload = $null
  )

  $bodyPath = $null
  $curlArgs = @("-sS", "-w", "`n__HTTP_STATUS__:%{http_code}`n", "-X", $Method, "-H", "Accept: application/json")

  if ($null -ne $Payload) {
    $bodyPath = ConvertTo-Utf8JsonFile -Payload $Payload
    $curlArgs += @("-H", "Content-Type: application/json; charset=utf-8", "--data-binary", "@$bodyPath")
  }

  $curlArgs += $Url
  $raw = & curl.exe @curlArgs

  if ($bodyPath -and (Test-Path -LiteralPath $bodyPath)) {
    Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
  }

  $rawText = ($raw -join "`n").Trim()
  $statusMatch = [regex]::Match($rawText, "__HTTP_STATUS__:(\d+)")
  $statusCode = if ($statusMatch.Success) { [int] $statusMatch.Groups[1].Value } else { 0 }
  $body = [regex]::Replace($rawText, "`n?__HTTP_STATUS__:\d+\s*$", "").Trim()

  if ($statusCode -lt 200 -or $statusCode -ge 300) {
    $preview = if ($body.Length -gt 1200) { $body.Substring(0, 1200) } else { $body }
    throw "HTTP $statusCode $Method $Url failed. Body preview: $preview"
  }

  try {
    $json = if ($body) { $body | ConvertFrom-Json } else { $null }
  }
  catch {
    throw "HTTP $statusCode $Method $Url returned invalid JSON. Body preview: $body"
  }

  return [pscustomobject]@{
    StatusCode = $statusCode
    Json = $json
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

Write-Host "Testing SolarMate production AI profit report flow against $BackendBaseUrl"

$analysisPayload = @'
{
  "longitude": 127.072254,
  "latitude": 37.202501,
  "selectedBuildingId": "manual-profit-report-test",
  "selectedAnalysisSessionId": "manual-profit-report-test-session",
  "selectedBuildingFeature": {
    "type": "Feature",
    "properties": {
      "bld_id": "manual-profit-report-test",
      "bld_nm": "AI 수익 리포트 테스트 건물",
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
  "mode": "fast"
}
'@

$health = (Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/db-health").Json
Assert-Condition ($health.ok -eq $true) "DB health endpoint did not return ok:true."

$openApi = (Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/openapi.json").Json
$openApiHasProfitReportEndpoint = $null -ne $openApi.paths.PSObject.Properties["/api/ai-profit-report"]
Assert-Condition $openApiHasProfitReportEndpoint "/api/ai-profit-report is missing from Render OpenAPI docs. Deploy the latest backend first."

$analysis = (Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/climate-rooftop-analysis" -Payload $analysisPayload).Json
Assert-Condition ($analysis.ok -eq $true) "Climate analysis did not return ok:true."
Assert-Condition (-not [string]::IsNullOrWhiteSpace($analysis.analysisResultId)) "analysisResultId is missing."

$profitPayload = @{
  analysisResultId = $analysis.analysisResultId
  userFinanceInput = @{
    availableCashKrw = 5000000
    preferredLoanYears = 5
    loanCoverageRatio = 0.8
  }
}

$profit = (Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/ai-profit-report" -Payload $profitPayload).Json
Assert-Condition ($profit.ok -eq $true) "AI profit report did not return ok:true."
Assert-Condition (-not [string]::IsNullOrWhiteSpace($profit.profitReportId)) "profitReportId is missing. Check profit_reports table and backend deployment."
Assert-Condition ($null -ne $profit.report.fourMetrics) "report.fourMetrics is missing."
Assert-Condition ($profit.report.subsidyMatrix.policyMode -eq "gyeonggi_home_solar_only") "subsidy policy mode is not gyeonggi_home_solar_only."
Assert-Condition ($profit.report.subsidyMatrix.stackingAllowed -eq $false) "subsidy stacking must be false."
Assert-Condition (($profit.report.loanSupportScenario.loanApprovalStatus -as [string]) -like "*금융기관 심사 필요*") "loan approval disclaimer is missing."

$consultationPayload = @{
  name = "테스트사용자"
  contact = "010-0000-0000"
  email = "test@example.com"
  consultationType = "AI 수익 리포트 기반 상담"
  content = "AI 수익 리포트 운영 저장 테스트입니다. 리포트 요약: $($profit.report.reportNarrative.summary)"
  roadAddress = "경기도 화성시 테스트 주소"
  jibunAddress = "경기도 화성시 테스트 지번"
  analysisResultId = $analysis.analysisResultId
  profitReportId = $profit.profitReportId
  privacyAgreed = $true
  thirdPartyAgreed = $false
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

$summary = [pscustomobject]@{
  dbHealthOk = $health.ok
  supabaseEnabled = $health.supabaseEnabled
  canConnect = $health.canConnect
  openApiHasProfitReportEndpoint = $openApiHasProfitReportEndpoint
  analysisResultId = $analysis.analysisResultId
  profitReportId = $profit.profitReportId
  consultationRequestId = $consultation.consultationRequestId
  profitReportSaved = $profit.dbSaveStatus.profitReportOk
  loanScenarioSaved = $profit.dbSaveStatus.loanScenarioOk
  subsidyPolicyMode = $profit.report.subsidyMatrix.policyMode
  subsidyStackingAllowed = $profit.report.subsidyMatrix.stackingAllowed
  loanApprovalStatus = $profit.report.loanSupportScenario.loanApprovalStatus
}

Write-Host ""
Write-Host "Summary:"
$summary | ConvertTo-Json
