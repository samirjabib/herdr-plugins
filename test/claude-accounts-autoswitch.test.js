// claude-accounts: switching safely (odd/tasks/claude-accounts-switching.md
// T1, S1-S3). The automatic switch's eligibility and its choice (pure,
// cli/autoswitch.mjs), the CLI end to end (the setting, the check that runs
// with every `usage`, the owner's exclusion, the record the footer tells),
// and what the mod says: the "API · pay per use" tag, the confirmation before
// a switch to such an account by hand, the setting's row and the toasts.
//
// CLI runs are the installed bin inside a sandbox of its own (HOME and
// CLAUDE_ACCOUNTS_HOME are tmp folders, `security` and `hc` are shims that
// fail, the usage endpoint is a dead port), and usage-state.json is seeded
// with fresh numbers that aren't due, so no run reads anything.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readAccounts, readSettings } from "../claude-accounts/mods/claude-accounts/store.js";
import { accountsModel } from "../claude-accounts/mods/claude-accounts/accounts-model.js";
import { panelModel, footerModel, popupModel } from "../claude-accounts/mods/claude-accounts/footer-model.js";
import { react } from "../claude-accounts/mods/claude-accounts/toasts.js";
import {
  PAY_PER_USE_TAG, isPayPerUse, payPerUsePrompt, autoSwitchSetting, readAutoSwitch, autoSwitchToast,
} from "../claude-accounts/mods/claude-accounts/switch-model.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const MOD = join(repo, "claude-accounts/mods/claude-accounts");
const BIN = join(MOD, "bin/claude-accounts");
const { isAutoSwitchEligible, pickAutoSwitch, SWITCH_LINE } = await import(pathToFileURL(join(MOD, "cli/autoswitch.mjs")).href);

const fixture = (name) => readFileSync(new URL(`fixtures/claude-accounts/${name}`, import.meta.url), "utf8");

const NOW = 1794000000000;
const MIN = 60_000;
const HOUR = 60 * MIN;

// ── The pure rule (S1, S2) ─────────────────────────────────────────────────

const w = (percent, resetsAt = NOW + HOUR) => ({ percent, resetsAt });
// An account as accounts.v1.json has it, read fresh a minute ago.
function acct(id, plan, session, weekly, extra = {}) {
  return {
    id, label: `${id}@example.com`, email: `${id}@example.com`, org: `${id} org`, plan, configDir: `/x/${id}`, isDefault: false,
    needsSignIn: false, error: null, errorDetail: null,
    usage: { session: session === null ? null : w(session), weekly: weekly === null ? null : w(weekly), fable: null, monthly: null },
    credits: null, usageUpdatedAt: NOW - MIN, lastAuthenticatedAt: 1, duplicateOf: null, signedInAs: null, ...extra,
  };
}
const docOf = (active, ...accounts) => ({ version: 1, updatedAt: NOW, active, accounts });

test("S1: only a Max or Pro subscription is eligible; Enterprise, Team, no plan and an excluded account never are", () => {
  for (const plan of ["Max 5x", "Max 20x", "Max", "Pro"]) assert.equal(isAutoSwitchEligible(acct("a", plan, 0, 0)), true, plan);
  for (const plan of ["Enterprise", "Team", null, "Something new"]) assert.equal(isAutoSwitchEligible(acct("a", plan, 0, 0)), false, String(plan));
  assert.equal(isAutoSwitchEligible(acct("a", "Max 5x", 0, 0), { excluded: ["a"] }), false, "the owner's exclusion");
  assert.equal(isAutoSwitchEligible(acct("a", "Max 5x", 0, 0), { excluded: ["b"] }), true);
});

test("S2: an account nobody runs (expired token, old numbers) is still a target: its last numbers count, a window past its reset counts as empty", () => {
  const stale = { error: "expired", usageUpdatedAt: NOW - 12 * HOUR };
  const resetPast = (id, pct) => acct(id, "Max 5x", null, null, { ...stale, usage: { session: { percent: pct, resetsAt: NOW - HOUR }, weekly: w(10, NOW + 3 * 24 * HOUR), fable: null, monthly: null } });
  // The other Max was last read 12 h ago at 3% weekly: it is chosen.
  let d = pickAutoSwitch(docOf("m1", acct("m1", "Max 5x", 97, 40), acct("m2", "Max 5x", 0, 3, stale)), { now: NOW });
  assert.deepEqual([d.action, d.to], ["switch", "m2"]);
  // Its 5h window was at 99% but has reset since: it counts as empty.
  d = pickAutoSwitch(docOf("m1", acct("m1", "Max 5x", 97, 40), resetPast("m2", 99)), { now: NOW });
  assert.deepEqual([d.action, d.to], ["switch", "m2"]);
  // Fresh numbers win a tie on room over old ones.
  d = pickAutoSwitch(docOf("m1", acct("m1", "Max 5x", 97, 40), acct("old", "Max 5x", 0, 10, stale), acct("new", "Max 5x", 0, 10)), { now: NOW });
  assert.equal(d.to, "new");
  // Not signed in as itself: never a target, and Enterprise stays out however old its numbers.
  for (const extra of [{ needsSignIn: true }, { needsSignIn: true, signedInAs: "x@example.com" }]) {
    d = pickAutoSwitch(docOf("m1", acct("m1", "Max 5x", 97, 40), acct("m2", "Max 5x", 0, 0, { ...stale, ...extra }), acct("ent", "Enterprise", 0, 0, stale)), { now: NOW });
    assert.equal(d.action, "stay", JSON.stringify(extra));
  }
});

test("S1: Enterprise is never chosen, even when it is the only account with room: the switch stays and says why", () => {
  const doc = docOf("max1", acct("max1", "Max 5x", 96, 40), acct("max2", "Max 20x", 99, 50), acct("ent", "Enterprise", 0, 0), acct("team", "Team", 1, 1));
  const d = pickAutoSwitch(doc, { now: NOW });
  assert.equal(d.action, "stay");
  assert.equal(d.from, "max1");
  assert.equal(d.window, "session");
  assert.equal(d.percent, 96);
});

