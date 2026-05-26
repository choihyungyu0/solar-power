$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BackendBaseUrl = $env:SOLARMATE_BACKEND_URL
if ([string]::IsNullOrWhiteSpace($BackendBaseUrl)) {
  $BackendBaseUrl = "https://solarmate-climate-backend.onrender.com"
}
$BackendBaseUrl = $BackendBaseUrl.TrimEnd("/")

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

function Get-ErrorResponseBody {
  param(
    [object] $ErrorRecord
  )

  try {
    $response = $ErrorRecord.Exception.Response

    if ($null -eq $response) {
      return ""
    }

    if ($response.Content) {
      return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }

    $stream = $response.GetResponseStream()
    if ($null -eq $stream) {
      return ""
    }

    $reader = [System.IO.StreamReader]::new($stream)
    try {
      return $reader.ReadToEnd()
    }
    finally {
      $reader.Dispose()
    }
  }
  catch {
    return ""
  }
}

function Get-ErrorStatusCode {
  param(
    [object] $ErrorRecord
  )

  try {
    $response = $ErrorRecord.Exception.Response

    if ($null -eq $response) {
      return $null
    }

    if ($response.StatusCode -is [int]) {
      return $response.StatusCode
    }

    return [int]$response.StatusCode
  }
  catch {
    return $null
  }
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("GET", "POST")]
    [string] $Method,

    [Parameter(Mandatory = $true)]
    [string] $Path,

    [object] $Body = $null
  )

  $uri = "$BackendBaseUrl$Path"
  $headers = @{
    Accept = "application/json"
  }
  $requestParams = @{
    Uri = $uri
    Method = $Method
    Headers = $headers
    TimeoutSec = 180
    ErrorAction = "Stop"
  }

  if ($null -ne $Body) {
    $requestParams["ContentType"] = "application/json; charset=utf-8"
    $requestParams["Body"] = ($Body | ConvertTo-Json -Depth 30)
  }

  try {
    $response = Invoke-WebRequest @requestParams
    $content = [string]$response.Content
    $json = $null

    if (-not [string]::IsNullOrWhiteSpace($content)) {
      $json = $content | ConvertFrom-Json -ErrorAction Stop
    }

    return [pscustomobject]@{
      Ok = $true
      StatusCode = [int]$response.StatusCode
      Json = $json
      Body = $content
      Error = $null
    }
  }
  catch {
    $statusCode = Get-ErrorStatusCode -ErrorRecord $_
    $bodyText = Get-ErrorResponseBody -ErrorRecord $_
    $preview = Get-BodyPreview -Body $bodyText

    Write-Host "Request failed: $Method $uri"
    if ($null -ne $statusCode) {
      Write-Host "HTTP status: $statusCode"
    }
    Write-Host "Error: $($_.Exception.Message)"
    if ($preview) {
      Write-Host "Response preview:"
      Write-Host $preview
    }

    return [pscustomobject]@{
      Ok = $false
      StatusCode = $statusCode
      Json = $null
      Body = $bodyText
      Error = $_.Exception.Message
    }
  }
}

function Add-Failure {
  param(
    [string] $Message
  )

  $script:Failures += $Message
  Write-Host "FAIL: $Message"
}

function Convert-JsonEscapedString {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Value
  )

  return ('"{0}"' -f $Value) | ConvertFrom-Json
}

$Failures = @()
$ManualRoofRing = @(
  @(127.07220, 37.20245),
  @(127.07235, 37.20245),
  @(127.07235, 37.20260),
  @(127.07220, 37.20260),
  @(127.07220, 37.20245)
)

$analysisPayload = @{
  longitude = 127.072254
  latitude = 37.202501
  selectedBuildingId = "manual-supabase-test"
  selectedAnalysisSessionId = "manual-supabase-test-session"
  selectedBuildingFeature = @{
    type = "Feature"
    properties = @{
      bld_id = "manual-supabase-test"
      bld_nm = (Convert-JsonEscapedString "\uc218\ub3d9 Supabase \ud14c\uc2a4\ud2b8 \uac74\ubb3c")
      address = (Convert-JsonEscapedString "\uacbd\uae30\ub3c4 \ud654\uc131\uc2dc \ud14c\uc2a4\ud2b8 \uc8fc\uc18c")
    }
    geometry = @{
      type = "Polygon"
      coordinates = @(, $ManualRoofRing)
    }
  }
  panelCapacityW = 640
  panelAngle = 35
  panelType = 1
  cellsPerPanel = 2
  mode = "fast"
}

Write-Host "Testing SolarMate production Supabase flow against $BackendBaseUrl"

$dbHealth = Invoke-JsonRequest -Method "GET" -Path "/api/db-health"
if (-not $dbHealth.Ok) {
  Add-Failure "DB health request failed."
}

