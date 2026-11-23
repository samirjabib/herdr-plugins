// Pure helpers of the Spaces "+" picker (no herdr imports, so node tests load them).
// It works the way mac-workspace does: the catalog (workspace.tsv) says which projects an
// organization has, `<root>/<group>/<name>/main` is a project's main checkout and
// `<root>/<group>/<name>/worktrees/<wt>` its worktrees.

// The workspace switcher's orgs, as spaces-ws/model.js draws them (a mod can't import
// another mod's files, so they are copied; a test keeps both the same). Collie's order.
export const SWITCH = [
  ["cs", "Coldsmoke", "CS"],
  ["ag", "Arctic Grey", "AG"],
  ["personal", "Personal", "P"],
  ["other", "Other", "O"],
];
export const ORG_IDS = SWITCH.map(([id]) => id);

// What the pill shows for an org: its name and initials.
export function orgFace(org) {
  const [, label, initials] = SWITCH.find(([id]) => id === org) ?? SWITCH[1];
  return { label, initials };
}

// The org Tab (or shift-Tab) moves to.
export function nextOrg(org, back = false) {
  const i = Math.max(0, ORG_IDS.indexOf(org));
  return ORG_IDS[(i + (back ? ORG_IDS.length - 1 : 1)) % ORG_IDS.length];
}

// The search's placeholder, in the picked org's name.
export function placeholder(org) {
  return org === "other" ? "Search folders outside mac-workspace…" : `Search ${orgFace(org).label} projects…`;
}

// The switcher's menu: every org with its tile, how many catalog projects it has, and the shown one.
export function orgMenu(projectsByOrg, picked) {
  return SWITCH.map(([id, label, initials]) => ({ id, label, initials, count: projectsByOrg[id] ?? 0, on: id === picked }));
}

// workspace.tsv (`group<TAB>name<TAB>remote`, a header first): its rows.
export function parseCatalog(text) {
  return (text ?? "").split("\n").slice(1).map((l) => l.split("\t"))
    .filter(([g, name]) => g && name).map(([group, name, remote = ""]) => ({ group, name, remote: remote.trim() }));
}

// The checkouts on this Mac and their HEAD: one `<path><TAB><HEAD file>` line each, as
// the picker's one shell read prints them (`ref: refs/heads/x`, or a commit when detached).
// Path -> branch ("" when detached).
export function parseHeads(text) {
  const heads = new Map();
  for (const line of (text ?? "").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const head = line.slice(tab + 1).trim();
    heads.set(line.slice(0, tab), head.startsWith("ref: refs/heads/") ? head.slice(16) : "");
  }
  return heads;
}

// An organization's projects: every catalog row of the group (only that group's: orgs
// never mix), plus checkouts of the group that the catalog misses. Cloned ones first,
// then the ones this Mac doesn't have (`cloned: false`), each by name. A cloned one
// carries its main's branch and its worktrees (by name, each with its branch).
export function projectsOf(org, { catalog = [], heads = new Map(), root }) {
  if (org === "other") return [];
  const base = `${root}/${org}/`;
  const names = new Set(catalog.filter((c) => c.group === org).map((c) => c.name));
  const wts = new Map();
  for (const [path, branch] of heads) {
    if (!path.startsWith(base)) continue;
    const [name, kind, wt, extra] = path.slice(base.length).split("/");
    if (!name || extra !== undefined) continue;
    if (kind === "main" && wt === undefined) names.add(name);
    else if (kind === "worktrees" && wt) {
      if (!wts.has(name)) wts.set(name, []);
      wts.get(name).push({ name: wt, path, branch });
    }
  }
  const all = [...names].map((name) => {
    const main = `${base}${name}/main`;
    const cloned = heads.has(main);
    const worktrees = cloned ? (wts.get(name) ?? []).sort((a, b) => a.name.localeCompare(b.name)) : [];
    return { org, name, main, cloned, branch: cloned ? heads.get(main) : null, worktrees };
  });
  const byName = (a, b) => a.name.localeCompare(b.name);
  return [...all.filter((p) => p.cloned).sort(byName), ...all.filter((p) => !p.cloned).sort(byName)];
}

// What a project row says about its main checkout, the same rule spaces-ws uses: `main`
// (or master) quietly, else a red ⚠ with the branch it is on. Null when not cloned.
export function mainFact(p) {
  if (!p.cloned) return null;
  if (p.branch === "main" || p.branch === "master") return { text: p.branch, warn: false };
  return { text: `⚠ ${p.branch || "detached"}`, warn: true, tip: `main checkout is on ${p.branch || "a detached HEAD"}, not main` };
}

// The picker's memory of what was opened: keys `<org>/<name>`, most recent first.
export function remember(history, org, name, limit = 12) {
  const key = `${org}/${name}`;
  return [key, ...(history ?? []).filter((k) => k !== key)].slice(0, limit);
}

