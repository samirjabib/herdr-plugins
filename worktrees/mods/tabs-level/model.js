// tabs-level's pure rules: which tabs the bar shows. A tab's level is where its lead terminal
// runs: a checkout (`<project>/main` or `<project>/worktrees/<wt>`), else an org root
// (~/mac-workspace or ~/mac-workspace/<org>). The bar shows the tabs on the active tab's level,
// so an org orchestrator's bar holds the org's own tabs and a worktree's bar its agents.

// Same rules as agents-tree/model.js (Herdr loads a mod only from its own folder, so they are
// copied; test/tabs-level-model.test.js fails if the two drift apart).
export function projectOf(dir) {
  const m = /^(.*\/mac-workspace\/(ag|cs|personal)\/([^/]+))\/(?:main|worktrees)(?:\/|$)/.exec(dir ?? "");
  return m ? { org: m[2], name: m[3], base: m[1] } : null;
}
export function placeOf(dir) {
  return /\/worktrees\/([^/]+)/.exec(dir ?? "")?.[1] ?? (/\/main(?:\/|$)/.test(dir ?? "") ? "main" : null);
}
export function orgRootOf(dir) {
  const m = /\/mac-workspace(?:\/(cs|ag|personal))?\/?$/.exec(dir ?? "");
  return m ? m[1] ?? "workspace" : null;
}

// A folder's level key, or null when it is outside mac-workspace (or unknown).
export function levelOf(cwd) {
  const p = projectOf(cwd);
  if (p) return `${p.base}/${placeOf(cwd) === "main" ? "main" : `worktrees/${placeOf(cwd)}`}`;
  const root = orgRootOf(cwd);
  return root ? `root:${root}` : null;
}

// The pane a tab is named after: its agent, else its first terminal (as the tabs mod picks it).
export const leadOf = (tab, panes) =>
  panes.find((p) => p.tab === tab.id && p.program?.agent) ?? panes.find((p) => p.tab === tab.id) ?? null;

// The tabs to show, in the space's order: those on the active tab's level, the active tab
// always. Every tab when the active one has no level (outside mac-workspace, folder unknown).
export function levelTabs(tabs, panes) {
  const active = tabs.find((t) => t.active);
  const level = active ? levelOf(leadOf(active, panes)?.cwd) : null;
  if (!level) return tabs;
  return tabs.filter((t) => t.active || levelOf(leadOf(t, panes)?.cwd) === level);
}
