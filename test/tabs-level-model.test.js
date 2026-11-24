// tabs-level's pure rules: the tab bar shows the tabs on the active tab's level
// (one checkout, or an org root), the active tab always.
import { test } from "node:test";
import assert from "node:assert/strict";
import { levelOf, levelTabs, projectOf, placeOf, orgRootOf } from "../worktrees/mods/tabs-level/model.js";
import * as tree from "../worktrees/mods/agents-tree/model.js";

const R = "/Users/me/mac-workspace";
const tab = (id, active = false) => ({ id, active });
const pane = (t, cwd, agent = true) => ({ tab: t, cwd, program: { agent } });

test("levelOf keys a checkout, an org root, and nothing outside mac-workspace", () => {
  assert.equal(levelOf(`${R}/ag/lids/main/src`), `${R}/ag/lids/main`);
  assert.equal(levelOf(`${R}/ag/lids/worktrees/early/app`), `${R}/ag/lids/worktrees/early`);
  assert.equal(levelOf(`${R}/ag`), "root:ag");
  assert.equal(levelOf(R), "root:workspace");
  assert.equal(levelOf("/tmp/x"), null);
  assert.equal(levelOf(null), null);
});

const tabs = [tab("orch"), tab("cro"), tab("early1"), tab("early2"), tab("ag-shell")];
const panes = [
  pane("orch", `${R}/ag`), pane("cro", `${R}/ag/cro-loop/main`),
  pane("early1", `${R}/ag/lids/worktrees/early`), pane("early2", `${R}/ag/lids/worktrees/early/web`),
  pane("ag-shell", `${R}/ag`, false),
];
const ids = (list) => list.map((t) => t.id);
const activate = (id) => tabs.map((t) => ({ ...t, active: t.id === id }));

test("an org orchestrator's bar holds only the org root's tabs", () => {
  assert.deepEqual(ids(levelTabs(activate("orch"), panes)), ["orch", "ag-shell"]);
});

test("a worktree's bar holds every agent and terminal in that worktree, and nothing else", () => {
  assert.deepEqual(ids(levelTabs(activate("early2"), panes)), ["early1", "early2"]);
  assert.deepEqual(ids(levelTabs(activate("cro"), panes)), ["cro"]);
});

test("a tab's level comes from its agent, not a shell split beside it", () => {
  const p = [...panes, pane("cro", `${R}/ag`, false)];
  assert.deepEqual(ids(levelTabs(activate("cro"), p)), ["cro"]);
});

test("every tab shows when the active tab has no level", () => {
  const p = [...panes.filter((x) => x.tab !== "orch"), pane("orch", "/tmp/x")];
  assert.deepEqual(ids(levelTabs(activate("orch"), p)), ids(tabs));
  assert.deepEqual(ids(levelTabs(tabs, panes)), ids(tabs));
});

test("the copied path rules agree with agents-tree's", () => {
  for (const d of [`${R}/ag/lids/main/src`, `${R}/cs/site/worktrees/fix-nav`, `${R}/ag`, R, `${R}/personal/`, "/tmp/x", null]) {
    assert.deepEqual(projectOf(d), tree.projectOf(d), d);
    assert.equal(placeOf(d), tree.placeOf(d), d);
    assert.equal(orgRootOf(d), tree.orgRootOf(d), d);
  }
});
