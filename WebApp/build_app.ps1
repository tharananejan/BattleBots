# BattleBots standalone build script
# Requires: Node.js, Python 3.10+, and (optional) Inno Setup for the installer

$ErrorActionPreference = "Stop"
$WebAppRoot = $PSScriptRoot
$FrontendDir = Join-Path $WebAppRoot "BattleBotsFrontend"
$BackendDir = Join-Path $WebAppRoot "Backend"
$FrontendDist = Join-Path $FrontendDir "dist"
$StagedFrontend = Join-Path $BackendDir "frontend_dist"
$VenvDir = Join-Path $WebAppRoot "build_venv"
$SpecFile = Join-Path $WebAppRoot "BattleBots.spec"
$PyInstallerDist = Join-Path (Join-Path $WebAppRoot "dist") "BattleBots"

Write-Host "=== Step 1: Build React frontend ===" -ForegroundColor Cyan
Push-Location $FrontendDir
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $FrontendDist "index.html"))) {
    throw "Frontend build failed: index.html not found in $FrontendDist"
}

Write-Host "=== Step 2: Stage frontend into Backend/frontend_dist ===" -ForegroundColor Cyan
if (Test-Path $StagedFrontend) {
    Remove-Item $StagedFrontend -Recurse -Force
}
Copy-Item $FrontendDist $StagedFrontend -Recurse

Write-Host "=== Step 3: Set up Python build environment ===" -ForegroundColor Cyan
if (-not (Test-Path $VenvDir)) {
    python -m venv $VenvDir
}
$Python = Join-Path (Join-Path $VenvDir "Scripts") "python.exe"
$Pip = Join-Path (Join-Path $VenvDir "Scripts") "pip.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -r (Join-Path $BackendDir "requirements.txt") pyinstaller
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "=== Step 4: Run PyInstaller ===" -ForegroundColor Cyan
Push-Location $WebAppRoot
try {
    & $Python -m PyInstaller $SpecFile --noconfirm
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host "  Portable app: $PyInstallerDist\BattleBots.exe"

$InnoSetup = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($InnoSetup) {
    Write-Host "=== Step 5: Build Windows installer ===" -ForegroundColor Cyan
    & $InnoSetup (Join-Path $WebAppRoot "BattleBots.iss")
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Installer: $(Join-Path $WebAppRoot 'installer\BattleBotsSetup.exe')" -ForegroundColor Green
    } else {
        Write-Host "  Installer build failed" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Install Inno Setup and run: iscc.exe `"$(Join-Path $WebAppRoot 'BattleBots.iss')`""
}
