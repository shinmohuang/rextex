#!/bin/sh
# Install rextex: the command in ~/.local/bin, and the Rex plugin in Rex's
# config directory. Run it again after moving this folder or changing Node.
#
#   ./install.sh                  install, bound to cmd+shift+m
#   ./install.sh --key cmd+e      install with another key
#   ./install.sh --no-config      install the command and plugin, leave init.lua alone
#   ./install.sh --uninstall      remove everything this script added
set -eu

here=$(cd "$(dirname "$0")" && pwd)
bin_dir="${HOME}/.local/bin"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/rex"
init="${REX_CONFIG:-$config_dir/init.lua}"
skill_dir="$HOME/.claude/skills/rextex-math"
key="cmd+shift+m"
edit_config=1
uninstall=0
begin="-- >>> rextex (managed by install.sh; edits inside are replaced)"
end="-- <<< rextex"

while [ $# -gt 0 ]; do
  case "$1" in
    --key) [ $# -ge 2 ] || { echo "install.sh: --key needs a key, such as cmd+shift+m" >&2; exit 2; }; key=$2; shift 2 ;;
    --no-config) edit_config=0; shift ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

# Take the managed block out of init.lua, keeping everything else.
strip_block() {
  [ -f "$init" ] || return 0
  grep -qF -- "$begin" "$init" || return 0
  awk -v b="$begin" -v e="$end" '$0 == b { skip = 1; next } $0 == e { skip = 0; next } !skip' "$init" > "$init.rextex-tmp"
  mv "$init.rextex-tmp" "$init"
}

reload() {
  command -v rex >/dev/null 2>&1 || return 0
  rex config reload >/dev/null 2>&1 || echo "Could not reload Rex's config; run: rex config reload"
}

if [ "$uninstall" -eq 1 ]; then
  strip_block
  rm -f "$bin_dir/rextex" "$config_dir/rextex.lua"
  [ -L "$skill_dir" ] && rm -f "$skill_dir"
  # The panes to turn rendering back on in, and the renderers' log.
  rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/rextex"
  reload
  echo "Removed rextex."
  exit 0
fi

node=$(command -v node || true)
[ -n "$node" ] || { echo "install.sh: Node.js 18 or later is needed, and node is not on PATH" >&2; exit 1; }
(cd "$here" && npm install --omit=dev --no-audit --no-fund >/dev/null)

# Rex starts the viewer without a shell, so the launcher names Node by its
# full path instead of relying on PATH. The same goes for rex itself.
mkdir -p "$bin_dir" "$config_dir"
rex_bin=$(command -v rex || echo rex)
cat > "$bin_dir/rextex" <<LAUNCHER
#!/bin/sh
REXTEX_REX="\${REXTEX_REX:-$rex_bin}" exec "$node" "$here/bin/rextex.js" "\$@"
LAUNCHER
chmod +x "$bin_dir/rextex"
ln -sf "$here/rex/rextex.lua" "$config_dir/rextex.lua"
echo "Installed $bin_dir/rextex and $config_dir/rextex.lua"

# The writing skill tells Claude Code how to lay formulas out so they can be
# drawn in place.
if [ -d "$HOME/.claude" ]; then
  mkdir -p "$HOME/.claude/skills"
  if [ ! -e "$skill_dir" ] || [ -L "$skill_dir" ]; then
    ln -sfn "$here/skills/rextex-math" "$skill_dir"
    echo "Installed the rextex-math skill for Claude Code"
  else
    echo "Left $skill_dir alone: it exists and is not a link this script made"
  fi
fi

if [ "$edit_config" -eq 1 ]; then
  [ -f "$init" ] && cp "$init" "$init.rextex-backup"
  strip_block
  printf '%s\nrequire("rextex").setup{ key = "%s" }\n%s\n' "$begin" "$key" "$end" >> "$init"
  reload
  echo "Added rextex to $init, bound to $key."
else
  echo "Add this to $init, then run: rex config reload"
  echo "  require(\"rextex\").setup{ key = \"$key\" }"
fi
