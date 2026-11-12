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
// open: false, true, or the label of who uses it ("in use · Claude working").
// { main, branch, merged, dirty, unpushed, open } ->
//   { safe, suggested, inMain, onRemote, why: [] }
export function cleanVerdict(c) {
  const why = [];
  if (c.main) why.push("main checkout");
  if (!c.branch) why.push("detached");
  if (c.dirty) why.push("uncommitted changes");
  if (c.unpushed > 0) why.push(`${c.unpushed} only on this Mac`);
  if (c.open) why.push(typeof c.open === "string" ? c.open : "in use");
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

// Who is in a checkout, for its "in use" badge: the panes whose live folder
// is inside it. An agent's name and status when one runs there, else a shell.
// panes: [{ cwd, app, status }] -> false | "in use · Claude working" | "in use · shell"
const AGENTS = { "claude-code": "Claude", pi: "Pi", codex: "Codex", opencode: "OpenCode" };
export function usedBy(path, panes) {
  const here = panes.filter((q) => q.cwd && (q.cwd === path || q.cwd.startsWith(path + "/")));
  if (here.length === 0) return false;
  const agent = here.find((q) => q.app);
  if (!agent) return here.length > 1 ? `in use · ${here.length} shells` : "in use · shell";
  const name = AGENTS[agent.app] ?? agent.app;
  return `in use · ${name}${agent.status ? ` ${agent.status}` : ""}`;
}

// du -sk kilobytes for people: 840 KB, 12 MB, 1.4 GB.
export function size(kb) {
  if (!Number.isFinite(kb) || kb <= 0) return "";
  if (kb < 1024) return `${Math.round(kb)} KB`;
  if (kb < 1024 * 1024) return `${Math.round(kb / 1024)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

// A theme color with alpha `aa` (two hex digits), replacing any alpha it has:
// theme colors can already be #rrggbbaa, and appending to those is invalid.
export function withAlpha(color, aa) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color ?? "");
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split("").map((ch) => ch + ch).join("") : m[1].slice(0, 6);
  return `#${hex}${aa}`;
}
