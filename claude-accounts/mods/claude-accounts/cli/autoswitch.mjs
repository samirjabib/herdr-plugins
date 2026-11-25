// The automatic switch (odd/tasks/claude-accounts-switching.md S1, S2): when
// the active account reaches the switch line on its 5-hour or weekly window,
// or its org's monthly spend limit (usage.monthly at 100), the next Claude
// starts on the eligible account with the most room left.
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
// per use stays where the owner put it), except one at its org's monthly
// spend limit, whatever its plan: Claude refuses every turn there. System default (the Mac's own login,
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
//
// Per org (odd/tasks/autoswitch-orgs.md S1, cli/orgs.mjs): with mac-workspace's
// claude-profiles.tsv it runs once per org (cs, ag, personal), each on its
// own active account and pool (pickOrgAutoSwitch), skipping an org pinned in
// group-accounts. A switch goes through accounts.switchOrgAccount: that
// org's active file, the global one when it was the full account, and only
// the terminals of the orgs whose account moved restart. The record carries
// `org`. The result is the first switch (else stay, else none) plus `orgs`,
// every org's decision, and `sessions` when some live Claude ran on a full
// account that is no org's active one (pickSessionMoves, local-39).

import { parseArgs } from "node:util";
import { isAutoSwitchPlan, isSpendLimited } from "../plans.js";
import { FILES, stateHome } from "./paths.mjs";
import { failure, readJson, rebuildContract, render, withLock, writeAtomic } from "./files.mjs";
import { knownAccounts, readSettings, sameEmail, switchAccount, switchOrgAccount } from "./accounts.mjs";
import { ORGS, effectiveActives, orgOfCwd, pinnedOrgs, poolOf, readOrgActives, readProfiles } from "./orgs.mjs";
import { afterUse } from "./restart.mjs";
import { inspectTerminal, listClaudeTerminals } from "./terminals.mjs";
import { join } from "node:path";

export const SWITCH_LINE = 95;
// Every account is read at least every 15 minutes (the footer's poll): two
// polls without a read is stale.
export const FRESH_MS = 30 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const WINDOWS = ["session", "weekly", "monthly"];

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

// "Max", "Max 5x", "Max 20x", "Pro": a personal subscription.
// Pro, Max and Ultra (plans.js autoSwitch): an individual subscription.
export const isSubscription = (plan) => isAutoSwitchPlan(plan);

