// The automatic switch (odd/tasks/claude-accounts-switching.md S1, S2): when
// the active account reaches the switch line on its 5-hour or weekly window,
// the next Claude starts on the eligible account with the most room left.
//
//   auto-switch check                 runs the check now, prints its decision
//   auto-switch exclude|include <id>  keeps a saved account out of it, or back in
//
// isAutoSwitchEligible(account, { excluded }) → boolean (S1): a Max or Pro
// subscription the owner hasn't excluded. Enterprise and Team are billed per
// use through the API: never eligible.
//
// pickAutoSwitch(doc, { now, line, excluded }) → the decision, pure, from
// accounts.v1.json (fresh numbers only):
//   { action: "none", reason }   nothing to do
//   { action: "switch", from, to, window, percent, resetsAt }
//   { action: "stay", from, window, percent, resetsAt }   at the line, and no
//                                                          eligible account has room
// Only an active subscription account moves (one chosen by hand that is pay
// per use stays where the owner put it). System default (the Mac's own login,
// hidden from the lists) and an account of the same login are never targets.
// A window past its reset is null in the contract: it counts as 0, so an
// account that was full comes back once its window resets, never before. The
// new account is under the line, so the next poll does nothing: no flapping.
//
// checkAutoSwitch(home) runs it when settings.autoSwitch is "on": a switch
// goes through accounts.switchAccount, `use`'s own path (the restart setting
// applies), guarded so it happens only while the account it read is still
// the active one. It writes auto-switch.json, which the footer tells:
//   { state: "switched", from, to, at, window, percent }
//   { state: "stuck", from, at, window, percent, resetsAt }  once per window
// `usage` runs it after every merge, so it follows each poll and each turn.

import { parseArgs } from "node:util";
import { FILES, stateHome } from "./paths.mjs";
import { failure, readJson, rebuildContract, render, withLock, writeAtomic } from "./files.mjs";
import { knownAccounts, readSettings, sameEmail, switchAccount } from "./accounts.mjs";
import { join } from "node:path";

export const SWITCH_LINE = 95;
// Every account is read at least every 15 minutes (the footer's poll): two
// polls without a read is stale.
export const FRESH_MS = 30 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const WINDOWS = ["session", "weekly"];

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

// "Max", "Max 5x", "Max 20x", "Pro": a personal subscription.
export const isSubscription = (plan) => plan === "Pro" || plan === "Max" || (typeof plan === "string" && /^Max \d+x$/.test(plan));

export function isAutoSwitchEligible(account, { excluded = [] } = {}) {
  return Boolean(account) && isSubscription(account.plan) && !excluded.includes(account.id);
}

// Numbers good enough to decide on: read within FRESH_MS, with no error and
// a login that is the account's own.
function isFresh(a, now) {
  return Boolean(a) && !a.error && a.needsSignIn !== true && !a.signedInAs && isNumber(a.usageUpdatedAt) &&
    now - a.usageUpdatedAt <= FRESH_MS && a.usageUpdatedAt <= now + FUTURE_SKEW_MS;
}

// Its own login is in its folder (it may still need Claude to refresh it).
const isSignedIn = (a) => Boolean(a) && a.needsSignIn !== true && !a.signedInAs;

// Its usage with every window past its reset read as empty.
function withoutPastWindows(a, now) {
  const usage = { ...(a.usage ?? {}) };
  for (const key of WINDOWS) {
    const win = usage[key];
    if (win && isNumber(win.resetsAt) && win.resetsAt <= now) usage[key] = { percent: 0, resetsAt: null };
  }
  return { ...a, usage };
}

// The most used of its 5-hour and weekly windows: { window, percent, resetsAt }.
function tightest(a) {
  let best = { window: "session", percent: 0, resetsAt: null };
  for (const key of WINDOWS) {
    const win = a.usage?.[key];
    const percent = isNumber(win?.percent) ? win.percent : 0;
    if (percent > best.percent) best = { window: key, percent, resetsAt: isNumber(win?.resetsAt) ? win.resetsAt : null };
  }
  return best;
}

// The active saved account with System default's fresher numbers for the same
// login, as the footer shows it (footer-model.js withSameLoginUsage).
function withSameLogin(active, def, now) {
  if (!active || !def || active.isDefault || def.duplicateOf !== active.id) return active;
  if (isFresh(active, now) || !isFresh(def, now)) return active;
  if (isNumber(active.usageUpdatedAt) && active.usageUpdatedAt >= def.usageUpdatedAt) return active;
  return { ...active, usage: def.usage, usageUpdatedAt: def.usageUpdatedAt, error: null, needsSignIn: false };
}

