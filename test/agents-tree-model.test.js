// agents-tree's pure rules: the Boss -> org orchestrator -> project -> workers tree, each
// project's one-line summary, and the live processes folded under an agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  helperLabels, helperBadge, projectLook, roleMark, roleOf,
  projectOf, projectOrchOf, buildTree, headBranch, hasGithub, projectSummary,
  parsePs, shortCmd, processRows, formatMem, processTree, plumbingNote, procTotal,
  bgState, bgLabel, bgVisible, jobInfo, placeOf, orgRootOf, sleepersOf, sleepTip, sleepEtas, sleepsIn, asleepIn,
  jobRunsOf, jobRunTip,
} from "../worktrees/mods/agents-tree/model.js";

const R = "/Users/me/mac-workspace";
const ag = (address, cwd, more = {}) => ({ address, name: null, cwd, rank: 1, since: 0, seq: 0, pinned: false, space: `s-${address}`, ...more });

test("projectOf names a mac-workspace project from any folder of its main or worktrees", () => {
  assert.deepEqual(projectOf(`${R}/ag/shop/main/src`), { org: "ag", name: "shop", base: `${R}/ag/shop` });
  assert.deepEqual(projectOf(`${R}/cs/site/worktrees/fix-nav`), { org: "cs", name: "site", base: `${R}/cs/site` });
  assert.equal(projectOf(`${R}/ag`), null);
  assert.equal(projectOf("/tmp/x"), null);
  assert.equal(projectOf(null), null);
});

test("a project orchestrator is the terminal named orch-<org>-<project>", () => {
  assert.deepEqual(projectOrchOf("orch-ag-shop"), { org: "ag", project: "shop" });
  assert.deepEqual(projectOrchOf("orch-personal-herdr-plugins"), { org: "personal", project: "herdr-plugins" });
  assert.equal(projectOrchOf("orch-ag"), null);
  assert.equal(projectOrchOf("shop"), null);
});

test("the tree is Boss -> each org orchestrator -> its projects -> the agents working in them", () => {
  const list = [
    ag("t1", R, { name: "orch-workspace" }),
    ag("t2", `${R}/ag`, { name: "orch-ag" }),
    ag("t3", `${R}/ag/shop/main`),
    ag("t4", `${R}/ag/shop/worktrees/fix-cart`),
    ag("t5", `${R}/cs/site/main`),
  ];
  const tree = buildTree(list);
  assert.equal(tree.boss.address, "t1");
  assert.deepEqual(tree.seats.map((s) => s.org), ["cs", "ag", "personal"]);
  const agSeat = tree.seats.find((s) => s.org === "ag");
  assert.equal(agSeat.orch.address, "t2");
  assert.deepEqual(agSeat.projects.map((p) => [p.name, p.lead.address, p.workers.map((w) => w.address)]), [["shop", "t3", ["t4"]]]);
  // An org whose orchestrator isn't running still holds its agents, under an off seat.
  const cs = tree.seats.find((s) => s.org === "cs");
  assert.equal(cs.orch, null);
  assert.equal(cs.projects[0].lead.address, "t5");
  // Personal has neither: an empty off seat (only under All).
  assert.deepEqual(tree.seats.find((s) => s.org === "personal").projects, []);
});

test("an org picked shows the Boss and only that org's orchestrator and agents", () => {
  const list = [ag("t1", R, { name: "orch-workspace" }), ag("t3", `${R}/ag/shop/main`), ag("t5", `${R}/cs/site/main`)];
  const tree = buildTree(list, { org: "cs" });
  assert.equal(tree.boss.address, "t1");
  assert.deepEqual(tree.seats.map((s) => s.org), ["cs"]);
  assert.deepEqual(tree.seats[0].projects.map((p) => p.name), ["site"]);
});

test("agents outside every org go under Other, shown only when there are some (or it is picked)", () => {
  assert.ok(!buildTree([ag("t3", `${R}/ag/shop/main`)]).seats.some((s) => s.org === "other"));
  const tree = buildTree([ag("t9", "/tmp/scratch")]);
  const other = tree.seats.find((s) => s.org === "other");
  assert.deepEqual(other.loose.map((a) => a.address), ["t9"]);
  assert.deepEqual(buildTree([], { org: "other" }).seats.map((s) => s.org), ["other"]);
});

test("a project's orchestrator (orch-<org>-<project>) is the project's node, not one of its workers", () => {
  const tree = buildTree([ag("t6", `${R}/ag/shop/main`, { name: "orch-ag-shop" }), ag("t7", `${R}/ag/shop/worktrees/a`)]);
  const shop = tree.seats.find((s) => s.org === "ag").projects[0];
  assert.equal(shop.orch.address, "t6");
  assert.deepEqual(shop.workers.map((w) => w.address), ["t7"]);
});

