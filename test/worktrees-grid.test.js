import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const grid = fileURLToPath(new URL("../worktrees/mods/spaces-ws/bin/herdr-grid", import.meta.url));
const plan = (n) => execFileSync("sh", [grid, "plan", String(n)], { encoding: "utf8" }).trim().split("\n");

test("one worker goes right of the orchestrator", () => {
  assert.deepEqual(plan(1), ["1 0 right"]);
});

test("two workers stack in one column right of the orchestrator", () => {
  assert.deepEqual(plan(2), ["1 0 right", "2 1 down"]);
});

test("three workers: the pair's column opens before the third's, so both stay full height when split", () => {
  assert.deepEqual(plan(3), ["1 0 right", "3 1 right", "2 1 down"]);
});

test("four and five workers: every column top first, left to right, then the workers under them", () => {
  assert.deepEqual(plan(4), ["1 0 right", "3 1 right", "2 1 down", "4 3 down"]);
  assert.deepEqual(plan(5), ["1 0 right", "3 1 right", "5 3 right", "2 1 down", "4 3 down"]);
});

test("plan rejects a worker count below 1", () => {
  const r = spawnSync("sh", [grid, "plan", "0"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /worker count must be 1 or more/);
});

test("place without an anchor outside Herdr is a clear error", () => {
  const r = spawnSync("sh", [grid, "place", "t1"], { encoding: "utf8", env: { ...process.env, HC_TERMINAL_ID: "" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no anchor/);
});
