$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodePath = $nodeCommand.Source }
else { $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 22 or later first.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\next\dist\bin\next'))) { throw 'Dependencies missing. Run pnpm install first.' }
Write-Host 'Open http://127.0.0.1:3000 . Press Ctrl+C to stop.'
& $nodePath 'node_modules/next/dist/bin/next' dev --hostname 127.0.0.1
exit $LASTEXITCODE
