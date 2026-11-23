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

// The workspace switcher (Collie's, in its words): All first, then Collie's order (cs, ag,
// personal, its ⌘1–⌘3), then what is outside mac-workspace. Initials as Collie's tiles.
const SWITCH = [
  ["all", "All workspaces", ""],
  ["cs", "Coldsmoke", "CS"],
  ["ag", "Arctic Grey", "AG"],
  ["personal", "Personal", "P"],
  ["other", "Other", "O"],
];

// What the switcher's pill shows for a pick: the org's name and initials (All: none).
export function orgFace(org) {
  const [, label, initials] = SWITCH.find(([id]) => id === org) ?? SWITCH[0];
  return { label, initials };
}

// The switcher's menu. `rows`: the list's rows with their `org`; `picked`: the shown one.
// All always, each org with spaces (and the picked one even when empty): its count, and
// `needs` when an agent in one of its spaces is blocked.
export function orgMenu(rows, picked) {
  return SWITCH.map(([id, label, initials]) => {
    const list = id === "all" ? rows : rows.filter((r) => r.org === id);
    return { id, label, initials, count: list.length, needs: list.some((r) => r.w?.status === "blocked"), on: picked === id };
  }).filter((m) => m.id === "all" || m.count || m.on);
}

// The workspace Collie shows, from its desktop.json (`{"workspace": "cs"|"ag"|"personal"|"all"}`);
// null when the file is missing, broken or names something else.
export function collieWorkspace(text) {
  try {
    const ws = JSON.parse(text ?? "")?.workspace;
    return ["all", "cs", "ag", "personal"].includes(ws) ? ws : null;
  } catch {
    return null;
  }
}

// Herdr follows Collie: when Collie's pick differs from the last one seen, the list switches
// to it; a pick made here stays until Collie picks again. `seen`: Collie's last pick (null at
// first), `collie`: its pick now (null: unreadable, nothing changes).
export function followCollie({ org, seen }, collie) {
  if (collie == null || collie === seen) return { org, seen };
  return { org: collie, seen: collie };
}

// The link to Collie's core, in Collie's own words. `link`: the last answer ({ok}), null
// before the first; `working`: agents working here now.
export function linkStatus(link, working) {
  if (!link) return { text: "waking up", loose: false, tip: "Looking for Collie's core at 127.0.0.1:4317" };
  if (!link.ok) {
    return { text: "sheep loose", loose: true, tip: "Collie unreachable: the mac-workspace core at 127.0.0.1:4317 didn't answer (ws console serve; launchd keeps it up). Click to retry" };
  }
  if (!working) return { text: "on watch", loose: false, tip: "Collie is on watch: nothing to herd. Click to open Collie" };
  return { text: `herding ${working}`, loose: false, tip: `Collie is herding: ${working} agent${working === 1 ? "" : "s"} working. Click to open Collie` };
}

// A folder's organization: its mac-workspace group (`<root>/<group>/...`), "workspace" for
// the root itself (the Workspace Boss's home, above every org), else "other".
export function orgOf(dir) {
  const d = `${dir ?? ""}/`;
  if (/\/mac-workspace\/$/.test(d)) return "workspace";
  return /\/mac-workspace\/(ag|cs|personal)\//.exec(d)?.[1] ?? "other";
}

// The spaces the list shows for the organization picked. Focusing a space of another org
// (from Agents, a toast) switches the pick with it; the workspace root belongs to every org,
// so focusing it (the Boss) keeps the pick and its space stays listed. A hidden switcher
// still filters by the pick; only the rail (collapsed) and ALL list every space.
// rows: [{ id, org, active }]. Returns { org, lastActive, rows }.
export function orgView({ org, lastActive, rows, collapsed }) {
  const active = rows.find((r) => r.active);
  if (active && active.id !== lastActive) {
    lastActive = active.id;
    if (org !== "all" && active.org !== "workspace" && active.org !== org) org = active.org;
  }
  const shown = collapsed || org === "all" ? rows : rows.filter((r) => r.org === org || r.org === "workspace");
  return { org, lastActive, rows: shown };
}

// What clicking the main mark does: "switch" puts the main checkout back on main,
// "pull" fast-forwards it from origin, null when there is nothing to do (no main
// checkout, or main has no upstream to pull from).
export function mainAction(m) {
  if (!m) return null;
  if (m.branch !== "main" && m.branch !== "master") return "switch";
  return m.behind == null ? null : "pull";
}

// The toast after a pull: how many commits it brought in (null: unknown).
export function pulledText(n) {
  if (n == null) return "main is up to date with origin";
  return n > 0 ? `pulled ${n} commit${n === 1 ? "" : "s"}` : "already up to date";
}

// Why a pull failed: git's first line of complaint, else its exit code.
export function pullFailure(r) {
  const line = (r?.stderr ?? "").trim().split("\n")[0];
  return line || `git exited with code ${r?.code ?? "?"}`;
}
