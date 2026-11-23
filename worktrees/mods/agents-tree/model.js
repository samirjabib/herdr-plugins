// Pure rules of the Agents tree (no herdr imports, so node tests load them): the
// Boss -> org orchestrator -> project -> workers tree, a project's one-line summary,
// and the live processes folded under an agent.

// The organization of a folder under ~/mac-workspace (spaces-ws orgOf), else "other".
export function orgOfDir(dir) {
  return /\/mac-workspace\/(ag|cs|personal)\//.exec(`${dir ?? ""}/`)?.[1] ?? "other";
}

// The worktree a folder is in (`<repo>/worktrees/<slug>`), else null: the main checkout.
export function worktreeOf(dir) {
  return /\/worktrees\/([^/]+)/.exec(dir ?? "")?.[1] ?? null;
}

// Where an agent runs: "main" in a main checkout (`<repo>/main`), its worktree's name in one, else null.
export function placeOf(dir) {
  return worktreeOf(dir) ?? (/\/main(?:\/|$)/.test(dir ?? "") ? "main" : null);
}

// The mac-workspace project a folder belongs to (`<root>/<org>/<name>/main|worktrees/...`):
// its org, name and folder (`base`, holding `main` and `worktrees`). Null elsewhere.
export function projectOf(dir) {
  const m = /^(.*\/mac-workspace\/(ag|cs|personal)\/([^/]+))\/(?:main|worktrees)(?:\/|$)/.exec(dir ?? "");
  return m ? { org: m[2], name: m[3], base: m[1] } : null;
}

// A workspace root a folder is: "workspace" for ~/mac-workspace, the org for
// ~/mac-workspace/<org>, else null.
export function orgRootOf(dir) {
  const m = /\/mac-workspace(?:\/(cs|ag|personal))?\/?$/.exec(dir ?? "");
  return m ? m[1] ?? "workspace" : null;
}

// A job: a terminal named job-<name> (scheduled or watching), as Collie's core has no jobs
// with a folder yet.
export const isJob = (name) => /^job-./.test(name ?? "");

// The org of a mac-workspace orchestrator (`ws orchestrator start <org>` names it orch-<org>), else null.
export function orchOf(name) {
  return /^orch-(workspace|cs|ag|personal)$/.exec(name ?? "")?.[1] ?? null;
}

// A project's own orchestrator: the terminal named `orch-<org>-<project>`.
export function projectOrchOf(name) {
  const m = /^orch-(cs|ag|personal)-(.+)$/.exec(name ?? "");
  return m ? { org: m[1], project: m[2] } : null;
}

// Seats under the Boss, in Collie's order; "other" (outside every org) has no orchestrator.
export const ORG_SEATS = ["cs", "ag", "personal", "other"];

const byUrgency = (x, y) => y.rank - x.rank || y.since - x.since || y.seq - x.seq;

// The tree. `list`: agents in the list's order, each { address, name, cwd, rank, since, seq,
// pinned, space }. Returns { boss, pinned, seats: [{ org, orch, projects, loose }] }: each
// project { org, name, base, orch, workers, rank, since }, `loose` the org's agents outside a
// project. Under All every org seat shows (an off one too) and Other only with agents; an org
// picked shows only its seat. Pinned workers leave the tree (orchestrators keep their seat).
// byPriority: projects and workers by urgency, then recency; else in the list's order.
//
// extras: terminals that are not agents, each { address, name, cwd }: jobs (job-*) and
// background terminals whose launcher isn't known. A job sits where it runs: the workspace
// root under the Boss (`jobs`), an org's root under its seat, a project under its row; a
// background terminal under its project's row (`background`), else in its seat's `loose`.
export function buildTree(list, { org = "all", byPriority = false, extras = [] } = {}) {
  const boss = list.find((a) => orchOf(a.name) === "workspace") ?? null;
  const pinned = [];
  const jobs = [];
  const seats = new Map(ORG_SEATS.map((o) => [o, { org: o, orch: null, projects: [], loose: [], jobs: [] }]));
  const projects = new Map();
  const projectNode = (p) => {
    const key = `${p.org}/${p.name}`;
    if (!projects.has(key)) {
      const node = { ...p, orch: null, workers: [], jobs: [], background: [], rank: 0, since: 0, seq: 0 };
      projects.set(key, node);
      seats.get(p.org).projects.push(node);
    }
    return projects.get(key);
  };
  for (const a of list) {
    if (a === boss) continue;
    const seatOrg = orchOf(a.name);
    if (seatOrg) { seats.get(seatOrg).orch ??= a; continue; }
    if (a.pinned) { pinned.push(a); continue; }
    const p = projectOf(a.cwd);
    const seat = seats.get(p?.org ?? orgOfDir(a.cwd));
    if (!p) { seat.loose.push(a); continue; }
    const node = projectNode(p);
    const own = projectOrchOf(a.name);
    if (own && own.org === p.org && own.project === p.name && !node.orch) node.orch = a;
    else node.workers.push(a);
    node.rank = Math.max(node.rank, a.rank);
    node.since = Math.max(node.since, a.since);
    node.seq = Math.max(node.seq, a.seq);
  }
  for (const extra of extras) {
    const x = { rank: 0, since: 0, seq: 0, ...extra };
    const p = projectOf(x.cwd);
    const root = orgRootOf(x.cwd);
    const seat = seats.get(p?.org ?? (root && root !== "workspace" ? root : orgOfDir(x.cwd)));
    if (isJob(x.name)) {
      if (p) projectNode(p).jobs.push(x);
      else if (root === "workspace") jobs.push(x);
      else seat.jobs.push(x);
    } else if (p) projectNode(p).background.push(x);
    else seat.loose.push(x);
  }
  if (byPriority) {
    for (const seat of seats.values()) {
      seat.projects.sort(byUrgency);
      for (const p of seat.projects) p.workers.sort(byUrgency);
      seat.loose.sort(byUrgency);
    }
  }
  const shown = (s) => (org === "all" ? s.org !== "other" || s.projects.length || s.loose.length || s.jobs.length : s.org === org);
  return { boss, pinned, jobs, seats: [...seats.values()].filter(shown) };
}

