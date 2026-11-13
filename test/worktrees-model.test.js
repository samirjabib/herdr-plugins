// The worktrees plugin's pure rules: where checkouts go, how the header names
// them, and which ones clean up may remove.
import { test } from "node:test";
import assert from "node:assert/strict";
import { worktreeOf } from "../worktrees/mods/pane-branch/model.js";
import { checkoutDir, repoTitle, slug, wsBase, cleanVerdict, mergedSet, size, withAlpha, usedBy, mapLimit } from "../worktrees/mods/worktree-ws/model.js";
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
  assert.deepEqual(cleanVerdict({ ...ok, open: true }).why, ["in use"]);
  assert.deepEqual(cleanVerdict({ ...ok, open: "in use · Claude working" }).why, ["in use · Claude working"]);
  assert.equal(cleanVerdict({ ...ok, main: true }).safe, false);
  // Detached (after `git checkout origin/main`): nothing to lose when its commit is on a remote.
  assert.deepEqual(cleanVerdict({ ...ok, branch: null }), { safe: true, suggested: true, inMain: true, onRemote: true, why: [] });
  assert.deepEqual(cleanVerdict({ ...ok, branch: null, unpushed: 1 }).why, ["1 only on this Mac"]);
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

test("a checkout in use says who: the agent and its status, else shells", () => {
  const wt = "/r/worktrees/a";
  assert.equal(usedBy(wt, []), false);
  assert.equal(usedBy(wt, [{ cwd: "/r/worktrees/ab", app: "claude-code", status: "working" }]), false);
  assert.equal(usedBy(wt, [{ cwd: `${wt}/src`, app: "claude-code", status: "working" }]), "in use · Claude working");
  assert.equal(usedBy(wt, [{ cwd: wt, app: null, status: null }]), "in use · shell");
  assert.equal(usedBy(wt, [{ cwd: wt, app: null }, { cwd: wt, app: null }]), "in use · 2 shells");
  assert.equal(usedBy(wt, [{ cwd: wt, app: "pi", status: null }]), "in use · Pi");
});

test("reading checkouts runs a bounded number of commands at once, results in order", async () => {
  let running = 0, peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapLimit([], 2, async () => 1), []);
});

// The Files and Changes panels name the checkout exactly as the pane header does,
// so their copies of model.js (mods cannot import each other) must stay the same.
test("files-ws and changes-ws name a checkout like the pane header", async () => {
  const { readFile } = await import("node:fs/promises");
  const header = await readFile(new URL("../worktrees/mods/pane-branch/model.js", import.meta.url), "utf8");
  for (const m of ["files-ws", "changes-ws"]) {
    const copy = await readFile(new URL(`../worktrees/mods/${m}/model.js`, import.meta.url), "utf8");
    assert.equal(copy, header, `${m}/model.js drifted from pane-branch/model.js`);
    const { worktreeOf: w, withAlpha: a } = await import(`../worktrees/mods/${m}/model.js`);
    assert.deepEqual(w("/Users/x/mac-workspace/ag/shop/worktrees/fix-cart/src"), worktreeOf("/Users/x/mac-workspace/ag/shop/worktrees/fix-cart/src"));
    assert.equal(a("#ffffff18", "1f"), "#ffffff1f");
  }
});

test("the header marks main: live on the main branch, a warning on another", async () => {
  const { mainState } = await import("../worktrees/mods/pane-branch/model.js");
  const m = { project: "shop", wt: "main" };
  assert.equal(mainState(m, "main"), "live");
  assert.equal(mainState(m, "master"), "live");
  assert.equal(mainState(m, "feat/cart"), "off-main");
  assert.equal(mainState(m, ""), null); // branch not read yet
  assert.equal(mainState({ project: "shop", wt: "fix-cart" }, "main"), null);
  assert.equal(mainState(null, "main"), null);
});

