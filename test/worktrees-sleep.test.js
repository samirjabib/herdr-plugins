// The space menu's "Sleep agents": the command agent-sleep expects for the
// checkout a space is in, and the Spaces row's moon for a space put away.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sleepCommandFor } from "../worktrees/mods/menu-ws/model.js";
import { asleep } from "../worktrees/mods/spaces-ws/model.js";
import { sleepWorkspaceCommand } from "../agent-sleep/mods/agent-sleep/workspace-sleep.js";

const H = "/Users/me/mac-workspace/ag/shop";
const porcelain = `worktree ${H}/main\nHEAD 1\nbranch refs/heads/main\n\nworktree ${H}/worktrees/fix-cart\nHEAD 2\nbranch refs/heads/fix\n`;

test("sleep names the deepest checkout holding the space's folder, as agent-sleep spells it", () => {
  assert.equal(sleepCommandFor(`${H}/main/src`, porcelain), `agent-sleep.${sleepWorkspaceCommand(`${H}/main`)}`);
  assert.equal(sleepCommandFor(`${H}/worktrees/fix-cart`, porcelain), `agent-sleep.${sleepWorkspaceCommand(`${H}/worktrees/fix-cart`)}`);
  assert.equal(sleepCommandFor(`${H}/mainly`, porcelain), null);
  assert.equal(sleepCommandFor("/elsewhere", porcelain), null);
  assert.equal(sleepCommandFor(`${H}/main`, ""), null);
});

test("a space is asleep when every tab is put away", () => {
  assert.equal(asleep({ tabs: [{ settled: true }, { settled: true }] }), true);
  assert.equal(asleep({ tabs: [{ settled: true }, { settled: false }] }), false);
  assert.equal(asleep({ tabs: [] }), false);
  assert.equal(asleep({}), false);
});
