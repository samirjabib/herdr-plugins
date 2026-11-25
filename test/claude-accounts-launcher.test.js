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
  // It prints CLAUDE_ACCOUNTS_DIR without spelling the name, so the launcher
  // takes it for Claude Code itself, not for an account-aware wrapper.
  await writeFile(fake, '#!/bin/sh\nprintf "dir=%s\\n" "${CLAUDE_CONFIG_DIR-<unset>}"\nk=ACCOUNTS; eval "v=\\${CLAUDE_${k}_DIR-<unset>}"; printf "accounts=%s\\n" "$v"\nfor a in "$@"; do printf "arg=%s\\n" "$a"; done\n');
  await chmod(fake, 0o755);
  if (active !== undefined) {
    const state = join(dir, ".config/herdr-app/claude-accounts");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "active"), active);
  }
  return { home: dir, realBin };
}

function run({ home, realBin }, env, args = [], path = `${LAUNCHER_DIR}:${realBin}:/usr/bin:/bin`, cwd = undefined) {
  const r = spawnSync(LAUNCHER, args, { cwd, env: { HOME: home, PATH: path, ...env }, encoding: "utf8", timeout: 5000 });
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
  assert.match(r.out, /^accounts=\/profiles\/b\/home$/m);
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

// A mac-workspace checkout in the sandbox HOME, this Mac's host id and alias, and
// the accounts list, for the session name.
async function workspace(s, rel) {
  const dir = join(s.home, "mac-workspace", rel);
  await mkdir(dir, { recursive: true });
  await mkdir(join(s.home, "mac-workspace/hosts"), { recursive: true });
  await writeFile(join(s.home, "mac-workspace/hosts/aliases.tsv"), "# alias\thost-id\nair\tmacbook-air\nmini\tsamirs-mac-mini\n");
  await mkdir(join(s.home, ".config/mac-workspace"), { recursive: true });
  await writeFile(join(s.home, ".config/mac-workspace/host"), "samirs-mac-mini\n");
  await writeFile(join(s.home, ".config/herdr-app/claude-accounts/accounts.json"), JSON.stringify([
    { id: "a", email: "dev@example.com", org: "dev@example.com's Organization", configDir: "/profiles/a/home" },
    { id: "b", email: "me@work.example", org: "Work Org", configDir: "/profiles/b/home" },
  ]));
  return dir;
}
const named = (r) => { const a = r.out.split("\n").filter((l) => l.startsWith("arg=")).map((l) => l.slice(4)); const i = a.indexOf("--name"); return i < 0 ? null : a[i + 1]; };

test("inside Herdr, a session is named Mac · project · worktree · account", async (t) => {
  const s = await sandbox(t, { active: "/profiles/b/home\n" });
  const cwd = await workspace(s, "ag/shop-app/worktrees/pre-order/src");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, cwd)), "mini · shop-app · pre-order · Work Org");
});

test("the main checkout is named main, and a personal org by its email's name", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "personal/tools/main");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, cwd)), "mini · tools · main · dev");
});

test("a switch's restart names the session after the account it switches to", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" }, ["--resume", "x"], undefined, cwd)), "mini · shop-app · main · Work Org");
});

// A transcript of session `sid` under the shared projects folder, its last
// /rename being `title` (as Claude writes it).
async function transcript(s, sid, ...titles) {
  const dir = join(s.home, ".claude/projects/-ws-shop");
  await mkdir(dir, { recursive: true });
  const lines = [{ type: "user", sessionId: sid }, ...titles.map((customTitle) => ({ type: "custom-title", customTitle, sessionId: sid }))];
  await writeFile(join(dir, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
const argsOf = (r) => r.out.split("\n").filter((l) => l.startsWith("arg=")).map((l) => l.slice(4));

test("a resumed session keeps a name given with /rename, through a switch", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  await transcript(s, "sid1", "mini · shop-app · main · dev", "Checkout bug \"v2\"");
  const env = { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" };
  assert.equal(named(run(s, env, ["--resume", "sid1"], undefined, cwd)), 'Checkout bug "v2"');
  assert.equal(named(run(s, env, ["-r", "sid1"], undefined, cwd)), 'Checkout bug "v2"');
});

test("a resumed session whose name is the automatic one gets it again, with the new account", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  await transcript(s, "sid2", "mini · shop-app · main · dev");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" }, ["--resume", "sid2"], undefined, cwd)), "mini · shop-app · main · Work Org");
});

test("on System default (no account in the name) an old automatic name is made again too", async (t) => {
  const s = await sandbox(t, { active: "\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  await transcript(s, "sid4", "mini · shop-app · main · Work Org");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1" }, ["--resume", "sid4"], undefined, cwd)), "mini · shop-app · main");
});

