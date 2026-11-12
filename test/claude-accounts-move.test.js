// claude-accounts S4: "Move this session to…", one terminal's Claude to
// another account, without changing the active account or touching any other
// terminal, and S3's confirmation first when the target is billed per use.
// All pure: move-model.js decides what the move dialog shows and which CLI
// command it runs; toasts.js says how a move it started goes. The CLI side
// (the command really moving one terminal only) is in
// claude-accounts-restart.test.js, against its fake terminals.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOVES_KEY, PAY_PER_USE_TAG, isPayPerUse, moveArgs, moveModel, moveStep, moveStarted, addMove, moveTarget,
} from "../claude-accounts/mods/claude-accounts/move-model.js";
import { react } from "../claude-accounts/mods/claude-accounts/toasts.js";
import { readAccounts, readRestart } from "../claude-accounts/mods/claude-accounts/store.js";

const NOW = 1794000000000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const ANA = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"; // Max 5x, active
const BEN = "7c9e6679-7425-40de-944b-e07fc1f90ae7"; // Max 20x
const ENT = "e1e1e1e1-5555-4555-8555-555555555555"; // Enterprise: pay per use
const TEAM = "7e7e7e7e-6666-4666-8666-666666666666"; // Team: pay per use
const LAPSED = "1a1a1a1a-7777-4777-8777-777777777777"; // Max, needs sign-in

const account = (id, email, plan, extra = {}) => ({
  id, label: email, email, org: null, plan, configDir: `/p/${id}/home`, isDefault: false, needsSignIn: false,
  error: null, errorDetail: null, usage: { session: null, weekly: null, fable: null, monthly: null }, credits: null,
  usageUpdatedAt: null, lastAuthenticatedAt: null, duplicateOf: null, signedInAs: null, ...extra,
});
const DOC = readAccounts(JSON.stringify({
  version: 1,
  updatedAt: NOW,
  active: ANA,
  accounts: [
    { ...account("default", "dee@example.com", "Pro"), label: "System default", configDir: null, isDefault: true },
    account(ANA, "ana@example.com", "Max 5x"),
    account(BEN, "ben@example.org", "Max 20x"),
    account(ENT, "samir@work.example", "Enterprise"),
    account(TEAM, "team@work.example", "Team"),
    account(LAPSED, "old@example.com", "Max", { needsSignIn: true }),
  ],
}));

// The terminal the dialog moves, as the move command hands it over.
const T1 = { terminal: "t1", title: "claude · herdr-plugins" };
// What `terminal t1 --json` said: Claude there runs on ana.
const ON_ANA = { account: ANA, sessionId: "s-1", status: "idle", resumable: true };

// ── S3's rule, for this action ───────────────────────────────────────────────

test("isPayPerUse: Enterprise and Team are billed per use; Max, Pro, no plan or no account aren't", () => {
  for (const plan of ["Enterprise", "Team"]) assert.equal(isPayPerUse({ plan }), true, plan);
  for (const plan of ["Max 5x", "Max 20x", "Max", "Pro", null, undefined, "", "enterprise "]) assert.equal(isPayPerUse({ plan }), false, String(plan));
  assert.equal(isPayPerUse(null), false);
  assert.equal(isPayPerUse(undefined), false);
});

// ── The dialog ───────────────────────────────────────────────────────────────

test("moveModel: names the terminal, lists every account but the one it runs on, with its plan and the pay-per-use tag", () => {
  const m = moveModel({ accounts: DOC, target: T1, on: ON_ANA });
  assert.equal(m.title, "Move this session to…");
  assert.equal(m.subtitle, "Claude in claude · herdr-plugins. The active account and your other sessions stay as they are.");
  assert.deepEqual(m.rows.map((r) => [r.id, r.label, r.plan, r.tag, r.disabled]), [
    [BEN, "ben@example.org", "Max 20x", null, false],
    [ENT, "samir@work.example", "Enterprise", PAY_PER_USE_TAG, false],
    [TEAM, "team@work.example", "Team", PAY_PER_USE_TAG, false],
    [LAPSED, "old@example.com", "Max", null, true],
  ], "ana (where it runs) and System default (not the active one) aren't listed");
  assert.equal(PAY_PER_USE_TAG, "API · pay per use");
  assert.equal(m.rows.at(-1).hint, "Sign in again to use this account");
  assert.equal(m.confirm, null);
  assert.equal(m.error, null);
});