const sameLogin = (a, b) => sameEmail(a.email, b.email) && (a.org ?? null) === (b.org ?? null);

export function pickAutoSwitch(doc, { now = Date.now(), line = SWITCH_LINE, excluded = [] } = {}) {
  const accounts = Array.isArray(doc?.accounts) ? doc.accounts : [];
  const def = accounts.find((a) => a.isDefault) ?? null;
  const active = withSameLogin(accounts.find((a) => a.id === doc?.active) ?? null, def, now);
  if (!active) return { action: "none", reason: "noActive" };
  if (!isSubscription(active.plan)) return { action: "none", reason: "notSubscription" };
  if (!isFresh(active, now)) return { action: "none", reason: "stale" };
  const full = tightest(active);
  if (full.percent < line) return { action: "none", reason: "underLine" };
  // A target only needs its own login. Nobody runs Claude on the other
  // accounts, so their tokens lapse and their numbers age: the last ones
  // count, a window past its reset counts as empty, and fresh numbers win a
  // tie on room.
  let best = null;
  for (const a of accounts) {
    if (a.id === active.id || a.isDefault || sameLogin(a, active)) continue;
    if (!isAutoSwitchEligible(a, { excluded }) || !isSignedIn(a)) continue;
    const room = line - tightest(withoutPastWindows(a, now)).percent;
    const fresh = isFresh(a, now);
    if (room > 0 && (!best || room > best.room || (room === best.room && fresh && !best.fresh))) best = { id: a.id, room, fresh };
  }
  const at = { from: active.id, window: full.window, percent: full.percent, resetsAt: full.resetsAt };
  return best ? { action: "switch", ...at, to: best.id } : { action: "stay", ...at };
}

const recordPath = (home) => join(home, FILES.autoSwitch);

export async function checkAutoSwitch(home = stateHome(), now = Date.now()) {
  const { autoSwitch } = await readSettings(home);
  if (autoSwitch !== "on") return { action: "none", reason: "off" };
  const known = await knownAccounts(home);
  const excluded = known.accounts.filter((a) => a.autoSwitchExcluded).map((a) => a.id);
  const decision = pickAutoSwitch(await rebuildContract(home), { now, excluded });
  if (decision.action === "switch") {
    const { from, to } = await switchAccount(decision.to, { onlyFrom: decision.from });
    // Another run switched first: its record stands.
    if (from === to) return { action: "none", reason: "moved" };
    await withLock(home, () => writeAtomic(recordPath(home), render({
      state: "switched", from, to, at: now, window: decision.window, percent: decision.percent,
    })));
  } else if (decision.action === "stay") {
    await withLock(home, async () => {
      const old = await readJson(recordPath(home)).catch(() => null);
      const same = old?.state === "stuck" && old.from === decision.from && old.window === decision.window && old.resetsAt === decision.resetsAt;
      if (!same) {
        await writeAtomic(recordPath(home), render({
          state: "stuck", from: decision.from, at: now, window: decision.window, percent: decision.percent, resetsAt: decision.resetsAt,
        }));
      }
    });
  }
  return decision;
}

// ── auto-switch ─────────────────────────────────────────────────────────────

const usageError = () => failure("usage: claude-accounts auto-switch check | exclude <id> | include <id>", 64);

export async function autoSwitchCommand(args) {
  const { values, positionals } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: true, allowPositionals: true });
  const [verb, id] = positionals;
  const print = (value, human) => process.stdout.write(values.json ? render(value) : `${human}\n`);
  if (verb === "check" && positionals.length === 1) {
    const d = await checkAutoSwitch();
    print(d, d.action === "switch" ? `Switched from ${d.from} to ${d.to}.` : d.action === "stay" ? `Stays on ${d.from}: no account has room.` : `Nothing to do (${d.reason}).`);
    return 0;
  }
  if ((verb !== "exclude" && verb !== "include") || positionals.length !== 2 || id === "default") throw usageError();
  const home = stateHome();
  await knownAccounts(home);
  await withLock(home, async () => {
    const path = join(home, FILES.accounts);
    const registry = (await readJson(path)) ?? [];
    const entry = Array.isArray(registry) ? registry.find((a) => a?.id === id) : null;
    if (!entry) throw failure(`unknown account "${id}"`, 7);
    if (verb === "exclude") entry.excludeFromAutoSwitch = true;
    else delete entry.excludeFromAutoSwitch;
    await writeAtomic(path, render(registry));
  });
  const excluded = verb === "exclude";
  print({ id, excluded }, `${id}: ${excluded ? "excluded from" : "included in"} the automatic switch`);
  return 0;
}