test("the sidebar names a repo by project, counts its worktrees and finds main's pane", async () => {
  const { repoName, worktreeCount, mainPane } = await import("../worktrees/mods/spaces-ws/model.js");
  assert.equal(repoName(`${H}/mac-workspace/ag/shop/main/.git`), "shop");
  assert.equal(repoName(`${H}/code/app/.git`), "app");
  assert.equal(repoName(`${H}/bare/app.git`), "app");
  const porcelain = `worktree ${H}/m/main\nHEAD 1\nbranch refs/heads/main\n\nworktree ${H}/m/worktrees/a\nHEAD 2\nbranch refs/heads/a\n\nworktree ${H}/m/worktrees/b\nHEAD 3\ndetached\n`;
  assert.equal(worktreeCount(porcelain), 2);
  assert.equal(worktreeCount(`worktree ${H}/m/main\nHEAD 1\n`), 0);
  assert.equal(worktreeCount(""), 0);
  const ps = [
    { pane: "p1", tab: "t1", cwd: `${H}/mac-workspace/ag/shop/worktrees/a` },
    { pane: "p2", tab: "t2", cwd: `${H}/mac-workspace/ag/shop/main/src` },
    { pane: "p3", tab: "x", cwd: `${H}/mac-workspace/ag/shop/main` },
  ];
  assert.equal(mainPane({ tabs: [{ id: "t1" }, { id: "t2" }] }, ps), "p2");
  assert.equal(mainPane({ tabs: [{ id: "t1" }] }, ps), null);
});

test("the sidebar reads the main checkout and its branch from the worktree list", async () => {
  const { mainCheckout } = await import("../worktrees/mods/spaces-ws/model.js");
  const porcelain = `worktree ${H}/m/main\nHEAD 1\nbranch refs/heads/main\n\nworktree ${H}/m/worktrees/a\nHEAD 2\nbranch refs/heads/a\n`;
  assert.deepEqual(mainCheckout(porcelain), { path: `${H}/m/main`, branch: "main" });
  assert.deepEqual(mainCheckout(`worktree ${H}/m/main\nHEAD 1\ndetached\n`), { path: `${H}/m/main`, branch: "" });
  assert.equal(mainCheckout(""), null);
});

test("a space on a project's main checkout goes by that folder", async () => {
  const { isMainFolder } = await import("../worktrees/mods/spaces-ws/model.js");
  assert.equal(isMainFolder(`${H}/mac-workspace/ag/miss-me/main`), true);
  assert.equal(isMainFolder(`${H}/mac-workspace/ag/miss-me/worktrees/x`), false);
  assert.equal(isMainFolder(`${H}/code/app`), false);
  assert.equal(isMainFolder(null), false);
});

test("a space is where its terminals run now, the one of its named project first", async () => {
  const { spacePlace } = await import("../worktrees/mods/spaces-ws/model.js");
  const W = `${H}/mac-workspace/ag`;
  const ps = [
    { pane: "p1", tab: "t1", terminal: "a", cwd: `${W}/miss-me/main` },
    { pane: "p2", tab: "t1", terminal: "b", cwd: `${W}/miss-me/worktrees/x` },
  ];
  const live = { a: `${W}/ai-time/main` };
  // Claude in a moved there, but the space is named after miss-me: b's folder is miss-me's.
  assert.equal(spacePlace({ name: "miss-me", tabs: [{ id: "t1" }], folder: "/x" }, ps, live), `${W}/miss-me/worktrees/x`);
  // No terminal of the named project: the first terminal's live folder, not where the space was made.
  assert.equal(spacePlace({ name: "loop", tabs: [{ id: "t1" }], folder: "/x" }, ps, live), `${W}/ai-time/main`);
  // A project's main checkout wins over its worktrees.
  assert.equal(spacePlace({ name: "miss-me", tabs: [{ id: "t1" }] }, ps, {}), `${W}/miss-me/main`);
  assert.equal(spacePlace({ name: "x", tabs: [], folder: "/made" }, ps, live), "/made");
});

test("a space's organization comes from its mac-workspace group, else other", async () => {
  const { orgOf } = await import("../worktrees/mods/spaces-ws/model.js");
  assert.equal(orgOf(`${H}/mac-workspace/ag/shop/main`), "ag");
  assert.equal(orgOf(`${H}/mac-workspace/cs/site/worktrees/x/src`), "cs");
  assert.equal(orgOf(`${H}/mac-workspace/personal/herdr-plugins/main`), "personal");
  assert.equal(orgOf(`${H}/mac-workspace`), "other");
  assert.equal(orgOf(`${H}/code/app`), "other");
  assert.equal(orgOf(null), "other");
});
