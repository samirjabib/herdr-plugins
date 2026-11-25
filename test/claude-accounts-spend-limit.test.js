// An account at its org's monthly spend limit (odd/tasks/team-usage.md S4):
// "You've hit your org's monthly spend limit". It's read from the usage
// endpoint's spend (used at or past the limit) or from the error text that
// names the limit; every view says so, and the automatic switch never moves
// onto it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readAccounts, readSettings } from "../claude-accounts/mods/claude-accounts/store.js";
import { accountsModel } from "../claude-accounts/mods/claude-accounts/accounts-model.js";
import { panelModel, footerModel, popupModel } from "../claude-accounts/mods/claude-accounts/footer-model.js";
import { isSpendLimited, SPEND_LIMIT } from "../claude-accounts/mods/claude-accounts/plans.js";

const MOD = join(fileURLToPath(new URL("..", import.meta.url)), "claude-accounts/mods/claude-accounts");
const cli = (name) => import(pathToFileURL(join(MOD, "cli", `${name}.mjs`)).href);

const NOW = 1794000000000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const w = (percent) => ({ percent, resetsAt: NOW + HOUR });
const LIMITED = { balance: null, limit: 500, spendLimited: true };

function acct(id, plan, session, weekly, extra = {}) {
  return {
    id, label: `${id}@example.com`, email: `${id}@example.com`, org: null, plan, configDir: `/x/${id}`, isDefault: false,
    needsSignIn: false, error: null, errorDetail: null,
    usage: { session: session === null ? null : w(session), weekly: weekly === null ? null : w(weekly), fable: null, monthly: null },
    credits: null, usageUpdatedAt: NOW - MIN, lastAuthenticatedAt: 1, duplicateOf: null, signedInAs: null, ...extra,
  };
}
const docOf = (active, ...accounts) => readAccounts(JSON.stringify({ version: 1, updatedAt: NOW, active, accounts }));

test("S4: the usage endpoint's spend at or past its limit marks the account; under it doesn't", async () => {
  const { parseUsageResponse } = await cli("usage");
  const at = parseUsageResponse({ spend: { used: { amount_minor: 50000 }, limit: { amount_minor: 50000 } } });
  assert.equal(at.credits.spendLimited, true);
  const over = parseUsageResponse({ five_hour: { utilization: 10 }, spend: { percent: 100, limit: 200 } });
  assert.equal(over.credits.spendLimited, true, "a subscription's extra usage at its cap too");
  const legacy = parseUsageResponse({ extra_usage: { monthly_limit: 10000, used_credits: 10000 } });
  assert.equal(legacy.credits.spendLimited, true, "the older extra_usage shape");
  const under = parseUsageResponse({ spend: { used: { amount_minor: 100 }, limit: { amount_minor: 50000 } } });
  assert.equal(under.credits.spendLimited, undefined);
  const off = parseUsageResponse({ spend: { used: 0, limit: 0 } });
  assert.equal(off.credits?.spendLimited, undefined, "a zero limit is extra usage turned off, not a hit limit");
});

test("S4: isSpendLimited reads the spend mark or the error that names the limit, and survives the store", () => {
  assert.equal(isSpendLimited(acct("a", "Team", null, null, { credits: LIMITED })), true);
  assert.equal(isSpendLimited(acct("a", "Team", null, null, { error: "unavailable", errorDetail: "You've hit your org's monthly spend limit" })), true);
  assert.equal(isSpendLimited(acct("a", "Team", 10, 10)), false);
  assert.equal(isSpendLimited(null), false);
  const stored = docOf("a", acct("a", "Team", null, null, { credits: LIMITED })).accounts[0];
  assert.equal(isSpendLimited(stored), true);
});

test("S4: the automatic switch never picks an account at its spend limit, even with the most room", async () => {
  const { isAutoSwitchEligible, pickAutoSwitch } = await cli("autoswitch");
  const limited = acct("lim", "Max 20x", 0, 0, { credits: LIMITED });
  assert.equal(isAutoSwitchEligible(limited), false);
  const doc = docOf("act", acct("act", "Max 5x", 97, 40), limited, acct("ok", "Pro", 50, 50));
  assert.equal(pickAutoSwitch(doc, { now: NOW }).to, "ok");
  const stuck = docOf("act", acct("act", "Max 5x", 97, 40), limited);
  assert.equal(pickAutoSwitch(stuck, { now: NOW }).action, "stay");
});

test("S4: every view says the spend limit is reached", () => {
  const limited = acct("lim", "Team", null, null, { credits: LIMITED });
  const other = acct("ok", "Pro", 10, 10);
  // Active: the panel's card, the footer, the popover.
  const active = docOf("lim", limited, other);
  const card = panelModel({ doc: active, now: NOW }).card;
  assert.equal(card.notice.message, SPEND_LIMIT);
  const footer = footerModel({ doc: active, width: 1000, now: NOW });
  assert.equal(footer.kind, "error");
  assert.match(JSON.stringify(footer), /Spend limit/);
  assert.equal(popupModel({ doc: active, now: NOW }).row.status, SPEND_LIMIT);
  // Another account: its panel row, and Manage Accounts' badge.
  const row = panelModel({ doc: docOf("ok", limited, other), now: NOW }).rows.find((r) => r.id === "lim");
  assert.equal(row.status, SPEND_LIMIT);
  const badges = accountsModel({ accounts: active, settings: readSettings("{}") }).rows.find((r) => r.id === "lim").badges;
  assert.ok(badges.includes(SPEND_LIMIT), badges.join(", "));
});

test("S4: a subscription with bars at its spend limit keeps its bars and says so", () => {
  const limited = acct("lim", "Max 5x", 30, 20, { credits: LIMITED });
  const card = panelModel({ doc: docOf("lim", limited), now: NOW }).card;
  assert.equal(card.windows.length > 0, true);
  assert.equal(card.notice.message, SPEND_LIMIT);
});

test("S4: a usage-based login whose only bar is its spent monthly limit says the limit, not API usage", () => {
  const limited = acct("lim", "Enterprise", null, null, { credits: LIMITED });
  limited.usage.monthly = { percent: 100, resetsAt: null };
  const doc = docOf("lim", limited);
  const footer = footerModel({ doc, width: 1000, now: NOW });
  assert.equal(footer.kind, "error");
  assert.equal(popupModel({ doc, now: NOW }).row.status, SPEND_LIMIT);
  assert.equal(panelModel({ doc, now: NOW }).card.notice.message, SPEND_LIMIT);
});
