#!/usr/bin/env bash
# CFChart Universal Installer for Linux, macOS, and Windows (Git Bash / WSL / MSYS2)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sangiiko/CFChart/main/install.sh | bash

set -e

EXTENSION_ID="cfchart@sangiko.extension"
REPO="sangiiko/CFChart"
XPI_URL="https://github.com/${REPO}/releases/latest/download/cfchart.xpi"
CHROME_ZIP_URL="https://github.com/${REPO}/releases/latest/download/cfchart-chrome.zip"

# Styling
BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

log_info() { echo -e "${BLUE}${BOLD}[INFO]${RESET} $1"; }
log_ok()   { echo -e "${GREEN}${BOLD}[OK]${RESET} $1"; }
log_warn() { echo -e "${YELLOW}${BOLD}[WARN]${RESET} $1"; }
log_err()  { echo -e "${RED}${BOLD}[ERROR]${RESET} $1"; }

echo -e "${CYAN}${BOLD}"
echo "  ____ _____ ____ _hart "
echo " / ___|  ___/ ___| |__   __ _ _ __| |_ "
echo "| |   | |_ | |   | '_ \ / _\` | '__| __|"
echo "| |___|  _|| |___| | | | (_| | |  | |_ "
echo " \____|_|   \____|_| |_|\__,_|_|   \__|"
echo "  Universal 1-Line Installer v2.0"
echo -e "${RESET}"

# 1. Detect Operating System
OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="macos" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) PLATFORM="unknown" ;;
esac
log_info "Detected operating system: ${BOLD}${PLATFORM}${RESET} ($OS)"

# Temporary workspace
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'cfchart')"
trap 'rm -rf "$TMP_DIR"' EXIT

# 2. Acquire Packages (Local files if inside repo, otherwise fetch from GitHub)
XPI_FILE=""
CHROME_ZIP=""

if [ -f "cfchart.xpi" ]; then
  log_info "Using local package: cfchart.xpi"
  XPI_FILE="$(pwd)/cfchart.xpi"
elif [ -d "dist" ]; then
  log_info "Building local cfchart.xpi from dist/..."
  (cd dist && zip -r -FS -q "$TMP_DIR/cfchart.xpi" .)
  XPI_FILE="$TMP_DIR/cfchart.xpi"
fi

if [ -f "cfchart-chrome.zip" ]; then
  CHROME_ZIP="$(pwd)/cfchart-chrome.zip"
elif [ -d "dist-chrome" ]; then
  (cd dist-chrome && zip -r -FS -q "$TMP_DIR/cfchart-chrome.zip" .)
  CHROME_ZIP="$TMP_DIR/cfchart-chrome.zip"
fi

# Download if not found locally
if [ -z "$XPI_FILE" ] || [ ! -f "$XPI_FILE" ]; then
  log_info "Downloading latest cfchart.xpi from GitHub Releases..."
  XPI_FILE="$TMP_DIR/cfchart.xpi"
  if ! curl -fsSL -L "$XPI_URL" -o "$XPI_FILE"; then
    log_warn "Could not download cfchart.xpi from latest release. Checking if repo source is accessible..."
  fi
fi

if [ -z "$CHROME_ZIP" ] || [ ! -f "$CHROME_ZIP" ]; then
  CHROME_ZIP="$TMP_DIR/cfchart-chrome.zip"
  curl -fsSL -L "$CHROME_ZIP_URL" -o "$CHROME_ZIP" 2>/dev/null || true
fi

INSTALLED_GECKO=0
INSTALLED_CHROMIUM=0

# 3. Detect and Install for Gecko / Firefox-based Browsers
# (Firefox, Zen Browser, LibreWolf, Floorp, Waterfox, Tor Browser)
GECKO_SEARCH_DIRS=()

if [ "$PLATFORM" = "linux" ]; then
  GECKO_SEARCH_DIRS+=(
    "$HOME/.mozilla/firefox"
    "$HOME/.config/zen"
    "$HOME/.zen"
    "$HOME/.librewolf"
    "$HOME/.floorp"
    "$HOME/.waterfox"
  )
