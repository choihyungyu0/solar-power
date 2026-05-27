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
  $path = Join-Path $env:TEMP ("solarmate-subsidy-rag-{0}.json" -f ([guid]::NewGuid().ToString("N")))
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

Write-Host "Testing SolarMate production subsidy RAG flow against $BackendBaseUrl"

$health = (Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/db-health").Json
Assert-Condition ($health.ok -eq $true) "DB health endpoint did not return ok:true."

foreach ($tableName in @("subsidy_documents", "subsidy_chunks")) {
  $tableProperty = $health.tables.PSObject.Properties[$tableName]
  Assert-Condition ($null -ne $tableProperty) "DB health response is missing table key: $tableName"
  Assert-Condition ($tableProperty.Value -eq $true) "DB health table check failed for: $tableName"
}

$rpcProperty = if ($null -ne $health.rpcs) { $health.rpcs.PSObject.Properties["match_subsidy_chunks"] } else { $null }
Assert-Condition ($null -ne $rpcProperty) "DB health response is missing match_subsidy_chunks RPC status."
Assert-Condition ($rpcProperty.Value -eq $true) "match_subsidy_chunks RPC check failed."

$ragPayload = @{
  regionSido = "경기도"
  regionSigungu = "화성시"
  buildingUsage = "공동주택"
  installCapacityKw = 3
  query = "화성시 경기 주택태양광 지원사업 보조금 중복 지원 여부"
}

$rag = (Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/subsidy-rag/search" -Payload $ragPayload).Json
Assert-Condition ($rag.ok -eq $true) "Subsidy RAG search did not return ok:true."
Assert-Condition ($rag.ragEnabled -eq $true) "Subsidy RAG is not enabled."
Assert-Condition ($rag.matches.Count -gt 0) "Subsidy RAG search returned no matches."

$analysisPayload = @'
{
  "longitude": 127.072254,
  "latitude": 37.202501,
  "selectedBuildingId": "manual-subsidy-rag-test",
  "selectedAnalysisSessionId": "manual-subsidy-rag-test-session",
  "selectedBuildingFeature": {
    "type": "Feature",
    "properties": {
      "bld_id": "manual-subsidy-rag-test",
      "bld_nm": "보조금 RAG 테스트 건물",
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

$profitPayload = @{
  analysisResultId = $analysis.analysisResultId
  forceRegenerate = $true
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
Assert-Condition ($profit.report.subsidyRagContext.enabled -eq $true) "report.subsidyRagContext.enabled must be true."
Assert-Condition ($profit.report.subsidyRagContext.matches.Count -gt 0) "report.subsidyRagContext.matches is empty."
Assert-Condition ($profit.report.sourceReferences.Count -gt 0) "report.sourceReferences is empty."
Assert-Condition ($profit.report.subsidyMatrix.policyMode -eq "gyeonggi_home_solar_only") "subsidy policy mode is not gyeonggi_home_solar_only."
Assert-Condition ($profit.report.subsidyMatrix.stackingAllowed -eq $false) "subsidy stacking must be false."

$firstMatch = $profit.report.subsidyRagContext.matches[0]
$firstSource = $profit.report.sourceReferences[0]
$summary = [pscustomobject]@{
  analysisResultId = $analysis.analysisResultId
  profitReportId = $profit.profitReportId
  firstSourceTitle = $firstSource.sourceTitle
  firstSimilarity = $firstMatch.similarity
  reportNarrativeSource = $profit.report.reportNarrativeSource
}

Write-Host ""
Write-Host "Summary:"
$summary | ConvertTo-Json
