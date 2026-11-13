// The Agents list's background processes (worktrees/mods/agents-ws/model.js):
// which terminals are processes, how they nest under whoever launched them,
// what their state reads, and when they leave the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FADE_MS, isProcess, procState, procName, track, withEnded, tree } from "../worktrees/mods/agents-ws/model.js";

const NOW = 1_800_000_000_000;
const agent = (address, extra = {}) => ({ address, state: "live", status: "working", program: { key: "claude", name: "Claude Code", agent: true, shell: false }, ...extra });
const job = (address, parent, extra = {}) => ({ address, parent, state: "live", argv: ["npm", "test"], program: { key: "program", name: "npm", agent: false, shell: false }, ...extra });
const shell = (address, extra = {}) => ({ address, state: "live", argv: ["/bin/zsh", "-l"], program: { key: "shell", name: "zsh", agent: false, shell: true }, ...extra });

test("a terminal an agent launched with a command is a process", () => {
  assert.equal(isProcess(job("t2", "t1")), true);
  assert.equal(isProcess(shell("t2", { parent: "t1", argv: ["/bin/zsh", "-c", "npm run watch"] })), true);
});

test("agents, sub-agents and the user's own shells are not processes", () => {
  assert.equal(isProcess(agent("t1")), false);
  assert.equal(isProcess(agent("t2", { parent: "t1" })), false, "a sub-agent stays an agent");
  assert.equal(isProcess(shell("t3")), false, "a plain shell in a tab has no parent");
  assert.equal(isProcess(job("t4", null)), false, "no launcher, nothing to nest under");
  assert.equal(isProcess(shell("t5", { parent: "t1" })), false, "a bare interactive shell is not a job");
  assert.equal(isProcess(job("t6", "t1", { status: "idle" })), false, "a program that reports a status is an agent");
});

test("a process is named by its name, else its command", () => {
  assert.equal(procName(job("t2", "t1", { name: "dev server" })), "dev server");
  assert.equal(procName(job("t2", "t1")), "npm test");
  assert.equal(procName(job("t2", "t1", { argv: [] })), "npm");
});

test("state reads running, a check with its age, or the exit code", () => {
  assert.deepEqual(procState(job("t2", "t1"), undefined, NOW), { kind: "running", text: "running" });
  const ok = job("t2", "t1", { state: "finished", exit_code: 0, finished_ms: NOW - 2 * 60000 });
  assert.deepEqual(procState(ok, undefined, NOW), { kind: "done", text: "✓ 2m" });
  const failed = job("t2", "t1", { state: "finished", exit_code: 1 });
  assert.deepEqual(procState(failed, undefined, NOW), { kind: "failed", text: "exit 1" });
  const signalled = job("t2", "t1", { state: "finished", exit_code: null, signal: "SIGTERM" });
  assert.deepEqual(procState(signalled, undefined, NOW), { kind: "failed", text: "exit SIGTERM" });
});

test("without finished_ms the age counts from when the list first saw it finished", () => {
  const ok = job("t2", "t1", { state: "finished", exit_code: 0 });
  assert.equal(procState(ok, { at: NOW - 3 * 60000 }, NOW).text, "✓ 3m");
});

test("track stamps when a process is first seen finished and reports ones that vanished", () => {
  const store = {};
  let r = track(store, [job("t2", "t1"), agent("t1")], NOW);
  assert.equal(r.dirty, true);
  assert.deepEqual(store.t2, { live: true });
  assert.equal(store.t1, undefined, "agents are not tracked");
  r = track(store, [job("t2", "t1", { state: "finished", exit_code: 0 }), agent("t1")], NOW + 1000);
  assert.deepEqual(store.t2, { at: NOW + 1000 });
  r = track(store, [job("t2", "t1", { state: "finished", exit_code: 0 })], NOW + 9000);
  assert.equal(r.dirty, false, "a later look keeps the first stamp");
  assert.deepEqual(store.t2, { at: NOW + 1000 });

  const s2 = { t9: { live: true } };
  r = track(s2, [], NOW);
  assert.deepEqual(r.vanished, ["t9"], "a running one that left the list is looked up once");
  assert.deepEqual(s2.t9, { at: NOW, gone: true });
  assert.deepEqual(track(s2, [], NOW + 1).vanished, []);
});

test("track forgets processes gone for a day", () => {
  const store = { t9: { at: NOW - 2 * 86400000, gone: true }, t8: { at: NOW - 1000, gone: true } };
  track(store, [job("t2", "t1")], NOW);
  assert.equal(store.t9, undefined);
  assert.deepEqual(store.t8, { at: NOW - 1000, gone: true });
});

test("withEnded adds a vanished process's final state unless the list still has it", () => {
  const all = [agent("t1"), job("t3", "t1")];
  const ended = { t2: job("t2", "t1", { state: "finished", exit_code: 0 }), t3: job("t3", "t1", { state: "finished" }) };
  const merged = withEnded(all, ended);
  assert.deepEqual(merged.map((t) => [t.address, t.state]), [["t1", "live"], ["t3", "live"], ["t2", "finished"]]);
});

test("processes nest under whoever launched them, at any depth, beside live sub-agents", () => {
  const all = [
    agent("t1"),
    agent("t2", { parent: "t1" }),
    job("t3", "t2", { name: "watch" }),
    job("t4", "t3", { name: "child job" }),
    job("t5", "t1", { name: "build" }),
    agent("t6", { parent: "t1", state: "finished" }),
  ];
  const rows = tree(all, "t1", {}, NOW);
  assert.deepEqual(rows.map((r) => [r.t.address, r.proc, r.lines]), [
    ["t2", false, ["├"]],
    ["t3", true, ["│", "└"]],
    ["t4", true, ["│", "", "└"]],
    ["t5", true, ["└"]],
  ]);
});

