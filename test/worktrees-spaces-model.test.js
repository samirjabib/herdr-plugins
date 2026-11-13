// The Spaces sidebar's pure rules: one row per project, its agents' dots and
// running processes, the state of its main checkout, the order, and what
// Update main says.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectName, mainCheckout, mainState, groupRows, rowActivity, sortRows, rank,
  dotsShown, rowTooltip, procText, updateArgs, updateToast, contiguousOrder, freshRequest, dropOrder, clickTarget, spaceCount,
} from "../worktrees/mods/spaces-ws/model.js";

const H = "/Users/me";
const MM = `${H}/mac-workspace/ag/miss-me/main/.git`;
const git = (repo, linked = false) => ({ repo: JSON.stringify([null, repo]), path: repo, linked });

test("a project is named after its repo folder; a mac-workspace main checkout by the folder above main", () => {
  assert.equal(projectName(MM), "miss-me");
  assert.equal(projectName(`${H}/code/herdr/.git`), "herdr");
  assert.equal(projectName(`${H}/repos/tool.git`), "tool");
  assert.equal(projectName(`${H}/mac-workspace/ag/miss-me/main/.git/`), "miss-me");
});

test("the main checkout is the repo's own folder; a bare repo has none", () => {
  assert.equal(mainCheckout(MM), `${H}/mac-workspace/ag/miss-me/main`);
  assert.equal(mainCheckout(`${H}/repos/tool.git`), null);
});

test("main is silent when it is up to date on its default branch", () => {
  assert.deepEqual(mainState({ branch: "main", defaultBranch: "main", dirty: false, ahead: 0, behind: 0 }), { kind: "fresh" });
});

test("main behind its upstream shows ↓N", () => {
  assert.deepEqual(mainState({ branch: "main", defaultBranch: "main", dirty: false, ahead: 0, behind: 119 }), { kind: "behind", n: 119, text: "↓119" });
});

test("main that can't fast-forward shows ⚠ with why: uncommitted changes, another branch, ahead", () => {
  assert.deepEqual(mainState({ branch: "main", defaultBranch: "main", dirty: true, ahead: 0, behind: 3 }), { kind: "warn", text: "⚠", why: "uncommitted changes" });
  assert.deepEqual(mainState({ branch: "fix/nav", defaultBranch: "main", dirty: false, ahead: 0, behind: 0 }), { kind: "warn", text: "⚠", why: "on another branch (fix/nav)" });
  assert.deepEqual(mainState({ branch: "main", defaultBranch: "main", dirty: false, ahead: 2, behind: 1 }), { kind: "warn", text: "⚠", why: "2 commits ahead of upstream" });
  assert.deepEqual(mainState({ branch: null, defaultBranch: "main", dirty: true, ahead: 0, behind: 0 }), { kind: "warn", text: "⚠", why: "on another branch (detached), uncommitted changes" });
});

test("main state is unknown (silent) when it couldn't be read", () => {
  assert.deepEqual(mainState(null), { kind: "fresh" });
});

test("spaces of the same repo merge into one row; the main checkout's space is its target", () => {
  const sp = [
    { id: "w1", machine: null }, { id: "m", machine: null }, { id: "x", machine: null }, { id: "w2", machine: null },
  ];
  const info = { w1: git(MM, true), m: git(MM), x: null, w2: git(MM, true) };
  const rows = groupRows(sp, (s) => info[s.id]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].spaces.map((s) => s.id), ["m", "w1", "w2"]);
  assert.equal(rows[0].target.id, "m");
  assert.equal(rows[0].name, "miss-me");
  assert.deepEqual(rows[1].spaces.map((s) => s.id), ["x"]);
  assert.equal(rows[1].target.id, "x");
  assert.equal(rows[1].name, null);
});

test("a repo without a space on its main checkout goes to its first space", () => {
  const sp = [{ id: "w1" }, { id: "w2" }];
  const rows = groupRows(sp, () => git(MM, true));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target.id, "w1");
});

