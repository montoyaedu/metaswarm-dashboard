#!/usr/bin/env bash
# metaswarm-dashboard — single-step starter.
#
# What it does, in order:
#   1. Verifies node 22.12+ is active (whatever version manager you use).
#   2. Builds the workspaces (only if dist/ artifacts are missing).
#   3. Resolves the XDG config path on your platform.
#   4. Initializes config.yaml if missing AND auto-runs project discovery
#      on first start (default root: the repo's parent directory).
#   5. Runs `collect --all`.
#   6. Runs `serve` (long-running; Ctrl-C to stop).
#
# Discovery roots
# ---------------
# Discovery looks for `.beads/`-tracked projects under one or more parent
# directories. Roots are resolved with this precedence:
#   (a) CLI args after `--discover` (e.g. `--discover ~/code ~/work`)
#   (b) Settings file at ${XDG_CONFIG_HOME:-~/.config}/metaswarm-dashboard/discover-roots.txt
#       (one absolute path per line). Saved automatically the first time
#       you confirm a root list interactively.
#   (c) Fallback: the repo's parent directory (`dirname $REPO_ROOT`).
#
# If discovery finds nothing, you're prompted for parent dirs to scan and
# the answer is saved into discover-roots.txt for next time.
#
# Idempotent by default: an existing config is kept untouched, dist/ is
# only rebuilt if missing, and `collect --all` overwrites only today's
# UTC daily snapshot (per the writer's atomic-rename design).
#
# Flags:
#   --discover [<root>...]   Force discovery now (even if config.yaml exists).
#                            Roots come from the args; if none given, falls
#                            back to (b) then (c) above.
#   --reinit                 Wipe config.yaml + re-run config init. Use
#                            this if your YAML got corrupted or you want
#                            a fresh starter file.
#   --reset-discover-roots   Wipe the saved discover-roots.txt and re-prompt
#                            on the next discovery.
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
REPO_PARENT="$(dirname "$REPO_ROOT")"

# Run a command from inside the repo without polluting the caller's cwd.
in_repo() {
  ( cd "$REPO_ROOT" && "$@" )
}

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
DO_DISCOVER=0
DO_REINIT=0
RESET_DISCOVER_ROOTS=0
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
    --reinit)               DO_REINIT=1; shift ;;
    --reset-discover-roots) RESET_DISCOVER_ROOTS=1; shift ;;
    --no-collect)           DO_COLLECT=0; shift ;;
    --no-serve)             DO_SERVE=0; shift ;;
    --port)                 PORT="$2"; shift 2 ;;
    -h|--help)              sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                      echo "Unknown flag: $1" >&2; exit 2 ;;
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
# 3. Config + settings paths
# -----------------------------------------------------------------------------
if [ -n "${METASWARM_DASHBOARD_CONFIG:-}" ]; then
  CFG="$METASWARM_DASHBOARD_CONFIG"
elif [ "$(uname)" = "Darwin" ]; then
  CFG="$HOME/Library/Application Support/metaswarm-dashboard/config.yaml"
else
  CFG="${XDG_CONFIG_HOME:-$HOME/.config}/metaswarm-dashboard/config.yaml"
fi

# discover-roots.txt — operator-level (NOT per-project) settings file.
# Always under XDG_CONFIG_HOME, never inside the data dir, so it survives
# `rm -rf <data dir>` cleanups and is portable across shells.
DISCOVER_SETTINGS="${XDG_CONFIG_HOME:-$HOME/.config}/metaswarm-dashboard/discover-roots.txt"

printf '✓ config path: %s\n' "$CFG"

if [ "$RESET_DISCOVER_ROOTS" -eq 1 ] && [ -f "$DISCOVER_SETTINGS" ]; then
  rm -f "$DISCOVER_SETTINGS"
  echo "→ wiped saved discover roots ($DISCOVER_SETTINGS)"
fi

# -----------------------------------------------------------------------------
# Discovery helpers
# -----------------------------------------------------------------------------
expand_path() {
  # Expand a leading ~ to $HOME.
  case "$1" in
    "~") echo "$HOME" ;;
    "~/"*) echo "$HOME/${1#~/}" ;;
    *) echo "$1" ;;
  esac
}