test("S2: at the line on 5h or weekly it picks the eligible account with the most headroom, across any number of Max accounts", () => {
  assert.equal(SWITCH_LINE, 95);
  const doc = docOf("m1",
    acct("m1", "Max 5x", 40, 95),
    acct("m2", "Max 5x", 70, 20),
    acct("m3", "Max 20x", 10, 30),
    acct("m4", "Pro", 50, 50),
    acct("ent", "Enterprise", 0, 0));
  const d = pickAutoSwitch(doc, { now: NOW });
  assert.deepEqual([d.action, d.from, d.to, d.window, d.percent], ["switch", "m1", "m3", "weekly", 95]);
  // Excluded by the owner: the next one with the most room.
  assert.equal(pickAutoSwitch(doc, { now: NOW, excluded: ["m3"] }).to, "m4");
  // Under the line: nothing happens.
  assert.equal(pickAutoSwitch(docOf("m1", acct("m1", "Max 5x", 94, 94), acct("m3", "Max", 0, 0)), { now: NOW }).action, "none");
});

test("S2: a signed-out or full candidate is skipped, old or failed numbers still count, and a stale active account never moves", () => {
  const candidates = [
    acct("out", "Max", 0, 0, { needsSignIn: true }),
    acct("full", "Max", 10, 97),
  ];
  const stuck = pickAutoSwitch(docOf("m1", acct("m1", "Max", 100, 10), ...candidates), { now: NOW });
  assert.equal(stuck.action, "stay");
  for (const extra of [{ usageUpdatedAt: NOW - 31 * MIN }, { error: "network" }, { usageUpdatedAt: null }]) {
    const d = pickAutoSwitch(docOf("m1", acct("m1", "Max", 100, 10), ...candidates, acct("aged", "Max", 20, 20, extra)), { now: NOW });
    assert.equal(d.to, "aged", JSON.stringify(extra));
  }
  const ok = pickAutoSwitch(docOf("m1", acct("m1", "Max", 100, 10), ...candidates, acct("good", "Max", 80, 80)), { now: NOW });
  assert.equal(ok.to, "good");
  for (const patch of [{ usageUpdatedAt: NOW - 31 * MIN }, { error: "rateLimited" }, { needsSignIn: true }]) {
    const d = pickAutoSwitch(docOf("m1", acct("m1", "Max", 100, 10, patch), acct("good", "Max", 0, 0)), { now: NOW });
    assert.equal(d.action, "none", JSON.stringify(patch));
  }
});

test("S2: no flapping: once switched, the new account under the line stays; the old one comes back only after its window resets", () => {
  const m1Full = acct("m1", "Max", 98, 10);
  const m2 = acct("m2", "Max", 30, 30);
  assert.equal(pickAutoSwitch(docOf("m1", m1Full, m2), { now: NOW }).to, "m2");
  // After the switch: m2 is active and under the line, m1 still full. Nothing.
  assert.equal(pickAutoSwitch(docOf("m2", m1Full, m2), { now: NOW }).action, "none");
  // m2 fills up while m1's 5h window hasn't reset: stay, never back to a full one.
  const m2Full = acct("m2", "Max", 96, 30);
  assert.equal(pickAutoSwitch(docOf("m2", m1Full, m2Full), { now: NOW }).action, "stay");
  // m1's window reset (the contract drops a past window: null): it has room again.
  const m1Reset = acct("m1", "Max", null, 10);
  assert.equal(pickAutoSwitch(docOf("m2", m1Reset, m2Full), { now: NOW }).to, "m1");
});

test("S2: a pay-per-use active account, System default and the same login are never switched from or to automatically", () => {
  // Chosen by hand: the owner is on Enterprise on purpose.
  assert.equal(pickAutoSwitch(docOf("ent", acct("ent", "Enterprise", 99, 99), acct("m1", "Max", 0, 0)), { now: NOW }).action, "none");
  const def = acct("default", "Max", 0, 0, { isDefault: true, configDir: null, label: "System default" });
  assert.equal(pickAutoSwitch(docOf("m1", acct("m1", "Max", 99, 0), def), { now: NOW }).action, "stay", "System default isn't a target");
  const twin = acct("twin", "Max", 0, 0, { email: "m1@example.com", org: "m1 org" });
  assert.equal(pickAutoSwitch(docOf("m1", acct("m1", "Max", 99, 0), twin), { now: NOW }).action, "stay", "the same login isn't another account");
});

test("S2: an account at its org's monthly spend limit moves off whatever its plan, and is never a target", () => {
  const spent = (a) => ({ ...a, usage: { ...a.usage, monthly: { percent: 100, resetsAt: null } } });
  // samir@coldsmoke.co: a Team seat under its plan windows, blocked by the org's spend limit.
  const team = spent(acct("team", "Team", 40, 91));
  const d = pickAutoSwitch(docOf("team", team, acct("m1", "Max", 10, 20)), { now: NOW });
  assert.deepEqual([d.action, d.to, d.window, d.percent], ["switch", "m1", "monthly", 100]);
  const max = spent(acct("m1", "Max", 10, 20));
  assert.equal(pickAutoSwitch(docOf("m1", max, acct("m2", "Max", 50, 50)), { now: NOW }).to, "m2", "a Max at the limit moves too");
  const full = pickAutoSwitch(docOf("m1", acct("m1", "Max", 99, 0), spent(acct("m2", "Max", 0, 0))), { now: NOW });
  assert.equal(full.action, "stay", "a spend-limited account has no room");
  // Under its limit a Team or Enterprise account still stays where the owner put it.
  assert.equal(pickAutoSwitch(docOf("team", acct("team", "Team", 99, 99), acct("m1", "Max", 0, 0)), { now: NOW }).action, "none");
});

test("S2: the active saved account borrows System default's fresher numbers for the same login, as the footer shows them", () => {
  const stale = acct("m1", "Max", 10, 10, { usageUpdatedAt: NOW - 2 * HOUR });
  const def = acct("default", "Max", 97, 10, { isDefault: true, configDir: null, duplicateOf: "m1" });
  const d = pickAutoSwitch(docOf("m1", stale, def, acct("m2", "Max", 0, 0)), { now: NOW });
  assert.deepEqual([d.action, d.to, d.percent], ["switch", "m2", 97]);
});

