#!/usr/bin/env bash
# Discover .beads/-tracked projects under one or more parent directories
# and emit YAML you can paste into ~/.config/metaswarm-dashboard/config.yaml
# (or wherever METASWARM_DASHBOARD_CONFIG points).
#
# Usage:
#   bin/discover-projects.sh ~/code ~/ethiclab
#   bin/discover-projects.sh ~/code | tee -a ~/.config/metaswarm-dashboard/config.yaml
#
# Stop-gap until `metaswarm-dashboard config discover` lands (issue #5).
# Reads nothing inside .beads/ — only lists directories that contain one.
# Zero footprint by construction.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <parent-dir> [<parent-dir> ...]" >&2
  exit 1
fi

MAX_DEPTH=4

echo "# Discovered .beads/-tracked projects under: $*"
echo "# Max depth: ${MAX_DEPTH}"
echo "# Review and remove any entry you don't want collected."
echo "projects:"

found=0
for root in "$@"; do
  if [ ! -d "$root" ]; then
    echo "# (skip) $root: not a directory" >&2
    continue
  fi
  while IFS= read -r beads_dir; do
    project_path="$(dirname "$beads_dir")"
    project_name="$(basename "$project_path")"
    printf '  - name: %s\n    path: %s\n' "$project_name" "$project_path"
    found=$((found + 1))
  done < <(find -L "$root" -maxdepth "${MAX_DEPTH}" -type d -name '.beads' 2>/dev/null | sort)
done

if [ "$found" -eq 0 ]; then
  echo "# (no .beads/ directories found under the given roots within depth ${MAX_DEPTH})" >&2
  echo "  []"
fi