export function isAutoSwitchEligible(account, { excluded = [] } = {}) {
  return Boolean(account) && isSubscription(account.plan) && !isSpendLimited(account) && !excluded.includes(account.id);
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

// At its org's monthly spend limit: Claude refuses every turn until it resets.
const atSpendLimit = (a) => isNumber(a?.usage?.monthly?.percent) && a.usage.monthly.percent >= 100;

// The most used of its 5-hour, weekly and monthly windows: { window, percent, resetsAt }.
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
  if (!isSubscription(active.plan) && !atSpendLimit(active)) return { action: "none", reason: "notSubscription" };
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

// The record the footer and the toast tell. org: the mac-workspace org that
// switched, absent when the switch is global (no claude-profiles.tsv).
async function record(home, decision, now, org) {
  const tag = org ? { org } : {};
  if (decision.action === "switch") {
    await withLock(home, () => writeAtomic(recordPath(home), render({
      state: "switched", ...tag, from: decision.from, to: decision.to, at: now, window: decision.window, percent: decision.percent,
    })));
  } else if (decision.action === "stay") {
    await withLock(home, async () => {
      const old = await readJson(recordPath(home)).catch(() => null);
      const same = old?.state === "stuck" && (old.org ?? null) === (org ?? null) && old.from === decision.from &&
        old.window === decision.window && old.resetsAt === decision.resetsAt;
      if (!same) {
        await writeAtomic(recordPath(home), render({
          state: "stuck", ...tag, from: decision.from, at: now, window: decision.window, percent: decision.percent, resetsAt: decision.resetsAt,
        }));
      }
    });
  }
}

// One org's decision: its pool (plus System default, whose numbers the same
// login borrows) and its own active account.
export function pickOrgAutoSwitch(doc, { org, active, pool, ...options }) {
  if (!active) return { action: "none", reason: "noActive" };
  const accounts = (doc?.accounts ?? []).filter((a) => a.isDefault || pool.has(a.id));
  return pickAutoSwitch({ ...doc, active, accounts }, options);
}

// Sessions off their org's account (local-39): a live Claude can run on an
// account that is no org's active one (System default's ~/.claude, a login
// started by hand), so the per-org check never sees it fill up. Each such
// session whose account is at the line moves to the account its folder's
// org runs on (actives[org], "none" outside the orgs), unless that org is
// pinned or its account is at the line too. Numbers: the account's own,
// System default's borrowed from the saved account of the same login when
// its own aren't fresh. Within a window usage only grows, so numbers past
// FRESH_MS still say "at the line" until their window resets.
// sessions: [{ terminal, account, org }] → [{ org, from, to, terminals, window, percent }].
//
// atLine(a, now, line): the account's tightest window when it is at the line
// or its spend limit, from any numbers it has (a window past its reset counts
// as empty), else null.
function atLine(a, now, line) {
  if (!a || !isNumber(a.usageUpdatedAt) || a.usageUpdatedAt <= 0) return null;
  const current = withoutPastWindows(a, now);
  const t = tightest(current);
  return t.percent >= line || atSpendLimit(current) ? t : null;
}

export function pickSessionMoves(doc, { sessions, actives, pinned = new Set(), now = Date.now(), line = SWITCH_LINE }) {
  const accounts = Array.isArray(doc?.accounts) ? doc.accounts : [];
  const def = accounts.find((a) => a.isDefault) ?? null;
  const byId = (id) => accounts.find((a) => a.id === id) ?? null;
  const loginOf = (id) => {
    if (id !== "default" || !def) return byId(id);
    if (isFresh(def, now)) return def;
    return byId(def.duplicateOf) ?? accounts.find((a) => !a.isDefault && sameLogin(a, def)) ?? def;
  };
  const sameAccount = (from, to) => from === to || (from === "default" && def?.duplicateOf === to);
  const full = (a) => atLine(a, now, line);
  const moves = new Map();
  for (const s of sessions) {
    const org = s.org ?? "none";
    const to = actives[org];
    if (!s.account || !to || pinned.has(org) || sameAccount(s.account, to)) continue;
    const at = full(loginOf(s.account));
    if (!at || full(loginOf(to))) continue;
    const key = `${org}\t${s.account}\t${to}`;
    const m = moves.get(key) ?? { org, from: s.account, to, terminals: [], window: at.window, percent: at.percent };
    m.terminals.push(s.terminal);
    moves.set(key, m);
  }
  return [...moves.values()];
}

export async function checkAutoSwitch(home = stateHome(), now = Date.now()) {
  const { autoSwitch } = await readSettings(home);
  if (autoSwitch !== "on") return { action: "none", reason: "off" };
  const known = await knownAccounts(home);
  const excluded = known.accounts.filter((a) => a.autoSwitchExcluded).map((a) => a.id);
  const rows = await readProfiles();
  if (!rows) {
    const decision = pickAutoSwitch(await rebuildContract(home), { now, excluded });
    if (decision.action === "switch") {
      const { from, to } = await switchAccount(decision.to, { onlyFrom: decision.from });
      // Another run switched first: its record stands.
      if (from === to) return { action: "none", reason: "moved" };
    }
    await record(home, decision, now);
    const k = await knownAccounts(home);
    const sessions = await moveSessions(home, now, { known: k, actives: { none: k.active }, pinned: new Set() });
    return sessions.length > 0 ? { ...decision, sessions } : decision;
  }
  // One org at a time, each on its own active account and its own pool. An
  // org a switch moved already (it followed the global active) reads its new
  // account, under the line: no second switch.
  const pinned = await pinnedOrgs(home);
  const orgs = [];
  for (const org of ORGS) {
    if (pinned.has(org)) {
      orgs.push({ org, action: "none", reason: "pinned" });
      continue;
    }
    const k = await knownAccounts(home);
    const active = effectiveActives({ known: k, rows, orgDirs: await readOrgActives(home) })[org];
    const pool = poolOf(org, k.accounts, rows);
    let decision = pickOrgAutoSwitch(await rebuildContract(home), { org, active, pool, now, excluded });
    if (decision.action === "switch") {
      const { from, to } = await switchOrgAccount(org, decision.to, { onlyFrom: decision.from });
      if (from === to) decision = { action: "none", reason: "moved" };
    }
    await record(home, decision, now, org);
    orgs.push({ org, ...decision });
  }
  const first = orgs.find((d) => d.action === "switch") ?? orgs.find((d) => d.action === "stay") ?? { action: "none", reason: "underLine" };
  const k = await knownAccounts(home);
  const actives = effectiveActives({ known: k, rows, orgDirs: await readOrgActives(home) });
  const sessions = await moveSessions(home, now, { known: k, actives, pinned, scoped: true });
  return { ...first, orgs, ...(sessions.length > 0 ? { sessions } : {}) };
}

// Restarts the sessions pickSessionMoves moves, through afterUse (the restart
// setting applies: keep moves none, ask asks). Terminals are read only when
// some account is at the line, so a quiet poll calls no hc. A failed read
// leaves every session where it is.
async function moveSessions(home, now, { known, actives, pinned, scoped = false }) {
  const doc = await rebuildContract(home);
  if (!(doc.accounts ?? []).some((a) => atLine(a, now, SWITCH_LINE))) return [];
  let sessions;
  try {
    const listed = await listClaudeTerminals();
    sessions = await Promise.all(listed.map(async ({ terminal }) => {
      const found = await inspectTerminal(terminal, known);
      return { terminal, account: found.kind === "claude" ? found.account : null, org: await orgOfCwd(found.cwd) };
    }));
  } catch {
    return [];
  }
  const moves = pickSessionMoves(doc, { sessions, actives, pinned, now });
  for (const m of moves) {
    await afterUse(m.from, m.to, scoped ? { scopes: [m.org] } : {});
    await record(home, { action: "switch", from: m.from, to: m.to, window: m.window, percent: m.percent }, now, scoped ? m.org : undefined);
  }
  return moves;
}

// ── auto-switch ─────────────────────────────────────────────────────────────

const usageError = () => failure("usage: claude-accounts auto-switch check | exclude <id> | include <id>", 64);

export async function autoSwitchCommand(args) {
  const { values, positionals } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: true, allowPositionals: true });
  const [verb, id] = positionals;
  const print = (value, human) => process.stdout.write(values.json ? render(value) : `${human}\n`);
  if (verb === "check" && positionals.length === 1) {
    const d = await checkAutoSwitch();
    const say = (x) => (x.action === "switch" ? `Switched from ${x.from} to ${x.to}.` : x.action === "stay" ? `Stays on ${x.from}: no account has room.` : `Nothing to do (${x.reason}).`);
    const moved = (d.sessions ?? []).map((m) => `${m.terminals.join(", ")}: moves from ${m.from} to ${m.to} (${m.window} at ${m.percent}%).`);
    print(d, [d.orgs ? d.orgs.map((x) => `${x.org}: ${say(x)}`).join("\n") : say(d), ...moved].join("\n"));
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