test("pinned agents leave the tree for the Pinned section; orchestrators keep their seat", () => {
  const tree = buildTree([ag("t2", `${R}/ag`, { name: "orch-ag", pinned: true }), ag("t3", `${R}/ag/shop/main`, { pinned: true })]);
  assert.deepEqual(tree.pinned.map((a) => a.address), ["t3"]);
  assert.equal(tree.seats.find((s) => s.org === "ag").orch.address, "t2");
  assert.deepEqual(tree.seats.find((s) => s.org === "ag").projects, []);
});

test("priority sorts projects and workers by urgency then recency; grouped keeps the list's order", () => {
  const list = [
    ag("a", `${R}/ag/one/main`, { rank: 1, since: 5 }),
    ag("b", `${R}/ag/two/main`, { rank: 4, since: 1 }),
    ag("c", `${R}/ag/one/worktrees/x`, { rank: 2, since: 9 }),
    ag("d", `${R}/ag/one/worktrees/y`, { rank: 2, since: 3 }),
  ];
  const seat = (o) => buildTree(list, o).seats.find((s) => s.org === "ag");
  const pri = seat({ byPriority: true });
  assert.deepEqual(pri.projects.map((p) => p.name), ["two", "one"]);
  assert.deepEqual([pri.projects[1].lead.address, pri.projects[1].workers.map((w) => w.address)], ["a", ["c", "d"]]);
  const grouped = seat({ byPriority: false });
  assert.deepEqual(grouped.projects.map((p) => p.name), ["one", "two"]);
  assert.deepEqual([grouped.projects[0].lead.address, grouped.projects[0].workers.map((w) => w.address)], ["a", ["c", "d"]]);
});

test("the main checkout's branch comes from its HEAD file (empty when detached)", () => {
  assert.equal(headBranch("ref: refs/heads/main\n"), "main");
  assert.equal(headBranch("0123456789abcdef0123456789abcdef01234567\n"), "");
  assert.equal(headBranch(null), null);
});

test("a project has GitHub when a remote in its git config points there (host aliases too)", () => {
  assert.equal(hasGithub('[remote "origin"]\n\turl = git@github.com-arcticgrey:Arctic-Grey/shop.git\n'), true);
  assert.equal(hasGithub('[remote "origin"]\n\turl = https://github.com/me/x.git\n'), true);
  assert.equal(hasGithub('[remote "origin"]\n\turl = git@gitlab.com:me/x.git\n'), false);
  assert.equal(hasGithub(null), false);
});

test("the project summary says only what needs saying: ⚠ branch, ↓N behind, ⑂ worktrees, GitHub", () => {
  assert.deepEqual(projectSummary({ branch: "main", behind: 0, worktrees: 0, github: false }), []);
  assert.deepEqual(projectSummary({ branch: "feat/x", behind: 3, worktrees: 2, github: true }).map((s) => [s.kind, s.text, s.warn]), [
    ["branch", "⚠ feat/x", true],
    ["behind", "↓3", true],
    ["worktrees", "⑂ 2", false],
    ["github", "", false],
  ]);
  assert.equal(projectSummary({ branch: "", behind: null, worktrees: 0 })[0].text, "⚠ detached");
  // Not read yet: nothing, never a warning.
  assert.deepEqual(projectSummary(null), []);
  assert.deepEqual(projectSummary({ branch: null, behind: null, worktrees: 1 }).map((s) => s.kind), ["worktrees"]);
});

test("parsePs reads `ps -axo pid,ppid,pcpu,rss,command`, header and blank lines skipped", () => {
  const ps = parsePs("  PID  PPID  %CPU    RSS COMMAND\n  10     1   2.5  2048 /bin/zsh -l\n\n  11    10   0.0  1024 node /x/next dev --port 3000\n");
  assert.deepEqual(ps.get(11), { pid: 11, ppid: 10, cpu: 0, rss: 1024, command: "node /x/next dev --port 3000" });
  assert.equal(ps.size, 2);
});

test("shortCmd: the program and plain words up to the first flag, never tokens, values or long text", () => {
  assert.equal(shortCmd("/usr/local/bin/node /app/node_modules/.bin/next dev --port 3000"), "node next dev");
  assert.equal(shortCmd("npx playwright test --headed"), "npx playwright test");
  assert.equal(shortCmd("curl -H Authorization:abc https://x"), "curl");
  assert.equal(shortCmd("tool ghp_0123456789abcdefABCDEF0123456789 KEY=secret run"), "tool run");
  assert.equal(shortCmd("a b c d e"), "a b c d");
  assert.equal(shortCmd(`x ${"y".repeat(39)} ${"z".repeat(30)}`).length <= 60, true);
});

