$ErrorActionPreference = "Stop"

Push-Location apps\web
try {
  npm.cmd install --no-audit --no-fund
  npm.cmd run build
}
finally {
  Pop-Location
}