test("moveModel: before the terminal is read every account but the active one shows; System default shows while it's active", () => {
  const unread = moveModel({ accounts: DOC, target: T1, on: null });
  assert.deepEqual(unread.rows.map((r) => r.id), [BEN, ENT, TEAM, LAPSED]);
  const onDefault = readAccounts(JSON.stringify({ ...DOC, active: "default" }));
  const m = moveModel({ accounts: onDefault, target: T1, on: ON_ANA });
  assert.deepEqual(m.rows.map((r) => r.id), ["default", BEN, ENT, TEAM, LAPSED]);
  assert.equal(m.rows[0].label, "System default");
});

test("moveModel: no terminal to move says so and lists nothing", () => {
  const m = moveModel({ accounts: DOC, target: null, on: null });
  assert.deepEqual(m.rows, []);
  assert.equal(m.error, "Click a Claude terminal first, then choose Move this session to….");
});

test("moveStep: a subscription account runs `resume` on this terminal at once, never `use`", () => {
  const r = moveStep({ accounts: DOC, target: T1, on: ON_ANA, pending: null }, { type: "pick", id: BEN });
  assert.deepEqual(r, { pending: null, run: ["resume", "--terminal", "t1", "--account", BEN, "--json"] });
  assert.deepEqual(moveArgs("t1", BEN), r.run);
});

test("moveStep (S3): a pay-per-use account asks first; Move runs `resume`, Cancel runs nothing", () => {
  for (const id of [ENT, TEAM]) {
    const asked = moveStep({ accounts: DOC, target: T1, on: ON_ANA, pending: null }, { type: "pick", id });
    assert.deepEqual(asked, { pending: id, run: null }, "nothing runs before the answer");
    const shown = moveModel({ accounts: DOC, target: T1, on: ON_ANA, pending: id });
    assert.deepEqual(shown.confirm, {
      title: "Move this session to pay per use?",
      body: `${id === ENT ? "samir@work.example" : "team@work.example"} is billed per API use. This Claude session continues on it, and what it uses from now on is charged per use. The active account and your other sessions stay as they are.`,
      move: "Move to pay per use",
      cancel: "Cancel",
    });
    assert.deepEqual(moveStep({ accounts: DOC, target: T1, on: ON_ANA, pending: id }, { type: "confirm" }), { pending: null, run: moveArgs("t1", id) });
    assert.deepEqual(moveStep({ accounts: DOC, target: T1, on: ON_ANA, pending: id }, { type: "cancel" }), { pending: null, run: null });
  }
});

test("moveStep: an account that needs sign-in, the one it already runs on, an unknown one, or no terminal runs nothing", () => {
  const state = { accounts: DOC, target: T1, on: ON_ANA, pending: null };
  for (const id of [LAPSED, ANA, "no-such-account"]) assert.deepEqual(moveStep(state, { type: "pick", id }), { pending: null, run: null }, id);
  assert.deepEqual(moveStep({ ...state, target: null }, { type: "pick", id: BEN }), { pending: null, run: null });
  assert.deepEqual(moveStep(state, { type: "confirm" }), { pending: null, run: null }, "a confirm with nothing asked runs nothing");
});

// ── What `resume` answered ───────────────────────────────────────────────────

test("moveStarted: a job is a toast and a job to follow; a refusal is the CLI's own words, kept in the dialog", () => {
  const ok = moveStarted({ code: 0, stdout: '{"job":"rs-1a2b3c4d"}\n', stderr: "" }, { accounts: DOC, target: T1, id: ENT });
  assert.deepEqual(ok, {
    job: "rs-1a2b3c4d",
    error: null,
    notify: { title: "Moving Claude in claude · herdr-plugins to samir@work.example", body: "It restarts there once it's idle. Your other sessions stay as they are.", level: "info" },
  });
  const cases = [
    [3, "claude-accounts resume: terminal t2 isn't running Claude\n", "Terminal t2 isn't running Claude."],
    [2, "claude-accounts resume: there's no conversation to resume yet in terminal t6: Claude hasn't saved session s-6 (it has no messages)\n",
      "There's no conversation to resume yet in terminal t6: Claude hasn't saved session s-6 (it has no messages)."],
    [8, "claude-accounts resume: Claude is terminal t3's own program: there's no shell to restart it in\n", "Claude is terminal t3's own program: there's no shell to restart it in."],
  ];
  for (const [code, stderr, error] of cases) {
    assert.deepEqual(moveStarted({ code, stdout: "", stderr }, { accounts: DOC, target: T1, id: BEN }), { job: null, error, notify: null }, `exit ${code}`);
  }
  assert.deepEqual(moveStarted(new Error("exec timed out"), { accounts: DOC, target: T1, id: BEN }), { job: null, error: "Exec timed out.", notify: null });
});

