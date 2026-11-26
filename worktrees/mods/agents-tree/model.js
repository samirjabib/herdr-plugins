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
// pinned, space }. Returns { boss, helpers, pinned, jobs, root, seats: [{ org, orch, helpers, projects, loose }] }.
// Helpers: agents in the same folder as a row's owner get no row; the owner carries them as a
// badge. `helpers` the other agents at the workspace root (the Boss's), a seat's `helpers` the
// other agents at its org root (only while its orchestrator runs; an off seat keeps them in
// `loose`); `root` the background terminals at the workspace root; each
// project { org, name, base, orch, lead, helpers, workers, main, checkouts, rank, since }: `lead`
// the agent the project row IS (its orchestrator orch-<org>-<project>, else the first agent in
// the main checkout; null when none runs there), `helpers` the other agents on main, `workers`
// every agent but the lead, `main` the background terminals in the main checkout ({ background },
// right under the lead), `checkouts` each worktree's ({ place, lead, helpers, workers, background }:
// `lead` its first agent, the row, `helpers` the rest; as first met); `loose` the org's agents outside a
// project. Under All every org seat shows (an off one too) and Other only with agents; an org
// picked shows only its seat. Pinned workers leave the tree (orchestrators keep their seat).
// byPriority: projects and workers by urgency, then recency; else in the list's order.
//
// extras: terminals that are not agents, each { address, name, cwd }: jobs (job-*) and
// background terminals whose launcher isn't known. A job sits where it runs: the workspace
// root under the Boss (`jobs`), an org's root under its seat, a project under its row; a
// background terminal under its project's row (`background`), else in its seat's `loose`.
export function buildTree(list, { org = "all", byPriority = false, extras = [] } = {}) {
  let boss = list.find((a) => orchOf(a.name) === "workspace") ?? null;
  const pinned = [];
  const jobs = [];
  const helpers = []; // agents and sleepers at the workspace root: the Boss's helpers
  const seats = new Map(ORG_SEATS.map((o) => [o, { org: o, orch: null, helpers: [], projects: [], loose: [], jobs: [] }]));
  const projects = new Map();
  const listed = new Set(list);
  const projectNode = (p) => {
    const key = `${p.org}/${p.name}`;
    if (!projects.has(key)) {
      const node = { ...p, orch: null, lead: null, helpers: [], workers: [], main: { background: [] }, checkouts: [], jobs: [], background: [], rank: 0, since: 0, seq: 0 };
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
    if (orgRootOf(a.cwd) === "workspace") { helpers.push(a); continue; }
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
  const rootTerms = [];
  for (const extra of extras) {
    const x = { rank: 0, since: 0, seq: 0, ...extra };
    const p = projectOf(x.cwd);
    const root = orgRootOf(x.cwd);
    const seat = seats.get(p?.org ?? (root && root !== "workspace" ? root : orgOfDir(x.cwd)));
    // A sleeping orchestrator holds its seat (the Boss's too) while no live one does.
    const sleepingOrch = x.sleeping ? orchOf(x.name) : null;
    if (sleepingOrch === "workspace") boss ??= x;
    else if (sleepingOrch) seats.get(sleepingOrch).orch ??= x;
    if (sleepingOrch) continue;
    if (isJob(x.name)) {
      if (p) projectNode(p).jobs.push(x);
      else if (root === "workspace") jobs.push(x);
      else seat.jobs.push(x);
    } else if (p) projectNode(p).background.push(x);
    else if (root === "workspace") (x.sleeping ? helpers : rootTerms).push(x);
    else seat.loose.push(x);
  }
  if (byPriority) {
    for (const seat of seats.values()) {
      seat.projects.sort(byUrgency);
      for (const p of seat.projects) p.workers.sort(byUrgency);
      seat.loose.sort(byUrgency);
    }
  }
  for (const seat of seats.values()) {
    for (const p of seat.projects) leadAndCheckouts(p);
    if (!seat.orch) continue;
    const atRoot = (x) => (listed.has(x) || x.sleeping) && orgRootOf(x.cwd) === seat.org;
    seat.helpers = seat.loose.filter(atRoot);
    seat.loose = seat.loose.filter((x) => !atRoot(x));
  }
  const shown = (s) => (org === "all" ? s.org !== "other" || s.projects.length || s.loose.length || s.jobs.length : s.org === org);
  return { boss, helpers, pinned, jobs, root: rootTerms, seats: [...seats.values()].filter(shown) };
}

// A project's lead (its orchestrator, else its first agent on main, taken out of `workers`;
// with no live one there, its sleeping orchestrator, else its most recent sleeper on main), its
// helpers (the other agents and sleepers on main), the main checkout's background terminals
// (`main`), and each worktree's (`checkouts`, in the order first met: the same lead rule, live
// agents first, the rest its helpers). `background` keeps every terminal and sleeper (the zzz count).
function leadAndCheckouts(p) {
  const onMain = (x) => (placeOf(x.cwd) ?? "main") === "main";
  const recent = (xs) => [...xs].sort((x, y) => (y.since ?? 0) - (x.since ?? 0));
  const sleepers = p.background.filter((x) => x.sleeping);
  const mainSleepers = recent(sleepers.filter(onMain));
  p.lead = p.orch ?? p.workers.find(onMain)
    ?? mainSleepers.find((x) => projectOrchOf(x.name)?.project === p.name) ?? mainSleepers[0] ?? null;
  if (p.lead && p.lead !== p.orch) p.workers = p.workers.filter((a) => a !== p.lead);
  p.helpers = [...p.workers.filter(onMain), ...mainSleepers.filter((x) => x !== p.lead)];
  p.main = { background: [] };
  const groups = new Map();
  const at = (x) => {
    if (onMain(x)) return p.main;
    const place = placeOf(x.cwd);
    if (!groups.has(place)) groups.set(place, { place, lead: null, helpers: [], workers: [], background: [], sleepers: [] });
    return groups.get(place);
  };
  for (const a of p.workers) if (!onMain(a)) at(a).workers.push(a);
  for (const b of p.background) if (!b.sleeping) at(b).background.push(b);
  for (const z of sleepers) if (!onMain(z)) at(z).sleepers.push(z);
  p.checkouts = [...groups.values()];
  for (const c of p.checkouts) {
    [c.lead = null, ...c.helpers] = [...c.workers, ...recent(c.sleepers)];
    delete c.sleepers;
  }
}

// How a project row looks: the same name and `main` tag whether its lead is live or asleep
// (asleep only dims it and adds the zzz); with nothing on main, a muted folder and no tag.
export function projectLook(p) {
  const lead = p?.lead ?? null;
  return { name: p?.name, tag: lead ? "main" : null, asleep: Boolean(lead?.sleeping), dim: !lead || Boolean(lead.sleeping), folder: !lead };
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

// A background terminal's state: live, done (exited 0), failed (its program ended on its own
// with a non-zero code) or closed: ended from outside (a pane closed, killed, hung up, a restart:
// hc's reason other than "exited", a signal, or no exit code), which is no failure.
export function bgState(term) {
  if (term.state === "live") return "live";
  if (term.exit_code === 0) return "done";
  const outside = (term.reason != null && term.reason !== "exited") || term.signal != null || typeof term.exit_code !== "number";
  return outside ? "closed" : "failed";
}

// A background terminal's name: the one it was given, else its short command.
export function bgLabel(term) {
  return term.name || shortCmd((term.argv ?? []).join(" ")) || term.address;
}

// A finished background terminal stays in the tree 15 minutes after it ended, unless it was
// dismissed (`dismissed`: addresses); a live one always.
export function bgVisible(term, now, dismissed = null) {
  if (term.state === "live") return true;
  if (dismissed?.has(term.address)) return false;
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
// with the next run (`job.next`, ms) or "on watch", running/done/failed/closed, and its last run.
export function jobInfo(term, now) {
  if (!isJob(term.name)) return null;
  if (term.run) return runInfo(term, now);
  const labels = term.labels ?? {};
  const next = Number(labels["job.next"]);
  const every = labels["job.schedule"];
  const schedule = every ? `${every}${next > now ? ` · next ${span(next - now)}` : ""}` : "on watch";
  const state = term.state === "live" ? "running" : bgState(term);
  const last = term.finished_ms != null ? `${span(now - term.finished_ms)} ago` : null;
  return { name: term.name.slice(4), schedule, state, last };
}

// A scheduled job's run (mac-workspace's launchd jobs, job-live): from the core's /api/agents
// `jobs`, each as a tree extra named job-<id> so it hangs in its project's Jobs group; a click
// opens its live view (steps and screenshots) from the core.
const JOB_CORE = "http://127.0.0.1:4317";
const RUN_WORDS = { running: "running", proposal: "to review", ok: "done", failed: "failed", timeout: "failed" };

export function jobRunsOf(got) {
  const list = Array.isArray(got?.jobs) ? got.jobs : [];
  return list
    .filter((j) => j && /^[a-z0-9][a-z0-9-]*$/.test(j.run ?? "") && /^[a-z0-9][a-z0-9-]*$/.test(j.job ?? ""))
    .map((j) => ({ address: `jobrun:${j.run}`, name: `job-${j.job}`, run: j.run, job: j.job, cwd: j.cwd ?? null,
      status: j.status ?? "", state: j.status === "running" ? "live" : "finished", step: j.step ?? "",
      steps: j.steps ?? 0, screenshots: j.screenshots ?? 0, summary: j.summary ?? "",
      startedMs: j.startedMs ?? null, finished_ms: j.endedMs ?? null, labels: {},
      watch: `${JOB_CORE}/api/jobs/watch/${j.run}` }));
}

function runInfo(r, now) {
  const running = r.status === "running";
  const state = RUN_WORDS[r.status] ?? r.status;
  const schedule = running ? r.step || "starting" : r.summary || r.step || state;
  const last = running ? (r.startedMs ? span(now - r.startedMs) : null) : r.finished_ms != null ? `${span(now - r.finished_ms)} ago` : null;
  return { name: r.job, schedule, state, last };
}

// A scheduled run's tooltip: how long it has run, how far it got, what it does now, the click.
export function jobRunTip(r, now) {
  const j = runInfo(r, now);
  const head = [r.job, r.status === "running" ? `running${j.last ? ` ${j.last}` : ""}` : `${j.state}${j.last ? ` ${j.last}` : ""}`,
    `${r.steps} steps`, ...(r.screenshots ? [`${r.screenshots} screenshots`] : [])].join(" · ");
  const now_ = r.status === "running" ? `Now: ${r.step || "starting"}` : r.summary || r.step;
  return [head, now_, r.status === "running" ? "Click: watch it live" : "Click: its steps and report"].filter(Boolean).join("\n");
}

// Resident memory (KB, as ps gives it) said short.
export function formatMem(kb) {
  const mb = kb / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

// Sleeping agents (mac-workspace puts idle agents to sleep: summary in Engram, terminal ended),
// from the core's /api/agents: each as a tree extra { address: "sleep:<name>", name, title,
// cwd, sleeping, since, recap } so it hangs under its checkout like a background terminal.
export function sleepersOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && (a.sleeping || a.state === "sleeping") && /^\w[\w.-]*$/.test(a.name ?? ""))
    .map((a) => ({ address: `sleep:${a.name}`, name: a.name, title: a.title || a.name, cwd: a.cwd ?? null,
      sleeping: true, since: a.sinceMs ?? 0, recap: a.recap ?? null }));
}

// A sleeper's tooltip: how long it has slept, its recap's first lines, and what a click does.
export function sleepTip(s, ago) {
  const recap = (s.recap ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !/^RECAP-/.test(l)).slice(0, 4);
  return [`Asleep${ago ? ` ${ago}` : ""} · summary saved in Engram`, ...recap, "Click (or Wake) resumes it: same conversation, same tab"].join("\n");
}

// What a sleeper's row shows after `ws agent wake <name>` (exec's { code, stdout, stderr }, an
// Error, or null when exec could not run): null when it woke, else the error, stderr's last line.
export function wakeError(r) {
  if (r instanceof Error) return r.message || "ws agent wake could not run";
  if (!r) return "ws agent wake could not run";
  if (r.code === 0) return null;
  const last = String(r.stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return last || `ws agent wake failed (exit ${r.code})`;
}

// terminal -> when auto-sleep will put it to sleep (epoch ms), from the core's /api/agents
// (sleepAtMs; absent: it never will, or an older core).
export function sleepEtas(list) {
  const out = new Map();
  for (const a of Array.isArray(list) ? list : []) {
    if (a && !a.sleeping && a.terminal && Number.isFinite(a.sleepAtMs)) out.set(a.terminal, a.sleepAtMs);
  }
  return out;
}

// An idle agent's tag: "zzz 12m" until auto-sleep takes it, "zzz soon" in its last minute
// (Collie says "sleeps in 12m"). Null when it never sleeps.
export function sleepsIn(at, now) {
  if (!Number.isFinite(at)) return null;
  const left = at - now;
  if (left <= 60_000) return "zzz soon";
  const m = Math.floor(left / 60_000);
  return `zzz ${m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`}`;
}

// How many sleeping agents a project, or an org seat (its projects and loose rows), holds.
export function asleepIn(node) {
  const own = (list) => (list ?? []).filter((x) => x?.sleeping).length;
  if (node?.projects) return node.projects.reduce((n, p) => n + own(p.background), 0) + own(node.loose) + own(node.helpers) + own([node.orch]);
  return own(node?.background);
}

// A row owner's helper badge: "N helper(s)", a hover listing each helper's name and state, and
// `need` the most urgent state that needs you (blocked, then done), else null. Null without helpers.
export function helperBadge(helpers, labelOf) {
  if (!helpers?.length) return null;
  const need = ["blocked", "done"].find((s) => helpers.some((h) => h.status === s)) ?? null;
  return {
    text: `${helpers.length} helper${helpers.length === 1 ? "" : "s"}`,
    tip: helpers.map((h) => `${labelOf(h) || h.address} · ${h.sleeping ? "asleep" : h.status}`).join("\n"),
    need,
  };
}

// A role's quiet mark (one collie glyph, tinted per role by the view): the role and a
// one-line tooltip. `place`: a worker's worktree. Null for an unknown role.
const ROLE_TIPS = { boss: "Workspace Boss", org: "Org lead", project: "Project lead on main", helper: "Helper" };
export function roleMark(role, place) {
  if (role === "worker") return { role, tip: `Worker in ${place}` };
  return ROLE_TIPS[role] ? { role, tip: ROLE_TIPS[role] } : null;
}

// Every placed agent's role mark, by address: the Boss, each org lead, each project lead, each
// worktree's worker (its lead), and every helper (the others in the same folder as one of them).
export function roleOf(tree) {
  const roles = new Map();
  const put = (a, role, place) => a && roles.set(a.address, roleMark(role, place));
  put(tree.boss, "boss");
  for (const h of tree.helpers ?? []) put(h, "helper");
  for (const s of tree.seats ?? []) {
    put(s.orch, "org");
    for (const h of s.helpers ?? []) put(h, "helper");
    for (const p of s.projects) {
      put(p.lead, "project");
      for (const h of p.helpers) put(h, "helper");
      for (const c of p.checkouts) {
        put(c.lead, "worker", c.place);
        for (const h of c.helpers) put(h, "helper");
      }
    }
  }
  return roles;
}

// The names of the Boss's helpers (agents at the workspace root): one whose name copies the
// Boss's (a pane of the Boss's tab reads the tab's title) or has none becomes "Helper", numbered
// in order when there are several. Returns Map(address -> name) for the ones renamed.
export function helperLabels(addresses, bossLabel, labelOf) {
  const plain = addresses.filter((k) => !labelOf(k) || labelOf(k) === bossLabel);
  return new Map(plain.map((k, i) => [k, plain.length > 1 ? `Helper ${i + 1}` : "Helper"]));
}