elif [ "$PLATFORM" = "macos" ]; then
  GECKO_SEARCH_DIRS+=(
    "$HOME/Library/Application Support/Firefox/Profiles"
    "$HOME/Library/Application Support/Firefox"
    "$HOME/Library/Application Support/zen/Profiles"
    "$HOME/Library/Application Support/zen"
    "$HOME/Library/Application Support/LibreWolf/Profiles"
    "$HOME/Library/Application Support/Floorp/Profiles"
    "$HOME/Library/Application Support/Waterfox/Profiles"
  )
elif [ "$PLATFORM" = "windows" ]; then
  APPDATA_WIN="${APPDATA:-$HOME/AppData/Roaming}"
  GECKO_SEARCH_DIRS+=(
    "$APPDATA_WIN/Mozilla/Firefox/Profiles"
    "$APPDATA_WIN/zen/Profiles"
    "$APPDATA_WIN/librewolf/Profiles"
    "$APPDATA_WIN/floorp/Profiles"
    "$APPDATA_WIN/Waterfox/Profiles"
  )
fi

install_gecko_profile() {
  local prof_dir="$1"
  local browser_name="$2"

  local ext_dir="$prof_dir/extensions"
  mkdir -p "$ext_dir"
  cp -f "$XPI_FILE" "$ext_dir/${EXTENSION_ID}.xpi"

  # Ensure user.js allows unverified self-hosted extensions
  local user_js="$prof_dir/user.js"
  local pref_line='user_pref("xpinstall.signatures.required", false);'
  if [ -f "$user_js" ]; then
    if ! grep -q "xpinstall.signatures.required" "$user_js"; then
      echo -e "\n$pref_line" >> "$user_js"
    fi
  else
    echo "$pref_line" > "$user_js"
  fi

  log_ok "Installed for ${BOLD}${browser_name}${RESET} profile: $(basename "$prof_dir")"
  INSTALLED_GECKO=$((INSTALLED_GECKO + 1))
}