// ── The CLI end to end (S1, S2) ────────────────────────────────────────────

const root = realpathSync(mkdtempSync(join(tmpdir(), "claude-accounts-autoswitch-")));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

let n = 0;
function sandbox({ workspace = false } = {}) {
  const box = join(root, String(++n));
  const home = join(box, "home");
  const state = join(box, "state");
  const shims = join(box, "bin");
  for (const dir of [home, state, shims]) mkdirSync(dir, { recursive: true });
  for (const [name, code] of [["security", 44], ["hc", 1], ["claude-usage", 1], ["open", 1]]) {
    writeFileSync(join(shims, name), `#!/bin/sh\nexit ${code}\n`);
    chmodSync(join(shims, name), 0o755);
  }
  const env = {
    HOME: home,
    USER: "tester",
    PATH: [shims, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    TMPDIR: box,
    CLAUDE_ACCOUNTS_HOME: state,
    CLAUDE_ACCOUNTS_USAGE_URL: "http://127.0.0.1:9/api/oauth/usage",
    CLAUDE_ACCOUNTS_USAGE_BIN: join(shims, "claude-usage"),
    // A mac-workspace of its own when the test lists org rows (S1).
    ...(workspace ? { CLAUDE_ACCOUNTS_WORKSPACE: join(box, "ws") } : {}),
  };
  const cli = (args) => {
    const r = spawnSync(BIN, args, { env, encoding: "utf8", timeout: 30000 });
    if (r.error) throw r.error;
    return r;
  };
  const read = (name) => readFileSync(join(state, name), "utf8");
  return { box, home, state, cli, read };
}

// Saved accounts, each signed in with its plan, and fresh numbers that
// aren't due: [{ id, type, tier?, session, weekly }].
function accounts(s, list, active) {
  const now = Date.now();
  const registry = [];
  const usage = {};
  for (const a of list) {
    const email = `${a.id.slice(0, 4)}@example.com`;
    const orgUuid = `${a.id.slice(0, 8)}-0000-4000-8000-000000000000`;
    const configDir = join(s.box, a.id, "home");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, ".claude.json"), JSON.stringify({
      oauthAccount: { emailAddress: email, organizationName: "Org", organizationUuid: orgUuid, organizationType: a.type, ...(a.tier ? { organizationRateLimitTier: a.tier } : {}) },
    }));
    registry.push({ id: a.id, email, org: "Org", orgUuid, configDir, lastAuthenticatedAt: 1, source: "herdr", ...(a.extra ?? {}) });
    usage[a.id] = {
      usage: { session: { percent: a.session, resetsAt: now + HOUR }, weekly: { percent: a.weekly, resetsAt: now + 48 * HOUR }, fable: null, monthly: null },
      credits: null, source: "fetch", usageUpdatedAt: now - MIN, checkedAt: now, error: null, errorDetail: null, needsSignIn: false,
      failureStreak: 0, retryAt: null, liveAt: null, claim: null, login: { email, orgUuid },
    };
  }
  writeFileSync(join(s.state, "accounts.json"), JSON.stringify(registry));
  writeFileSync(join(s.state, "active"), registry.find((r) => r.id === active)?.configDir ?? "");
  writeFileSync(join(s.state, "settings.json"), JSON.stringify({ switchMode: "keep" }));
  writeFileSync(join(s.state, "usage-state.json"), JSON.stringify({ version: 1, accounts: usage }));
  return Object.fromEntries(registry.map((r) => [r.id, r.configDir]));
}

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const ENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MAX = "claude_max";
const ENTERPRISE = "claude_enterprise";

