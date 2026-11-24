// agents-tree's message flights and agent history. Messages between terminals (`hc send`) come
// from the history ledger (GET /api/history, oldest first): the sender's row lets a small paw
// fly out, the receiver's row glows and keeps a dot until it is focused or answers, and a
// row's history opens as a quiet chat below it. These are the pure rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historyUrl, messageOf, ingestHistory, noteMessage, firstWords, clearDots, liveFlights, flightRows, dotTip,
  historyItems, FLIGHT_MS, emptyFlights,
} from "../worktrees/mods/agents-tree/flight.js";

const who = (address, name) => ({ address, name, org: "personal" });
const message = (id, ts, from, to, text = "Review x.rs") => ({ id, ts, kind: "message", from, to, text, state: null });
const state = (id, ts, of, s) => ({ id, ts, kind: "state", from: of, to: null, text: "", state: s });
const ORCH = who("t62", "orch-workspace");
const LEAD = who("t126", "project-lead-row");
const OTHER = who("t9", "merged-cleanup");

test("historyUrl asks the core for one terminal's history, only with the filters given", () => {
  assert.equal(historyUrl("http://127.0.0.1:4317", { limit: 50 }), "http://127.0.0.1:4317/api/history?limit=50");
  assert.equal(historyUrl("http://c", { terminal: "t126", with: "t62", limit: 40, before: 1700 }),
    "http://c/api/history?terminal=t126&with=t62&limit=40&before=1700");
  assert.equal(historyUrl("http://c", {}), "http://c/api/history");
});

test("messageOf reads a message entry; state entries and broken entries are not messages", () => {
  assert.deepEqual(messageOf(message("m1", 1000, ORCH, LEAD, "From t62, new task")),
    { id: "m1", from: "t62", name: "orch-workspace", to: "t126", text: "From t62, new task" });
  assert.equal(messageOf(state("s1", 1000, LEAD, "working")), null);
  assert.equal(messageOf({ id: "x", kind: "message", from: null, to: LEAD }), null);
});

test("the first read of the ledger only marks what is there: old messages never fly", () => {
  const s = ingestHistory(emptyFlights(), [message("m1", 1000, ORCH, LEAD)], { focused: null, now: 5000 });
  assert.equal(s.ready, true);
  assert.deepEqual(s.flights, []);
  assert.deepEqual(s.dots, {});
});

test("a new message entry flies from sender to receiver and leaves a dot on the receiver", () => {
  let s = ingestHistory(emptyFlights(), [], { now: 1000 });
  s = ingestHistory(s, [message("m1", 2000, ORCH, LEAD, "From t62, new task here")], { focused: "t1", now: 3000 });
  assert.deepEqual(s.flights, [{ from: "t62", to: "t126", at: 3000 }]);
  assert.deepEqual(s.dots, { t126: { from: "t62", name: "orch-workspace", words: "From t62, new task here", at: 3000 } });
});

test("an entry read again on the next tick does not fly twice (keyed by entry id)", () => {
  let s = ingestHistory(emptyFlights(), [], { now: 1000 });
  s = ingestHistory(s, [message("m1", 2000, ORCH, LEAD)], { now: 3000 });
  assert.equal(ingestHistory(s, [message("m1", 2000, ORCH, LEAD)], { now: 8000 }), s);
  const next = ingestHistory(s, [message("m1", 2000, ORCH, LEAD), state("s1", 2100, LEAD, "working")], { now: 8000 });
  assert.deepEqual(next.flights, s.flights);
  assert.deepEqual(next.dots, s.dots);
});

test("two messages in one tick both fly, oldest first", () => {
  let s = ingestHistory(emptyFlights(), [], { now: 1000 });
  s = ingestHistory(s, [message("m1", 2000, ORCH, LEAD), message("m2", 2500, ORCH, OTHER)], { now: 3000 });
  assert.deepEqual(s.flights.map((f) => f.to), ["t126", "t9"]);
});

test("nothing happens when the receiver is the terminal in focus, but the entry counts as seen", () => {
  let s = ingestHistory(emptyFlights(), [], { now: 1000 });
  s = ingestHistory(s, [message("m1", 2000, ORCH, LEAD)], { focused: "t126", now: 3000 });
  assert.deepEqual(s.flights, []);
  assert.deepEqual(s.dots, {});
  assert.equal(ingestHistory(s, [message("m1", 2000, ORCH, LEAD)], { focused: null, now: 4000 }), s);
});

test("answering the sender clears the receiver's dot, and the answer flies back", () => {
  let s = noteMessage(emptyFlights(), { id: "m1", from: "t62", to: "t126", text: "go" }, { now: 1000 });
  s = noteMessage(s, { id: "m2", from: "t126", to: "t62", text: "Done: 60e4b66" }, { now: 2000 });
  assert.equal(s.dots.t126, undefined);
  assert.equal(s.dots.t62.from, "t126");
  assert.deepEqual(s.flights.map((f) => [f.from, f.to]), [["t62", "t126"], ["t126", "t62"]]);
});