test("processRows walks the agent's descendants, hides shells and the agent, folds a tool's own children", () => {
  const ps = parsePs([
    "PID PPID %CPU RSS COMMAND",
    "100 1 0.1 1000 /bin/zsh -l",
    "101 100 3.0 200000 node /opt/claude/cli.js --resume",
    "102 101 0.0 900 /bin/zsh -c npm run dev",
    "103 102 1.0 50000 node /usr/bin/npm run dev",
    "104 103 20.0 300000 next-server (v15)",
    "105 101 5.0 100000 node /x/node_modules/.bin/playwright test",
    "106 105 30.0 400000 /ms-playwright/chromium/Chromium --headless",
    "107 106 10.0 100000 /ms-playwright/chromium/Chromium Helper --type=renderer",
    "200 1 99.0 9 unrelated",
  ].join("\n"));
  const rows = processRows(ps, 100, { hide: ["claude"] });
  assert.deepEqual(rows.map((r) => [r.name, r.count]), [
    ["node npm run dev", 1],
    ["next-server", 1],
    ["node playwright test", 1],
    ["Playwright · chromium", 2],
  ]);
  const chromium = rows.at(-1);
  assert.equal(chromium.cpu, 40);
  assert.equal(chromium.rss, 500000);
  // An unknown root, or nothing under it: no rows.
  assert.deepEqual(processRows(ps, 999), []);
});

test("formatMem: KB from ps as MB or GB", () => {
  assert.equal(formatMem(51200), "50 MB");
  assert.equal(formatMem(1572864), "1.5 GB");
  assert.equal(formatMem(500), "0 MB");
});

test("an agent's plumbing is hidden from its processes and only counted: MCP servers, caffeinate", () => {
  const ps = parsePs([
    "PID PPID %CPU RSS COMMAND",
    "100 1 0 1 claude",
    "110 100 0 10 npm exec @upstash/context7-mcp",
    "111 110 2 20 node /x/.bin/context7-mcp",
    "112 100 0 10 engram mcp",
    "113 100 0 10 uvx mcp-server-fetch",
    "114 100 0 10 caffeinate -i -w 100",
    "115 100 1 30 node /x/.bin/vitest run",
  ].join("\n"));
  const view = processTree(ps, 100, { hide: ["claude"] });
  assert.deepEqual(view.rows.map((r) => r.name), ["node vitest run"]);
  assert.deepEqual(view.plumbing, { mcp: 3, other: 1 });
  assert.equal(plumbingNote(view.plumbing), "3 MCP servers and 1 helper hidden");
  assert.equal(plumbingNote({ mcp: 1, other: 0 }), "1 MCP server hidden");
  assert.equal(plumbingNote({ mcp: 0, other: 0 }), "");
});

test("a background terminal's CPU and memory count it and every process under it", () => {
  const ps = parsePs("PID PPID %CPU RSS COMMAND\n300 1 1.5 100 /bin/zsh -c npm test\n301 300 20 900 node vitest\n302 9 50 5 other");
  assert.deepEqual(procTotal(ps, 300), { cpu: 21.5, rss: 1000 });
  assert.equal(procTotal(ps, 999), null);
});

test("a background terminal reads live, done (exit 0) or failed, named by its name else its short command", () => {
  assert.equal(bgState({ state: "live" }), "live");
  assert.equal(bgState({ state: "finished", exit_code: 0 }), "done");
  assert.equal(bgState({ state: "finished", exit_code: 2 }), "failed");
  assert.equal(bgState({ state: "finished", exit_code: 2, reason: "exited" }), "failed");
  assert.equal(bgLabel({ name: "ci", argv: ["gh", "run", "watch"] }), "ci");
  assert.equal(bgLabel({ name: null, argv: ["/usr/bin/npm", "run", "dev", "--port=3"] }), "npm run dev");
});

test("a terminal closed by hand (killed, hung up, a restart, no exit code) reads closed, never failed", () => {
  // As hc reports them: a shell whose pane was closed, a Claude killed on restart.
  assert.equal(bgState({ state: "finished", exit_code: 1, signal: null, reason: "killed" }), "closed");
  assert.equal(bgState({ state: "finished", exit_code: 129, signal: null, reason: "killed" }), "closed");
  assert.equal(bgState({ state: "finished", exit_code: null, signal: 9, reason: "killed" }), "closed");
  assert.equal(bgState({ state: "finished", exit_code: null, signal: null, reason: "stopped_by_restart" }), "closed");
  assert.equal(bgState({ state: "finished", exit_code: null }), "closed");
  assert.equal(bgState({ state: "finished", exit_code: 3, signal: 15 }), "closed");
  // A program that ran to its end with a non-zero code still failed.
  assert.equal(bgState({ state: "finished", exit_code: 1, signal: null, reason: "exited" }), "failed");
  assert.equal(bgState({ state: "finished", exit_code: 0, reason: "exited" }), "done");
  assert.equal(jobInfo({ name: "job-x", state: "finished", exit_code: 129, reason: "killed", labels: {} }, 0).state, "closed");
});

test("a dismissed finished terminal leaves the tree; a live one can't be dismissed", () => {
  const now = 1_000_000_000;
  const gone = new Set(["t8", "t9"]);
  assert.equal(bgVisible({ address: "t8", state: "finished", finished_ms: now - 60000 }, now, gone), false);
  assert.equal(bgVisible({ address: "t7", state: "finished", finished_ms: now - 60000 }, now, gone), true);
  assert.equal(bgVisible({ address: "t9", state: "live" }, now, gone), true);
});

