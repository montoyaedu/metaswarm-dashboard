// Group ProjectSummary[] by their parent directory (`dirname(path)`).
// Pure function so it can be unit-tested directly.

import type { ProjectSummary } from '@metaswarm-dashboard/types/api';

export interface ProjectGroup {
  /** Parent directory path. The display label is the basename. */
  parentPath: string;
  /** Display name (basename of parentPath, or "(unknown parent)" when empty). */
  label: string;
  projects: ProjectSummary[];
  /** Aggregate counts useful for the section header. */
  counts: {
    total: number;
    metaswarm: number;
    gitOnly: number;
    ok: number;
    degraded: number;
    failed: number;
  };
}

function dirname(p: string): string {
  if (p === '' || p === '/') return '';
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '';
  return p.slice(0, idx);
}

function basename(p: string): string {
  if (p === '' || p === '/') return '';
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

export function groupByParent(projects: ProjectSummary[]): ProjectGroup[] {
  const groups = new Map<string, ProjectSummary[]>();
  for (const p of projects) {
    const parent = dirname(p.path);
    const existing = groups.get(parent) ?? [];
    existing.push(p);
    groups.set(parent, existing);
  }

  return Array.from(groups.entries())
    .map(([parentPath, list]): ProjectGroup => {
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
      const counts = {
        total: sorted.length,
        metaswarm: sorted.filter((p) => p.category === 'metaswarm').length,
        gitOnly: sorted.filter((p) => p.category === 'git-only').length,
        ok: sorted.filter((p) => p.collectionStatus === 'ok' && p.category !== 'git-only').length,
        degraded: sorted.filter((p) => p.collectionStatus === 'degraded').length,
        failed: sorted.filter((p) => p.collectionStatus === 'failed').length,
      };
      const label = basename(parentPath) || '(root)';
      return { parentPath, label, projects: sorted, counts };
    })
    .sort((a, b) => a.parentPath.localeCompare(b.parentPath));
}
