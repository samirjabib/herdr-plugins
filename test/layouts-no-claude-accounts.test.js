// local-39 (Samir 2026-11-25): Collie owns Claude accounts; Herdr's layouts
// no longer draw the claude-accounts usage ("sacar esto de aca? que no esta
// funcionando"). The claude-accounts mod stays installed: its CLI and its
// launcher (bin/claude) are what Collie and the restarts run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const layout = (path) => JSON.parse(readFileSync(repo + path, "utf8"));
const blocks = (node, out = []) => {
  if (node?.content) out.push({ id: node.id, mod: node.content.mod, view: node.content.props?.view ?? null });
  for (const v of Object.values(node ?? {})) if (Array.isArray(v)) for (const c of v) if (c && typeof c === "object") blocks(c, out);
  return out;
};
const mods = (path) => [...new Set(blocks(layout(path)).map((b) => b.mod))];

test("local-39: neither layout draws claude-accounts' usage", () => {
  for (const path of ["worktrees/layouts/collie-sheeps.json", "projects-sidebar/layouts/projects.json"]) {
    assert.equal(mods(path).includes("claude-accounts"), false, path);
  }
});

test("local-39: collie-sheeps' status bar is Herdr's workspace-status in place of the usage's status view", () => {
  const status = blocks(layout("worktrees/layouts/collie-sheeps.json")).filter((b) => b.id?.startsWith("status-"));
  assert.deepEqual(status.map((b) => b.mod), ["workspace-status"]);
});