test("a finished background terminal stays in the tree for 15 minutes, a live one always", () => {
  const now = 1_000_000_000;
  assert.equal(bgVisible({ state: "live" }, now), true);
  assert.equal(bgVisible({ state: "finished", finished_ms: now - 14 * 60000 }, now), true);
  assert.equal(bgVisible({ state: "finished", finished_ms: now - 16 * 60000 }, now), false);
  assert.equal(bgVisible({ state: "finished" }, now), false);
});

test("a job (a terminal named job-*) says its schedule and next run, else on watch, its state and last run", () => {
  const now = 1_000_000_000;
  const job = jobInfo({ name: "job-sync", state: "finished", exit_code: 0, finished_ms: now - 3 * 60000,
    labels: { "job.schedule": "every 15m", "job.next": String(now + 4 * 60000) } }, now);
  assert.deepEqual(job, { name: "sync", schedule: "every 15m · next 4m", state: "done", last: "3m ago" });
  const watch = jobInfo({ name: "job-slack-ag", state: "live", labels: {} }, now);
  assert.deepEqual(watch, { name: "slack-ag", schedule: "on watch", state: "running", last: null });
  assert.equal(jobInfo({ name: "shop-dev" }, now), null);
});

test("jobs and parentless background terminals sit where they run: root under the Boss, org root under its orchestrator, a project under its row", () => {
  assert.equal(orgRootOf(R), "workspace");
  assert.equal(orgRootOf(`${R}/ag/`), "ag");
  assert.equal(orgRootOf(`${R}/ag/shop/main`), null);
  const tree = buildTree([ag("t2", `${R}/ag`, { name: "orch-ag" }), ag("t3", `${R}/ag/shop/main`)], {
    extras: [
      { address: "j1", name: "job-autosync", cwd: R },
      { address: "j2", name: "job-slack-ag", cwd: `${R}/ag` },
      { address: "j3", name: "job-drop-check", cwd: `${R}/ag/shop/main` },
      { address: "b1", name: null, cwd: `${R}/ag/shop/worktrees/x` },
      { address: "b2", name: null, cwd: `${R}/cs/site/main` },
    ],
  });
  const agSeat = tree.seats.find((s) => s.org === "ag");
  assert.deepEqual(tree.jobs.map((j) => j.address), ["j1"]);
  assert.deepEqual(agSeat.jobs.map((j) => j.address), ["j2"]);
  assert.deepEqual(agSeat.projects[0].jobs.map((j) => j.address), ["j3"]);
  assert.deepEqual(agSeat.projects[0].background.map((b) => b.address), ["b1"]);
  // A project with only a background terminal still gets its row.
  assert.deepEqual(tree.seats.find((s) => s.org === "cs").projects.map((p) => [p.name, p.workers.length, p.background.length]), [["site", 0, 1]]);
});

test("a project's lead is its orchestrator on main; worktrees hang under it, with no main checkout group", () => {
  const tree = buildTree([
    ag("t1", `${R}/ag/shop/worktrees/fix-cart`),
    ag("t2", `${R}/ag/shop/main/src`),
    ag("t3", `${R}/ag/shop/worktrees/nav`),
    ag("t4", `${R}/ag/shop/worktrees/fix-cart/app`),
    ag("t5", `${R}/ag/shop/main`, { name: "orch-ag-shop" }),
  ], { extras: [{ address: "b1", name: null, cwd: `${R}/ag/shop/worktrees/nav` }, { address: "b2", name: null, cwd: `${R}/ag/shop/main` }] });
  const shop = tree.seats.find((s) => s.org === "ag").projects[0];
  // The project row IS its lead: the project orchestrator wins over another agent on main.
  assert.equal(shop.lead.address, "t5");
  assert.equal(shop.orch.address, "t5");
  // Other agents on main are the lead's helpers; terminals on main sit right under it, with no "main" header.
  assert.deepEqual([shop.helpers.map((w) => w.address), shop.main.background.map((b) => b.address)], [["t2"], ["b2"]]);
  assert.deepEqual(shop.checkouts.map((c) => [c.place, c.workers.map((w) => w.address), c.background.map((b) => b.address)]), [
    ["fix-cart", ["t1", "t4"], []],
    ["nav", ["t3"], ["b1"]],
  ]);
  // The flat list holds every worker but the lead.
  assert.deepEqual(shop.workers.map((w) => w.address), ["t1", "t2", "t3", "t4"]);
});

test("with no project orchestrator, the first agent in the main checkout is the lead", () => {
  const tree = buildTree([ag("t1", `${R}/ag/cro-loop/worktrees/a`), ag("t2", `${R}/ag/cro-loop/main`), ag("t3", `${R}/ag/cro-loop/main`)]);
  const p = tree.seats.find((s) => s.org === "ag").projects[0];
  assert.equal(p.lead.address, "t2");
  assert.equal(p.orch, null);
  assert.deepEqual(p.helpers.map((w) => w.address), ["t3"]);
  assert.deepEqual(p.workers.map((w) => w.address), ["t1", "t3"]);
  assert.deepEqual(p.checkouts.map((c) => [c.place, c.workers.map((w) => w.address)]), [["a", ["t1"]]]);
});

