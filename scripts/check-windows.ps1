$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webAppPath = Join-Path $repoRoot "apps\web"

function Invoke-WebNpm {
  param(
    [string[]] $Arguments
  )

  $process = Start-Process -FilePath "npm.cmd" -ArgumentList $Arguments -WorkingDirectory $webAppPath -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "npm.cmd $($Arguments -join ' ') failed with exit code $($process.ExitCode)"
  }
}

Invoke-WebNpm -Arguments @("install", "--no-audit", "--no-fund")
Invoke-WebNpm -Arguments @("run", "build")