const usageOk = (s) => {
  const r = s.cli(["usage", "--json"]);
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

test("settings: autoSwitch is Off by default, sets on and off, keeps the other settings, and refuses anything else", () => {
  const s = sandbox();
  accounts(s, [], null);
  assert.deepEqual(JSON.parse(s.cli(["settings", "--json"]).stdout), { switchMode: "keep", remoteControl: "off", autoSwitch: "off" });
  s.cli(["settings", "set", "remoteControl", "on"]);
  const set = s.cli(["settings", "set", "autoSwitch", "on", "--json"]);
  assert.equal(set.status, 0, set.stderr);
  assert.deepEqual(JSON.parse(set.stdout), { autoSwitch: "on" });
  assert.deepEqual(JSON.parse(s.read("settings.json")), { switchMode: "keep", remoteControl: "on", autoSwitch: "on" });
  assert.equal(s.cli(["settings", "set", "autoSwitch", "yes"]).status, 64);
  assert.deepEqual(JSON.parse(s.cli(["settings", "--json"]).stdout), { switchMode: "keep", remoteControl: "on", autoSwitch: "on" });
});

test("usage with autoSwitch on: the active Max account at 96% moves to the Max with the most room, through `use`, once", () => {
  const s = sandbox();
  const dirs = accounts(s, [
    { id: M1, type: MAX, tier: "default_claude_max_5x", session: 96, weekly: 40 },
    { id: M2, type: MAX, session: 60, weekly: 60 },
    { id: M3, type: MAX, tier: "default_claude_max_20x", session: 20, weekly: 30 },
    { id: ENT, type: ENTERPRISE, session: 0, weekly: 0 },
  ], M1);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  const doc = usageOk(s);
  assert.equal(s.read("active"), dirs[M3], "the active file `use` writes");
  assert.equal(doc.active, M3, "the printed document has the new active account");
  const record = JSON.parse(s.read("auto-switch.json"));
  assert.deepEqual([record.state, record.from, record.to, record.window, record.percent], ["switched", M1, M3, "session", 96]);
  // Idempotent: the next poll changes nothing.
  const before = s.read("auto-switch.json");
  usageOk(s);
  assert.equal(s.read("active"), dirs[M3]);
  assert.equal(s.read("auto-switch.json"), before);
});

test("usage with autoSwitch on and only Enterprise with room: it stays, and records that once", () => {
  const s = sandbox();
  const dirs = accounts(s, [
    { id: M1, type: MAX, session: 99, weekly: 40 },
    { id: M2, type: MAX, session: 10, weekly: 97 },
    { id: ENT, type: ENTERPRISE, session: 0, weekly: 0 },
  ], M1);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  usageOk(s);
  assert.equal(s.read("active"), dirs[M1], "never Enterprise");
  const record = JSON.parse(s.read("auto-switch.json"));
  assert.deepEqual([record.state, record.from, record.window, record.percent], ["stuck", M1, "session", 99]);
  const before = s.read("auto-switch.json");
  usageOk(s);
  assert.equal(s.read("auto-switch.json"), before, "said once, not every poll");
});

test("usage with autoSwitch Off (the default) never switches; an excluded account is never picked", () => {
  const s = sandbox();
  const dirs = accounts(s, [
    { id: M1, type: MAX, session: 99, weekly: 40 },
    { id: M2, type: MAX, session: 0, weekly: 0 },
    { id: M3, type: MAX, session: 50, weekly: 50 },
  ], M1);
  usageOk(s);
  assert.equal(s.read("active"), dirs[M1], "Off by default");
  assert.equal(existsSync(join(s.state, "auto-switch.json")), false);

  const ex = s.cli(["auto-switch", "exclude", M2, "--json"]);
  assert.equal(ex.status, 0, ex.stderr);
  assert.deepEqual(JSON.parse(ex.stdout), { id: M2, excluded: true });
  assert.equal(JSON.parse(s.read("accounts.json")).find((a) => a.id === M2).excludeFromAutoSwitch, true);
  assert.equal(s.cli(["auto-switch", "exclude", "no-such-id"]).status, 7);
  assert.equal(s.cli(["auto-switch", "exclude", "default"]).status, 64);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  const check = s.cli(["auto-switch", "check", "--json"]);
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual([JSON.parse(check.stdout).action, JSON.parse(check.stdout).to], ["switch", M3]);
  assert.equal(s.read("active"), dirs[M3], "M2 has more room, but the owner excluded it");

  const inc = s.cli(["auto-switch", "include", M2, "--json"]);
  assert.deepEqual(JSON.parse(inc.stdout), { id: M2, excluded: false });
  assert.equal(JSON.parse(s.read("accounts.json")).find((a) => a.id === M2).excludeFromAutoSwitch, undefined);
});

test("existing behavior holds: `use` still switches by hand (Enterprise too) and settings keep switchMode and remoteControl", () => {
  const s = sandbox();
  const dirs = accounts(s, [{ id: M1, type: MAX, session: 10, weekly: 10 }, { id: ENT, type: ENTERPRISE, session: 0, weekly: 0 }], M1);
  s.cli(["settings", "set", "switchMode", "restart"]);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  const r = s.cli(["use", ENT, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { from: M1, to: ENT, switchMode: "restart" });
  assert.equal(s.read("active"), dirs[ENT]);
  // Chosen by hand: the auto-switch leaves a pay-per-use account alone.
  usageOk(s);
  assert.equal(s.read("active"), dirs[ENT]);
  assert.deepEqual(JSON.parse(s.cli(["settings", "--json"]).stdout), { switchMode: "restart", remoteControl: "off", autoSwitch: "on" });
});

// ── What the mod says (S2, S3) ─────────────────────────────────────────────

const ANA = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BEN = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
// usageBased: the ids whose usage has no 5-hour or weekly window (a
// usage-based Enterprise or Team login, plans.js billsPerUse).
function fixtureDoc(plans, usageBased = []) {
  const raw = JSON.parse(fixture("accounts.v1.json"));
  raw.accounts = raw.accounts.map((a) => ({ ...a, plan: plans[a.id] ?? null, ...(usageBased.includes(a.id) ? { usage: { session: null, weekly: null, fable: null, monthly: null } } : {}) }));
  return readAccounts(JSON.stringify(raw));
}

test("S3: Enterprise and Team with no 5h or weekly window are pay per use; Max, Pro and no plan aren't", () => {
  assert.equal(PAY_PER_USE_TAG, "API · pay per use");
  for (const plan of ["Enterprise", "Team"]) assert.equal(isPayPerUse({ plan }), true, plan);
  for (const plan of ["Max 5x", "Max", "Pro", null]) assert.equal(isPayPerUse({ plan }), false, String(plan));
  assert.equal(isPayPerUse(null), false);
});

test("S3: Manage Accounts tags a pay-per-use row after its plan, and the panel's row has the tag", () => {
  const doc = fixtureDoc({ [ANA]: "Max 5x", [BEN]: "Enterprise" }, [BEN]);
  const m = accountsModel({ accounts: doc, settings: readSettings(fixture("settings.json")) });
  assert.deepEqual(m.rows.map((r) => r.badges), [["Max 5x", "This device", "Active"], ["Enterprise", "API · pay per use", "This device"]]);
  const p = panelModel({ doc, now: NOW });
  const ben = p.rows.find((r) => r.id === BEN);
  assert.equal(ben.tag, "API · pay per use");
  assert.equal(ben.payPerUse, true);
  const max = panelModel({ doc: fixtureDoc({ [BEN]: "Max 5x" }), now: NOW }).rows.find((r) => r.id === BEN);
  assert.equal(max.tag, null);
  assert.equal(max.payPerUse, false);
});

test("S3: switching to a pay-per-use account by hand asks first, and the copy names the cost per the restart setting", () => {
  const ent = { id: BEN, email: "ben@example.org", plan: "Enterprise" };
  const restart = payPerUsePrompt(ent, { switchMode: "restart" });
  assert.deepEqual(restart, {
    title: "Switch to ben@example.org?",
    body: "ben@example.org is billed per use through the API, not by a subscription. New Claudes start on it, and the Claude sessions running now restart on it, so they're billed per use too.",
    cancel: "Cancel",
    confirm: "Switch to pay per use",
  });
  assert.equal(payPerUsePrompt(ent, { switchMode: "ask" }).body,
    "ben@example.org is billed per use through the API, not by a subscription. New Claudes start on it, and you pick which running sessions move to it.");
  assert.equal(payPerUsePrompt(ent, { switchMode: "keep" }).body,
    "ben@example.org is billed per use through the API, not by a subscription. New Claudes start on it; the sessions running now stay on their account.");
  // One session (T2's move): only that terminal's Claude.
  assert.deepEqual(payPerUsePrompt(ent, { scope: "session" }), {
    title: "Move this session to ben@example.org?",
    body: "ben@example.org is billed per use through the API, not by a subscription. This terminal's Claude restarts on it; the other sessions stay where they are.",
    cancel: "Cancel",
    confirm: "Move to pay per use",
  });
  // Max asks nothing.
  assert.equal(payPerUsePrompt({ id: ANA, email: "ana@example.com", plan: "Max 5x" }, { switchMode: "restart" }), null);
});

test("S2: the setting's row in Manage Accounts, Off by default", () => {
  const off = autoSwitchSetting(readSettings(fixture("settings.json")));
  assert.deepEqual(off, {
    title: "Switch accounts automatically when one runs out",
    description: "At 95% of the 5-hour or weekly limit, Herdr moves to the Max or Pro account with the most room left. Never to an API · pay per use account.",
    value: "off",
    valueLabel: "Off",
    options: [{ value: "on", label: "On", selected: false }, { value: "off", label: "Off", selected: true }],
  });
  assert.equal(autoSwitchSetting(readSettings('{"autoSwitch":"on"}')).valueLabel, "On");
  assert.equal(autoSwitchSetting(readSettings('{"autoSwitch":"sometimes"}')).value, "off");
  const m = accountsModel({ accounts: fixtureDoc({}), settings: readSettings('{"autoSwitch":"on"}') });
  assert.equal(m.autoSwitch.value, "on");
});

test("S2: the footer says an automatic switch, and that none had room, once each", () => {
  const doc = fixtureDoc({});
  const switched = readAutoSwitch(JSON.stringify({ state: "switched", from: ANA, to: BEN, at: NOW - MIN, window: "session", percent: 96 }));
  const r = react({ accounts: doc, now: NOW, autoSwitch: switched }, {});
  assert.deepEqual(r.notify, [{ title: "Switched to ben@example.org automatically", body: "ana@example.com reached 96% of its 5-hour limit.", level: "info" }]);
  assert.deepEqual(react({ accounts: doc, now: NOW, autoSwitch: switched }, r.seen).notify, [], "once");

  const stuck = readAutoSwitch(JSON.stringify({ state: "stuck", from: ANA, at: NOW - MIN, window: "weekly", percent: 98, resetsAt: NOW + HOUR }));
  assert.deepEqual(react({ accounts: doc, now: NOW, autoSwitch: stuck }, {}).notify, [{
    title: "ana@example.com reached 98% of its weekly limit",
    body: "No other Max or Pro account has room, so it stays on ana@example.com.",
    level: "warning",
  }]);
  // Old news (a Herdr restart) is marked seen without a word; junk reads null.
  assert.deepEqual(react({ accounts: doc, now: NOW + 60 * MIN, autoSwitch: switched }, {}).notify, []);
  assert.equal(readAutoSwitch("not json"), null);
  assert.equal(readAutoSwitch(JSON.stringify({ state: "other" })), null);
});

// ── S5: a pay-per-use account shows "API usage", never percentages ─────────

test("S5: a pay-per-use row in the panel has no bars, just API usage; a Max row keeps its bars", () => {
  const doc = fixtureDoc({ [BEN]: "Enterprise" }, [BEN]);
  const ben = panelModel({ doc, now: NOW }).rows.find((r) => r.id === BEN);
  assert.deepEqual([ben.bars, ben.status], [[], "API usage"]);
  const max = panelModel({ doc: fixtureDoc({ [BEN]: "Max 5x" }), now: NOW }).rows.find((r) => r.id === BEN);
  assert.ok(max.bars.length > 0, "a subscription keeps its bars");
  assert.equal(max.status, null);
});

test("S5: an active pay-per-use account: the card, the footer and the popover say API usage, with no number", () => {
  const raw = JSON.parse(fixture("accounts.v1.json"));
  raw.active = BEN;
  raw.accounts = raw.accounts.map((a) => (a.id === BEN
    ? { ...a, plan: "Team", needsSignIn: false, error: null, usage: { session: null, weekly: null, fable: null, monthly: { percent: 0, resetsAt: NOW + HOUR } }, credits: { balance: 5, limit: 10 } }
    : a));
  const doc = readAccounts(JSON.stringify(raw));
  const card = panelModel({ doc, now: NOW }).card;
  assert.deepEqual([card.label, card.windows, card.credits, card.notice], ["ben@example.org", [], null, { label: null, message: "API usage" }]);
  for (const width of [1000, 200, 40]) {
    const f = footerModel({ doc, width, now: NOW });
    assert.equal(f.kind, "api", `width ${width}`);
    assert.deepEqual([f.sections, f.bar, f.label, f.warning], [[], null, { text: "API usage", color: "muted" }, false], `width ${width}`);
  }
  const row = popupModel({ doc, now: NOW }).row;
  assert.deepEqual([row.kind, row.status, row.metrics], ["api", "API usage", []]);
  // Signed out: signing in comes first, as for any account.
  raw.accounts = raw.accounts.map((a) => (a.id === BEN ? { ...a, needsSignIn: true } : a));
  assert.equal(footerModel({ doc: readAccounts(JSON.stringify(raw)), width: 1000, now: NOW }).kind, "signIn");
});

// ── One active account per org (odd/tasks/autoswitch-orgs.md S1) ──────────

const ORGS_MJS = pathToFileURL(join(MOD, "cli/orgs.mjs")).href;
const { parseProfiles, poolOf, orgOfCwd, effectiveActives } = await import(ORGS_MJS);

test("S1: the tsv's rows give each org its pool; personal is every listed account and System default", () => {
  const env = { HOME: "/Users/me" };
  const rows = parseProfiles([
    "name\torg\tdir\tdefault",
    "# a comment",
    "cs\tcs\t~/.claude\tyes",
    "ag\tag\t~/.claude-profiles/ag\tyes",
    "u\tag\t/abs/u/home\tno",
    "odd\tnowhere\t/x\tno",
    "",
  ].join("\n"), env);
  assert.deepEqual(rows, [
    { name: "cs", org: "cs", dir: "/Users/me/.claude" },
    { name: "ag", org: "ag", dir: "/Users/me/.claude-profiles/ag" },
    { name: "u", org: "ag", dir: "/abs/u/home" },
  ]);
  const accounts = [
    { id: "default", isDefault: true, configDir: null },
    { id: "a1", isDefault: false, configDir: "/Users/me/.claude-profiles/ag" },
    { id: "a2", isDefault: false, configDir: "/abs/u/home" },
    { id: "x", isDefault: false, configDir: "/elsewhere/home" },
  ];
  assert.deepEqual([...poolOf("cs", accounts, rows, env)], ["default"]);
  assert.deepEqual([...poolOf("ag", accounts, rows, env)], ["a1", "a2"]);
  assert.deepEqual([...poolOf("personal", accounts, rows, env)], ["default", "a1", "a2"], "an unlisted folder is no one's");
});

test("S1: a terminal's org is the first folder under the workspace root, the org folder itself included; anything else has none", async () => {
  const env = { CLAUDE_ACCOUNTS_WORKSPACE: "/no/such/ws" };
  assert.equal(await orgOfCwd("/no/such/ws/ag/shop/worktrees/x/src", env), "ag");
  assert.equal(await orgOfCwd("/no/such/ws/personal/herdr-plugins/main", env), "personal");
  // local-39: an org's orchestrator runs in the org folder itself, and the
  // launcher and mac-workspace's shim run it on that org's account.
  assert.equal(await orgOfCwd("/no/such/ws/cs", env), "cs", "the org folder itself is the org's");
  assert.equal(await orgOfCwd("/no/such/ws/personal", env), "personal");
  assert.equal(await orgOfCwd("/no/such/ws/docs/x", env), null);
  assert.equal(await orgOfCwd("/no/such/wsx/ag/shop", env), null);
  assert.equal(await orgOfCwd(null, env), null);
});

test("S1: an org runs on its own file's account when it is in its pool, else on the global one when that is, else on none", () => {
  const rows = [{ name: "ag", org: "ag", dir: "/ag" }, { name: "u", org: "ag", dir: "/u" }, { name: "cs", org: "cs", dir: "/h/.claude" }];
  rows.push({ name: "p", org: "personal", dir: "/p" });
  const accounts = [{ id: "default", isDefault: true }, { id: "ag", configDir: "/ag" }, { id: "u", configDir: "/u" }, { id: "p", configDir: "/p" }];
  const env = { HOME: "/h" };
  const known = { active: "ag", accounts };
  assert.deepEqual(effectiveActives({ known, rows, orgDirs: {}, env }), { none: "ag", cs: null, ag: "ag", personal: "ag" });
  assert.deepEqual(effectiveActives({ known, rows, orgDirs: { ag: "/u", personal: "/p", cs: "/p" }, env }), { none: "ag", cs: null, ag: "u", personal: "p" },
    "cs's file names an account outside its pool: ignored");
  assert.deepEqual(effectiveActives({ known: { active: "p", accounts }, rows, orgDirs: { cs: "" }, env }), { none: "p", cs: "default", ag: null, personal: "p" });
});

// The sandbox's mac-workspace: harness/claude-profiles.tsv with these rows.
function orgRows(s, rows) {
  const dir = join(s.box, "ws", "harness");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "claude-profiles.tsv"), ["name\torg\tdir\tdefault", ...rows.map((r) => r.join("\t"))].join("\n") + "\n");
}