test("a project with no agent on main has no lead: its worktrees still hang under the plain row", () => {
  const tree = buildTree([ag("t1", `${R}/ag/shop/worktrees/a`)], { extras: [{ address: "b1", name: null, cwd: `${R}/ag/shop/main` }] });
  const shop = tree.seats.find((s) => s.org === "ag").projects[0];
  assert.equal(shop.lead, null);
  assert.deepEqual(shop.main.background.map((b) => b.address), ["b1"]);
  assert.deepEqual(shop.checkouts.map((c) => [c.place, c.workers.map((w) => w.address)]), [["a", ["t1"]]]);
});

test("byPriority picks the most urgent agent on main as the lead and orders the rest", () => {
  const tree = buildTree([ag("t1", `${R}/cs/site/main`, { rank: 1 }), ag("t2", `${R}/cs/site/main`, { rank: 4 }), ag("t3", `${R}/cs/site/main`, { rank: 2 })], { byPriority: true });
  const site = tree.seats.find((s) => s.org === "cs").projects[0];
  assert.equal(site.lead.address, "t2");
  assert.deepEqual(site.helpers.map((w) => w.address), ["t3", "t1"]);
  assert.deepEqual(site.checkouts, []);
});

test("sleepersOf keeps the core's sleeping agents as tree extras under their checkout", () => {
  const got = sleepersOf([
    { name: "hcp", title: "HCP reviews", cwd: `${R}/cs/site/worktrees/hcp`, sleeping: true, sinceMs: 5, recap: "Goal: x" },
    { name: "awake", cwd: `${R}/cs/site/main`, state: "idle" },
    { name: "bad name", cwd: `${R}/cs/site/main`, sleeping: true },
    { name: "--flag", cwd: `${R}/cs/site/main`, sleeping: true },
    { name: "lids", cwd: `${R}/ag/lids/main`, state: "sleeping" },
  ]);
  assert.deepEqual(got.map((s) => s.address), ["sleep:hcp", "sleep:lids"]);
  assert.deepEqual(got[0], { address: "sleep:hcp", name: "hcp", title: "HCP reviews", cwd: `${R}/cs/site/worktrees/hcp`, sleeping: true, since: 5, recap: "Goal: x" });
  assert.equal(got[1].title, "lids");
  assert.deepEqual(sleepersOf(null), []);
  const tree = buildTree([], { extras: got });
  const site = tree.seats.find((s) => s.org === "cs").projects[0];
  // A worktree whose only agent sleeps has that sleeper as its row.
  assert.deepEqual(site.checkouts.map((c) => [c.place, c.lead.name, c.background]), [["hcp", "hcp", []]]);
});

test("sleepTip says how long, the recap's first lines, and that a click wakes it", () => {
  const tip = sleepTip({ recap: "RECAP-BEGIN ab\nGoal: ship\nDone: a\nNext: b\nOpen questions: none\nmore\nRECAP-END ab" }, "1h");
  assert.equal(tip, "Asleep 1h · summary saved in Engram\nGoal: ship\nDone: a\nNext: b\nOpen questions: none\nWake resumes it: same conversation, same tab");
  assert.equal(sleepTip({ recap: null }, ""), "Asleep · summary saved in Engram\nWake resumes it: same conversation, same tab");
});

test("sleepEtas maps each live agent's terminal to when auto-sleep takes it", () => {
  const got = sleepEtas([
    { terminal: "t1", sleepAtMs: 900 }, { terminal: "t2", sleepAtMs: null },
    { terminal: "t3" }, { terminal: "t4", sleeping: true, sleepAtMs: 5 },
  ]);
  assert.deepEqual([...got], [["t1", 900]]);
  assert.deepEqual([...sleepEtas(null)], []);
});

test("sleepsIn tags an idle agent with the time left, soon in its last minute, nothing when it never sleeps", () => {
  const now = 1_000_000_000;
  assert.equal(sleepsIn(now + 12 * 60_000 + 5000, now), "zzz 12m");
  assert.equal(sleepsIn(now + 2 * 3_600_000, now), "zzz 2h");
  assert.equal(sleepsIn(now + 30_000, now), "zzz soon");
  assert.equal(sleepsIn(now - 5000, now), "zzz soon");
  assert.equal(sleepsIn(undefined, now), null);
});

test("asleepIn counts the sleepers of a project and of an org seat", () => {
  const sleeper = { sleeping: true }, bg = { name: "npm" };
  const p1 = { background: [sleeper, bg, sleeper] }, p2 = { background: [bg] };
  assert.equal(asleepIn(p1), 2);
  assert.equal(asleepIn(p2), 0);
  assert.equal(asleepIn({ projects: [p1, p2], loose: [sleeper] }), 3);
  assert.equal(asleepIn(null), 0);
});