test("answering someone else keeps the dot", () => {
  let s = noteMessage(emptyFlights(), { id: "m1", from: "t62", to: "t126", text: "go" }, { now: 1000 });
  s = noteMessage(s, { id: "m2", from: "t126", to: "t9", text: "help" }, { now: 2000 });
  assert.equal(s.dots.t126.from, "t62");
});

test("the dot stays until its terminal is focused, and goes when the terminal is gone", () => {
  let s = noteMessage(emptyFlights(), { id: "m1", from: "t62", to: "t126", text: "go" }, { now: 1000 });
  s = noteMessage(s, { id: "m2", from: "t62", to: "t5", text: "go" }, { now: 1000 });
  assert.equal(clearDots(s, { focused: "t1", live: new Set(["t62", "t126", "t5"]) }), s);
  assert.deepEqual(Object.keys(clearDots(s, { focused: "t126", live: new Set(["t62", "t126"]) }).dots), []);
});

test("the seen list stays bounded", () => {
  let s = ingestHistory(emptyFlights(), [], { now: 1 });
  const many = Array.from({ length: 700 }, (_, i) => state(`s${i}`, i, LEAD, "working"));
  s = ingestHistory(s, many, { now: 2 });
  assert.ok(s.seen.length <= 500);
  assert.ok(s.seen.includes("s699"));
});

test("firstWords keeps the first words only, never the full body", () => {
  assert.equal(firstWords("From t62, new task in your worktree, branch feat/message-flight"), "From t62, new task in your…");
  assert.equal(firstWords("Review x.rs"), "Review x.rs");
  assert.equal(firstWords("  spaced   out  "), "spaced out");
});

test("a flight lasts FLIGHT_MS, then only the dot remains", () => {
  const flights = [{ from: "a", to: "b", at: 1000 }, { from: "c", to: "d", at: 1000 + FLIGHT_MS }];
  assert.deepEqual(liveFlights(flights, 1000 + FLIGHT_MS + 1), [flights[1]]);
  assert.deepEqual(liveFlights(flights, 1000 + 2 * FLIGHT_MS + 1), []);
});

test("flightRows: both rows shown, the paw hops along every row between them", () => {
  const order = ["t1", "t62", "t5", "t8", "t126", "t9"];
  assert.deepEqual(flightRows(order, { from: "t62", to: "t126" }), { sender: "t62", receiver: "t126", between: ["t5", "t8"], down: true });
  assert.deepEqual(flightRows(order, { from: "t126", to: "t62" }), { sender: "t126", receiver: "t62", between: ["t8", "t5"], down: false });
});

test("flightRows: a row that is not shown keeps only the visible half, no path", () => {
  const order = ["t1", "t62", "t5"];
  assert.deepEqual(flightRows(order, { from: "t62", to: "t126" }), { sender: "t62", receiver: null, between: [], down: true });
  assert.deepEqual(flightRows(order, { from: "t99", to: "t5" }), { sender: null, receiver: "t5", between: [], down: true });
  assert.equal(flightRows(order, { from: "t98", to: "t99" }), null);
});

test("dotTip names the sender and the first words only", () => {
  assert.equal(dotTip({ from: "t62", name: "orch-workspace", words: "From t62, new task in your…" }), "from orch-workspace: From t62, new task in your…");
  assert.equal(dotTip({ from: "t7", name: null, words: "Review x.rs" }), "from t7: Review x.rs");
});

test("historyItems: bubbles with sender and time, oldest first, state changes as thin lines", () => {
  const at = (h, m) => new Date(2026, 10, 24, h, m).getTime();
  const items = historyItems([
    message("m1", at(14, 2), ORCH, LEAD, "From t62, new task"),
    state("s1", at(14, 3), LEAD, "working"),
    message("m2", at(14, 9), LEAD, ORCH, "Done: 60e4b66"),
    state("s2", at(14, 10), LEAD, "done"),
  ], "t126");
  assert.deepEqual(items, [
    { kind: "message", id: "m1", mine: false, who: "orch-workspace", to: "project-lead-row", time: "14:02", text: "From t62, new task" },
    { kind: "state", id: "s1", text: "project-lead-row working · 14:03" },
    { kind: "message", id: "m2", mine: true, who: "project-lead-row", to: "orch-workspace", time: "14:09", text: "Done: 60e4b66" },
    { kind: "state", id: "s2", text: "project-lead-row done · 14:10" },
  ]);
});

test("historyItems sorts by time, names a sender without a name by its address, and drops broken entries", () => {
  const items = historyItems([
    message("m2", 2000, { address: "t7" }, LEAD, "second"),
    message("m1", 1000, ORCH, LEAD, "first"),
    { id: "x", ts: 1500, kind: "message", from: null, to: null, text: "?" },
  ], "t126");
  assert.deepEqual(items.map((i) => [i.id, i.who]), [["m1", "orch-workspace"], ["m2", "t7"]]);
  assert.deepEqual(historyItems(null, "t1"), []);
});
