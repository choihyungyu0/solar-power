$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webAppPath = Join-Path $repoRoot "apps\web"

function Invoke-WebNpm {
  param(
    [string[]] $Arguments
  )

  Push-Location $webAppPath
  try {
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm.cmd $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  }
  finally {
    Pop-Location
  }
}

Invoke-WebNpm -Arguments @("install", "--no-audit", "--no-fund")
Invoke-WebNpm -Arguments @("run", "build")
