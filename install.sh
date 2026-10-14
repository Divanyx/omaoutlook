#!/bin/bash
# Builds the Outlook window (the host) and installs it for the current user.
# The Omarchy plugin itself needs no build; `omarchy plugin add` clones it and
# its service runs this script with --if-needed when the shell loads it, which
# adds the one native piece the shell cannot provide. Running it by hand does
# the same and always rebuilds. It installs no system packages: missing build
# dependencies are listed, and installing them stays with the user.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
prefix="$data_home/omaoutlook"
bindir="$prefix/bin"
build="${XDG_CACHE_HOME:-$HOME/.cache}/omaoutlook/build"

usage() {
  cat <<USAGE
Usage: install.sh [--uninstall] [--if-needed]

Builds the omaoutlook host from ./host with qmake6 and installs it to
$bindir (plus a symlink in ~/.local/bin), a desktop entry and an icon.
  --uninstall   remove everything install.sh created (keeps the Outlook profile)
  --if-needed   build only when the sources or Qt changed since the last build;
                never prompts; exits 0 when the host is already current,
                10 after building it, 3 when build dependencies are missing
                (this is what the plugin runs when the shell loads it)
USAGE
}

if_needed=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) exec "$here/uninstall.sh" ;;
    --if-needed) if_needed=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install.sh: unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

# The dependency check lists the missing pieces on stdout, one per line, so
# the plugin can name them in its notification.
need=()
if command -v pacman >/dev/null; then
  for pkg in qt6-webengine qt6-declarative libnotify jq; do
    pacman -Q "$pkg" &>/dev/null || need+=("$pkg")
  done
fi
{ command -v g++ >/dev/null && command -v make >/dev/null; } || need+=(base-devel)
if (( ${#need[@]} )); then
  printf '%s\n' "${need[@]}"
  echo "install.sh: missing packages: ${need[*]}" >&2
  echo "Install them (Omarchy menu > Install > Package) and run install.sh again." >&2
  exit 3
fi

qmake=$(command -v qmake6 || true)
[[ -n $qmake ]] || qmake=/usr/lib/qt6/bin/qmake6
[[ -x $qmake ]] || { echo "install.sh: qmake6 not found (install qt6-base)" >&2; exit 1; }

version=$(jq -r '.version // "dev"' "$here/manifest.json" 2>/dev/null || echo dev)

# The stamp names everything the binary depends on: the plugin version, the
# host sources and the Qt it was linked against. A plugin update or a Qt
# upgrade changes it, and the plugin's service then rebuilds on the next load.
# The shell reloads a plugin on every file a `git pull` touches, and each
# reload runs this script; a second build in the same directory would delete
# the first one's objects mid-link. Builds take turns instead, and the ones
# that waited find the stamp current and return at once.
mkdir -p "$prefix"
exec 9>"$prefix/.install.lock"
flock 9

stamp_file="$prefix/build-stamp"
stamp=$(
  {
    echo "$version"
    "$qmake" -query QT_VERSION
    cd "$here" && find host assets scripts manifest.json install.sh -type f -print0 | sort -z | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
)
if (( if_needed )) && [[ -x $bindir/omaoutlook && -f $stamp_file && $(<"$stamp_file") == "$stamp" ]]; then
  exit 0
fi

echo "Building omaoutlook $version ..."
# Always from scratch: make does not notice a changed qmake define such as the
# version, and an object built against an older Qt must not be reused.
rm -rf "$build"
mkdir -p "$build"
(
  cd "$build"
  "$qmake" "OMAOUTLOOK_VERSION=$version" "$here/host/omaoutlook.pro" >/dev/null
  make -j"$(nproc)" >/dev/null
)

# A running instance keeps the old binary mapped; stop it before replacing.
# The automatic build leaves it alone: install writes a new file, so the open
# window keeps working and picks up the new host on its next start.
if (( ! if_needed )) && [[ -x $bindir/omaoutlook ]] && "$bindir/omaoutlook" status 2>/dev/null | grep -q '"running":true'; then
  echo "Stopping the running Outlook window ..."
  "$bindir/omaoutlook" quit || true
  sleep 1
fi

install -Dm755 "$build/omaoutlook" "$bindir/omaoutlook"

# Files outside $prefix are written only if they do not exist yet or are
# listed in $owned from an earlier run; anything else at those paths belongs
# to someone else and stays untouched. uninstall.sh removes exactly the
# listed paths.
owned="$prefix/installed-files"
touch "$owned"
ours() { [[ ! -e $1 && ! -L $1 ]] || grep -qxF -- "$1" "$owned"; }
claim() { grep -qxF -- "$1" "$owned" || printf '%s\n' "$1" >> "$owned"; }
# 1.0.0 installed the same files but kept no list; take them over once.
if [[ ! -s $owned && -f $stamp_file ]]; then
  for path in "$HOME/.local/bin/omaoutlook" \
              "$data_home/icons/hicolor/scalable/apps/omaoutlook.svg" "$data_home/icons/hicolor/256x256/apps/omaoutlook.png" \
              "$data_home/applications/omaoutlook.desktop" "$data_home/applications/omaoutlook-mailto.desktop"; do
    [[ -e $path || -L $path ]] && claim "$path"
  done
fi
place() {  # place <mode> <source> <target>
  if ours "$3"; then
    install -Dm"$1" "$2" "$3" && claim "$3"
  else
    echo "install.sh: $3 exists and was not installed by omaoutlook; leaving it alone" >&2
  fi
}

link="$HOME/.local/bin/omaoutlook"
if ours "$link" || [[ $(readlink "$link" 2>/dev/null) == "$bindir/omaoutlook" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sfn "$bindir/omaoutlook" "$link" && claim "$link"
else
  echo "install.sh: $link exists and is not omaoutlook's; run $bindir/omaoutlook instead" >&2
fi

# The icon is drawn in placeholder colors; recolor it from the active theme so
# the launcher tile matches the desktop. Icon caches mean a later theme switch
# shows the new colors after the next install.sh run.
icon_dir="$data_home/icons/hicolor"
"$here/scripts/theme-icon.sh" "$here/assets/omaoutlook.svg" "$build/omaoutlook.svg"
place 644 "$build/omaoutlook.svg" "$icon_dir/scalable/apps/omaoutlook.svg"
if command -v rsvg-convert >/dev/null; then
  rsvg-convert -w 256 -h 256 "$build/omaoutlook.svg" -o "$build/omaoutlook.png"
  place 644 "$build/omaoutlook.png" "$icon_dir/256x256/apps/omaoutlook.png"
fi
gtk-update-icon-cache -q "$icon_dir" 2>/dev/null || true

for entry in omaoutlook omaoutlook-mailto; do
  sed "s|^Exec=omaoutlook|Exec=$bindir/omaoutlook|" "$here/assets/$entry.desktop" > "$build/$entry.desktop"
  place 644 "$build/$entry.desktop" "$data_home/applications/$entry.desktop"
done
update-desktop-database -q "$data_home/applications" 2>/dev/null || true

mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/omaoutlook"
printf '%s\n' "$stamp" > "$stamp_file"

echo "Installed $bindir/omaoutlook"
(( if_needed )) && exit 10
if [[ $here == "$HOME/.config/omarchy/plugins/"* ]]; then
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  echo "Enable the bar widget with:  omarchy plugin enable omaoutlook"
else
  echo "Add the bar widget with:     omarchy plugin add https://github.com/Divanyx/omaoutlook.git --enable"
fi
echo "Open Outlook with:           omaoutlook"
