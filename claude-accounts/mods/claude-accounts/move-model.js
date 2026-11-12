// "Move this session to…" (S4): one terminal's Claude to another account,
// without changing the active account and without touching any other
// terminal. Pure: no herdr or gpui-kit import, so `node --test` loads it;
// move.js only draws it and runs what it says.
//
// The move is the CLI's `resume --terminal <t> --account <id>` (CONTRACT.md):
// it never writes `active`, and it queues one job, for that terminal only.
// Nothing here restarts anything itself.
//
//   isPayPerUse(account)            S3: an Enterprise or Team login, billed per use
//   moveTarget(focused, terminals)  the terminal to move: Herdr's focused one, with its title
//   moveModel({accounts, target, on, pending, error})
//                                   what the dialog shows
//   moveStep(state, event)          what a pick, a Move or a Cancel does: { pending, run }
//   moveArgs(t, id)                 the CLI command a move runs
//   moveStarted(result, {…})        what `resume` answered: { job, error, notify }
//   addMove(moves, job, target, now) the shared value toasts.js follows the job by
//
// Accounts are store.js's readAccounts() (or its `accounts` list).

import { accountsList, accountLabel } from "./accounts-model.js";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);

// The shared key the moves started here live under: { "<job>": { at, where } }.
// toasts.js reports only these resume jobs; Spotlight's stay its own.
export const MOVES_KEY = "claude-accounts.moves";
const KEEP_MS = 2 * 24 * 60 * 60_000;

// S3: an account billed per API use, never a personal subscription.
const PAY_PER_USE = new Set(["Enterprise", "Team"]);
export const PAY_PER_USE_TAG = "API · pay per use";
export function isPayPerUse(account) {
  return isObject(account) && PAY_PER_USE.has(account.plan);
}

export const moveArgs = (terminal, id) => ["resume", "--terminal", terminal, "--account", id, "--json"];

const SIGN_IN_HINT = "Sign in again to use this account";
const NO_TERMINAL = "Click a Claude terminal first, then choose Move this session to….";

// Herdr's focused() and terminals(): the terminal to move, or null.
export function moveTarget(focused, terminals) {
  const address = str(focused?.terminal);
  if (!address) return null;
  const t = (Array.isArray(terminals) ? terminals : []).find((x) => isObject(x) && x.address === address);
  return { terminal: address, title: str(t?.name) ?? str(t?.title) ?? null };
}

const where = (target) => target?.title ?? target?.terminal ?? "this terminal";

// The accounts a move can go to: System default only while it's the active
// account (as the panel lists it), never the one the terminal runs on.
function candidates(accounts, on) {
  const list = accountsList(accounts);
  const active = str(isObject(accounts) ? accounts.active : null) ?? "default";
  const here = str(on?.account) ?? (on ? null : active);
  return list.filter((a) => {
    const isDefault = a.isDefault === true || a.id === "default";
    if (isDefault && active !== "default") return false;
    return a.id !== here;
  });
}

const findCandidate = (state, id) => candidates(state.accounts, state.on).find((a) => a.id === id) ?? null;
const canMoveTo = (a) => Boolean(a) && a.needsSignIn !== true;

// S3's confirmation, for this one session.
function confirmCopy(account) {
  const name = str(account?.email) ?? str(account?.label) ?? "This account";
  return {
    title: "Move this session to pay per use?",
    body: `${name} is billed per API use. This Claude session continues on it, and what it uses from now on is charged per use. The active account and your other sessions stay as they are.`,
    move: "Move to pay per use",
    cancel: "Cancel",
  };
}

//   target   moveTarget(), null when no terminal is focused
//   on       `terminal <t> --json`'s answer, null before it's read
//   pending  the pay-per-use account waiting for its confirmation, or null
//   error    why the last move didn't start (moveStarted's error), or null
export function moveModel({ accounts, target = null, on = null, pending = null, error = null } = {}) {
  const title = "Move this session to…";
  if (!target) return { title, subtitle: null, rows: [], confirm: null, error: NO_TERMINAL };
  const rows = candidates(accounts, on).map((a) => {
    const isDefault = a.isDefault === true || a.id === "default";
    return {
      id: a.id,
      label: isDefault ? "System default" : (str(a.email) ?? str(a.label) ?? "Claude account"),
      plan: str(a.plan),
      tag: isPayPerUse(a) ? PAY_PER_USE_TAG : null,
      disabled: !canMoveTo(a),
      hint: canMoveTo(a) ? null : SIGN_IN_HINT,
    };
  });
  const asked = pending ? findCandidate({ accounts, on }, pending) : null;
  return {
    title,
    subtitle: `Claude in ${where(target)}. The active account and your other sessions stay as they are.`,
    rows,
    confirm: asked && isPayPerUse(asked) ? confirmCopy(asked) : null,
    error: str(error),
  };
}

// state: { accounts, target, on, pending }; event: { type: "pick", id } |
// { type: "confirm" } | { type: "cancel" }. run is the CLI argv to run now,
// or null: nothing runs before a pay-per-use account is confirmed.
export function moveStep(state, event) {
  const none = { pending: null, run: null };
  const s = isObject(state) ? state : {};
  const terminal = str(s.target?.terminal);
  if (!terminal || !isObject(event)) return none;
  if (event.type === "cancel") return none;
  if (event.type === "confirm") {
    const a = s.pending ? findCandidate(s, s.pending) : null;
    return canMoveTo(a) ? { pending: null, run: moveArgs(terminal, a.id) } : none;
  }
  if (event.type !== "pick") return none;
  const a = findCandidate(s, event.id);
  if (!canMoveTo(a)) return none;
  if (isPayPerUse(a)) return { pending: a.id, run: null };
  return { pending: null, run: moveArgs(terminal, a.id) };
}

// "claude-accounts resume: terminal t2 isn't running Claude" → "Terminal t2 isn't running Claude."
function sentence(text) {
  const s = String(text ?? "").replace(/^claude-accounts [a-z-]+: /, "").trim();
  if (!s) return null;
  const up = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

// What `resume` answered (exec's { code, stdout, stderr }, or the error exec
// rejected with): the job to follow and the toast that says it started, or
// the CLI's own words for why it didn't (shown in the dialog).
export function moveStarted(result, { accounts, target, id } = {}) {
  if (result instanceof Error) return { job: null, error: sentence(result.message || String(result)), notify: null };
  if (isObject(result) && result.code === 0) {
    let job = null;
    try {
      job = str(JSON.parse(String(result.stdout ?? "")).job);
    } catch {
      job = null;
    }
    if (job) {
      return {
        job,
        error: null,
        notify: {
          title: `Moving Claude in ${where(target)} to ${accountLabel(accounts, id)}`,
          body: "It restarts there once it's idle. Your other sessions stay as they are.",
          level: "info",
        },
      };
    }
    return { job: null, error: "claude-accounts resume didn't return a job.", notify: null };
  }
  const last = String(result?.stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
  return { job: null, error: sentence(last) ?? `claude-accounts resume exited ${result?.code}.`, notify: null };
}

// The shared value with this job added, its terminal's title kept for the
// toasts, and entries older than two days gone.
export function addMove(moves, job, target, now = Date.now()) {
  const next = {};
  if (isObject(moves)) {
    for (const [k, v] of Object.entries(moves)) {
      if (isObject(v) && typeof v.at === "number" && now - v.at <= KEEP_MS) next[k] = v;
    }
  }
  next[job] = { at: now, where: where(target) };
  return next;
}