test("Remote Control carries the session's name, so the Claude app shows the same one", async (t) => {
  const s = await sandbox(t, { active: "/profiles/b/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  await transcript(s, "sid3", "Checkout bug");
  const r = run(s, { HC_TERMINAL_ID: "t1" }, ["--remote-control", "--resume", "sid3"], undefined, cwd);
  assert.deepEqual(argsOf(r), ["--name", "Checkout bug", "--remote-control", "Checkout bug", "--resume", "sid3"]);
  // A Remote Control name given by hand stays.
  const own = run(s, { HC_TERMINAL_ID: "t1" }, ["--remote-control", "phone", "--resume", "sid3"], undefined, cwd);
  assert.deepEqual(argsOf(own), ["--name", "Checkout bug", "--remote-control", "phone", "--resume", "sid3"]);
});

test("a name given by hand, or a print run, is left alone", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  for (const args of [["--name", "mine"], ["-n", "mine"], ["--name=mine"], ["-p", "hi"], ["--print", "hi"]]) {
    const r = run(s, { HC_TERMINAL_ID: "t1" }, args, undefined, cwd);
    assert.deepEqual(r.out.split("\n").filter((l) => l.startsWith("arg=")).map((l) => l.slice(4)), args);
  }
});

test("outside a mac-workspace checkout, or outside Herdr, no name is added", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, s.home)), null);
  assert.equal(named(run(s, {}, [], undefined, cwd)), null);
});

test("subcommands, --version and --help get no name: only sessions are named", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  for (const args of [["mcp", "list"], ["update"], ["doctor"], ["--version"], ["-v"], ["--help"], ["-h"]]) {
    const r = run(s, { HC_TERMINAL_ID: "t1" }, args, undefined, cwd);
    assert.deepEqual(r.out.split("\n").filter((l) => l.startsWith("arg=")).map((l) => l.slice(4)), args);
  }
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1" }, ["fix the login bug"], undefined, cwd)), "mini · shop-app · main · dev");
});

test("a backslash in a folder name is kept as is", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/a\\nb/main");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, cwd)), "mini · a\\nb · main · dev");
});

// An account-aware wrapper next on the PATH (like mac-workspace's claude shim,
// which keeps each org on its own accounts).
async function wrapperBin(s) {
  const bin = join(s.home, "wrapper-bin");
  await mkdir(bin);
  await writeFile(join(bin, "claude"), '#!/bin/sh\n# reads CLAUDE_ACCOUNTS_DIR\nprintf "dir=%s\\n" "${CLAUDE_CONFIG_DIR-<unset>}"\nprintf "accounts=%s\\n" "${CLAUDE_ACCOUNTS_DIR-<unset>}"\nfor a in "$@"; do printf "arg=%s\\n" "$a"; done\n');
  await chmod(join(bin, "claude"), 0o755);
  return `${LAUNCHER_DIR}:${bin}:${s.realBin}:/usr/bin:/bin`;
}