test("non-git spaces each keep their own row", () => {
  const rows = groupRows([{ id: "a" }, { id: "b" }], () => null);
  assert.deepEqual(rows.map((r) => r.spaces.map((s) => s.id)), [["a"], ["b"]]);
});

test("the same repo on two machines is two rows", () => {
  const sp = [{ id: "a", machine: null }, { id: "b", machine: "mini" }];
  const info = { a: git(MM), b: { repo: JSON.stringify(["mini", MM]), path: MM, linked: false } };
  assert.equal(groupRows(sp, (s) => info[s.id]).length, 2);
});

// A row with two spaces: the orchestrator in m's tab, a worker in w's tab.
const world = () => ({
  spaces: [{ id: "m", tabs: [{ id: "tm" }] }, { id: "w", tabs: [{ id: "tw" }] }, { id: "o", tabs: [{ id: "to" }] }],
  agents: [
    { address: "t1", space: "m", status: "working", tab_name: "1", program: { name: "Claude Code" } },
    { address: "t2", space: "w", status: "blocked", tab_name: "fix", program: { name: "Claude Code" } },
    { address: "t9", space: "o", status: "working", tab_name: "1", program: { name: "Claude Code" } },
  ],
  panes: [
    { pane: "p1", tab: "tm", terminal: "t1" }, { pane: "p2", tab: "tw", terminal: "t2" },
    { pane: "p3", tab: "tm", terminal: "s1" }, { pane: "p9", tab: "to", terminal: "t9" },
  ],
  terminals: [
    { address: "t1", state: "live", name: "orchestrator", status: "working", program: { agent: true } },
    { address: "t2", state: "live", status: "blocked", program: { agent: true } },
    { address: "s1", state: "live", program: { shell: true } },
    // A sub-agent of t1 without a pane, idle, and a done one.
    { address: "k1", parent: "t1", state: "live", name: "worker-a", status: "idle", program: { agent: true } },
    { address: "k2", parent: "t1", state: "live", name: "worker-b", status: "done", program: { agent: true } },
    // Processes started with hc run: a watcher of t1, a job of k1, one of another space.
    { address: "j1", parent: "t1", state: "live", name: "watch", program: { key: "program" } },
    { address: "j2", parent: "k1", state: "live", name: "tests", program: { key: "program" } },
    { address: "j9", parent: "t9", state: "live", name: "dev", program: { key: "program" } },
  ],
});

test("a row's agents: its spaces' agents in order, each sub-agent after its parent, with its status", () => {
  const w = world();
  const a = rowActivity(w.spaces.slice(0, 2), w);
  assert.deepEqual(a.agents.map((x) => [x.address, x.name, x.kind]), [
    ["t1", "orchestrator", "work"],
    ["k1", "worker-a", "idle"],
    ["k2", "worker-b", "idle"],
    ["t2", "fix", "need"],
  ]);
});

test("a row counts its running processes, not agents, shells in panes, or other spaces' processes", () => {
  const w = world();
  assert.deepEqual(rowActivity(w.spaces.slice(0, 2), w).procs, { running: 2, failed: false });
  assert.deepEqual(rowActivity([w.spaces[2]], w).procs, { running: 1, failed: false });
});

test("a failed process turns the count red; a killed one doesn't", () => {
  const w = world();
  w.terminals.push({ address: "j3", parent: "t1", state: "finished", exit_code: 1, program: { key: "program" } });
  w.terminals.push({ address: "j4", parent: "t1", state: "finished", exit_code: 1, reason: "killed", program: { key: "program" } });
  w.terminals.push({ address: "j5", parent: "t1", state: "finished", exit_code: 0, program: { key: "program" } });
  assert.deepEqual(rowActivity(w.spaces.slice(0, 2), w).procs, { running: 2, failed: true });
});

test("▸N shows only when something runs or failed", () => {
  assert.equal(procText({ running: 0, failed: false }), "");
  assert.equal(procText({ running: 3, failed: false }), "▸3");
  assert.equal(procText({ running: 0, failed: true }), "▸0");
});