const AG1 = "a1a1a1a1-1111-4111-8111-111111111111";
const AG2 = "a2a2a2a2-2222-4222-8222-222222222222";
const P1 = "p1p1p1p1-3333-4333-8333-333333333333";

test("S1: per org, the ag account at 96% moves to the other ag account, never to an account of another org with more room", () => {
  const s = sandbox({ workspace: true });
  const dirs = accounts(s, [
    { id: AG1, type: MAX, session: 96, weekly: 40 },
    { id: AG2, type: MAX, session: 50, weekly: 50 },
    { id: P1, type: MAX, session: 0, weekly: 0 },
  ], AG1);
  orgRows(s, [["ag", "ag", dirs[AG1], "yes"], ["u", "ag", dirs[AG2], "no"], ["p", "personal", dirs[P1], "no"]]);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  const check = s.cli(["auto-switch", "check", "--json"]);
  assert.equal(check.status, 0, check.stderr);
  const d = JSON.parse(check.stdout);
  assert.deepEqual([d.action, d.from, d.to], ["switch", AG1, AG2]);
  assert.deepEqual(d.orgs.map((x) => [x.org, x.action]), [["cs", "none"], ["ag", "switch"], ["personal", "none"]],
    "personal followed the global account, now AG2, under the line");
  assert.equal(s.read("active.ag"), dirs[AG2], "ag's own active file");
  assert.equal(s.read("active"), dirs[AG2], "the global active followed: it was the account that filled up");
  assert.equal(existsSync(join(s.state, "active.personal")), false);
  const record = JSON.parse(s.read("auto-switch.json"));
  assert.deepEqual([record.state, record.org, record.from, record.to, record.percent], ["switched", "ag", AG1, AG2, 96]);
  // Idempotent.
  const again = JSON.parse(s.cli(["auto-switch", "check", "--json"]).stdout);
  assert.equal(again.action, "none");
});

