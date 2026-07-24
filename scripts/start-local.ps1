# Local sandbox (no VPS deploy). From repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Host "==> Volvo EWD local sandbox" -ForegroundColor Cyan
Write-Host "    API  http://localhost:3000"
Write-Host "    UI   http://localhost:5173  (Vite proxies /api -> :3000)"
Write-Host ""

if (-not (Test-Path "node_modules")) {
  Write-Host "==> npm install" -ForegroundColor Yellow
  npm install
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "==> created .env from .env.example (edit secrets if needed)" -ForegroundColor Yellow
}

# Force development for local runs even if .env says production
$env:NODE_ENV = "development"
$env:PORT = if ($env:PORT) { $env:PORT } else { "3000" }
$env:DATABASE_PATH = if ($env:DATABASE_PATH) { $env:DATABASE_PATH } else { "data/wiring.sqlite" }
$env:DTC_DATABASE_PATH = if ($env:DTC_DATABASE_PATH) { $env:DTC_DATABASE_PATH } else { "data/dtc.sqlite" }
$env:EWD_DATA_DIR = if ($env:EWD_DATA_DIR) { $env:EWD_DATA_DIR } else { "data/ewd" }

$missing = @()
if (-not (Test-Path $env:DATABASE_PATH)) { $missing += $env:DATABASE_PATH }
if (-not (Test-Path (Join-Path $env:EWD_DATA_DIR "svg_desc_index.json"))) {
  $missing += "data/ewd/svg_desc_index.json"
}
if ($missing.Count) {
  Write-Host "WARN: missing data files:" -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host "  - $_" }
  Write-Host "EWD schemes need indexes + ewd_source SVG tree under data/ewd/."
  Write-Host ""
}

Write-Host "==> npm run dev (Ctrl+C to stop)" -ForegroundColor Green
npm run dev
