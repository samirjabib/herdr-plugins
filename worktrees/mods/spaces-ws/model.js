// The Spaces sidebar's pure rules (no Herdr calls, so node --test can run
// them): one row per project, what its dots and counts say, the state of its
// main checkout, the order, and what Update main says.

const trim = (path) => path.replace(/\/+$/, "");
const base = (path) => trim(path).split("/").pop();

// A project's name from its repo (git's common dir): the repo's folder, and
// for a mac-workspace main checkout (<root>/<group>/<name>/main) the <name>.
export function projectName(repo) {
  const r = trim(repo);
  if (!r.endsWith("/.git")) return base(r).replace(/\.git$/, "");
  const top = r.slice(0, -5);
  const name = base(top);
  return name === "main" ? base(top.slice(0, -5)) || name : name;
}

// The repo's own checkout, null for a bare repo.
export function mainCheckout(repo) {
  const r = trim(repo);
  return r.endsWith("/.git") ? r.slice(0, -5) : null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What main says, only when it isn't fresh: "↓N" behind its upstream, or "⚠"
// when `ws update` couldn't fast-forward it (the same reasons it gives).
// `m`: { branch (null: detached), defaultBranch, dirty, ahead, behind }, or
// null when it couldn't be read.
export function mainState(m) {
  if (!m) return { kind: "fresh" };
  const why = [];
  if (m.branch !== m.defaultBranch) why.push(`on another branch (${m.branch ?? "detached"})`);
  if (m.dirty) why.push("uncommitted changes");
  if (m.ahead > 0) why.push(`${plural(m.ahead, "commit")} ahead of upstream`);
  if (why.length) return { kind: "warn", text: "⚠", why: why.join(", ") };
  if (m.behind > 0) return { kind: "behind", n: m.behind, text: `↓${m.behind}` };
  return { kind: "fresh" };
}

// Spaces in rows, one per project. `gitOf(space)`: { repo (a key, one per
// repo and machine), path (git's common dir), linked } or null (not a repo).
// A row's spaces: its main checkout's first, then the rest in order; its
// target (where a click goes): the main checkout's space, else its first.
// Spaces outside a repo keep a row each. Rows come in their first space's order.
export function groupRows(spaces, gitOf) {
  const rows = [];
  const byRepo = new Map();
  for (const s of spaces) {
    const g = gitOf(s) ?? null;
    if (!g) {
      rows.push({ key: `space:${s.id}`, name: null, repo: null, path: null, spaces: [s], target: s, mains: [s] });
      continue;
    }
    let row = byRepo.get(g.repo);
    if (!row) {
      row = { key: `repo:${g.repo}`, name: projectName(g.path), repo: g.repo, path: g.path, spaces: [], mains: [], rest: [] };
      byRepo.set(g.repo, row);
      rows.push(row);
    }
    (g.linked ? row.rest : row.mains).push(s);
  }
  for (const r of rows) {
    if (!r.rest) continue;
    r.spaces = [...r.mains, ...r.rest];
    r.target = r.spaces[0];
    delete r.rest;
  }
  return rows;
}

// An agent's status as a dot: needs you, working, or idle (done counts as idle).
export const kind = (status) => (status === "blocked" || status === "error" ? "need" : status === "working" ? "work" : "idle");
const isAgent = (t) => Boolean(t?.status || t?.report || t?.program?.agent);

// What runs in a row's spaces. `world`: { agents: agents(), panes: panes(),
// terminals: terminals() }.
//   agents  [{ address, name, kind, space }]: the spaces' agents in order, each
//           sub-agent (started with hc run, no pane) right after its parent,
//           in its parent's space
//   procs   { running, failed }: the other terminals started with hc run from
//           anything in these spaces (watchers, jobs, dev servers); failed:
//           one ended with an error (not killed)
export function rowActivity(spaces, world) {
  const ids = new Set(spaces.map((s) => s.id));
  const tabs = new Set(spaces.flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  const all = world.terminals ?? [];
  const term = new Map(all.map((t) => [t.address, t]));
  const listedStatus = new Map((world.agents ?? []).map((a) => [a.address, a.status]));
  const inPanes = new Set((world.panes ?? []).filter((p) => p.terminal && tabs.has(p.tab)).map((p) => p.terminal));
  const agents = [];
  const seen = new Set();
  const add = (address, status, name, space) => {
    if (seen.has(address)) return;
    seen.add(address);
    agents.push({ address, name, kind: kind(status), space });
    for (const k of all) {
      if (k.parent !== address || k.state !== "live" || !isAgent(k)) continue;
      add(k.address, listedStatus.get(k.address) ?? k.status, k.name || k.program?.name || k.address, space);
    }
  };
  for (const a of world.agents ?? []) {
    if (!ids.has(a.space)) continue;
    add(a.address, a.status, term.get(a.address)?.name || a.tab_name || a.program?.name || a.address, a.space);
  }
  const roots = new Set([...inPanes, ...seen]);
  const rooted = (t) => {
    for (let p = t.parent, hops = 0; p && hops < 32; p = term.get(p)?.parent, hops++) if (roots.has(p)) return true;
    return false;
  };
  let running = 0;
  let failed = false;
  for (const t of all) {
    if (!t.parent || isAgent(t) || inPanes.has(t.address) || !rooted(t)) continue;
    if (t.state === "live") running++;
    else if (t.state === "finished" && t.exit_code && t.reason !== "killed" && !t.signal) failed = true;
  }
  return { agents, procs: { running, failed } };
}

// "▸N" running processes, red (the caller's color) when one failed; "" when nothing.
export const procText = ({ running, failed }) => (running || failed ? `▸${running}` : "");

// One agent alone and idle says nothing; otherwise a dot each.
export const dotsShown = (agents) => agents.length > 1 || (agents.length === 1 && agents[0].kind !== "idle");

// 0 needs you, 1 working, 2 the rest.
export function rank(row) {
  const agents = row.activity?.agents ?? [];
  return agents.some((a) => a.kind === "need") ? 0 : agents.some((a) => a.kind === "work") ? 1 : 2;
}

// Needs you first, then working, then the rest, each in its own order.
export const sortRows = (rows) => rows.map((r, i) => [rank(r), i, r]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , r]) => r);