$analysis = Invoke-JsonRequest -Method "POST" -Path "/api/climate-rooftop-analysis" -Body $analysisPayload
if (-not $analysis.Ok) {
  Add-Failure "Climate analysis request failed."
}

$analysisResultId = if ($analysis.Json -and $analysis.Json.analysisResultId) { [string]$analysis.Json.analysisResultId } else { $null }
$analysisResultSaved = $analysis.Json -and $analysis.Json.dbSaveStatus -and $analysis.Json.dbSaveStatus.analysisResultOk -eq $true
$trainingSampleSaved = $analysis.Json -and $analysis.Json.dbSaveStatus -and $analysis.Json.dbSaveStatus.trainingSampleOk -eq $true

if (-not ($analysis.Json -and $analysis.Json.ok -eq $true)) {
  Add-Failure "Climate analysis response did not return ok:true."
}
if ([string]::IsNullOrWhiteSpace($analysisResultId)) {
  Add-Failure "Climate analysis response did not return analysisResultId."
}
if (-not $analysisResultSaved) {
  Add-Failure "analysis_results insert was not confirmed."
}
if (-not $trainingSampleSaved) {
  Add-Failure "simulation_training_samples insert was not confirmed."
}
if (-not ($analysis.Json -and $analysis.Json.aiSimulationResult)) {
  Add-Failure "Climate analysis response did not include aiSimulationResult."
}
if (-not ($analysis.Json -and $analysis.Json.agentPayload)) {
  Add-Failure "Climate analysis response did not include agentPayload."
}

$consultationPayload = @{
  name = (Convert-JsonEscapedString "\ud14c\uc2a4\ud2b8\uc0ac\uc6a9\uc790")
  contact = "010-0000-0000"
  email = "test@example.com"
  consultationType = (Convert-JsonEscapedString "\uc124\uce58 \uac00\ub2a5 \uc5ec\ubd80 \uc0c1\ub2f4")
  content = (Convert-JsonEscapedString "Supabase \uc0c1\ub2f4 \uc800\uc7a5 \ud14c\uc2a4\ud2b8\uc785\ub2c8\ub2e4.")
  roadAddress = (Convert-JsonEscapedString "\uacbd\uae30\ub3c4 \ud654\uc131\uc2dc \ud14c\uc2a4\ud2b8 \uc8fc\uc18c")
  jibunAddress = (Convert-JsonEscapedString "\uacbd\uae30\ub3c4 \ud654\uc131\uc2dc \ud14c\uc2a4\ud2b8 \uc9c0\ubc88")
  analysisResultId = $analysisResultId
  privacyAgreed = $true
  thirdPartyAgreed = $false
  agentPayload = @{
    summaryForCounselor = (Convert-JsonEscapedString "\uc218\ub3d9 \ud14c\uc2a4\ud2b8 \uc0c1\ub2f4 payload\uc785\ub2c8\ub2e4.")
    nextStep = (Convert-JsonEscapedString "\uc800\uc7a5 \ud655\uc778")
  }
}

$consultation = $null
if (-not [string]::IsNullOrWhiteSpace($analysisResultId)) {
  $consultation = Invoke-JsonRequest -Method "POST" -Path "/api/consultations" -Body $consultationPayload
  if (-not $consultation.Ok) {
    Add-Failure "Consultation request failed."
  }
}
else {
  Add-Failure "Consultation request skipped because analysisResultId is missing."
}

$consultationRequestId = if ($consultation -and $consultation.Json -and $consultation.Json.consultationRequestId) {
  [string]$consultation.Json.consultationRequestId
} else {
  $null
}

if (-not ($consultation -and $consultation.Json -and $consultation.Json.ok -eq $true)) {
  Add-Failure "Consultation response did not return ok:true."
}
if ([string]::IsNullOrWhiteSpace($consultationRequestId)) {
  Add-Failure "Consultation response did not return consultationRequestId."
}

$summary = [ordered]@{
  dbHealthOk = [bool]($dbHealth.Json -and $dbHealth.Json.ok -eq $true)
  supabaseEnabled = [bool]($dbHealth.Json -and $dbHealth.Json.supabaseEnabled -eq $true)
  canConnect = [bool]($dbHealth.Json -and $dbHealth.Json.canConnect -eq $true)
  analysisOk = [bool]($analysis.Json -and $analysis.Json.ok -eq $true)
  analysisResultId = $analysisResultId
  analysisResultSaved = [bool]$analysisResultSaved
  trainingSampleSaved = [bool]$trainingSampleSaved
  consultationOk = [bool]($consultation -and $consultation.Json -and $consultation.Json.ok -eq $true)
  consultationRequestId = $consultationRequestId
}

Write-Host ""
Write-Host "Summary:"
$summary | ConvertTo-Json -Depth 8

if ($Failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Failures:"
  $Failures | ForEach-Object { Write-Host "- $_" }
  exit 1
}

exit 0