test("an account-aware wrapper next on the PATH gets the pick as CLAUDE_ACCOUNTS_DIR; CLAUDE_CONFIG_DIR is left alone", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const path = await wrapperBin(s);
  const fromActive = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: "/mine" }, [], path);
  assert.equal(fromActive.code, 0, fromActive.err);
  assert.match(fromActive.out, /^dir=\/mine$/m);
  assert.match(fromActive.out, /^accounts=\/profiles\/a\/home$/m);
  const fromSwitch = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" }, [], path);
  assert.match(fromSwitch.out, /^dir=<unset>$/m);
  assert.match(fromSwitch.out, /^accounts=\/profiles\/b\/home$/m);
  // The session name leaves the account out: the wrapper picks it.
  const cwd = await workspace(s, "ag/shop-app/main");
  assert.equal(named(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: "/profiles/b/home" }, [], path, cwd)), "mini · shop-app · main");
});

test("--continue and a resume that names no session keep their /rename name: no name is added", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cwd = await workspace(s, "ag/shop-app/main");
  for (const args of [["-c"], ["--continue"], ["--resume"], ["-r"], ["--resume", "--remote-control"]]) {
    assert.deepEqual(argsOf(run(s, { HC_TERMINAL_ID: "t1" }, args, undefined, cwd)), args);
  }
});

test("CLAUDE_ACCOUNTS_HOME moves the state folder the launcher reads", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const moved = join(s.home, "moved");
  await mkdir(moved);
  await writeFile(join(moved, "active"), "/profiles/c/home\n");
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_HOME: moved }).out, /^dir=\/profiles\/c\/home$/m);
});

// group-accounts pins a mac-workspace group to one account's config folder:
// `<group><TAB><config dir>` lines in the state folder's group-accounts file.
async function pinned(s, lines) {
  await writeFile(join(s.home, ".config/herdr-app/claude-accounts/group-accounts"), lines);
}

test("a group pinned in group-accounts runs on its folder, over the active file and a switch's CLAUDE_ACCOUNTS_DIR", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cs = join(s.home, "profiles/cs");
  await mkdir(cs, { recursive: true });
  await pinned(s, `# group\tconfig dir\n\ncs\t${cs}\n`);
  const cwd = await workspace(s, "cs/shop/worktrees/x/src");
  assert.match(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, cwd).out, new RegExp(`^dir=${cs}$`, "m"));
  const sw = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" }, [], undefined, cwd);
  assert.match(sw.out, new RegExp(`^dir=${cs}$`, "m"));
  assert.match(sw.out, /^accounts=<unset>$/m);
  // A wrapper next on the PATH gets the pinned folder as CLAUDE_ACCOUNTS_DIR.
  const path = await wrapperBin(s);
  const w = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "/profiles/b/home" }, [], path, cwd);
  assert.match(w.out, new RegExp(`^accounts=${cs}$`, "m"));
});

test("an unpinned group, a pin to a missing folder, or a folder outside mac-workspace keep the usual pick", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  await pinned(s, `cs\t${join(s.home, "missing")}\n`);
  for (const rel of ["cs/shop/main", "ag/shop-app/main"]) {
    const cwd = await workspace(s, rel);
    assert.match(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, cwd).out, /^dir=\/profiles\/a\/home$/m);
  }
  const outside = join(s.home, "elsewhere");
  await mkdir(outside);
  assert.match(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, outside).out, /^dir=\/profiles\/a\/home$/m);
});

test("outside Herdr a pinned group changes nothing", async (t) => {
  const s = await sandbox(t, { active: "/profiles/a/home\n" });
  const cs = join(s.home, "profiles/cs");
  await mkdir(cs, { recursive: true });
  await pinned(s, `cs\t${cs}\n`);
  const cwd = await workspace(s, "cs/shop/main");
  assert.match(run(s, { CLAUDE_CONFIG_DIR: "/mine" }, [], undefined, cwd).out, /^dir=\/mine$/m);
});