// The branch a HEAD file names ("" when detached), null when it couldn't be read.
export function headBranch(text) {
  if (text == null) return null;
  const head = text.trim();
  return head.startsWith("ref: refs/heads/") ? head.slice(16) : "";
}

// Whether a git config has a remote on GitHub (an ssh host alias like github.com-arcticgrey too).
export function hasGithub(config) {
  return /^\s*url\s*=\s*\S*github\.com/m.test(config ?? "");
}

// A project row's quiet summary, only what needs saying: its main checkout on another branch
// (⚠ branch), local main behind origin/main as last fetched (↓N), its worktrees (⑂ N), and a
// GitHub mark. `facts`: { branch, behind, worktrees, github }, any of them unknown (null).
export function projectSummary(facts) {
  if (!facts) return [];
  const out = [];
  const { branch, behind, worktrees, github } = facts;
  if (branch != null && branch !== "main" && branch !== "master") {
    out.push({ kind: "branch", text: `⚠ ${branch || "detached"}`, warn: true, tip: `The main checkout is on ${branch || "a detached HEAD"}, not main` });
  }
  if (behind > 0) out.push({ kind: "behind", text: `↓${behind}`, warn: true, tip: `main is ${behind} commit${behind === 1 ? "" : "s"} behind origin/main (last fetch). Update it from Collie` });
  if (worktrees > 0) out.push({ kind: "worktrees", text: `⑂ ${worktrees}`, warn: false, tip: `${worktrees} worktree${worktrees === 1 ? "" : "s"}` });
  if (github) out.push({ kind: "github", text: "", warn: false, tip: "On GitHub" });
  return out;
}

// `ps -axo pid,ppid,pcpu,rss,command`: pid -> { pid, ppid, cpu, rss (KB), command }.
export function parsePs(text) {
  const procs = new Map();
  for (const line of (text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), rss: Number(m[4]), command: m[5].trim() });
  }
  return procs;
}

// The last part of a path (`/usr/bin/node` -> `node`).
const base = (w) => w.replace(/\/+$/, "").split("/").at(-1) || w;
// A word that looks like a secret: long and made of letters and digits only (a token, a hash).
const tokenLike = (w) => w.length >= 24 && /^[A-Za-z0-9_-]+$/.test(w);
const plain = (w) => w.length > 0 && w.length <= 60 && /^[A-Za-z0-9@._\-/ ]+$/.test(w);

// A command said short and safe to show, as Collie's short_cmd: the program, then its plain
// positional words (paths cut to their last part) up to the first flag; never a flag, its
// value or anything token-like. At most three words after the program and 60 characters.
export function shortCmd(command) {
  const words = (command ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const out = [base(words[0])];
  for (const w of words.slice(1, 4)) {
    if (w.startsWith("-")) break;
    const b = base(w);
    if (b.length <= 40 && !b.includes("=") && !tokenLike(b) && plain(b)) out.push(b);
  }
  const line = out.join(" ");
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "login", "-zsh", "-bash"]);
const RUNTIMES = new Set(["node", "bun", "deno"]);

// Not worth a row: a shell, the agent itself (`hide`: its program names), or a runtime
// running it (`node .../claude/cli.js`).
function hidden(command, hide) {
  const words = command.split(/\s+/);
  const prog = base(words[0] ?? "");
  if (SHELLS.has(prog) || hide.includes(prog)) return true;
  if (!RUNTIMES.has(prog)) return false;
  const script = words.slice(1).find((w) => !w.startsWith("-")) ?? "";
  return hide.some((h) => script.split("/").includes(h) || base(script) === h);
}

