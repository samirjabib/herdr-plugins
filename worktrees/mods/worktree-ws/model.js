// Pure helpers of the worktree dialog (no herdr imports, so node tests load them).

// Herdr's default place for checkouts: <home>/.herdr/worktrees/<repo>/<slug>.
export const ROOT = (home) => `${home}/.herdr/worktrees`;

export const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

// A repo whose main checkout is .../mac-workspace/<group>/<name>/main: that
// project folder (.../<group>/<name>); null for any other repo.
export const wsBase = (main) => main.match(/^(.*\/mac-workspace\/[^/]+\/[^/]+)\/main$/)?.[1] ?? null;

// Where new checkouts of a repo go: <project>/worktrees in the mac-workspace
// layout, else Herdr's <ROOT>/<repo name>.
export const checkoutDir = (repo, userHome) => wsBase(repo.main) ? `${wsBase(repo.main)}/worktrees` : `${ROOT(userHome)}/${repo.name}`;

// A repo's name for people: the project folder in the mac-workspace layout
// (its main checkout's folder is always "main"), else the main checkout's folder.
export const repoTitle = (repo) => wsBase(repo.main)?.split("/").pop() ?? repo.name;

// Clean up: whether a checkout can go without losing anything, and why not.
// Removing a worktree keeps its branch and commits; what it can lose is
// uncommitted work, and commits that exist only on this machine (should the
// branch be deleted later). So a checkout is removable when it is a linked one
// on a branch, nothing is uncommitted, every commit is on a remote (pushing or
// merging puts it there) and no pane is in it. Suggested (chosen by default)
// when its branch is also merged into a base, so the work is in main.
// { main, branch, merged, dirty, unpushed, open } ->
//   { safe, suggested, inMain, onRemote, why: [] }
export function cleanVerdict(c) {
  const why = [];
  if (c.main) why.push("main checkout");
  if (!c.branch) why.push("detached");
  if (c.dirty) why.push("uncommitted changes");
  if (c.unpushed > 0) why.push(`${c.unpushed} only on this Mac`);
  if (c.open) why.push("open in a pane");
  const safe = why.length === 0;
  return { safe, suggested: safe && Boolean(c.merged), inMain: Boolean(c.merged), onRemote: c.unpushed === 0, why };
}

// Branch names out of `gh pr list --json headRefName --jq '.[].headRefName'`
// and `git branch --merged <base> --format=%(refname:short)` output, merged.
export function mergedSet(...outputs) {
  const set = new Set();
  for (const out of outputs) for (const line of (out ?? "").split("\n")) if (line.trim()) set.add(line.trim());
  return set;
}

// du -sk kilobytes for people: 840 KB, 12 MB, 1.4 GB.
export function size(kb) {
  if (!Number.isFinite(kb) || kb <= 0) return "";
  if (kb < 1024) return `${Math.round(kb)} KB`;
  if (kb < 1024 * 1024) return `${Math.round(kb / 1024)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}
