// Every Claude plan, shown right (odd/tasks/team-usage.md S1-S3): each plan
// through the public render functions (Manage Accounts' badges, the panel's
// row and card, the footer, the popover) and through planOf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readAccounts, readSettings } from "../claude-accounts/mods/claude-accounts/store.js";
import { accountsModel } from "../claude-accounts/mods/claude-accounts/accounts-model.js";
import { panelModel, footerModel, popupModel } from "../claude-accounts/mods/claude-accounts/footer-model.js";
import { isPayPerUse, payPerUsePrompt } from "../claude-accounts/mods/claude-accounts/switch-model.js";
import { PLANS, planOf, planByName } from "../claude-accounts/mods/claude-accounts/plans.js";

const NOW = 1794000000000;
const HOUR = 3_600_000;
const w = (percent) => ({ percent, resetsAt: NOW + HOUR });
const WINDOWS = { session: w(90), weekly: w(82), fable: w(0), monthly: null };
const NO_WINDOWS = { session: null, weekly: null, fable: null, monthly: null };
const SPEND_ONLY = { session: null, weekly: null, fable: null, monthly: w(12) };

// One active account with this plan and usage.
function docWith(plan, usage, active = "a1") {
  const account = {
    id: "a1", email: "me@example.com", plan, configDir: "/x/a1", needsSignIn: false, error: null,
    usage, credits: null, usageUpdatedAt: NOW - 60_000, lastAuthenticatedAt: 1,
  };
  const other = { ...account, id: "b2", email: "other@example.com", plan: "Pro", configDir: "/x/b2" };
  return readAccounts(JSON.stringify({ version: 1, active, accounts: [account, other] }));
}

// What each view shows for the account: footer kind, the panel row's bars and
// status, the tag, Manage Accounts' badges, whether switching asks first.
function shown(plan, usage) {
  const doc = docWith(plan, usage);
  // The panel lists the accounts that aren't active.
  const row = panelModel({ doc: docWith(plan, usage, "b2"), now: NOW }).rows.find((r) => r.id === "a1");
  const footer = footerModel({ doc, width: 1000, now: NOW });
  const popup = popupModel({ doc, now: NOW }).row;
  const badges = accountsModel({ accounts: doc, settings: readSettings("{}") }).rows[0].badges;
  return {
    footer: footer.kind, popup: popup.kind, bars: row.bars.length, status: row.status, tag: row.tag,
    badges, asks: payPerUsePrompt(doc.accounts[0]) !== null,
  };
}

const SUBSCRIPTION = (plan) => ({ footer: "usage", popup: "usage", bars: 3, status: null, tag: null, badges: [plan, "This device", "Active"], asks: false });
const API = (plan) => ({ footer: "api", popup: "api", bars: 0, status: "API usage", tag: "API · pay per use", badges: [plan, "API · pay per use", "This device", "Active"], asks: true });

test("S1: a Team login whose usage has 5h and weekly windows shows its bars, not API usage", () => {
  assert.deepEqual(shown("Team", WINDOWS), SUBSCRIPTION("Team"));
  assert.deepEqual(shown("Team Premium", WINDOWS), SUBSCRIPTION("Team Premium"));
  assert.deepEqual(shown("Team Standard", WINDOWS), SUBSCRIPTION("Team Standard"));
});

test("S1: a seat-based Enterprise login with windows shows its bars; a usage-based one says API usage", () => {
  assert.deepEqual(shown("Enterprise", WINDOWS), SUBSCRIPTION("Enterprise"));
  assert.deepEqual(shown("Enterprise", SPEND_ONLY), API("Enterprise"));
  assert.deepEqual(shown("Enterprise", NO_WINDOWS), API("Enterprise"));
});

test("S1: Team with no subscription windows in its usage says API usage", () => {
  assert.deepEqual(shown("Team", SPEND_ONLY), API("Team"));
});

test("S2: Free, Pro, Max 5x, Max 20x, Max and Ultra are subscriptions: bars, never API usage", () => {
  for (const plan of ["Free", "Pro", "Max 5x", "Max 20x", "Max", "Ultra"]) {
    assert.deepEqual(shown(plan, WINDOWS), SUBSCRIPTION(plan), plan);
    assert.equal(isPayPerUse({ plan, usage: NO_WINDOWS }), false, `${plan} without data`);
  }
});

test("S2: a Console (API) login is always pay per use", () => {
  assert.deepEqual(shown("Console (API)", NO_WINDOWS), API("Console (API)"));
  assert.equal(isPayPerUse({ plan: "Console (API)", usage: WINDOWS }), true);
});

test("S2: an unknown plan keeps its raw name and follows its usage data", () => {
  assert.deepEqual(shown("claude_new", WINDOWS), SUBSCRIPTION("claude_new"));
  assert.deepEqual(shown("claude_new", SPEND_ONLY), API("claude_new"));
});

test("S2: no plan at all is never pay per use", () => {
  assert.equal(isPayPerUse({ plan: null, usage: NO_WINDOWS }), false);
  assert.equal(isPayPerUse(null), false);
});

test("S2: planOf names every plan from the login's fields", () => {
  const cases = [
    [{ organizationType: "claude_free" }, "Free"],
    [{ organizationType: "claude_pro" }, "Pro"],
    [{ organizationType: "claude_max", organizationRateLimitTier: "default_claude_max_5x" }, "Max 5x"],
    [{ organizationType: "claude_max", organizationRateLimitTier: "default_claude_max_20x" }, "Max 20x"],
    [{ organizationType: "claude_max" }, "Max"],
    [{ organizationType: "claude_ultra" }, "Ultra"],
    [{ organizationType: "claude_max", organizationRateLimitTier: "default_claude_ultra" }, "Ultra"],
    [{ organizationType: "claude_team", seatTier: "team_tier_1", userRateLimitTier: "default_claude_max_5x" }, "Team Premium"],
    [{ organizationType: "claude_team", seatTier: "team_tier_1" }, "Team Standard"],
    [{ organizationType: "claude_team" }, "Team"],
    [{ organizationType: "claude_enterprise", organizationRateLimitTier: "default_raven_enterprise" }, "Enterprise"],
    [{ organizationType: "claude_api" }, "Console (API)"],
    [{ organizationType: "claude_new" }, "claude_new"],
    [{}, null],
    [null, null],
  ];
  for (const [login, name] of cases) assert.equal(planOf(login), name, JSON.stringify(login));
});

test("S2: the table registers every plan once, each with its windows, extra usage and detection", () => {
  const names = PLANS.map((p) => p.name);
  assert.deepEqual(names, ["Free", "Pro", "Max 5x", "Max 20x", "Max", "Ultra", "Team Standard", "Team Premium", "Team", "Enterprise", "Console (API)"]);
  for (const p of PLANS) {
    assert.ok(["always", "usage", "never"].includes(p.windows), p.name);
    assert.equal(typeof p.extraUsage, "boolean", p.name);
    assert.ok(p.how.length > 0, p.name);
    assert.equal(planByName(p.name), p);
  }
  assert.equal(planByName("nope"), null);
});
