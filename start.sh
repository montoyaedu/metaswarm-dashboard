#!/usr/bin/env bash
# metaswarm-dashboard — single-step starter.
#
# What it does, in order:
#   1. Verifies node 22.12+ is active (whatever version manager you use).
#   2. Builds the workspaces (only if dist/ artifacts are missing).
#   3. Resolves the XDG config path on your platform.
#   4. Initializes config.yaml if missing (and offers project discovery).
#   5. Runs `collect --all`.
#   6. Runs `serve` (long-running; Ctrl-C to stop).
#
# Idempotent by default: an existing config is kept untouched, dist/ is
# only rebuilt if missing, and `collect --all` overwrites only today's
# UTC daily snapshot (per the writer's atomic-rename design).
#
# Flags:
#   --discover [<root>...]   Run bin/discover-projects.sh against the given
#                            roots (or ~ by default), append result to
#                            config.yaml after a review prompt. Use this
#                            when you've added a new project under a parent
#                            you've already scanned.
#   --reinit                 Wipe config.yaml + re-run config init. Use
#                            this if your YAML got corrupted or you want
#                            a fresh starter file.
#   --no-collect             Skip step 5; go straight to serve.
#   --no-serve               Skip step 6; collect only (cron-friendly).
#   --port <n>               Port for serve (default 5174).
#   -h, --help               Show this banner.
#
# Examples:
#   ./start.sh
#   ./start.sh --discover ~/code ~/work
#   ./start.sh --reinit
#   ./start.sh --no-serve   # one-shot collect (e.g. from a cron job)

set -euo pipefail

# Resolve the repo root from the script's own location, not from cwd.
# Doesn't change the caller's shell directory.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run a node command from inside the repo without polluting the caller's cwd.
in_repo() {
  ( cd "$REPO_ROOT" && "$@" )
}

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
DO_DISCOVER=0
DO_REINIT=0
DO_COLLECT=1
DO_SERVE=1
PORT=5174
DISCOVER_ROOTS=()

# -----------------------------------------------------------------------------
# Args
# -----------------------------------------------------------------------------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --discover)
      DO_DISCOVER=1
      shift
      while [ "$#" -gt 0 ] && [[ "$1" != --* ]]; do
        DISCOVER_ROOTS+=("$1"); shift
      done
      ;;
    --reinit)        DO_REINIT=1; shift ;;
    --no-collect)    DO_COLLECT=0; shift ;;
    --no-serve)      DO_SERVE=0; shift ;;
    --port)          PORT="$2"; shift 2 ;;
    -h|--help)       sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

printf '\n\033[1;36m== metaswarm-dashboard starter ==\033[0m\n\n'

# -----------------------------------------------------------------------------
# 1. Node version check
# -----------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "✗ node not found on PATH. Install node 22.12.0 (.nvmrc pins this)." >&2
  exit 1
fi
NODE_VER="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MINOR_FULL="${NODE_VER#*.}"
NODE_MINOR="${NODE_MINOR_FULL%%.*}"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
  echo "✗ node $NODE_VER detected; need >= 22.12.0 (.nvmrc says 22.12.0)." >&2
  echo "  Run one of: nvm use, fnm use, volta install node@22.12.0, sudo n auto" >&2
  exit 1
fi
printf '✓ node %s\n' "$NODE_VER"

# -----------------------------------------------------------------------------
# 2. Build (only if dist/ missing)
# -----------------------------------------------------------------------------
if [ ! -d "$REPO_ROOT/packages/collector/dist" ] \
  || [ ! -d "$REPO_ROOT/packages/server/dist" ] \
  || [ ! -d "$REPO_ROOT/packages/web/dist" ]; then
  echo "→ building workspaces (dist/ missing)…"
  if [ ! -d "$REPO_ROOT/node_modules" ]; then
    echo "  npm ci"
    in_repo npm ci --silent
  fi
  in_repo npm run build
  printf '✓ build complete\n'
else
  printf '✓ dist/ already present (skipping build; rebuild manually with `npm run build` if needed)\n'
fi

# -----------------------------------------------------------------------------
# 3. Config path resolution
# -----------------------------------------------------------------------------
if [ -n "${METASWARM_DASHBOARD_CONFIG:-}" ]; then
  CFG="$METASWARM_DASHBOARD_CONFIG"
elif [ "$(uname)" = "Darwin" ]; then
  CFG="$HOME/Library/Application Support/metaswarm-dashboard/config.yaml"
else
  CFG="${XDG_CONFIG_HOME:-$HOME/.config}/metaswarm-dashboard/config.yaml"
fi
printf '✓ config path: %s\n' "$CFG"

# -----------------------------------------------------------------------------
# 4. Reinit / Init / Discover
# -----------------------------------------------------------------------------
if [ "$DO_REINIT" -eq 1 ]; then
  if [ -f "$CFG" ]; then
    BACKUP="$CFG.$(date -u +%Y%m%dT%H%M%SZ).bak"
    mv "$CFG" "$BACKUP"
    echo "→ existing config backed up to $BACKUP"
  fi
fi

if [ ! -f "$CFG" ]; then
  echo "→ no config.yaml; running config init…"
  in_repo node ./bin/metaswarm-dashboard config init
  printf '\n  Starter config written to: %s\n' "$CFG"
  printf '  It currently has no projects. You can either:\n'
  printf '    a) Re-run with `--discover ~/your/code/root` to auto-detect candidates.\n'
  printf '    b) Edit the file manually now and rerun this script.\n\n'
fi

if [ "$DO_DISCOVER" -eq 1 ]; then
  if [ "${#DISCOVER_ROOTS[@]}" -eq 0 ]; then
    DISCOVER_ROOTS=("$HOME")
    echo "→ no --discover roots given; defaulting to \$HOME"
  fi
  TMP_YAML="$(mktemp -t metaswarm-discover.XXXXXX)"
  trap 'rm -f "$TMP_YAML"' EXIT
  echo "→ discovering .beads/-tracked projects under: ${DISCOVER_ROOTS[*]}"
  in_repo ./bin/discover-projects.sh "${DISCOVER_ROOTS[@]}" > "$TMP_YAML"
  echo "─────────────────────────────────────────────"
  cat "$TMP_YAML"
  echo "─────────────────────────────────────────────"
  printf '\nReview the YAML above. Do you want to APPEND it to %s? [y/N] ' "$CFG"
  read -r reply
  case "$reply" in
    [yY]|[yY][eE][sS])
      mkdir -p "$(dirname "$CFG")"
      printf '\n# discovered %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$CFG"
      tail -n +4 "$TMP_YAML" | grep -v '^projects:' >> "$CFG"
      echo "✓ appended to $CFG"
      ;;
    *)
      echo "→ skipped append; you can edit $CFG manually"
      ;;
  esac
fi

# -----------------------------------------------------------------------------
# 5. Collect
# -----------------------------------------------------------------------------
if [ "$DO_COLLECT" -eq 1 ]; then
  echo "→ collect --all"
  in_repo node ./bin/metaswarm-dashboard collect --all
fi

# -----------------------------------------------------------------------------
# 6. Serve
# -----------------------------------------------------------------------------
if [ "$DO_SERVE" -eq 1 ]; then
  echo
  printf '\033[1;32m→ serve on port %s — open http://127.0.0.1:%s\033[0m\n' "$PORT" "$PORT"
  echo "  Ctrl-C to stop."
  echo
  cd "$REPO_ROOT"  # serve resolves staticRoot relative to cwd; safe to cd inside this final exec
  exec node ./bin/metaswarm-dashboard serve --port "$PORT"
fi

echo "✓ done"