test("S1: personal runs on any account, a cs or ag one too; its switch leaves cs and ag where they are; a pinned org never switches", () => {
  const s = sandbox({ workspace: true });
  const dirs = accounts(s, [
    { id: AG1, type: MAX, session: 10, weekly: 10 },
    { id: AG2, type: MAX, session: 20, weekly: 20 },
    { id: P1, type: MAX, session: 97, weekly: 30 },
  ], AG1);
  orgRows(s, [["ag", "ag", dirs[AG1], "yes"], ["u", "ag", dirs[AG2], "no"], ["p", "personal", dirs[P1], "no"]]);
  writeFileSync(join(s.state, "active.personal"), dirs[P1]);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  const d = JSON.parse(s.cli(["auto-switch", "check", "--json"]).stdout);
  assert.deepEqual([d.action, d.from, d.to], ["switch", P1, AG1], "an ag account is personal's too, the one with the most room");
  assert.equal(s.read("active.personal"), dirs[AG1]);
  assert.equal(s.read("active"), dirs[AG1], "the global account was AG1 already");
  assert.equal(existsSync(join(s.state, "active.ag")), false, "ag untouched");
  assert.equal(JSON.parse(s.read("auto-switch.json")).org, "personal");

  // A pin in group-accounts: that org's Claudes never follow, so no switch.
  writeFileSync(join(s.state, "active.personal"), dirs[P1]);
  writeFileSync(join(s.state, "group-accounts"), `personal\t${dirs[P1]}\n`);
  const p = JSON.parse(s.cli(["auto-switch", "check", "--json"]).stdout);
  assert.deepEqual(p.orgs.find((x) => x.org === "personal"), { org: "personal", action: "none", reason: "pinned" });
  assert.equal(s.read("active.personal"), dirs[P1]);
});