test("an agent at the workspace root sits under the Boss, not in Other; Other keeps only folders outside the workspace", () => {
  const tree = buildTree([
    ag("t1", R, { name: "orch-workspace" }),
    ag("t2", R, { name: "engram-cloud" }),
    ag("t3", "/Users/x/Desktop"),
  ], { extras: [{ address: "b1", name: null, cwd: R }] });
  // Other Claudes at the root are the Boss's helpers (a badge, not rows); terminals stay rows.
  assert.deepEqual(tree.helpers.map((a) => a.address), ["t2"]);
  assert.deepEqual(tree.root.map((a) => a.address), ["b1"]);
  const other = tree.seats.find((s) => s.org === "other");
  assert.deepEqual(other.loose.map((a) => a.address), ["t3"]);
  // With nothing outside the workspace, Other is hidden.
  const quiet = buildTree([ag("t1", R, { name: "orch-workspace" }), ag("t2", R)]);
  assert.equal(quiet.seats.some((s) => s.org === "other"), false);
});

test("helpers at the workspace root never read as a second Workspace Boss: a copied or empty name becomes Helper, numbered when there are several", () => {
  const names = { h1: "Workspace Boss", h2: "Engram cloud", h3: "", h4: "Workspace Boss" };
  const got = helperLabels(["h1", "h2", "h3", "h4"], "Workspace Boss", (k) => names[k]);
  assert.deepEqual([...got], [["h1", "Helper 1"], ["h3", "Helper 2"], ["h4", "Helper 3"]]);
  const one = helperLabels(["h1", "h2"], "Workspace Boss", (k) => names[k]);
  assert.deepEqual([...one], [["h1", "Helper"]]);
});

test("helpers at every level: agents in the same folder as a row's owner are its helpers, never rows of their own", () => {
  const tree = buildTree([
    ag("t1", R, { name: "orch-workspace" }),
    ag("t2", R), ag("t3", R),
    ag("t4", `${R}/ag`, { name: "orch-ag" }),
    ag("t5", `${R}/ag`),
    ag("t6", `${R}/ag/shop/main`), ag("t7", `${R}/ag/shop/main/src`),
    ag("t8", `${R}/ag/shop/worktrees/nav`), ag("t9", `${R}/ag/shop/worktrees/nav`),
    ag("t10", `${R}/cs`),
  ]);
  // The Boss + other Claudes at ~/mac-workspace.
  assert.deepEqual(tree.helpers.map((a) => a.address), ["t2", "t3"]);
  // An org orchestrator + other agents at ~/mac-workspace/<org>; they leave `loose`.
  const agSeat = tree.seats.find((s) => s.org === "ag");
  assert.deepEqual(agSeat.helpers.map((a) => a.address), ["t5"]);
  assert.deepEqual(agSeat.loose, []);
  // A project lead + other agents on main.
  const shop = agSeat.projects[0];
  assert.equal(shop.lead.address, "t6");
  assert.deepEqual(shop.helpers.map((a) => a.address), ["t7"]);
  // A worktree: its first agent is the row, the rest its helpers.
  assert.deepEqual(shop.checkouts.map((c) => [c.place, c.lead.address, c.helpers.map((a) => a.address)]), [["nav", "t8", ["t9"]]]);
  // An off seat has no row to own helpers: its root agents stay rows.
  const cs = tree.seats.find((s) => s.org === "cs");
  assert.deepEqual([cs.helpers, cs.loose.map((a) => a.address)], [[], ["t10"]]);
});

test("a worktree's most urgent agent is its row under Priority", () => {
  const tree = buildTree([ag("t1", `${R}/ag/shop/worktrees/nav`, { rank: 1 }), ag("t2", `${R}/ag/shop/worktrees/nav`, { rank: 4 })], { byPriority: true });
  const [c] = tree.seats.find((s) => s.org === "ag").projects[0].checkouts;
  assert.deepEqual([c.lead.address, c.helpers.map((a) => a.address)], ["t2", ["t1"]]);
});

test("helperBadge counts the helpers, lists names and states on hover, and colors only when one needs you", () => {
  const names = { h1: "engram-cloud", h2: "Helper 2", h3: "tests" };
  const label = (a) => names[a.address];
  assert.equal(helperBadge([], label), null);
  assert.deepEqual(helperBadge([{ address: "h1", status: "idle" }], label), { text: "1 helper", tip: "engram-cloud · idle", need: null });
  const many = helperBadge([{ address: "h1", status: "working" }, { address: "h2", status: "done" }, { address: "h3", status: "blocked" }], label);
  assert.deepEqual(many, { text: "3 helpers", tip: "engram-cloud · working\nHelper 2 · done\ntests · blocked", need: "blocked" });
  assert.equal(helperBadge([{ address: "h1", status: "working" }, { address: "h2", status: "done" }], label).need, "done");
  assert.equal(helperBadge([{ address: "h1", status: "working" }], label).need, null);
});