// An agent's own plumbing, hidden from its processes and only counted: MCP servers (with
// everything under them) and helpers like caffeinate.
function plumbing(command) {
  const words = command.split(/\s+/);
  if (words.slice(0, 4).some((w) => /(^|[-_.])mcp([-_.]|$)/i.test(base(w)))) return "mcp";
  return base(words[0] ?? "") === "caffeinate" ? "other" : null;
}

// A process's name as people say it: `Playwright · chromium` for a browser a test runner
// drives (one family for its many helper names), else shortCmd.
function friendly(command) {
  const lower = command.toLowerCase();
  const family = ["chrom", "firefox", "webkit"].find((f) => base(lower.split(/\s+/)[0] ?? "").includes(f));
  if (family && /playwright|puppeteer/.test(lower)) {
    return `${lower.includes("puppeteer") ? "Puppeteer" : "Playwright"} · ${family === "chrom" ? "chromium" : family}`;
  }
  return shortCmd(command);
}

// The live processes under an agent's terminal: every descendant of `rootPid` (depth first,
// in pid order), shells and the agent hidden (their children still count), and a process
// running the same tool as its nearest shown ancestor folded into it (CPU and memory summed,
// `count` processes). Rows: [{ pid, name, cpu, rss, count }].
export function processRows(procs, rootPid, opts = {}) {
  return processTree(procs, rootPid, opts).rows;
}

// processRows with what it hid: { rows, plumbing: { mcp, other } } (plumbing counts).
export function processTree(procs, rootPid, { hide = [] } = {}) {
  const kids = new Map();
  for (const p of [...procs.values()].sort((a, b) => a.pid - b.pid)) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }
  const rows = [];
  const hid = { mcp: 0, other: 0 };
  const walk = (pid, parentRow, seen) => {
    for (const p of kids.get(pid) ?? []) {
      if (seen.has(p.pid)) continue;
      seen.add(p.pid);
      const kind = plumbing(p.command);
      if (kind) { hid[kind] += 1; continue; }
      let row = parentRow;
      if (!hidden(p.command, hide)) {
        const name = friendly(p.command);
        if (parentRow?.name === name) {
          parentRow.cpu += p.cpu;
          parentRow.rss += p.rss;
          parentRow.count += 1;
        } else {
          row = { pid: p.pid, name, cpu: p.cpu, rss: p.rss, count: 1 };
          rows.push(row);
        }
      }
      walk(p.pid, row, seen);
    }
  };
  walk(rootPid, null, new Set([rootPid]));
  for (const r of rows) r.cpu = Math.round(r.cpu * 10) / 10;
  return { rows, plumbing: hid };
}

// What the process fold hid, for its tooltip ("" when nothing).
export function plumbingNote({ mcp = 0, other = 0 } = {}) {
  const parts = [];
  if (mcp) parts.push(`${mcp} MCP server${mcp === 1 ? "" : "s"}`);
  if (other) parts.push(`${other} helper${other === 1 ? "" : "s"}`);
  return parts.length ? `${parts.join(" and ")} hidden` : "";
}

// A terminal's own CPU and memory: its process and every one under it. Null when gone.
export function procTotal(procs, pid) {
  if (!procs.has(pid)) return null;
  let cpu = 0, rss = 0;
  const stack = [pid], seen = new Set();
  while (stack.length) {
    const at = stack.pop();
    if (seen.has(at)) continue;
    seen.add(at);
    const p = procs.get(at);
    cpu += p.cpu;
    rss += p.rss;
    for (const k of procs.values()) if (k.ppid === at) stack.push(k.pid);
  }
  return { cpu: Math.round(cpu * 10) / 10, rss };
}

// A background terminal's state: live, done (exited 0) or failed.
export function bgState(term) {
  if (term.state === "live") return "live";
  return term.exit_code === 0 ? "done" : "failed";
}

// A background terminal's name: the one it was given, else its short command.
export function bgLabel(term) {
  return term.name || shortCmd((term.argv ?? []).join(" ")) || term.address;
}

// A finished background terminal stays in the tree 15 minutes after it ended.
export function bgVisible(term, now) {
  if (term.state === "live") return true;
  return term.finished_ms != null && now - term.finished_ms <= 15 * 60000;
}

// "4m", "2h", "3d": a short span (negative counts as none).
function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// A job terminal's row: its name (without job-), its schedule from the `job.schedule` label
// with the next run (`job.next`, ms) or "on watch", running/done/failed, and its last run.
export function jobInfo(term, now) {
  if (!isJob(term.name)) return null;
  const labels = term.labels ?? {};
  const next = Number(labels["job.next"]);
  const every = labels["job.schedule"];
  const schedule = every ? `${every}${next > now ? ` · next ${span(next - now)}` : ""}` : "on watch";
  const state = term.state === "live" ? "running" : bgState(term);
  const last = term.finished_ms != null ? `${span(now - term.finished_ms)} ago` : null;
  return { name: term.name.slice(4), schedule, state, last };
}

// Resident memory (KB, as ps gives it) said short.
export function formatMem(kb) {
  const mb = kb / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