// mac-workspace's harness/claude-profiles.tsv lists each Claude account's org
// (`name<TAB>org<TAB>dir<TAB>default`). In a group folder the launcher never
// hands on an account of another group: personal/ runs only ~/.claude or a
// personal row, cs/ and ag/ only their own (an unlisted folder stays theirs).
async function profiles(s) {
  const p = (n) => join(s.home, "profiles", n);
  for (const n of ["ag", "ag2", "me2"]) await mkdir(p(n), { recursive: true });
  await mkdir(join(s.home, ".claude"), { recursive: true });
  await mkdir(join(s.home, "mac-workspace/harness"), { recursive: true });
  await writeFile(join(s.home, "mac-workspace/harness/claude-profiles.tsv"),
    "name\torg\tdir\tdefault\n# comment\ncs\tcs\t~/.claude\tyes\n" +
    `ag\tag\t${p("ag")}\tyes\nag2\tag\t~/profiles/ag2\tno\nme2\tpersonal\t${p("me2")}/\tno\n`);
  return { ag: p("ag"), ag2: p("ag2"), me2: p("me2"), cs: join(s.home, ".claude") };
}

test("in personal/, an ag or cs pick or inherited CLAUDE_CONFIG_DIR never reaches the wrapper", async (t) => {
  const s = await sandbox(t, { active: "/x\n" });
  const a = await profiles(s);
  await writeFile(join(s.home, ".config/herdr-app/claude-accounts/active"), `${a.ag}\n`);
  const path = await wrapperBin(s);
  const cwd = await workspace(s, "personal/tool/worktrees/w");
  for (const cfg of [a.ag, join(s.home, "profiles/ag2"), "/profiles/unknown/home"]) {
    const r = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: cfg }, [], path, cwd);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^dir=<unset>$/m, cfg);
    assert.match(r.out, /^accounts=<unset>$/m, cfg);
  }
  const sw = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: a.ag2 }, [], path, cwd);
  assert.match(sw.out, /^accounts=<unset>$/m);
  // A personal account, or ~/.claude, is handed on as it is.
  for (const ok of [a.me2, a.cs]) {
    const r = run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: ok, CLAUDE_ACCOUNTS_DIR: ok }, [], path, cwd);
    assert.match(r.out, new RegExp(`^dir=${ok}$`, "m"));
    assert.match(r.out, new RegExp(`^accounts=${ok}$`, "m"));
  }
});

test("without a wrapper, a pick of another group falls back to the group's default account", async (t) => {
  const s = await sandbox(t, { active: "/x\n" });
  const a = await profiles(s);
  await writeFile(join(s.home, ".config/herdr-app/claude-accounts/active"), `${a.ag}\n`);
  const personal = await workspace(s, "personal/tool/main");
  assert.match(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, personal).out, /^dir=<unset>$/m);
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: a.me2 }, [], undefined, personal).out, new RegExp(`^dir=${a.me2}$`, "m"));
  const cs = await workspace(s, "cs/shop/main");
  assert.match(run(s, { HC_TERMINAL_ID: "t1" }, [], undefined, cs).out, /^dir=<unset>$/m);
  const ag = await workspace(s, "ag/shop-app/main");
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: "" }, [], undefined, ag).out, new RegExp(`^dir=${a.ag}$`, "m"));
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_ACCOUNTS_DIR: a.ag2 }, [], undefined, ag).out, new RegExp(`^dir=${a.ag2}$`, "m"));
});

test("in cs/ and ag/, an inherited CLAUDE_CONFIG_DIR of the other org is dropped; their own and unlisted ones stay", async (t) => {
  const s = await sandbox(t, { active: "/x\n" });
  const a = await profiles(s);
  const path = await wrapperBin(s);
  const cs = await workspace(s, "cs/shop/main");
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: a.ag }, [], path, cs).out, /^dir=<unset>$/m);
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: "/profiles/x/home" }, [], path, cs).out, /^dir=\/profiles\/x\/home$/m);
  const ag = await workspace(s, "ag/shop-app/main");
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: a.cs }, [], path, ag).out, /^dir=<unset>$/m);
  assert.match(run(s, { HC_TERMINAL_ID: "t1", CLAUDE_CONFIG_DIR: a.ag2 }, [], path, ag).out, new RegExp(`^dir=${a.ag2}$`, "m"));
  // Outside Herdr nothing changes.
  assert.match(run(s, { CLAUDE_CONFIG_DIR: a.cs }, [], path, ag).out, new RegExp(`^dir=${a.cs}$`, "m"));
});
