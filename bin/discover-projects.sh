#!/usr/bin/env bash
# Discover .beads/-tracked projects (and optionally any git repo) under
# one or more parent directories. Emits YAML you can paste into
# ~/.config/metaswarm-dashboard/config.yaml.
#
# Each entry includes a `category:` field:
#   - `metaswarm` — has `.beads/` (collected with full metrics)
#   - `git-only` — has `.git/` but no `.beads/` (rendered as a placeholder
#                   card on the dashboard with a "not yet managed" badge)
#
# Usage:
#   bin/discover-projects.sh ~/code ~/work               # metaswarm only (default)
#   bin/discover-projects.sh --include-git-only ~/code   # also git repos without .beads/
#
# Stop-gap until `metaswarm-dashboard config discover` lands (issue #5).
# Reads nothing inside .beads/ or .git/ — only checks if those directories
# exist. Zero footprint by construction.

set -euo pipefail

INCLUDE_GIT_ONLY=0
ROOTS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --include-git-only) INCLUDE_GIT_ONLY=1; shift ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' ; exit 0 ;;
    *) ROOTS+=("$1"); shift ;;
  esac
done

if [ "${#ROOTS[@]}" -eq 0 ]; then
  echo "Usage: $0 [--include-git-only] <parent-dir> [<parent-dir> ...]" >&2
  exit 1
fi

MAX_DEPTH=4

echo "# Discovered projects under: ${ROOTS[*]}"
echo "# Max depth: ${MAX_DEPTH}"
[ "$INCLUDE_GIT_ONLY" -eq 1 ] && echo "# Include git-only repos: yes" || echo "# Include git-only repos: no"
echo "# Review and remove any entry you don't want collected."
echo "projects:"

found_metaswarm=0
found_git_only=0

# --- Pass 1: metaswarm-managed (has .beads/) ---
for root in "${ROOTS[@]}"; do
  if [ ! -d "$root" ]; then
    echo "# (skip) $root: not a directory" >&2
    continue
  fi
  while IFS= read -r beads_dir; do
    project_path="$(dirname "$beads_dir")"
    project_name="$(basename "$project_path")"
    printf '  - name: %s\n    path: %s\n    category: metaswarm\n' "$project_name" "$project_path"
    found_metaswarm=$((found_metaswarm + 1))
  done < <(find -L "$root" -maxdepth "${MAX_DEPTH}" -type d -name '.beads' 2>/dev/null | sort)
done

# --- Pass 2: git repos WITHOUT .beads/ (only if --include-git-only) ---
if [ "$INCLUDE_GIT_ONLY" -eq 1 ]; then
  for root in "${ROOTS[@]}"; do
    [ -d "$root" ] || continue
    while IFS= read -r git_dir; do
      project_path="$(dirname "$git_dir")"
      # Skip if this repo also has .beads/ (already emitted above)
      [ -d "$project_path/.beads" ] && continue
      project_name="$(basename "$project_path")"
      printf '  - name: %s\n    path: %s\n    category: git-only\n' "$project_name" "$project_path"
      found_git_only=$((found_git_only + 1))
    done < <(find -L "$root" -maxdepth "${MAX_DEPTH}" -type d -name '.git' 2>/dev/null | sort)
  done
fi

if [ "$found_metaswarm" -eq 0 ] && [ "$found_git_only" -eq 0 ]; then
  echo "  []"
  echo "# (no projects found under the given roots within depth ${MAX_DEPTH})" >&2
fi

echo "# Discovered: ${found_metaswarm} metaswarm-managed, ${found_git_only} git-only" >&2