const zz = (name, cwd, since = 0) => ({ address: `sleep:${name}`, name, title: name, cwd, sleeping: true, since, recap: null });

test("screenshot lids-hd-agent-v2: a project whose only session on main sleeps has that sleeper as its row, no folder row", () => {
  const tree = buildTree([], { extras: [zz("lids-session", `${R}/ag/lids-hd-agent-v2/main`, 5)] });
  const p = tree.seats.find((s) => s.org === "ag").projects[0];
  assert.equal(p.lead.address, "sleep:lids-session");
  assert.deepEqual([p.helpers, p.main.background, p.checkouts], [[], [], []]);
});

test("screenshot cro-loop: a live lead on main wins; an older sleeping session there is its helper, not a row", () => {
  const tree = buildTree([ag("t1", `${R}/ag/cro-loop/main`)], { extras: [zz("old-session", `${R}/ag/cro-loop/main`, 5)] });
  const p = tree.seats.find((s) => s.org === "ag").projects[0];
  assert.equal(p.lead.address, "t1");
  assert.deepEqual(p.helpers.map((a) => a.address), ["sleep:old-session"]);
  assert.deepEqual(p.main.background, []);
});

test("a sleeping lead: the project orchestrator first, else the most recent sleeper; the rest are helpers", () => {
  const sleepers = [zz("a", `${R}/ag/shop/main`, 9), zz("orch-ag-shop", `${R}/ag/shop/main`, 1), zz("b", `${R}/ag/shop/main`, 20)];
  const withOrch = buildTree([], { extras: sleepers }).seats.find((s) => s.org === "ag").projects[0];
  assert.equal(withOrch.lead.name, "orch-ag-shop");
  assert.deepEqual(withOrch.helpers.map((a) => a.name), ["b", "a"]);
  const noOrch = buildTree([], { extras: sleepers.filter((x) => x.name !== "orch-ag-shop") }).seats.find((s) => s.org === "ag").projects[0];
  assert.equal(noOrch.lead.name, "b");
  // Sleepers still count toward the zzz of the project and the seat.
  assert.equal(asleepIn(noOrch), 2);
});

test("a worktree's lead may sleep too: live agents first, else the most recent sleeper; other sleepers are helpers", () => {
  const live = buildTree([ag("t1", `${R}/ag/shop/worktrees/nav`)], { extras: [zz("s1", `${R}/ag/shop/worktrees/nav`, 3), { address: "b1", name: null, cwd: `${R}/ag/shop/worktrees/nav` }] });
  const [c] = live.seats.find((s) => s.org === "ag").projects[0].checkouts;
  assert.deepEqual([c.lead.address, c.helpers.map((a) => a.address), c.background.map((b) => b.address)], ["t1", ["sleep:s1"], ["b1"]]);
  const asleep = buildTree([], { extras: [zz("s1", `${R}/ag/shop/worktrees/nav`, 3), zz("s2", `${R}/ag/shop/worktrees/nav`, 8)] });
  const [d] = asleep.seats.find((s) => s.org === "ag").projects[0].checkouts;
  assert.deepEqual([d.lead.name, d.helpers.map((a) => a.name)], ["s2", ["s1"]]);
});

test("an org orchestrator or the Boss asleep is its seat's row; sleepers in the same folder are helpers", () => {
  const tree = buildTree([ag("t5", `${R}/ag`)], { extras: [zz("orch-ag", `${R}/ag`), zz("orch-workspace", R), zz("notes", R), zz("ag-notes", `${R}/ag`)] });
  assert.equal(tree.boss.address, "sleep:orch-workspace");
  assert.deepEqual([tree.helpers.map((a) => a.address), tree.root], [["sleep:notes"], []]);
  const agSeat = tree.seats.find((s) => s.org === "ag");
  assert.equal(agSeat.orch.address, "sleep:orch-ag");
  assert.deepEqual([agSeat.helpers.map((a) => a.address), agSeat.loose], [["t5", "sleep:ag-notes"], []]);
  // A live orchestrator beats a sleeping one.
  const live = buildTree([ag("t2", `${R}/ag`, { name: "orch-ag" })], { extras: [zz("orch-ag", `${R}/ag`)] });
  assert.equal(live.seats.find((s) => s.org === "ag").orch.address, "t2");
});

test("helperBadge says a sleeping helper is asleep", () => {
  assert.equal(helperBadge([zz("notes", R)], (a) => a.title).tip, "notes · asleep");
});

