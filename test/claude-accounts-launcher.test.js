// The `claude` launcher (mods/claude-accounts/bin/claude): inside Herdr it
// starts Claude on CLAUDE_ACCOUNTS_DIR (a switch's restart line) or else on the
// first line of the `active` file, then runs the next `claude` on the PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LAUNCHER_DIR = fileURLToPath(new URL("../claude-accounts/mods/claude-accounts/bin", import.meta.url));
const LAUNCHER = join(LAUNCHER_DIR, "claude");

// A scratch HOME with a fake real `claude` that prints what it got.
async function sandbox(t, { active } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "claude-launcher-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const realBin = join(dir, "real-bin");
  await mkdir(realBin);
  const fake = join(realBin, "claude");
  await writeFile(fake, '#!/bin/sh\nprintf "dir=%s\\n" "${CLAUDE_CONFIG_DIR-<unset>}"\nprintf "accounts=%s\\n" "${CLAUDE_ACCOUNTS_DIR-<unset>}"\nfor a in "$@"; do printf "arg=%s\\n" "$a"; done\n');
  await chmod(fake, 0o755);
  if (active !== undefined) {
    const state = join(dir, ".config/herdr-app/claude-accounts");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "active"), active);
  }
  return { home: dir, realBin };
}

function run({ home, realBin }, env, args = [], path = `${LAUNCHER_DIR}:${realBin}:/usr/bin:/bin`) {
  const r = spawnSync(LAUNCHER, args, { env: { HOME: home, PATH: path, ...env }, encoding: "utf8", timeout: 5000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("inside Herdr, a new Claude runs on the active account's folder", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const r = run(s, { HC_TERMINAL_ID: "t1" });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^dir=\/profiles\/a\/home$/m);
});

test("a switch's CLAUDE_ACCOUNTS_DIR wins over the active file and is not passed on", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const r = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" });
  assert.match(r.out, /^dir=\/profiles\/b\/home$/m);
  assert.match(r.out, /^accounts=<unset>$/m);
});

test("an empty CLAUDE_ACCOUNTS_DIR means System default: CLAUDE_CONFIG_DIR is unset", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const r = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "", CLAUDE_CONFIG_DIR: "/stale" });
  assert.match(r.out, /^dir=<unset>$/m);
});

test("an empty active file means System default", async (t) => {
  const s = await sandbox(t, { active: "\n" });
  const r = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: "/stale" });
  assert.match(r.out, /^dir=<unset>$/m);
});

test("with no active file, the environment is left as it is", async (t) => {
  const s = await sandbox(t);
  const r = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: "/mine" });
  assert.match(r.out, /^dir=\/mine$/m);
});

test("outside Herdr, nothing changes, even with CLAUDE_ACCOUNTS_DIR set", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const r = run(s, { CLAUDE_CONFIG_DIR: "/mine", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" });
  assert.match(r.out, /^dir=\/mine$/m);
});

test("arguments reach the real claude exactly, spaces and quotes included", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const r = run(s, { HC_TERMINAL_ID: "t1" }, ["--dangerously-skip-permissions", "--resume", "id 1", "it's"]);
  assert.deepEqual(r.out.split("\n").filter((l) => l.startsWith("arg=")), ["arg=--dangerously-skip-permissions", "arg=--resume", "arg=id 1", "arg=it's"]);
});

test("the launcher skips itself on the PATH, even listed twice, and finds the real claude", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const r = run(s, { HC_TERMINAL_ID: "t1" }, [], `${LAUNCHER_DIR}:${LAUNCHER_DIR}/:${s.realBin}:/usr/bin:/bin`);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^dir=\/profiles\/a\/home$/m);
});

test("with no other claude on the PATH it fails with a message instead of looping", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const r = run(s, { HC_TERMINAL_ID: "t1" }, [], `${LAUNCHER_DIR}:/usr/bin:/bin`);
  assert.equal(r.code, 127);
  assert.match(r.err, /no claude found on the PATH/);
});