test("S1: `use` by hand sets every org whose pool has the account, and leaves the others", () => {
  const s = sandbox({ workspace: true });
  const dirs = accounts(s, [
    { id: AG1, type: MAX, session: 10, weekly: 10 },
    { id: AG2, type: MAX, session: 20, weekly: 20 },
    { id: P1, type: MAX, session: 0, weekly: 0 },
  ], AG1);
  orgRows(s, [["ag", "ag", dirs[AG1], "yes"], ["u", "ag", dirs[AG2], "no"], ["p", "personal", dirs[P1], "no"]]);
  writeFileSync(join(s.state, "active.ag"), dirs[AG1]);
  let r = s.cli(["use", P1, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.read("active"), dirs[P1]);
  assert.equal(s.read("active.personal"), dirs[P1]);
  assert.equal(s.read("active.ag"), dirs[AG1], "P1 is no ag account: ag stays on AG1");
  r = s.cli(["use", AG2, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.read("active.ag"), dirs[AG2]);
  assert.equal(s.read("active.personal"), dirs[AG2]);
});

test("S3: the toast of a per-org switch names the org; a global one reads as before", () => {
  const label = (id) => ({ a: "a@example.com", b: "b@example.com" })[id] ?? id;
  const org = autoSwitchToast(readAutoSwitch({ state: "switched", org: "ag", from: "a", to: "b", at: 1, window: "session", percent: 96 }), label);
  assert.equal(org.toast.title, "ag switched to b@example.com automatically");
  assert.equal(org.toast.body, "a@example.com reached 96% of its 5-hour limit.");
  const stuck = autoSwitchToast(readAutoSwitch({ state: "stuck", org: "personal", from: "a", at: 1, window: "weekly", percent: 99 }), label);
  assert.equal(stuck.toast.title, "personal: a@example.com reached 99% of its weekly limit");
  const plain = autoSwitchToast(readAutoSwitch({ state: "switched", from: "a", to: "b", at: 1, window: "session", percent: 96 }), label);
  assert.equal(plain.toast.title, "Switched to b@example.com automatically");
});

// ── Sessions off their org's account (local-39) ────────────────────────────
// Samir: 'no funciono el cambio entre cuentas automatico que paso'. A Claude
// in ~/mac-workspace/personal ran on ~/.claude (System default, Coldsmoke's
// login) at 100%, while personal's active account was under the line: the
// check only looked at each org's active account, never at the account a
// live session really runs on.

const { pickSessionMoves } = await import(pathToFileURL(join(MOD, "cli/autoswitch.mjs")).href);

test("local-39: a session on System default whose login is at its limit moves to its folder's org account; one under the line, on its org's account, or in a pinned org stays", () => {
  const cs = acct("cs", "Team", null, 100, { usage: { session: null, weekly: w(100), fable: null, monthly: w(100) } });
  const def = acct("default", "Team", null, null, { isDefault: true, duplicateOf: "cs", usageUpdatedAt: 0, error: "expired" });
  const p = acct("p", "Max 5x", 7, 43);
  const doc = docOf("p", def, cs, p);
  const actives = { none: "p", cs: "cs", ag: null, personal: "p" };
  const sessions = [
    { terminal: "t10h", account: "default", org: "personal" },
    { terminal: "t2", account: "p", org: "personal" },
    { terminal: "t3", account: "default", org: "cs" },
  ];
  const moves = pickSessionMoves(doc, { sessions, actives, pinned: new Set(["cs"]), now: NOW });
  assert.deepEqual(moves, [{ org: "personal", from: "default", to: "p", terminals: ["t10h"], window: "weekly", percent: 100 }]);
  // Under the line: nothing moves.
  const calm = docOf("p", def, acct("cs", "Team", null, 40), p);
  assert.deepEqual(pickSessionMoves(calm, { sessions, actives, pinned: new Set(), now: NOW }), []);
  // The org's account is full too: no move onto it.
  const full = docOf("p", def, cs, acct("p", "Max 5x", 99, 43));
  assert.deepEqual(pickSessionMoves(full, { sessions, actives, pinned: new Set(), now: NOW }), []);
  // Outside every org a session follows the global account.
  const out = pickSessionMoves(doc, { sessions: [{ terminal: "t9", account: "cs", org: null }], actives, pinned: new Set(), now: NOW });
  assert.deepEqual(out.map((m) => [m.org, m.from, m.to]), [["none", "cs", "p"]]);
});

test("local-39: `auto-switch check` restarts a personal Claude running on ~/.claude when that login is at its limit, even though personal's account is under the line", () => {
  const s = sandbox({ workspace: true });
  const CS = "c5c5c5c5-5555-4555-8555-555555555555";
  const dirs = accounts(s, [
    { id: CS, type: MAX, session: 40, weekly: 100 },
    { id: P1, type: MAX, session: 7, weekly: 43 },
  ], P1);
  // ~/.claude holds the CS login: System default is its duplicate.
  const cs = JSON.parse(readFileSync(join(dirs[CS], ".claude.json"), "utf8"));
  const system = join(s.home, ".claude");
  mkdirSync(join(system, "sessions"), { recursive: true });
  writeFileSync(join(s.home, ".claude.json"), JSON.stringify(cs));
  const sid = "3da9c849-6697-4058-b204-6d1a2711c6f0";
  writeFileSync(join(system, "sessions", "4242.json"), JSON.stringify({ sessionId: sid, status: "idle" }));
  mkdirSync(join(system, "projects", "x"), { recursive: true });
  writeFileSync(join(system, "projects", "x", `${sid}.jsonl`), "{}\n");
  orgRows(s, [["cs", "cs", "~/.claude", "yes"], ["personal", "personal", dirs[P1], "yes"]]);
  const cwd = join(s.box, "ws", "personal");
  mkdirSync(cwd, { recursive: true });
  // t10h: Claude (pid 4242) in ~/mac-workspace/personal.
  const get = JSON.stringify({ state: "live", pid: 4000, title: "orch-personal", foreground: { pid: 4242, name: "claude", argv: ["claude"], cwd } });
  writeFileSync(join(s.box, "bin", "hc"), `#!/bin/sh
case "$1" in
  ls) echo '{"terminals":[{"address":"t10h","state":"live","agent":"claude-code","where":"orch"}]}' ;;
  get) echo '${get}' ;;
  *) exit 1 ;;
esac
`);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  s.cli(["settings", "set", "switchMode", "ask"]);
  const check = s.cli(["auto-switch", "check", "--json"]);
  assert.equal(check.status, 0, check.stderr);
  const d = JSON.parse(check.stdout);
  assert.deepEqual(d.orgs.find((x) => x.org === "personal").reason, "underLine", "personal's own account is fine");
  assert.deepEqual(d.sessions, [{ org: "personal", from: "default", to: P1, terminals: ["t10h"], window: "weekly", percent: 100 }]);
  const pending = JSON.parse(s.read("pending-switch.json"));
  assert.deepEqual([pending.from, pending.to], ["default", P1]);
  assert.deepEqual(pending.sessions.map((x) => [x.terminal, x.group]), [["t10h", "onAccount"]]);
  assert.deepEqual(JSON.parse(s.read("auto-switch.json")).org, "personal");
  // Answered (the question is gone): the next poll asks again, in words.
  rmSync(join(s.state, "pending-switch.json"));
  const human = s.cli(["auto-switch", "check"]);
  assert.match(human.stdout, new RegExp(`^t10h: moves from default to ${P1} \\(weekly at 100%\\)\\.$`, "m"));
});

// A fake Herdr with one Claude terminal (t10h, pid 4242) in ~/mac-workspace/personal whose
// session file lives in `dir` (the account's folder).
function claudeIn(s, dir) {
  const sid = "3da9c849-6697-4058-b204-6d1a2711c6f0";
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "sessions", "4242.json"), JSON.stringify({ sessionId: sid, status: "idle" }));
  mkdirSync(join(dir, "projects", "x"), { recursive: true });
  writeFileSync(join(dir, "projects", "x", `${sid}.jsonl`), "{}\n");
  const cwd = join(s.box, "ws", "personal");
  mkdirSync(cwd, { recursive: true });
  const get = JSON.stringify({ state: "live", pid: 4000, title: "orch-personal", foreground: { pid: 4242, name: "claude", argv: ["claude"], cwd } });
  writeFileSync(join(s.box, "bin", "hc"), `#!/bin/sh
case "$1" in
  ls) echo '{"terminals":[{"address":"t10h","state":"live","agent":"claude-code","where":"orch"}]}' ;;
  get) echo '${get}' ;;
  *) exit 1 ;;
esac
`);
}