test("dots show when there are several agents or the only one isn't idle", () => {
  assert.equal(dotsShown([]), false);
  assert.equal(dotsShown([{ kind: "idle" }]), false);
  assert.equal(dotsShown([{ kind: "work" }]), true);
  assert.equal(dotsShown([{ kind: "idle" }, { kind: "idle" }]), true);
});

test("rows sort needs you → working → the rest, keeping their order within each", () => {
  const rows = [
    { key: "a", activity: { agents: [{ kind: "idle" }] } },
    { key: "b", activity: { agents: [{ kind: "work" }] } },
    { key: "c", activity: { agents: [{ kind: "work" }, { kind: "need" }] } },
    { key: "d", activity: { agents: [] } },
    { key: "e", activity: { agents: [{ kind: "work" }] } },
  ];
  assert.deepEqual(sortRows(rows).map((r) => r.key), ["c", "b", "e", "a", "d"]);
  assert.equal(rank(rows[2]), 0);
  assert.equal(rank(rows[3]), 2);
});

test("hover lists the agents with their status, and main's reason when it warns", () => {
  const agents = [{ name: "orchestrator", kind: "work" }, { name: "worker-a", kind: "need" }, { name: "w", kind: "idle" }];
  assert.equal(rowTooltip(agents, { kind: "fresh" }), "orchestrator · working\nworker-a · needs you\nw · idle");
  assert.equal(rowTooltip([], { kind: "warn", why: "uncommitted changes" }), "main · uncommitted changes");
  assert.equal(rowTooltip([], { kind: "behind", n: 2, text: "↓2" }), "main · 2 commits behind");
  assert.equal(rowTooltip([], { kind: "fresh" }), null);
});

test("Update main runs ws update <name> from the machine's home", () => {
  assert.deepEqual(updateArgs("miss-me"), ["-c", 'exec "$HOME/mac-workspace/bin/ws" update "$1"', "sh", "miss-me"]);
});

test("Update main's toast is ws update's line: success, not touched, not installed", () => {
  assert.deepEqual(updateToast("miss-me", { code: 0, stdout: "miss-me: main ↓12 → up to date\n", stderr: "" }), { title: "miss-me: main ↓12 → up to date", level: "success" });
  assert.deepEqual(updateToast("miss-me", { code: 0, stdout: "miss-me: main already up to date\n", stderr: "" }), { title: "miss-me: main already up to date", level: "success" });
  assert.deepEqual(updateToast("miss-me", { code: 1, stdout: "", stderr: "miss-me: uncommitted changes, not touched\n" }), { title: "miss-me: uncommitted changes, not touched", level: "warning" });
  assert.deepEqual(updateToast("miss-me", { code: 127, stdout: "", stderr: "sh: /Users/me/mac-workspace/bin/ws: not found\n" }), { title: "ws update is not installed", body: "Update mac-workspace (~/mac-workspace/bin/ws) to get it.", level: "error" });
  assert.deepEqual(updateToast("miss-me", null), { title: "ws update is not installed", body: "Update mac-workspace (~/mac-workspace/bin/ws) to get it.", level: "error" });
  assert.deepEqual(updateToast("miss-me", { code: 2, stdout: "", stderr: "" }), { title: "miss-me: ws update failed (exit 2)", level: "error" });
});

test("an older ws without the update command counts as not installed", () => {
  assert.equal(updateToast("x", { code: 1, stdout: "", stderr: "ws: unknown command: update\n" }).title, "ws update is not installed");
});

test("each project's spaces stay next to each other, in the rows' order", () => {
  const rows = [{ spaces: [{ id: "m" }, { id: "w1" }] }, { spaces: [{ id: "x" }] }];
  assert.deepEqual(contiguousOrder(rows), ["m", "w1", "x"]);
});

