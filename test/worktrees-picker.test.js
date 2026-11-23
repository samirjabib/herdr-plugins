// The Spaces "+" picker, the mac-workspace way: an organization's catalog projects,
// their main's branch and worktrees, the sections it lists and how the keys move.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SWITCH, orgFace, nextOrg, placeholder, orgMenu, parseCatalog, parseHeads, projectsOf, mainFact,
  remember, recentOf, buildRows, selectable, step, firstRow, arrow, cloneArgv, HEADS_SCRIPT,
} from "../worktrees/mods/space-picker/model.js";
import { orgFace as spacesFace } from "../worktrees/mods/spaces-ws/model.js";

const R = "/Users/me/mac-workspace";
const catalog = parseCatalog("group\tname\tremote\nag\tshop\tgit@x:shop\nag\tblog\tgit@x:blog\nag\tlegacy\tgit@x:legacy\ncs\tsite\tgit@x:site\n");
const heads = parseHeads([
  `${R}/ag/shop/main\tref: refs/heads/main`,
  `${R}/ag/shop/worktrees/fix-cart\tref: refs/heads/fix/cart`,
  `${R}/ag/shop/worktrees/alpha\t0123456789abcdef`,
  `${R}/ag/blog/main\tref: refs/heads/feat/x`,
  `${R}/ag/local-only/main\tref: refs/heads/main`,
  `${R}/cs/site/main\tref: refs/heads/main`,
].join("\n"));
const ag = projectsOf("ag", { catalog, heads, root: R });
const kinds = (rows) => rows.map((r) => (r.kind === "section" ? `# ${r.label}` : `${r.kind}:${r.label}`));

test("the switcher's orgs look exactly as the Spaces sidebar draws them", () => {
  for (const [id] of SWITCH) assert.deepEqual(orgFace(id), spacesFace(id));
  assert.deepEqual(SWITCH.map(([id]) => id), ["cs", "ag", "personal", "other"]);
  assert.equal(nextOrg("cs"), "ag");
  assert.equal(nextOrg("other"), "cs");
  assert.equal(nextOrg("cs", true), "other");
});

test("the placeholder names the picked org, in sentence case", () => {
  assert.equal(placeholder("ag"), "Search Arctic Grey projects…");
  assert.equal(placeholder("cs"), "Search Coldsmoke projects…");
  assert.equal(placeholder("personal"), "Search Personal projects…");
  assert.equal(placeholder("other"), "Search folders outside mac-workspace…");
});

test("the menu lists every org with its project count and the picked one", () => {
  assert.deepEqual(orgMenu({ ag: 4, cs: 1 }, "ag").map((m) => `${m.initials} ${m.label} ${m.count}${m.on ? " ✓" : ""}`),
    ["CS Coldsmoke 1", "AG Arctic Grey 4 ✓", "P Personal 0", "O Other 0"]);
});

test("the catalog parses into group, name and remote, skipping the header and blank lines", () => {
  assert.deepEqual(parseCatalog("group\tname\tremote\nag\tshop\tgit@x:shop\n\n"), [{ group: "ag", name: "shop", remote: "git@x:shop" }]);
  assert.deepEqual(parseCatalog(null), []);
});

test("HEAD files give branches; a detached HEAD gives an empty branch", () => {
  assert.equal(heads.get(`${R}/ag/shop/worktrees/fix-cart`), "fix/cart");
  assert.equal(heads.get(`${R}/ag/shop/worktrees/alpha`), "");
});

test("an org lists its catalog projects and checkouts: cloned first, then not cloned, never another org's", () => {
  assert.deepEqual(ag.map((p) => `${p.name}${p.cloned ? "" : " (not cloned)"}`), ["blog", "local-only", "shop", "legacy (not cloned)"]);
  const shop = ag.find((p) => p.name === "shop");
  assert.deepEqual(shop.worktrees, [
    { name: "alpha", path: `${R}/ag/shop/worktrees/alpha`, branch: "" },
    { name: "fix-cart", path: `${R}/ag/shop/worktrees/fix-cart`, branch: "fix/cart" },
  ]);
  assert.deepEqual(ag.find((p) => p.name === "legacy"), { org: "ag", name: "legacy", main: `${R}/ag/legacy/main`, cloned: false, branch: null, worktrees: [] });
  assert.deepEqual(projectsOf("cs", { catalog, heads, root: R }).map((p) => p.name), ["site"]);
  assert.deepEqual(projectsOf("personal", { catalog, heads, root: R }), []);
  assert.deepEqual(projectsOf("other", { catalog, heads, root: R }), []);
});

test("main's fact: quiet main, a red ⚠ with the branch otherwise, none when not cloned", () => {
  assert.deepEqual(mainFact(ag.find((p) => p.name === "shop")), { text: "main", warn: false });
  assert.equal(mainFact(ag.find((p) => p.name === "blog")).text, "⚠ feat/x");
  assert.equal(mainFact(ag.find((p) => p.name === "blog")).warn, true);
  assert.equal(mainFact(ag.find((p) => p.name === "legacy")), null);
});

test("recent: opened from here first, then open spaces; only this org's cloned projects", () => {
  let h = remember([], "ag", "blog");
  h = remember(h, "cs", "site");
  h = remember(h, "ag", "shop");
  h = remember(h, "ag", "blog");
  assert.deepEqual(h, ["ag/blog", "ag/shop", "cs/site"]);
  assert.deepEqual(recentOf(ag, h, ["local-only", "legacy"]).map((p) => p.name), ["blog", "shop", "local-only"]);
  assert.deepEqual(recentOf(ag, [], []), []);
  assert.deepEqual(recentOf([], h, ["x"]), []);
});