// Recent projects of an org: the ones opened from here (most recent first), then the
// ones that have a space open now; only cloned projects of this org, at most `limit`.
export function recentOf(projects, history, open = [], limit = 4) {
  if (!projects.length) return [];
  const byName = new Map(projects.filter((p) => p.cloned).map((p) => [p.name, p]));
  const org = projects[0].org;
  const names = [
    ...(history ?? []).filter((k) => k.startsWith(`${org}/`)).map((k) => k.slice(org.length + 1)),
    ...open,
  ];
  const out = [];
  for (const n of names) {
    const p = byName.get(n);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

// The picker's rows, in order. Sections are labels (`kind: "section"`, not selectable):
// - "Here": the org's seat, its orchestrator (`orch`, running or not) and a terminal at
//   `~/mac-workspace/<org>` (`root`);
// - "Recent" (only without a search, and only when there is one);
// - "Projects": every project of the org; an `expanded` one (a Set of names) lists its
//   worktrees under it. A search keeps matching projects and, for a project that only
//   matches by a worktree, those worktrees;
// then "Other folder…" and "New terminal" as quiet last rows.
// `orch`: { running } for the org's orchestrator; `root`: ~/mac-workspace.
export function buildRows({ org, projects = [], recent = [], orch = null, query = "", expanded = new Set(), root }) {
  const q = (query ?? "").trim().toLowerCase();
  const has = (s) => !q || s.toLowerCase().includes(q);
  const rows = [];
  const section = (label, list) => { if (list.length) rows.push({ kind: "section", label }, ...list); };
  if (org !== "other") {
    const { label } = orgFace(org);
    section("Here", [
      { kind: "orch", label: `${label} orchestrator`, running: Boolean(orch?.running) },
      { kind: "root", label: `Terminal at ~/mac-workspace/${org}`, path: `${root}/${org}` },
    ].filter((r) => has(r.label)));
    if (!q) section("Recent", recent.map((p) => ({ kind: "project", label: p.name, project: p, recent: true })));
    const list = [];
    for (const p of projects) {
      const hit = has(p.name);
      const wts = p.worktrees.filter((w) => has(w.name) || has(w.branch ?? ""));
      if (!hit && !wts.length) continue;
      const open = (expanded.has(p.name) && p.worktrees.length > 0) || (!hit && wts.length > 0);
      list.push({ kind: "project", label: p.name, project: p, expandable: p.worktrees.length > 0, open });
      if (open) for (const w of hit ? p.worktrees : wts) list.push({ kind: "worktree", label: w.name, branch: w.branch, project: p, path: w.path });
    }
    if (list.length) section("Projects", list);
    else if (!q) rows.push({ kind: "section", label: "Projects" }, { kind: "empty", label: "No projects in the catalog for this workspace" });
  }
  const tail = [{ kind: "other", label: "Other folder…" }, { kind: "terminal", label: "New terminal" }].filter((r) => has(r.label));
  if (tail.length) rows.push({ kind: "gap" }, ...tail);
  return rows;
}

// Rows the keyboard can land on.
export function selectable(row) {
  return Boolean(row) && row.kind !== "section" && row.kind !== "empty" && row.kind !== "gap";
}

// The next selectable row from `at` going `dir` (+1/-1), wrapping; -1 when none.
export function step(rows, at, dir) {
  const n = rows.length;
  for (let k = 1; k <= n; k++) {
    const i = (((at + dir * k) % n) + n) % n;
    if (selectable(rows[i])) return i;
  }
  return -1;
}

// Where the selection starts: the first project when there is one (a search lands on
// what it found), else the first selectable row.
export function firstRow(rows, query = "") {
  const want = (query ?? "").trim() ? rows.findIndex((r) => r.kind === "project" || r.kind === "worktree") : -1;
  return want >= 0 ? want : step(rows, -1, 1);
}

// What → and ← do on a row: "expand" / "collapse" a project with worktrees, or "parent"
// (← on a worktree selects its project, folded). Null: nothing.
export function arrow(row, key) {
  if (!row) return null;
  if (row.kind === "project" && !row.recent && row.expandable) {
    if (key === "right" && !row.open) return "expand";
    if (key === "left" && row.open) return "collapse";
  }
  if (row.kind === "worktree" && key === "left") return "parent";
  return null;
}

// The shell command a not-cloned project's row runs in its new terminal: `ws clone`, then
// Claude in the fresh main checkout; on failure a shell stays to show why.
export function cloneArgv(p) {
  return ["zsh", "-lc", 'ws clone "$1" && cd "$2" && exec claude; echo; echo "ws clone $1 did not finish"; exec zsh -l', "zsh", p.name, p.main];
}

// The one shell read behind the list: every main checkout and worktree under `root` with
// its HEAD file, read straight from disk (no git process per checkout).
export const HEADS_SCRIPT = `for d in "$1"/*/*/main "$1"/*/*/worktrees/*; do
  if [ -d "$d/.git" ]; then g="$d/.git"
  elif [ -f "$d/.git" ]; then g=$(sed -n 's/^gitdir: //p' "$d/.git"); case $g in /*) ;; *) g="$d/$g" ;; esac
  else continue; fi
  [ -f "$g/HEAD" ] && printf '%s\\t%s\\n' "$d" "$(cat "$g/HEAD")"
done 2>/dev/null; true`;
