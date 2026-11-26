// Agents tree: what a click on a sleeper's row reports after `ws agent wake <name>`
// (sleeper-click-wake S3): nothing when it woke, else the error to show on the row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wakeError } from "../worktrees/mods/agents-tree/model.js";

test("a wake that exits 0 shows no error", () => {
  assert.equal(wakeError({ code: 0, stdout: "orch-x (t1) woke up in ~/x\n", stderr: "" }), null);
});

test("a refused wake shows its stderr's last line", () => {
  const r = { code: 1, stdout: "", stderr: "ws: orch-cs-x: its account ~/.claude is no cs profile, its folder is cs: refused (cs and ag never mix)\n\n" };
  assert.equal(wakeError(r), "ws: orch-cs-x: its account ~/.claude is no cs profile, its folder is cs: refused (cs and ag never mix)");
});

test("a failed wake with no stderr names its exit code", () => {
  assert.equal(wakeError({ code: 2, stdout: "", stderr: "" }), "ws agent wake failed (exit 2)");
});

test("a wake that could not run at all says so", () => {
  assert.equal(wakeError(null), "ws agent wake could not run");
  assert.equal(wakeError(new Error("spawn /bin/zsh ENOENT")), "spawn /bin/zsh ENOENT");
});
