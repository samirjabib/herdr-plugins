// org-links (mac-workspace odd/tasks/org-link-open.md S4): which Cmd-clicked links go to
// `ws open <url> --cwd <terminal folder>`, and what a ws answer shows. Pure model, no Herdr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wsOpen, toastFor } from "../worktrees/mods/org-links/model.js";

const click = (url, source = {}) => ({
  link: { kind: "url", raw: url, url },
  source: { terminal: "t1", machine: null, cwd: "/Users/me/mac-workspace/cs/shop/main", pane: null, tab: null, space: null, ...source },
});

test("a web link of a local terminal goes to ws open with the terminal's folder", () => {
  assert.deepEqual(wsOpen(click("https://app.fellow.app/oauth?a=1"), "/Users/me"), {
    command: "/Users/me/mac-workspace/bin/ws",
    args: ["open", "https://app.fellow.app/oauth?a=1", "--cwd", "/Users/me/mac-workspace/cs/shop/main"],
    cwd: "/Users/me",
  });
  assert.equal(wsOpen(click("http://localhost:9292"), "/Users/me").args[1], "http://localhost:9292");
});

test("a terminal without a folder still goes to ws open, from home (no org: default browser)", () => {
  assert.deepEqual(wsOpen(click("https://x.test", { cwd: null }), "/Users/me").args, ["open", "https://x.test"]);
});

test("a remote terminal, a file or a non-web link passes to Herdr's usual opener", () => {
  assert.equal(wsOpen(click("https://x.test", { machine: "mini" }), "/Users/me"), null);
  assert.equal(wsOpen({ link: { kind: "file", raw: "a.md", path: "/a.md" }, source: { machine: null, cwd: "/" } }, "/Users/me"), null);
  assert.equal(wsOpen(click("mailto:a@b.c"), "/Users/me"), null);
  assert.equal(wsOpen(null, "/Users/me"), null);
});

test("ws open's answer: a refusal is an error toast with its line, the default browser a note, ego lite silent", () => {
  assert.deepEqual(toastFor({ code: 1, stdout: "", stderr: "x\nws: open: ego lite did not open it (cs); not opened elsewhere\n" }), {
    title: "Link not opened",
    body: "ws: open: ego lite did not open it (cs); not opened elsewhere",
    level: "error",
  });
  assert.deepEqual(toastFor({ code: 0, stdout: "ws open: no org for ~: opened in the default browser\n", stderr: "" }), {
    title: "Opened in the default browser",
    body: "ws open: no org for ~: opened in the default browser",
    level: "info",
  });
  assert.equal(toastFor({ code: 0, stdout: "ws open: opened in ego lite (cs: CS)\n", stderr: "" }), null);
});