test("addMove: records the job with its terminal's title, keeps others, and forgets ones older than two days", () => {
  const old = { "rs-old": { at: NOW - 3 * DAY, where: "x" }, "rs-keep": { at: NOW - DAY, where: "y" } };
  assert.equal(MOVES_KEY, "claude-accounts.moves");
  assert.deepEqual(addMove(old, "rs-new", T1, NOW), { "rs-keep": { at: NOW - DAY, where: "y" }, "rs-new": { at: NOW, where: "claude · herdr-plugins" } });
  assert.deepEqual(addMove(null, "rs-new", { terminal: "t9", title: null }, NOW), { "rs-new": { at: NOW, where: "t9" } });
});

test("moveTarget: the focused terminal and its title from Herdr's list, or null when none is focused", () => {
  const list = [{ address: "t1", name: "claude · herdr-plugins" }, { address: "t2", title: "zsh" }];
  assert.deepEqual(moveTarget({ terminal: "t1" }, list), { terminal: "t1", title: "claude · herdr-plugins" });
  assert.deepEqual(moveTarget({ terminal: "t2" }, list), { terminal: "t2", title: "zsh" });
  assert.deepEqual(moveTarget({ terminal: "t7" }, list), { terminal: "t7", title: null });
  assert.equal(moveTarget({ terminal: null }, list), null);
  assert.equal(moveTarget(null, list), null);
});

// ── How a move goes (toasts.js) ──────────────────────────────────────────────

const job = (id, state, extra = {}) => ({
  id, kind: "resume", terminal: "t1", from: ANA, to: ENT, sessionId: "3f1c2b7e-8a4d-4e55-9a51-0c2d6f1b7a10",
  args: [], message: null, state, code: null, detail: null, claimedBy: null, updatedAt: NOW - MIN, ...extra,
});
const queue = (...items) => readRestart(JSON.stringify({ items }));
const moves = { "rs-1": { at: NOW - MIN, where: "claude · herdr-plugins" } };
const run = (state, seen = {}) => react({ accounts: DOC, now: NOW, ...state }, seen);

test("react: a move's job says it's busy, then done, each once", () => {
  const busy = run({ restart: queue(job("rs-1", "waitingIdle")), moves });
  assert.deepEqual(busy.notify, [{
    title: "Claude in claude · herdr-plugins is busy",
    body: "It moves to samir@work.example once it's idle.",
    level: "info",
    action: { name: "pane.focus", args: { terminal: "t1" } },
  }]);
  assert.deepEqual(run({ restart: queue(job("rs-1", "waitingIdle")), moves }, busy.seen).notify, []);
  const done = run({ restart: queue(job("rs-1", "done", { code: 0 })), moves }, busy.seen);
  assert.deepEqual(done.notify, [{
    title: "Moved Claude in claude · herdr-plugins to samir@work.example",
    level: "success",
    action: { name: "pane.focus", args: { terminal: "t1" } },
  }]);
  assert.deepEqual(run({ restart: queue(job("rs-1", "done", { code: 0 })), moves }, done.seen).notify, []);
});

test("react: a move that failed gives the manual line and why, as a switch's does; a cancelled one says nothing", () => {
  const line = "CLAUDE_ACCOUNTS_DIR=/p/e/home claude --resume 3f1c2b7e-8a4d-4e55-9a51-0c2d6f1b7a10";
  const failed = run({ restart: queue(job("rs-1", "failed", { code: 9, detail: `the shell didn't come back within 30 s: ${line}` })), moves });
  assert.deepEqual(failed.notify, [{
    title: "Couldn't restart Claude in claude · herdr-plugins",
    body: "Run claude --resume 3f1c2b7e-8a4d-4e55-9a51-0c2d6f1b7a10 there. The shell didn't come back within 30 s.",
    level: "error",
    action: { name: "pane.focus", args: { terminal: "t1" } },
  }]);
  assert.deepEqual(run({ restart: queue(job("rs-1", "cancelled", { code: 10 })), moves }).notify, []);
});

test("react: a resume job the move didn't start (Spotlight's) still says nothing, as before", () => {
  const r = run({ restart: queue(job("rs-other", "done", { code: 0 }), job("rs-2", "failed", { code: 9, detail: "x" })), moves });
  assert.deepEqual(r.notify, []);
  assert.deepEqual(run({ restart: queue(job("rs-1", "done", { code: 0 })) }).notify, [], "no moves given: no move toasts");
});

test("reactState hands the moves on to toasts.react; none given reads as none", async () => {
  const { reactState } = await import("../claude-accounts/mods/claude-accounts/footer-model.js");
  assert.equal(reactState({ doc: DOC, restart: null, pending: null, link: null, moves, now: NOW }).moves, moves);
  assert.equal(reactState({ doc: DOC, restart: null, pending: null, link: null, now: NOW }).moves, null);
});
