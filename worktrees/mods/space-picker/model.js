// Pure helpers of the Spaces "+" picker (no herdr imports, so node tests load them).

// An organization's projects: the cloned ones from `dirs` (one path per line,
// `<root>/<org>/<name>/main` and `<root>/<org>/<name>/worktrees/<wt>`), sorted by
// name, each with its worktrees; then the catalog's (workspace.tsv: group, name,
// remote) not cloned here, with `cloned: false`.
export function projectsOf(org, dirs, catalog, root) {
  const base = `${root}/${org}/`;
  const byName = new Map();
  for (const line of (dirs ?? "").split("\n")) {
    if (!line.startsWith(base)) continue;
    const [name, kind, wt] = line.slice(base.length).split("/");
    if (!name) continue;
    const p = byName.get(name) ?? { name, main: `${base}${name}/main`, worktrees: [], cloned: false };
    if (kind === "main" && wt === undefined) p.cloned = true;
    if (kind === "worktrees" && wt) p.worktrees.push({ name: wt, path: line });
    byName.set(name, p);
  }
  const cloned = [...byName.values()].filter((p) => p.cloned).sort((a, b) => a.name.localeCompare(b.name));
  for (const p of cloned) p.worktrees.sort((a, b) => a.name.localeCompare(b.name));
  const missing = (catalog ?? "").split("\n").slice(1).map((l) => l.split("\t"))
    .filter(([g, name]) => g === org && name && !cloned.some((p) => p.name === name))
    .map(([, name]) => ({ name, main: `${base}${name}/main`, worktrees: [], cloned: false }));
  return [...cloned, ...missing];
}

// The rows for a search (case-insensitive, on project and worktree names): a
// project, then its worktrees (all of them when the project matches, else the
// matching ones), and "Other folder…" last.
export function pickRows(projects, query) {
  const q = (query ?? "").trim().toLowerCase();
  const rows = [];
  for (const p of projects) {
    const hit = !q || p.name.toLowerCase().includes(q);
    const wts = hit ? p.worktrees : p.worktrees.filter((w) => w.name.toLowerCase().includes(q));
    if (!hit && !wts.length) continue;
    rows.push({ kind: "project", label: p.name, project: p });
    for (const w of wts) rows.push({ kind: "worktree", label: w.name, project: p, path: w.path });
  }
  rows.push({ kind: "other", label: "Other folder…" });
  return rows;
}
