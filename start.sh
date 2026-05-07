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
#   --discover [<root>...]   Override the discovery roots for THIS run.
#                            Discovery itself runs by default on every
#                            invocation; this flag just lets you target
#                            a different parent dir without editing
#                            discover-roots.txt. Idempotent (deduped).
#   --no-discover            Skip discovery entirely. Useful for cron /
#                            CI runs where you want predictable
#                            non-interactive behavior.
#   --reinit                 Wipe config.yaml + re-run config init. Use
#                            this if your YAML got corrupted or you want
#                            a fresh starter file.
#   --reset-discover-roots   Wipe the saved discover-roots.txt and re-prompt
#                            on the next discovery.
#   --include-git-only       Pass --include-git-only to discovery so vanilla
#                            git repos (no .beads/) are surfaced as
#                            placeholder cards on the dashboard with a
#                            "not yet managed" badge.
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
# Discovery runs by default on every invocation. The dedup logic (added
# in 2bf33ff) makes it cheap and idempotent — only NEW projects trigger
# the prompt; if nothing's new, discovery skips silently. Pass
# --no-discover to disable (cron / CI / non-interactive contexts).
DO_DISCOVER=1
DO_REINIT=0
RESET_DISCOVER_ROOTS=0
DO_COLLECT=1
DO_SERVE=1
PORT=5174
DISCOVER_ROOTS=()
INCLUDE_GIT_ONLY=0

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
    --no-discover)          DO_DISCOVER=0; shift ;;
    --reinit)               DO_REINIT=1; shift ;;
    --reset-discover-roots) RESET_DISCOVER_ROOTS=1; shift ;;
    --include-git-only)     INCLUDE_GIT_ONLY=1; shift ;;
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
  if [ "$INCLUDE_GIT_ONLY" -eq 1 ]; then
    in_repo ./bin/discover-projects.sh --include-git-only "${RESOLVED_ROOTS[@]}" > "$TMP_YAML"
  else
    in_repo ./bin/discover-projects.sh "${RESOLVED_ROOTS[@]}" > "$TMP_YAML"
  fi

  # Detect "no projects found" — discover-projects.sh emits "  []" in that case.
  if grep -qE '^[[:space:]]*\[\]$' "$TMP_YAML"; then
    echo "→ no projects found under those roots."
    if prompt_and_save_roots; then
      echo "→ rescanning with the new roots…"
      if [ "$INCLUDE_GIT_ONLY" -eq 1 ]; then
    in_repo ./bin/discover-projects.sh --include-git-only "${RESOLVED_ROOTS[@]}" > "$TMP_YAML"
  else
    in_repo ./bin/discover-projects.sh "${RESOLVED_ROOTS[@]}" > "$TMP_YAML"
  fi
    fi
  fi

  # Dedup against the existing config FIRST (before any prompt) so we
  # only nag the operator when there's actually something new. The dedup
  # logic itself is described in commit 2bf33ff.
  if grep -q '^  - name:' "$TMP_YAML"; then
    EXISTING_PATHS_FILE="$(mktemp -t metaswarm-existing-paths.XXXXXX)"
    grep -E '^[[:space:]]+path:' "$CFG" 2>/dev/null \
      | sed -E "s/^[[:space:]]+path:[[:space:]]*//; s/^[\"']//; s/[\"']\$//" \
      > "$EXISTING_PATHS_FILE" || true
    TMP_NEW="$(mktemp -t metaswarm-discover-new.XXXXXX)"
    # awk walks the discovery YAML in 3-line blocks (name/path/category)
    # and emits only the blocks whose path isn't in the existing-paths file.
    # Reads existing paths from a file (not -v) so newline-separated lists
    # work correctly.
    awk -v existing_file="$EXISTING_PATHS_FILE" '
      BEGIN {
        while ((getline line < existing_file) > 0) {
          seen[line] = 1
        }
        close(existing_file)
      }
      /^[[:space:]]+- name:/ { name = $0; next }
      /^[[:space:]]+path:/ {
        p = $0
        sub(/^[[:space:]]+path:[[:space:]]*/, "", p)
        sub(/^["\x27]/, "", p)
        sub(/["\x27]$/, "", p)
        keep = (seen[p] != 1)
        if (keep) { print name; print $0 }
        current_keep = keep
        next
      }
      /^[[:space:]]+category:/ { if (current_keep) print $0; next }
    ' "$TMP_YAML" > "$TMP_NEW"
    rm -f "$EXISTING_PATHS_FILE"

    # grep -c always prints a number on stdout (even on no-match), and
    # exits 1 when no matches. We disable -e for these two assignments
    # so the exit-1 doesn't trip set -e, and we don't add `|| echo 0`
    # (which would double-print on no-match).
    new_count=$(set +e; grep -cE '^[[:space:]]+- name:' "$TMP_NEW" 2>/dev/null; true)
    total_discovered=$(set +e; grep -cE '^  - name:' "$TMP_YAML" 2>/dev/null; true)
    skipped_count=$((total_discovered - new_count))

    if [ "$new_count" -eq 0 ]; then
      # Nothing new — silent skip with a one-line summary. No prompt.
      echo "→ discovery: $skipped_count projects already in config; nothing new."
      rm -f "$TMP_NEW"
    else
      # Show ONLY the new entries and prompt.
      echo "─────────────────────────────────────────────"
      echo "# $new_count NEW project(s) found ($skipped_count already in config):"
      cat "$TMP_NEW"
      echo "─────────────────────────────────────────────"
      printf '\nAppend the %s new project(s) to %s? [Y/n] ' "$new_count" "$CFG"
      read -r reply
      case "$reply" in
        ''|[yY]|[yY][eE][sS])
          mkdir -p "$(dirname "$CFG")"
          # If the starter wrote `projects: []` (closed empty array),
          # convert it to `projects:` (open list) before appending so
          # the new entries land under the projects key, not at the
          # YAML root. Idempotent.
          if grep -qE '^projects: \[\][[:space:]]*$' "$CFG"; then
            sed -i.bak 's/^projects: \[\][[:space:]]*$/projects:/' "$CFG"
            rm -f "$CFG.bak"
          fi
          printf '\n# discovered %s (added %s, deduped %s)\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$new_count" "$skipped_count" >> "$CFG"
          cat "$TMP_NEW" >> "$CFG"
          echo "✓ appended $new_count new entries to $CFG"

          # If this was a first-time interactive resolution (no prior
          # settings file, no CLI roots), persist the roots for next time.
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
          echo "→ skipped append; rerun with --no-discover to suppress this prompt next time, or edit $CFG manually"
          ;;
      esac
      rm -f "$TMP_NEW"
    fi
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