resolve_discover_roots() {
  # Populates a global RESOLVED_ROOTS array (paths) using precedence:
  #   1. DISCOVER_ROOTS (CLI args, already populated)
  #   2. $DISCOVER_SETTINGS file (one path per line, # comments allowed)
  #   3. $REPO_PARENT
  RESOLVED_ROOTS=()
  if [ "${#DISCOVER_ROOTS[@]}" -gt 0 ]; then
    for r in "${DISCOVER_ROOTS[@]}"; do
      RESOLVED_ROOTS+=("$(expand_path "$r")")
    done
    return
  fi
  if [ -f "$DISCOVER_SETTINGS" ]; then
    while IFS= read -r line; do
      # strip whitespace + skip blanks/comments
      line="$(printf '%s' "$line" | sed -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*//')"
      [ -z "$line" ] && continue
      [ "${line#'#'}" != "$line" ] && continue
      RESOLVED_ROOTS+=("$(expand_path "$line")")
    done < "$DISCOVER_SETTINGS"
    if [ "${#RESOLVED_ROOTS[@]}" -gt 0 ]; then return; fi
  fi
  RESOLVED_ROOTS=("$REPO_PARENT")
}

prompt_and_save_roots() {
  # Reads parent dirs from stdin (one per line, blank to finish). Saves
  # them to $DISCOVER_SETTINGS. Sets RESOLVED_ROOTS to the saved list.
  RESOLVED_ROOTS=()
  echo
  echo "Which parent directories should I scan for .beads/-tracked projects?"
  echo "Enter one absolute path per line. Blank line when done."
  while true; do
    printf '  > '
    if ! IFS= read -r line; then break; fi
    [ -z "$line" ] && break
    line="$(expand_path "$line")"
    if [ -d "$line" ]; then
      RESOLVED_ROOTS+=("$line")
    else
      printf '    (skip — not a directory: %s)\n' "$line"
    fi
  done

  if [ "${#RESOLVED_ROOTS[@]}" -eq 0 ]; then
    echo "→ no roots provided; nothing saved."
    return 1
  fi

  mkdir -p "$(dirname "$DISCOVER_SETTINGS")"
  {
    echo "# metaswarm-dashboard discover-roots — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# One absolute parent directory per line. Used by ./start.sh."
    printf '%s\n' "${RESOLVED_ROOTS[@]}"
  } > "$DISCOVER_SETTINGS"
  echo "✓ saved $DISCOVER_SETTINGS"
}

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

CONFIG_FRESHLY_CREATED=0
if [ ! -f "$CFG" ]; then
  echo "→ no config.yaml; running config init…"
  in_repo node ./bin/metaswarm-dashboard config init
  CONFIG_FRESHLY_CREATED=1
fi

# Auto-trigger discovery on first run (or when explicitly requested).
if [ "$DO_DISCOVER" -eq 1 ] || [ "$CONFIG_FRESHLY_CREATED" -eq 1 ]; then
  resolve_discover_roots
  TMP_YAML="$(mktemp -t metaswarm-discover.XXXXXX)"
  trap 'rm -f "$TMP_YAML"' EXIT

  echo "→ scanning for .beads/-tracked projects under: ${RESOLVED_ROOTS[*]}"
  in_repo ./bin/discover-projects.sh "${RESOLVED_ROOTS[@]}" > "$TMP_YAML"

  # Detect "no projects found" — discover-projects.sh emits "  []" in that case.
  if grep -qE '^[[:space:]]*\[\]$' "$TMP_YAML"; then
    echo "→ no projects found under those roots."
    if prompt_and_save_roots; then
      echo "→ rescanning with the new roots…"
      in_repo ./bin/discover-projects.sh "${RESOLVED_ROOTS[@]}" > "$TMP_YAML"
    fi
  fi

  # Show + prompt append (only if there's actual content to append).
  if grep -q '^  - name:' "$TMP_YAML"; then
    echo "─────────────────────────────────────────────"
    cat "$TMP_YAML"
    echo "─────────────────────────────────────────────"
    printf '\nAppend the discovered projects to %s? [y/N] ' "$CFG"
    read -r reply
    case "$reply" in
      [yY]|[yY][eE][sS])
        mkdir -p "$(dirname "$CFG")"
        printf '\n# discovered %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$CFG"
        # Skip the YAML preamble (header + `projects:` line) and append only entries.
        grep -E '^[[:space:]]+- name:|^[[:space:]]{4,}path:' "$TMP_YAML" >> "$CFG"
        echo "✓ appended to $CFG"

        # If we just resolved roots interactively (no prior settings file)
        # AND the resolution wasn't from CLI args, persist them.
        if [ ! -f "$DISCOVER_SETTINGS" ] && [ "${#DISCOVER_ROOTS[@]}" -eq 0 ]; then
          mkdir -p "$(dirname "$DISCOVER_SETTINGS")"
          {
            echo "# metaswarm-dashboard discover-roots — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            echo "# Auto-saved on first successful discovery."
            printf '%s\n' "${RESOLVED_ROOTS[@]}"
          } > "$DISCOVER_SETTINGS"
          echo "✓ remembered scan roots in $DISCOVER_SETTINGS"
        fi
        ;;
      *)
        echo "→ skipped append; you can edit $CFG manually"
        ;;
    esac
  fi
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
