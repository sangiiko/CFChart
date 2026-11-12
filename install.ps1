# CFChart Universal Installer for Windows PowerShell
# Usage:
#   irm https://raw.githubusercontent.com/sangiiko/CFChart/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$ExtensionId = "cfchart@sangiko.extension"
$Repo = "sangiiko/CFChart"
$XpiUrl = "https://github.com/$Repo/releases/latest/download/cfchart.xpi"
$ChromeZipUrl = "https://github.com/$Repo/releases/latest/download/cfchart-chrome.zip"

Write-Host "  ____ _____ ____ _hart " -ForegroundColor Cyan
Write-Host " / ___|  ___/ ___| |__   __ _ _ __| |_ " -ForegroundColor Cyan
Write-Host "| |   | |_ | |   | '_ \ / _` | '__| __|" -ForegroundColor Cyan
Write-Host "| |___|  _|| |___| | | | (_| | |  | |_ " -ForegroundColor Cyan
Write-Host " \____|_|   \____|_| |_|\__,_|_|   \__|" -ForegroundColor Cyan
Write-Host "  Windows PowerShell 1-Line Installer v2.0`n" -ForegroundColor DarkCyan

$TempDir = Join-Path $env:TEMP ("cfchart-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    $XpiFile = ""
    $ChromeZip = ""

    # Check local packages first
    if (Test-Path "cfchart.xpi") {
        Write-Host "[INFO] Using local package: cfchart.xpi" -ForegroundColor Blue
        $XpiFile = (Resolve-Path "cfchart.xpi").Path
    } elseif (Test-Path "dist") {
        Write-Host "[INFO] Packaging local dist/..." -ForegroundColor Blue
        $XpiFile = Join-Path $TempDir "cfchart.xpi"
        Compress-Archive -Path "dist\*" -DestinationPath $XpiFile -Force
    }

    if (Test-Path "cfchart-chrome.zip") {
        $ChromeZip = (Resolve-Path "cfchart-chrome.zip").Path
    } elseif (Test-Path "dist-chrome") {
        $ChromeZip = Join-Path $TempDir "cfchart-chrome.zip"
        Compress-Archive -Path "dist-chrome\*" -DestinationPath $ChromeZip -Force
    }

    # Download from GitHub Releases if not found locally
    if (-not $XpiFile -or -not (Test-Path $XpiFile)) {
        Write-Host "[INFO] Downloading latest cfchart.xpi from GitHub Releases..." -ForegroundColor Blue
        $XpiFile = Join-Path $TempDir "cfchart.xpi"
        Invoke-WebRequest -Uri $XpiUrl -OutFile $XpiFile -UseBasicParsing
    }

    if (-not $ChromeZip -or -not (Test-Path $ChromeZip)) {
        $ChromeZip = Join-Path $TempDir "cfchart-chrome.zip"
        try {
            Invoke-WebRequest -Uri $ChromeZipUrl -OutFile $ChromeZip -UseBasicParsing
        } catch {
            # Optional, fall back to xpi extraction
        }
    }

    $InstalledGecko = 0

    # 1. Search Gecko Profiles
    $GeckoRoots = @(
        (Join-Path $env:APPDATA "Mozilla\Firefox\Profiles"),
        (Join-Path $env:APPDATA "zen\Profiles"),
        (Join-Path $env:APPDATA "librewolf\Profiles"),
        (Join-Path $env:APPDATA "floorp\Profiles"),
        (Join-Path $env:APPDATA "Waterfox\Profiles")
    )

    Write-Host "[INFO] Scanning for Firefox, Zen, LibreWolf, Floorp profiles..." -ForegroundColor Blue

    foreach ($Root in $GeckoRoots) {
        if (Test-Path $Root) {
            $BrowserName = "Firefox-family"
            if ($Root -match "zen") { $BrowserName = "Zen Browser" }
            elseif ($Root -match "Firefox") { $BrowserName = "Firefox" }
            elseif ($Root -match "librewolf") { $BrowserName = "LibreWolf" }
            elseif ($Root -match "floorp") { $BrowserName = "Floorp" }
            elseif ($Root -match "Waterfox") { $BrowserName = "Waterfox" }

            $Profiles = Get-ChildItem -Path $Root -Directory
            foreach ($Prof in $Profiles) {
                $ExtDir = Join-Path $Prof.FullName "extensions"
                New-Item -ItemType Directory -Path $ExtDir -Force | Out-Null
                Copy-Item -Path $XpiFile -Destination (Join-Path $ExtDir "$ExtensionId.xpi") -Force

                $UserJs = Join-Path $Prof.FullName "user.js"
                $Pref = 'user_pref("xpinstall.signatures.required", false);'
                if (Test-Path $UserJs) {
                    $Content = Get-Content $UserJs -Raw
                    if ($Content -notmatch "xpinstall\.signatures\.required") {
                        Add-Content -Path $UserJs -Value "`n$Pref"
                    }
                } else {
                    Set-Content -Path $UserJs -Value $Pref
                }

                Write-Host "[OK] Installed for $BrowserName profile: $($Prof.Name)" -ForegroundColor Green
                $InstalledGecko++
            }
        }
    }

    # 2. Setup Chromium Directory
    $ChromeTargetDir = Join-Path $env:LOCALAPPDATA "cfchart\chrome"
    Write-Host "[INFO] Setting up Chromium extension directory..." -ForegroundColor Blue
    New-Item -ItemType Directory -Path $ChromeTargetDir -Force | Out-Null

    if ($ChromeZip -and (Test-Path $ChromeZip)) {
        Expand-Archive -Path $ChromeZip -DestinationPath $ChromeTargetDir -Force
    } elseif (Test-Path "dist-chrome") {
        Copy-Item -Path "dist-chrome\*" -Destination $ChromeTargetDir -Recurse -Force
    } elseif (Test-Path $XpiFile) {
        Expand-Archive -Path $XpiFile -DestinationPath $ChromeTargetDir -Force
    }

    Write-Host "[OK] Prepared Chrome unpacked extension at: $ChromeTargetDir" -ForegroundColor Green

    # Summary
    Write-Host "`n====================================================" -ForegroundColor Green
    Write-Host "        CFChart Installation Complete! 🎉           " -ForegroundColor Green
    Write-Host "====================================================`n" -ForegroundColor Green

    if ($InstalledGecko -gt 0) {
        Write-Host "🦊 Firefox / Zen / LibreWolf / Floorp:" -ForegroundColor Yellow
        Write-Host "   • Đã cài đặt thành công vào $InstalledGecko profile."
        Write-Host "   • Đã tự động cấu hình bypass chữ ký trong user.js."
        Write-Host "   • Chỉ cần khởi động lại trình duyệt để kích hoạt!`n" -ForegroundColor Cyan
    }

    Write-Host "🌐 Chrome / Brave / Edge / Chromium:" -ForegroundColor Yellow
    Write-Host "   • Mã nguồn extension đã sẵn sàng tại: $ChromeTargetDir"
    Write-Host "   • Để hoàn tất kích hoạt (chỉ làm 1 lần):"
    Write-Host "     1. Mở trang: chrome://extensions hoặc edge://extensions hoặc brave://extensions"
    Write-Host "     2. Bật công tắc Developer mode (Chế độ cho nhà phát triển)."
    Write-Host "     3. Bấm nút Load unpacked (Tải tiện ích đã giải nén) và chọn thư mục:"
    Write-Host "        $ChromeTargetDir`n" -ForegroundColor Cyan

    Write-Host "Mở Codeforces (https://codeforces.com) để sử dụng ngay!`n"
}
finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
