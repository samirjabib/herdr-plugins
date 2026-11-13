// The Spaces "+" picker: projects of an organization from mac-workspace's
// folders and catalog, their worktrees, and the rows a search leaves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectsOf, pickRows } from "../worktrees/mods/space-picker/model.js";

const R = "/Users/me/mac-workspace";
const dirs = [`${R}/ag/shop/main`, `${R}/ag/shop/worktrees/fix-cart`, `${R}/ag/blog/main`, `${R}/cs/site/main`].join("\n");
const catalog = "group\tname\tremote\nag\tshop\tgit@x:shop\nag\tblog\tgit@x:blog\nag\tlegacy\tgit@x:legacy\ncs\tsite\tgit@x:site\n";

test("an organization lists its cloned projects with worktrees, then catalogued ones not cloned", () => {
  assert.deepEqual(projectsOf("ag", dirs, catalog, R), [
    { name: "blog", main: `${R}/ag/blog/main`, worktrees: [], cloned: true },
    { name: "shop", main: `${R}/ag/shop/main`, worktrees: [{ name: "fix-cart", path: `${R}/ag/shop/worktrees/fix-cart` }], cloned: true },
    { name: "legacy", main: `${R}/ag/legacy/main`, worktrees: [], cloned: false },
  ]);
  assert.deepEqual(projectsOf("cs", dirs, catalog, R).map((p) => p.name), ["site"]);
  assert.deepEqual(projectsOf("personal", dirs, catalog, R), []);
});

test("a search keeps projects whose name or worktree matches, Other folder always last", () => {
  const ps = projectsOf("ag", dirs, catalog, R);
  assert.deepEqual(pickRows(ps, "").map((r) => `${r.kind}:${r.label}`), ["project:blog", "project:shop", "worktree:fix-cart", "project:legacy", "other:Other folder…"]);
  assert.deepEqual(pickRows(ps, "cart").map((r) => `${r.kind}:${r.label}`), ["project:shop", "worktree:fix-cart", "other:Other folder…"]);
  assert.deepEqual(pickRows(ps, "BLO").map((r) => r.label), ["blog", "Other folder…"]);
});