if [ -f "$XPI_FILE" ]; then
  log_info "Scanning for Firefox-family profiles (Firefox, Zen, LibreWolf, Floorp)..."
  for base_dir in "${GECKO_SEARCH_DIRS[@]}"; do
    if [ -d "$base_dir" ]; then
      # Determine browser display name
      B_NAME="Firefox-family"
      [[ "$base_dir" == *"zen"* ]] && B_NAME="Zen Browser"
      [[ "$base_dir" == *"firefox"* ]] || [[ "$base_dir" == *"Firefox"* ]] && B_NAME="Firefox"
      [[ "$base_dir" == *"librewolf"* ]] || [[ "$base_dir" == *"LibreWolf"* ]] && B_NAME="LibreWolf"
      [[ "$base_dir" == *"floorp"* ]] && B_NAME="Floorp"
      [[ "$base_dir" == *"waterfox"* ]] && B_NAME="Waterfox"

      # Check if base_dir itself is a profile (contains prefs.js)
      if [ -f "$base_dir/prefs.js" ]; then
        install_gecko_profile "$base_dir" "$B_NAME"
      fi

      # Check subdirectories
      for sub in "$base_dir"/*; do
        if [ -d "$sub" ] && { [ -f "$sub/prefs.js" ] || [ -f "$sub/times.json" ] || [[ "$(basename "$sub")" == *.* ]]; }; then
          # Avoid directories like Crash Reports, Pending Pings
          bname="$(basename "$sub")"
          if [[ "$bname" != "Crash Reports" && "$bname" != "Pending Pings" && "$bname" != "extensions" && "$bname" != "Profiles" ]]; then
            install_gecko_profile "$sub" "$B_NAME"
          fi
        fi
      done
    fi
  done
fi

# 4. Detect and Setup for Chromium-based Browsers
# (Google Chrome, Brave, Microsoft Edge, Chromium)
CHROME_TARGET_DIR=""
if [ "$PLATFORM" = "windows" ]; then
  CHROME_TARGET_DIR="${LOCALAPPDATA:-$HOME/AppData/Local}/cfchart/chrome"
else
  CHROME_TARGET_DIR="$HOME/.local/share/cfchart/chrome"
fi

setup_chromium() {
  log_info "Setting up for Chromium-family browsers (Chrome, Brave, Edge)..."
  mkdir -p "$CHROME_TARGET_DIR"

  if [ -f "$CHROME_ZIP" ] && [ -s "$CHROME_ZIP" ]; then
    unzip -q -o "$CHROME_ZIP" -d "$CHROME_TARGET_DIR"
  elif [ -d "dist-chrome" ]; then
    cp -rf dist-chrome/* "$CHROME_TARGET_DIR/"
  elif [ -f "$XPI_FILE" ]; then
    unzip -q -o "$XPI_FILE" -d "$CHROME_TARGET_DIR"
    # Ensure manifest has background service worker for Chrome
    if [ -f "$CHROME_TARGET_DIR/manifest.json" ]; then
      sed -i.bak 's/"scripts": \["background.js"\]/"service_worker": "background.js"/g' "$CHROME_TARGET_DIR/manifest.json" 2>/dev/null || true
      rm -f "$CHROME_TARGET_DIR/manifest.json.bak"
    fi
  fi

  if [ -f "$CHROME_TARGET_DIR/manifest.json" ]; then
    log_ok "Prepared Chrome unpacked extension at: ${BOLD}${CHROME_TARGET_DIR}${RESET}"
    INSTALLED_CHROMIUM=1

    # Optional Linux/macOS External Extensions JSON drop-in
    EXTERNAL_DIRS=()
    if [ "$PLATFORM" = "linux" ]; then
      EXTERNAL_DIRS+=(
        "$HOME/.config/google-chrome/External Extensions"
        "$HOME/.config/chromium/External Extensions"
        "$HOME/.config/BraveSoftware/Brave-Browser/External Extensions"
        "$HOME/.config/microsoft-edge/External Extensions"
      )
    elif [ "$PLATFORM" = "macos" ]; then
      EXTERNAL_DIRS+=(
        "$HOME/Library/Application Support/Google/Chrome/External Extensions"
        "$HOME/Library/Application Support/Chromium/External Extensions"
        "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/External Extensions"
        "$HOME/Library/Application Support/Microsoft Edge/External Extensions"
      )
    fi

    for ext_dir in "${EXTERNAL_DIRS[@]}"; do
      parent_dir="$(dirname "$ext_dir")"
      if [ -d "$parent_dir" ]; then
        mkdir -p "$ext_dir"
        cat <<EOF > "$ext_dir/cfchart.json"
{
  "external_path": "${CHROME_TARGET_DIR}"
}
EOF
        log_ok "Registered external extension in: $(basename "$parent_dir")"
      fi
    done
  fi
}

setup_chromium

# 5. Summary & Guidance
echo ""
echo -e "${GREEN}${BOLD}====================================================${RESET}"
echo -e "${GREEN}${BOLD}        CFChart Installation Complete! 🎉           ${RESET}"
echo -e "${GREEN}${BOLD}====================================================${RESET}"
echo ""

if [ $INSTALLED_GECKO -gt 0 ]; then
  echo -e "🦊 ${BOLD}Firefox / Zen / LibreWolf / Floorp:${RESET}"
  echo -e "   • Đã cài đặt thành công vào ${GREEN}${INSTALLED_GECKO}${RESET} profile."
  echo -e "   • Đã tự động cấu hình bypass chữ ký trong ${CYAN}user.js${RESET}."
  echo -e "   • ${YELLOW}Chỉ cần khởi động lại trình duyệt để kích hoạt!${RESET}"
  echo ""
fi

if [ $INSTALLED_CHROMIUM -gt 0 ]; then
  echo -e "🌐 ${BOLD}Chrome / Brave / Edge / Chromium:${RESET}"
  echo -e "   • Mã nguồn extension đã sẵn sàng tại: ${CYAN}${CHROME_TARGET_DIR}${RESET}"
  echo -e "   • Để hoàn tất kích hoạt (chỉ làm 1 lần):"
  echo -e "     1. Mở trang quản lý tiện ích: ${BOLD}chrome://extensions${RESET} hoặc ${BOLD}brave://extensions${RESET}"
  echo -e "     2. Bật công tắc ${BOLD}Developer mode${RESET} (Chế độ nhà phát triển) ở góc trên bên phải."
  echo -e "     3. Bấm nút ${BOLD}Load unpacked${RESET} (Tải tiện ích đã giải nén) và chọn thư mục:"
  echo -e "        ${CYAN}${CHROME_TARGET_DIR}${RESET}"
  echo ""
fi

echo -e "Mở Codeforces (${CYAN}https://codeforces.com${RESET}) để tận hưởng biểu đồ rating cải tiến và streak luyện tập!"
echo ""