test("local-39 review: a check that switched an org leaves that switch's terminals to it: no second move in the same poll", () => {
  const s = sandbox({ workspace: true });
  const dirs = accounts(s, [{ id: P1, type: MAX, session: 97, weekly: 30 }, { id: AG1, type: MAX, session: 10, weekly: 10 }], P1);
  orgRows(s, [["ag", "ag", dirs[AG1], "yes"], ["p", "personal", dirs[P1], "yes"]]);
  claudeIn(s, dirs[P1]);
  s.cli(["settings", "set", "autoSwitch", "on"]);
  s.cli(["settings", "set", "switchMode", "ask"]);
  const d = JSON.parse(s.cli(["auto-switch", "check", "--json"]).stdout);
  assert.deepEqual([d.action, d.org ?? d.orgs.find((x) => x.action === "switch").org, d.to], ["switch", "personal", AG1]);
  assert.equal(d.sessions, undefined, "the org switch's own afterUse moves t10h");
});

test("local-39 review: with switchMode keep no session moves; in ask mode the same question is not asked again every poll", () => {
  const s = sandbox({ workspace: true });
  const CS = "c5c5c5c5-5555-4555-8555-555555555555";
  const dirs = accounts(s, [{ id: CS, type: MAX, session: 40, weekly: 100 }, { id: P1, type: MAX, session: 7, weekly: 43 }], P1);
  writeFileSync(join(s.home, ".claude.json"), readFileSync(join(dirs[CS], ".claude.json")));
  orgRows(s, [["cs", "cs", "~/.claude", "yes"], ["personal", "personal", dirs[P1], "yes"]]);
  claudeIn(s, join(s.home, ".claude"));
  s.cli(["settings", "set", "autoSwitch", "on"]);
  s.cli(["settings", "set", "switchMode", "keep"]);
  let d = JSON.parse(s.cli(["auto-switch", "check", "--json"]).stdout);
  assert.equal(d.sessions, undefined, "keep: nothing moves, nothing is said");
  assert.equal(existsSync(join(s.state, "auto-switch.json")), false);
  s.cli(["settings", "set", "switchMode", "ask"]);
  d = JSON.parse(s.cli(["auto-switch", "check", "--json"]).stdout);
  assert.equal(d.sessions.length, 1);
  d = JSON.parse(s.cli(["auto-switch", "check", "--json"]).stdout);
  assert.equal(d.sessions, undefined, "the pending question already asks it");
});