test("a menu request runs once and only when new", () => {
  const now = 100000;
  assert.equal(freshRequest({ space: "a", at: now - 1000 }, null, now), true);
  assert.equal(freshRequest({ space: "a", at: now - 1000 }, now - 1000, now), false); // already handled
  assert.equal(freshRequest({ space: "a", at: now - 60000 }, null, now), false); // stale (from before a restart)
  assert.equal(freshRequest(null, null, now), false);
});

test("dragging a row moves all its spaces: after the row dropped on when going down, before it going up", () => {
  const order = ["a", "a2", "b", "c", "c2"];
  assert.deepEqual(dropOrder(order, ["a", "a2"], ["c", "c2"]), ["b", "c", "c2", "a", "a2"]);
  assert.deepEqual(dropOrder(order, ["c", "c2"], ["a", "a2"]), ["c", "c2", "a", "a2", "b"]);
  assert.deepEqual(dropOrder(order, ["b"], ["b"]), order);
});

test("clicking a row goes to its target; clicking it again cycles through the project's spaces", () => {
  const row = { spaces: [{ id: "m", active: false }, { id: "w1", active: false }, { id: "w2", active: false }] };
  row.target = row.spaces[0];
  assert.equal(clickTarget(row).id, "m");
  row.spaces[0].active = true;
  assert.equal(clickTarget(row).id, "w1");
  row.spaces[0].active = false; row.spaces[2].active = true;
  assert.equal(clickTarget(row).id, "m");
  const one = { spaces: [{ id: "x", active: true }] };
  one.target = one.spaces[0];
  assert.equal(clickTarget(one).id, "x");
});

test("a row shows how many spaces it merges, only when more than one", () => {
  assert.equal(spaceCount({ spaces: [{ id: "a" }] }), "");
  assert.equal(spaceCount({ spaces: [{ id: "a" }, { id: "b" }] }), "2");
});

test("each agent knows its space; a sub-agent its parent's", () => {
  const w = world();
  const a = rowActivity(w.spaces.slice(0, 2), w);
  assert.deepEqual(a.agents.map((x) => [x.address, x.space]), [["t1", "m"], ["k1", "m"], ["k2", "m"], ["t2", "w"]]);
});

test("hover groups agents under their space's name when the row has several spaces", () => {
  const agents = [{ name: "orchestrator", kind: "work", space: "m" }, { name: "worker", kind: "idle", space: "m" }, { name: "fix", kind: "need", space: "w" }];
  const spaces = [{ id: "m", name: "mac-workspace" }, { id: "w", name: "fix-nav" }];
  assert.equal(rowTooltip(agents, { kind: "fresh" }, spaces), "mac-workspace\n  orchestrator · working\n  worker · idle\nfix-nav\n  fix · needs you");
  assert.equal(rowTooltip(agents.slice(0, 1), { kind: "fresh" }, spaces.slice(0, 1)), "orchestrator · working");
  // A space without agents still shows, so the hover names every space of the row.
  assert.equal(rowTooltip(agents.slice(0, 1), { kind: "fresh" }, spaces), "mac-workspace\n  orchestrator · working\nfix-nav\n  no agents");
});

test("a project spread over several spaces is gathered into one grid on click", async () => {
  const { needsGather, gatherArgs } = await import("../worktrees/mods/spaces-ws/model.js");
  const s = (id) => ({ id, active: false });
  const repo = "/Users/x/mac-workspace/ag/miss-me/main/.git";
  assert.equal(needsGather({ path: repo, spaces: [s("a"), s("b")] }), true);
  assert.equal(needsGather({ path: repo, spaces: [s("a")] }), false, "one space: just select it");
  assert.equal(needsGather({ path: null, spaces: [s("a"), s("b")] }), false, "not a git project: nothing to gather");
  assert.deepEqual(gatherArgs("/Users/x/mac-workspace/ag/miss-me/main"),
    ["-c", 'exec "$HOME/.local/bin/herdr-grid" project "$1"', "sh", "/Users/x/mac-workspace/ag/miss-me/main"]);
});
