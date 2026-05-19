$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host "[harness] repo root: $repoRoot"

if (!(Test-Path "apps/web/package.json")) {
  throw "apps/web/package.json 파일을 찾을 수 없습니다. 레포 루트에서 실행되는지 확인하세요."
}

Push-Location "apps/web"
try {
  Write-Host "[harness] installing frontend dependencies with npm.cmd"
  npm.cmd install

  Write-Host "[harness] building frontend"
  npm.cmd run build

  Write-Host "[harness] success"
}
finally {
  Pop-Location
}