test("a project row looks the same with its lead live or asleep: same name and main tag; asleep only dims it and adds the zzz", () => {
  const live = projectLook({ name: "cro-loop", lead: ag("t1", `${R}/ag/cro-loop/main`) });
  const asleep = projectLook({ name: "cro-loop", lead: zz("s", `${R}/ag/cro-loop/main`) });
  assert.deepEqual(live, { name: "cro-loop", tag: "main", asleep: false, dim: false, folder: false });
  assert.deepEqual(asleep, { name: "cro-loop", tag: "main", asleep: true, dim: true, folder: false });
  // Nothing on main, live or asleep: the muted folder row, no tag.
  assert.deepEqual(projectLook({ name: "shop", lead: null }), { name: "shop", tag: null, asleep: false, dim: true, folder: true });
});

test("roleMark: one quiet collie mark per level, its tooltip naming the role in one line", () => {
  assert.deepEqual(roleMark("boss"), { role: "boss", tip: "Workspace Boss" });
  assert.deepEqual(roleMark("org"), { role: "org", tip: "Org lead" });
  assert.deepEqual(roleMark("project"), { role: "project", tip: "Project lead on main" });
  assert.deepEqual(roleMark("worker", "nav"), { role: "worker", tip: "Worker in nav" });
  assert.deepEqual(roleMark("helper"), { role: "helper", tip: "Helper" });
  assert.equal(roleMark("nobody"), null);
});

test("roleOf gives every placed agent its role: Boss, org lead, project lead, worktree worker, helper", () => {
  const tree = buildTree([
    ag("t1", R, { name: "orch-workspace" }), ag("t2", R),
    ag("t3", `${R}/ag`, { name: "orch-ag" }), ag("t4", `${R}/ag`),
    ag("t5", `${R}/ag/shop/main`), ag("t6", `${R}/ag/shop/main`),
    ag("t7", `${R}/ag/shop/worktrees/nav`), ag("t8", `${R}/ag/shop/worktrees/nav`),
  ], { extras: [zz("s1", `${R}/ag/shop/worktrees/nav`)] });
  const roles = roleOf(tree);
  assert.deepEqual(Object.fromEntries([...roles].map(([k, v]) => [k, v.tip])), {
    t1: "Workspace Boss", t2: "Helper", t3: "Org lead", t4: "Helper", t5: "Project lead on main", t6: "Helper",
    t7: "Worker in nav", t8: "Helper", "sleep:s1": "Helper",
  });
});

// job-live (mac-workspace local-50): a scheduled job's run, from the core's /api/agents `jobs`.
const RUN = { name: "job-collie-design", job: "collie-design", run: "collie-design-20261125-1630", org: "personal",
  project: "mac-workspace", status: "running", cwd: `${R}/personal/mac-workspace/worktrees/job-collie-design-20261125-1630`,
  step: "Bash: ws playwright shot overview", steps: 12, startedMs: 1_000_000_000 - 7 * 60000, endedMs: null,
  summary: "", screenshots: 2, watch: "/api/jobs/watch/collie-design-20261125-1630" };

test("a running scheduled job is a tree extra named job-<id> that opens its live view", () => {
  const [x] = jobRunsOf({ agents: [], jobs: [RUN] });
  assert.equal(x.address, "jobrun:collie-design-20261125-1630");
  assert.equal(x.name, "job-collie-design");
  assert.equal(x.cwd, RUN.cwd);
  assert.equal(x.state, "live");
  assert.equal(x.watch, "http://127.0.0.1:4317/api/jobs/watch/collie-design-20261125-1630");
  assert.deepEqual(jobRunsOf({ agents: [] }), []);
  assert.deepEqual(jobRunsOf([{ terminal: "t1" }]), []); // an older core: a bare list, no jobs
  assert.deepEqual(jobRunsOf({ jobs: [{ ...RUN, run: "../x" }] }), []); // never a forged id
});

test("a scheduled run says its step while it runs, its outcome once it ends", () => {
  const now = 1_000_000_000;
  const [x] = jobRunsOf({ jobs: [RUN] });
  assert.deepEqual(jobInfo(x, now), { name: "collie-design", schedule: "Bash: ws playwright shot overview", state: "running", last: "7m" });
  const [done] = jobRunsOf({ jobs: [{ ...RUN, status: "proposal", endedMs: now - 2 * 60000, summary: "Spacing tightened" }] });
  assert.deepEqual(jobInfo(done, now), { name: "collie-design", schedule: "Spacing tightened", state: "to review", last: "2m ago" });
  const [bad] = jobRunsOf({ jobs: [{ ...RUN, status: "failed", endedMs: now - 60000, summary: "run exited 1" }] });
  assert.equal(jobInfo(bad, now).state, "failed");
  assert.match(jobRunTip(x, now), /^collie-design · running 7m · 12 steps · 2 screenshots\nNow: Bash: ws playwright shot overview\nClick: watch it live/);
});

test("a scheduled run hangs in its project's Jobs group", () => {
  const extras = jobRunsOf({ jobs: [RUN] });
  const tree = buildTree([], { extras });
  const personal = tree.seats.find((s) => s.org === "personal");
  const p = personal.projects.find((q) => q.name === "mac-workspace");
  assert.deepEqual(p.jobs.map((j) => j.address), ["jobrun:collie-design-20261125-1630"]);
});