test("sections in order: Here, Recent, Projects, then the quiet rows", () => {
  const rows = buildRows({ org: "ag", projects: ag, recent: [ag[0]], orch: { running: false }, root: R });
  assert.deepEqual(kinds(rows), [
    "# Here", "orch:Arctic Grey orchestrator", "root:Terminal at ~/mac-workspace/ag",
    "# Recent", "project:blog",
    "# Projects", "project:blog", "project:local-only", "project:shop", "project:legacy",
    "gap:undefined", "other:Other folder…", "terminal:New terminal",
  ]);
  assert.equal(rows.find((r) => r.kind === "root").path, `${R}/ag`);
  assert.equal(rows[1].running, false);
  assert.equal(buildRows({ org: "ag", projects: ag, orch: { running: true }, root: R })[1].running, true);
  // No recent: no Recent section.
  assert.ok(!kinds(buildRows({ org: "ag", projects: ag, root: R })).includes("# Recent"));
});

test("a not-cloned project's row is marked so, and clones in a terminal that then opens it", () => {
  const legacy = buildRows({ org: "ag", projects: ag, root: R }).find((r) => r.label === "legacy");
  assert.equal(legacy.project.cloned, false);
  assert.equal(legacy.expandable, false);
  const argv = cloneArgv(legacy.project);
  assert.deepEqual(argv.slice(-2), ["legacy", `${R}/ag/legacy/main`]);
  assert.match(argv[2], /ws clone "\$1" && cd "\$2" && exec claude/);
});

test("expanding a project lists its worktrees with branches; → and ← fold and unfold", () => {
  const shut = buildRows({ org: "ag", projects: ag, root: R });
  const shop = shut.find((r) => r.label === "shop");
  assert.equal(shop.expandable, true);
  assert.equal(arrow(shop, "right"), "expand");
  assert.equal(arrow(shop, "left"), null);
  assert.equal(arrow(shut.find((r) => r.label === "blog" && !r.recent), "right"), null); // no worktrees
  const open = buildRows({ org: "ag", projects: ag, expanded: new Set(["shop"]), root: R });
  const i = open.findIndex((r) => r.label === "shop");
  assert.deepEqual(open.slice(i, i + 3).map((r) => `${r.kind}:${r.label}:${r.branch ?? ""}`),
    ["project:shop:", "worktree:alpha:", "worktree:fix-cart:fix/cart"]);
  assert.equal(open[i + 2].path, `${R}/ag/shop/worktrees/fix-cart`);
  assert.equal(arrow(open[i], "left"), "collapse");
  assert.equal(arrow(open[i + 1], "left"), "parent");
  // A recent row opens the project and never expands.
  assert.equal(arrow({ kind: "project", recent: true, expandable: true, open: false }, "right"), null);
});

test("a search filters every section, hides Recent and opens projects that only match by worktree", () => {
  const rows = (q) => kinds(buildRows({ org: "ag", projects: ag, recent: [ag[0]], query: q, root: R }));
  assert.deepEqual(rows("cart"), ["# Projects", "project:shop", "worktree:fix-cart"]);
  assert.deepEqual(rows("BLO"), ["# Projects", "project:blog"]);
  assert.deepEqual(rows("orchestrator"), ["# Here", "orch:Arctic Grey orchestrator"]);
  assert.deepEqual(rows("terminal"), ["# Here", "root:Terminal at ~/mac-workspace/ag", "gap:undefined", "terminal:New terminal"]);
  assert.deepEqual(rows("zzz"), []);
});

test("Other has no seat or projects: only the folder picker and a new terminal", () => {
  assert.deepEqual(kinds(buildRows({ org: "other", projects: [], root: R })), ["gap:undefined", "other:Other folder…", "terminal:New terminal"]);
  assert.deepEqual(kinds(buildRows({ org: "personal", projects: [], root: R })).slice(3, 5), ["# Projects", "empty:No projects in the catalog for this workspace"]);
});

test("the keys skip labels and wrap; a search starts on what it found", () => {
  const rows = buildRows({ org: "ag", projects: ag, recent: [ag[0]], root: R });
  assert.equal(firstRow(rows), 1);
  assert.equal(step(rows, 2, 1), 4); // past "# Recent"
  assert.equal(step(rows, 1, -1), rows.length - 1); // wraps to New terminal
  assert.ok(rows.every((r) => selectable(r) === !["section", "gap", "empty"].includes(r.kind)));
  const found = buildRows({ org: "ag", projects: ag, query: "shop", root: R });
  assert.equal(found[firstRow(found, "shop")].label, "shop");
  assert.equal(step([{ kind: "section" }], 0, 1), -1);
});

test("the one shell read prints each checkout's HEAD, worktrees included, straight from disk", () => {
  const root = mkdtempSync(join(tmpdir(), "picker-"));
  try {
    const main = join(root, "ag/shop/main");
    mkdirSync(join(main, ".git/worktrees/fix"), { recursive: true });
    writeFileSync(join(main, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(main, ".git/worktrees/fix/HEAD"), "abc123\n");
    mkdirSync(join(root, "ag/shop/worktrees/fix"), { recursive: true });
    writeFileSync(join(root, "ag/shop/worktrees/fix/.git"), `gitdir: ${join(main, ".git/worktrees/fix")}\n`);
    mkdirSync(join(root, "ag/empty/main"), { recursive: true }); // not a checkout: skipped
    const out = execFileSync("sh", ["-c", HEADS_SCRIPT, "sh", root], { encoding: "utf8" });
    const h = parseHeads(out);
    assert.equal(h.get(main), "main");
    assert.equal(h.get(join(root, "ag/shop/worktrees/fix")), "");
    assert.equal(h.size, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
