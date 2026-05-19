# Run from repository root in Windows PowerShell.
# This uses npm.cmd to avoid npm.ps1 execution-policy issues.

Set-Location -Path "apps/web"
npm.cmd install
npm.cmd run dev
