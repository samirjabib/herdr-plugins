// The worktrees plugin's pure rules: where checkouts go, how the header names
// them, and which ones clean up may remove.
import { test } from "node:test";
import assert from "node:assert/strict";
import { worktreeOf } from "../worktrees/mods/pane-branch/model.js";
import { checkoutDir, repoTitle, slug, wsBase, cleanVerdict, mergedSet, size, withAlpha } from "../worktrees/mods/worktree-ws/model.js";
import { withAlpha as headerAlpha } from "../worktrees/mods/pane-branch/model.js";

const H = "/Users/me";
const ws = { main: `${H}/mac-workspace/ag/bh-dashboard/main`, name: "main" };
const other = { main: `${H}/code/app`, name: "app" };

test("the header names a mac-workspace checkout by project and worktree", () => {
  assert.deepEqual(worktreeOf(`${H}/mac-workspace/ag/bh-dashboard/main`), { project: "bh-dashboard", wt: "main" });
  assert.deepEqual(worktreeOf(`${H}/mac-workspace/ag/bh-dashboard/worktrees/fix-nav/src/app`), { project: "bh-dashboard", wt: "fix-nav" });
  assert.deepEqual(worktreeOf(`${H}/.herdr/worktrees/main/lids-marks`), { project: "main", wt: "lids-marks" });
  assert.equal(worktreeOf(H), null);
  assert.equal(worktreeOf(null), null);
});

test("new checkouts go beside main in the mac-workspace layout, else under Herdr's root", () => {
  assert.equal(wsBase(ws.main), `${H}/mac-workspace/ag/bh-dashboard`);
  assert.equal(checkoutDir(ws, H), `${H}/mac-workspace/ag/bh-dashboard/worktrees`);
  assert.equal(checkoutDir(other, H), `${H}/.herdr/worktrees/app`);
  assert.equal(slug("feat/lids plugin"), "feat-lids-plugin");
});

test("a repo is titled by its project folder, not its 'main' checkout folder", () => {
  assert.equal(repoTitle(ws), "bh-dashboard");
  assert.equal(repoTitle(other), "app");
});

test("clean up removes a checkout only when nothing in it can be lost", () => {
  const ok = { main: false, branch: "fix-nav", merged: true, dirty: false, unpushed: 0, open: false };
  assert.deepEqual(cleanVerdict(ok), { safe: true, suggested: true, inMain: true, onRemote: true, why: [] });
  assert.deepEqual(cleanVerdict({ ...ok, dirty: true }).why, ["uncommitted changes"]);
  assert.deepEqual(cleanVerdict({ ...ok, unpushed: 2 }).why, ["2 only on this Mac"]);
  assert.equal(cleanVerdict({ ...ok, unpushed: 2 }).onRemote, false);
  assert.deepEqual(cleanVerdict({ ...ok, open: true }).why, ["open in a pane"]);
  assert.equal(cleanVerdict({ ...ok, main: true }).safe, false);
  assert.equal(cleanVerdict({ ...ok, branch: null }).safe, false);
});

test("a pushed branch not merged yet can go but isn't suggested", () => {
  const pushed = { main: false, branch: "wip", merged: false, dirty: false, unpushed: 0, open: false };
  assert.deepEqual(cleanVerdict(pushed), { safe: true, suggested: false, inMain: false, onRemote: true, why: [] });
});

test("merged branches come from PRs and from git, blank lines ignored", () => {
  assert.deepEqual([...mergedSet("a\nb\n", "\nb\nc", undefined)].sort(), ["a", "b", "c"]);
});

test("sizes read like people say them", () => {
  assert.equal(size(840), "840 KB");
  assert.equal(size(12 * 1024), "12 MB");
  assert.equal(size(1.4 * 1024 * 1024), "1.4 GB");
  assert.equal(size(0), "");
});

test("a tint replaces a theme color's alpha instead of appending to it", () => {
  for (const f of [withAlpha, headerAlpha]) {
    assert.equal(f("#ffffff18", "66"), "#ffffff66");
    assert.equal(f("#3b82f6", "26"), "#3b82f626");
    assert.equal(f("#fff", "1f"), "#ffffff1f");
    assert.equal(f("red", "26"), "red");
  }
});
