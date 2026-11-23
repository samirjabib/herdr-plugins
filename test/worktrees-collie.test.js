// The Spaces sidebar's link to Collie (the mac-workspace app): its workspace switcher, the
// workspace Collie has picked, and the "sheep herded" status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orgMenu, orgFace, collieWorkspace, followCollie, linkStatus, ORGS } from "../worktrees/mods/spaces-ws/model.js";

const rows = [
  { org: "ag", w: { status: "idle" } },
  { org: "ag", w: { status: "blocked" } },
  { org: "cs", w: { status: "working" } },
  { org: "other", w: { status: "idle" } },
];

test("the switcher lists All, then Collie's order, each org with spaces and its count", () => {
  const menu = orgMenu(rows, "all");
  assert.deepEqual(menu.map((m) => [m.id, m.label, m.count, m.on]), [
    ["all", "All workspaces", 4, true],
    ["cs", "Coldsmoke", 1, false],
    ["ag", "Arctic Grey", 2, false],
    ["other", "Other", 1, false],
  ]);
  assert.deepEqual(menu.map((m) => m.needs), [true, false, true, false]);
});

test("the picked org stays in the menu even with no spaces", () => {
  const menu = orgMenu(rows, "personal");
  assert.deepEqual(menu.find((m) => m.id === "personal"), { id: "personal", label: "Personal", initials: "P", count: 0, needs: false, on: true });
});

test("the pill's face names the picked org with Collie's initials; All has none", () => {
  assert.deepEqual(orgFace("cs"), { label: "Coldsmoke", initials: "CS" });
  assert.deepEqual(orgFace("ag"), { label: "Arctic Grey", initials: "AG" });
  assert.deepEqual(orgFace("all"), { label: "All workspaces", initials: "" });
  assert.deepEqual(orgFace("nope"), { label: "All workspaces", initials: "" });
});

test("every filter the tabs had is still in the switcher", () => {
  assert.deepEqual(ORGS.map(([id]) => id).sort(), ["ag", "cs", "other", "personal"]);
  for (const [id] of ORGS) assert.ok(orgMenu([], id).some((m) => m.id === id && m.on));
});

test("Collie's workspace is read from its desktop.json; anything else is unknown", () => {
  assert.equal(collieWorkspace(JSON.stringify({ workspace: "ag", colors: {} })), "ag");
  assert.equal(collieWorkspace('{"workspace":"all"}'), "all");
  assert.equal(collieWorkspace('{"workspace":"other"}'), null);
  assert.equal(collieWorkspace('{"workspace":""}'), null);
  assert.equal(collieWorkspace("{not json"), null);
  assert.equal(collieWorkspace(null), null);
  assert.equal(collieWorkspace("[]"), null);
});

test("Herdr follows Collie when Collie's pick changes, and only then", () => {
  // First read: Collie's pick wins over the one Herdr remembered.
  assert.deepEqual(followCollie({ org: "cs", seen: null }, "ag"), { org: "ag", seen: "ag" });
  // Picked here since: Collie still says ag, so the local pick stays.
  assert.deepEqual(followCollie({ org: "personal", seen: "ag" }, "ag"), { org: "personal", seen: "ag" });
  // Collie switched: Herdr switches with it.
  assert.deepEqual(followCollie({ org: "personal", seen: "ag" }, "all"), { org: "all", seen: "all" });
  // Collie unreadable: nothing changes.
  assert.deepEqual(followCollie({ org: "cs", seen: "ag" }, null), { org: "cs", seen: "ag" });
});

test("the link says herding N while connected, sheep loose when the core is down", () => {
  assert.deepEqual(linkStatus({ ok: true }, 3), { text: "herding 3", loose: false, tip: "Collie is herding: 3 agents working. Click to open Collie" });
  assert.equal(linkStatus({ ok: true }, 1).tip, "Collie is herding: 1 agent working. Click to open Collie");
  assert.equal(linkStatus({ ok: true }, 0).text, "on watch");
  const down = linkStatus({ ok: false }, 2);
  assert.equal(down.text, "sheep loose");
  assert.equal(down.loose, true);
  assert.match(down.tip, /^Collie unreachable: .*127\.0\.0\.1:4317.*Click to retry/);
  assert.equal(linkStatus(null, 0).text, "waking up");
  assert.equal(linkStatus(null, 0).loose, false);
});

test("the Spaces list draws the switcher instead of the organization tabs", () => {
  const src = readFileSync(new URL("../worktrees/mods/spaces-ws/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /orgTabs\(/);
  assert.match(src, /Popup\.new\("org-switch"/);
  // agents-tree follows this key: it must stay the one the list writes.
  assert.match(src, /setShared\("spaces\.org", org\)/);
});