const LABEL = { work: "working", need: "needs you", idle: "idle" };

// The hover: each agent and its status, under its space's name when the row
// has several `spaces` (every one listed), then main's reason; null when there's nothing.
export function rowTooltip(agents, main, spaces = []) {
  const line = (a) => `${a.name} · ${LABEL[a.kind]}`;
  const lines = spaces.length > 1
    ? spaces.flatMap((s) => {
      const mine = agents.filter((a) => a.space === s.id);
      return [s.name, ...(mine.length ? mine.map((a) => `  ${line(a)}`) : ["  no agents"])];
    })
    : agents.map(line);
  if (main?.kind === "warn") lines.push(`main · ${main.why}`);
  if (main?.kind === "behind") lines.push(`main · ${plural(main.n, "commit")} behind`);
  return lines.length ? lines.join("\n") : null;
}

// `sh` arguments for `ws update <name>` in that machine's ~/mac-workspace.
export const updateArgs = (name) => ["-c", 'exec "$HOME/mac-workspace/bin/ws" update "$1"', "sh", name];

const NOT_INSTALLED = { title: "ws update is not installed", body: "Update mac-workspace (~/mac-workspace/bin/ws) to get it.", level: "error" };

// The toast for what `ws update` answered (null: it couldn't start). Its one
// line is the title: exit 0 done or already up to date, exit 1 not touched.
export function updateToast(name, r) {
  if (!r || r.code === 127 || r.code === 126) return NOT_INSTALLED;
  const text = `${r.stdout}\n${r.stderr}`;
  if (/unknown (command|subcommand)|usage: ws/i.test(text) && !text.includes(`${name}:`)) return NOT_INSTALLED;
  const line = text.split("\n").map((l) => l.trim()).filter(Boolean).find((l) => l.startsWith(`${name}:`))
    ?? text.split("\n").map((l) => l.trim()).find(Boolean);
  if (r.code === 0) return { title: line ?? `${name}: main up to date`, level: "success" };
  if (r.code === 1 && line) return { title: line, level: "warning" };
  return { title: `${name}: ws update failed (exit ${r.code})`, ...(line ? { body: line } : {}), level: "error" };
}

// The spaces' order that keeps each project's together, in the rows' order.
export const contiguousOrder = (rows) => rows.flatMap((r) => r.spaces.map((s) => s.id));

// A menu's "Update main" request ({ space, at }, shared): new (not the one
// handled last) and recent (not one left from before a restart).
export const freshRequest = (req, handledAt, now, within = 15000) =>
  Boolean(req?.space && req.at && req.at !== handledAt && now - req.at < within);

// The spaces' order after dragging a row's spaces (`from`) onto another
// row's (`onto`): after it when it was below, else before it.
export function dropOrder(order, from, onto) {
  const moving = new Set(from);
  if (onto.some((id) => moving.has(id))) return order;
  const down = order.indexOf(from[0]) < order.indexOf(onto[0]);
  const rest = order.filter((id) => !moving.has(id));
  const at = down ? rest.indexOf(onto[onto.length - 1]) + 1 : rest.indexOf(onto[0]);
  return [...rest.slice(0, at), ...from, ...rest.slice(at)];
}

// Where a click on a row goes: its target, and once one of its spaces shows,
// the next of its spaces (round), so every space of the project is reachable.
export function clickTarget(row) {
  const at = row.spaces.findIndex((s) => s.active);
  return at === -1 ? row.target : row.spaces[(at + 1) % row.spaces.length];
}

// How many spaces a row merges, shown only when more than one.
export const spaceCount = (row) => (row.spaces.length > 1 ? String(row.spaces.length) : "");