test("sub-agent tree lines are unchanged when no process is around", () => {
  const all = [agent("t1"), agent("t2", { parent: "t1" }), agent("t3", { parent: "t1" }), agent("t4", { parent: "t3" })];
  assert.deepEqual(tree(all, "t1", {}, NOW).map((r) => [r.t.address, r.lines]), [
    ["t2", ["├"]],
    ["t3", ["└"]],
    ["t4", ["", "└"]],
  ]);
});

test("a finished OK process fades after a few minutes", () => {
  const ok = job("t3", "t1", { state: "finished", exit_code: 0, finished_ms: NOW - FADE_MS + 1000 });
  assert.equal(tree([agent("t1"), ok], "t1", {}, NOW).length, 1);
  assert.equal(tree([agent("t1"), ok], "t1", {}, NOW + 2000).length, 0);
  assert.ok(FADE_MS >= 2 * 60000 && FADE_MS <= 10 * 60000, "a few minutes");
});

test("a failed process stays until it was opened once", () => {
  const failed = job("t3", "t1", { state: "finished", exit_code: 2, finished_ms: NOW - 86400000 });
  assert.equal(tree([agent("t1"), failed], "t1", {}, NOW).length, 1);
  assert.equal(tree([agent("t1"), failed], "t1", { t3: { at: NOW, seen: true } }, NOW).length, 0);
});

test("a hidden process hides what it launched", () => {
  const all = [agent("t1"), job("t3", "t1", { state: "finished", exit_code: 0, finished_ms: NOW - FADE_MS - 1 }), job("t4", "t3")];
  assert.deepEqual(tree(all, "t1", {}, NOW), []);
});

test("a command with its own pane is a terminal row, not a background process", () => {
  assert.equal(isProcess(job("t2", "t1", { paned: true })), false);
  assert.equal(isProcess(job("t2", "t1")), true, "the same job without a pane stays a process");
});

test("a Claude with a pane shows before it reports a status, in its space's order", async () => {
  const { quietAgents } = await import("../worktrees/mods/agents-ws/model.js");
  const sp = [{ id: "s1", name: "dash", tabs: [{ id: "tb1" }] }, { id: "s2", name: "miss", tabs: [{ id: "tb2" }] }];
  const ps = [
    { pane: "p1", terminal: "t5d", tab: "tb1", program: { agent: true, name: "Claude" }, title: null, focused: false },
    { pane: "p2", terminal: "t7t", tab: "tb1", program: { agent: true }, status: "idle" },
    { pane: "p3", terminal: "t3r", tab: "tb2", program: { shell: true } },
    { pane: "p4", terminal: "t5g", tab: "tb2", program: { agent: false }, app: "claude-code", status: null, title: "Hook" },
  ];
  const listed = new Set(["t7t"]);
  assert.deepEqual(quietAgents(ps, listed, sp), [
    { address: "t5d", pane: "p1", tab: "tb1", space: "s1", space_name: "dash", status: "idle", program: { agent: true, name: "Claude" }, title: null, focused: false, pinned: false },
    { address: "t5g", pane: "p4", tab: "tb2", space: "s2", space_name: "miss", status: "idle", program: { agent: false }, title: "Hook", focused: false, pinned: false },
  ]);
});

test("agents keep their spaces' order once the quiet ones join", async () => {
  const { bySpace } = await import("../worktrees/mods/agents-ws/model.js");
  const sp = [{ id: "s1" }, { id: "s2" }];
  const got = bySpace([{ address: "a", space: "s2" }, { address: "b", space: "s1" }, { address: "c", space: "s2" }], sp).map((a) => a.address);
  assert.deepEqual(got, ["b", "a", "c"]);
});

test("a process whose agent is gone goes to Background, under its project", async () => {
  const { orphans, projectOf } = await import("../worktrees/mods/agents-ws/model.js");
  const now = 1_000_000;
  const all = [
    { address: "t1", state: "live", program: { agent: true }, status: "idle" },
    { address: "p1", parent: "t1", state: "live", argv: ["pnpm", "dev"] },
    { address: "p2", parent: "t9", state: "live", argv: ["next", "dev"], cwd: "/u/mac-workspace/ag/loop-seo/main" },
    { address: "p3", parent: "t9", state: "done", exit_code: 0, finished_ms: now - 10 * 60000, argv: ["build"] },
  ];
  assert.deepEqual(orphans(all, {}, now).map((t) => t.address), ["p2"]);
  assert.equal(projectOf("/u/mac-workspace/ag/loop-seo/worktrees/x/src"), "loop-seo");
  assert.equal(projectOf("/tmp"), null);
});

test("the main orchestrator is the one in a project's main checkout on main", async () => {
  const { isLiveMain } = await import("../worktrees/mods/agents-ws/model.js");
  assert.equal(isLiveMain("/u/mac-workspace/ag/shop/main", "main"), true);
  assert.equal(isLiveMain("/u/mac-workspace/ag/shop/main/src", "master"), true);
  assert.equal(isLiveMain("/u/mac-workspace/ag/shop/main", "feat/x"), false);
  assert.equal(isLiveMain("/u/mac-workspace/ag/shop/worktrees/x", "main"), false);
  assert.equal(isLiveMain(null, "main"), false);
});
