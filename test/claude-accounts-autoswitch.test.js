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
  PAY_PER_USE_TAG, isPayPerUse, payPerUsePrompt, autoSwitchSetting, readAutoSwitch,
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

test("S2: fresh data only: a stale, failed or signed-out candidate is skipped, and a stale active account never moves", () => {
  const candidates = [
    acct("old", "Max", 0, 0, { usageUpdatedAt: NOW - 31 * MIN }),
    acct("never", "Max", null, null, { usageUpdatedAt: null }),
    acct("err", "Max", 0, 0, { error: "network" }),
    acct("out", "Max", 0, 0, { needsSignIn: true }),
    acct("full", "Max", 10, 97),
  ];
  const stuck = pickAutoSwitch(docOf("m1", acct("m1", "Max", 100, 10), ...candidates), { now: NOW });
  assert.equal(stuck.action, "stay");
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

test("S2: the active saved account borrows System default's fresher numbers for the same login, as the footer shows them", () => {
  const stale = acct("m1", "Max", 10, 10, { usageUpdatedAt: NOW - 2 * HOUR });
  const def = acct("default", "Max", 97, 10, { isDefault: true, configDir: null, duplicateOf: "m1" });
  const d = pickAutoSwitch(docOf("m1", stale, def, acct("m2", "Max", 0, 0)), { now: NOW });
  assert.deepEqual([d.action, d.to, d.percent], ["switch", "m2", 97]);
});

// ── The CLI end to end (S1, S2) ────────────────────────────────────────────

const root = realpathSync(mkdtempSync(join(tmpdir(), "claude-accounts-autoswitch-")));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function sandbox() {
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
function fixtureDoc(plans) {
  const raw = JSON.parse(fixture("accounts.v1.json"));
  raw.accounts = raw.accounts.map((a) => ({ ...a, plan: plans[a.id] ?? null }));
  return readAccounts(JSON.stringify(raw));
}

test("S3: Enterprise and Team are pay per use; Max, Pro and no plan aren't", () => {
  assert.equal(PAY_PER_USE_TAG, "API · pay per use");
  for (const plan of ["Enterprise", "Team"]) assert.equal(isPayPerUse({ plan }), true, plan);
  for (const plan of ["Max 5x", "Max", "Pro", null]) assert.equal(isPayPerUse({ plan }), false, String(plan));
  assert.equal(isPayPerUse(null), false);
});

test("S3: Manage Accounts tags a pay-per-use row after its plan, and the panel's row has the tag", () => {
  const doc = fixtureDoc({ [ANA]: "Max 5x", [BEN]: "Enterprise" });
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
  const doc = fixtureDoc({ [BEN]: "Enterprise" });
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
