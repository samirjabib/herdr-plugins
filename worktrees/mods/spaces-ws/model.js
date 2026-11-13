// Pure helpers of the spaces list (no herdr imports, so node tests load them).

const MAIN = /\/mac-workspace\/[^/]+\/[^/]+\/main(?:\/|$)/;

// A repo's name from its git folder: the project for a mac-workspace
// `<group>/<name>/main/.git` (not "main"), else the folder holding .git, else a bare repo's.
export function repoName(gitDir) {
  const dir = gitDir.replace(/\/+$/, "");
  const parts = dir.split("/");
  if (parts.at(-1) === ".git") {
    parts.pop();
    if (parts.at(-1) === "main" && MAIN.test(parts.join("/"))) parts.pop();
    return parts.at(-1);
  }
  return parts.at(-1).replace(/\.git$/, "");
}

// Linked worktrees in `git worktree list --porcelain` (the first entry is the main checkout).
export function worktreeCount(porcelain) {
  const n = (porcelain ?? "").split("\n").filter((l) => l.startsWith("worktree ")).length;
  return Math.max(0, n - 1);
}

// The pane of a space whose terminal is in a project's main checkout, so entering
// the space lands there. `ps`: panes(), `live`: as spacePlace's. Null when the space has none.
export function mainPane(space, ps, live = {}) {
  const tabs = new Set((space.tabs ?? []).map((t) => t.id));
  return ps.find((p) => tabs.has(p.tab) && MAIN.test(live[p.terminal] || p.cwd || ""))?.pane ?? null;
}

// The main checkout (the list's first entry) and its branch ("" when detached).
export function mainCheckout(porcelain) {
  const first = (porcelain ?? "").split("\n\n")[0].split("\n");
  const path = first.find((l) => l.startsWith("worktree "))?.slice(9);
  if (!path) return null;
  const branch = first.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "";
  return { path, branch };
}

// A folder in a mac-workspace project's main checkout (`<group>/<name>/main`).
export function isMainFolder(dir) {
  return Boolean(dir) && MAIN.test(dir);
}

// A space agent-sleep put away: every one of its tabs settled.
export function asleep(space) {
  const tabs = space?.tabs ?? [];
  return tabs.length > 0 && tabs.every((t) => t.settled === true);
}

// The project a mac-workspace folder belongs to (`<group>/<name>/...`), else null.
function projectOf(dir) {
  return /\/mac-workspace\/[^/]+\/([^/]+)\/(?:main|worktrees)(?:\/|$)/.exec(dir ?? "")?.[1] ?? null;
}

// Where a space is now. Herdr's own folders lag: a space's `folder` is where it
// was made, and a pane's `cwd` is where its shell last said it was, not where the
// program in front runs. `live`: terminal -> its foreground program's folder
// (`hc ls`). Among the space's terminals, those of the project the space is named
// after come first, its main checkout before its worktrees; else the first one.
export function spacePlace(space, ps, live) {
  const tabs = new Set((space.tabs ?? []).map((t) => t.id));
  const dirs = ps.filter((p) => tabs.has(p.tab)).map((p) => live[p.terminal] || p.cwd).filter(Boolean);
  const named = dirs.filter((d) => projectOf(d) === space.name);
  return named.find((d) => MAIN.test(d)) || named[0] || dirs[0] || space.folder;
}

// The organization tabs of the Spaces list, in order: mac-workspace's groups,
// then everything outside them.
export const ORGS = [["ag", "AG"], ["cs", "CS"], ["personal", "PERSONAL"], ["other", "OTHER"]];

// A folder's organization: its mac-workspace group (`<root>/<group>/...`), else "other".
export function orgOf(dir) {
  return /\/mac-workspace\/(ag|cs|personal)\//.exec(`${dir ?? ""}/`)?.[1] ?? "other";
}
