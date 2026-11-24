// Messages between terminals (`hc send`) and each agent's history, from the history ledger the
// mac-workspace core serves (GET /api/history, oldest first; a prompt hook records each
// delivered message). Herdr itself tells a mod nothing about a send. Pure rules here; main.js
// polls the ledger and draws them.

// How long the paw flies and the receiver glows, in ms. After that only the dot remains.
export const FLIGHT_MS = 1400;
const WORDS = 6;
const SEEN = 500;

// ready: the ledger was read once (what was there then never flies); seen: entry ids read.
export const emptyFlights = () => ({ ready: false, seen: [], dots: {}, flights: [] });

// The ledger URL, with only the filters given (terminal matches from or to; with: one conversation).
export function historyUrl(base, { terminal, with: other, limit, before } = {}) {
  const q = Object.entries({ terminal, with: other, limit, before }).filter(([, v]) => v != null && v !== "");
  return `${base}/api/history${q.length ? `?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : ""}`;
}

// A ledger message entry as { id, from, name, to, text }, or null (state entries, broken ones).
export function messageOf(e) {
  if (e?.kind !== "message" || !e.from?.address || !e.to?.address) return null;
  return { id: e.id, from: e.from.address, name: e.from.name ?? null, to: e.to.address, text: e.text ?? "" };
}

// The first few words of a message, never its whole body.
export function firstWords(text, n = WORDS) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
}

// One message { from, to, name, text }. The receiver in focus gets nothing. Otherwise the paw
// flies and the receiver keeps a dot. A message back to whoever wrote to `from` is its answer,
// so `from`'s own dot from `to` goes.
export function noteMessage(state, msg, { focused = null, now = Date.now() } = {}) {
  if (focused === msg.to) return state;
  const dots = { ...state.dots };
  if (dots[msg.from]?.from === msg.to) delete dots[msg.from];
  dots[msg.to] = { from: msg.from, name: msg.name ?? null, words: firstWords(msg.text), at: now };
  return { ...state, dots, flights: [...state.flights, { from: msg.from, to: msg.to, at: now }] };
}

// The ledger's latest entries, read on a tick. New message entries fly, oldest first; every
// entry is seen once by id. Nothing new: the same state.
export function ingestHistory(state, entries, { focused = null, now = Date.now() } = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e?.id != null);
  const seen = new Set(state.seen);
  const fresh = list.filter((e) => !seen.has(e.id)).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  if (state.ready && !fresh.length) return state;
  let next = { ...state, ready: true, seen: [...state.seen, ...fresh.map((e) => e.id)].slice(-SEEN) };
  if (!state.ready) return next;
  for (const e of fresh) {
    const m = messageOf(e);
    if (m) next = noteMessage(next, m, { focused, now });
  }
  return next;
}

// Dots go when their terminal is focused or gone. Unchanged: the same state.
export function clearDots(state, { focused = null, live = null } = {}) {
  const keep = Object.entries(state.dots).filter(([to]) => to !== focused && (!live || live.has(to)));
  if (keep.length === Object.keys(state.dots).length) return state;
  return { ...state, dots: Object.fromEntries(keep) };
}

// Flights still in the air at `now`.
export function liveFlights(flights, now) {
  return flights.filter((f) => now - f.at <= FLIGHT_MS);
}

// Which rows a flight animates, given the tree's row order top to bottom: the sender and the
// receiver when shown, and the rows between them (in flight order) when both are shown.
export function flightRows(order, { from, to }) {
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 && j < 0) return null;
  const down = i < 0 || j < 0 ? true : i < j;
  const between = i < 0 || j < 0 ? [] : down ? order.slice(i + 1, j) : order.slice(j + 1, i).reverse();
  return { sender: i < 0 ? null : from, receiver: j < 0 ? null : to, between, down };
}

// The dot's tooltip.
export function dotTip(dot) {
  return `from ${dot.name || dot.from}: ${dot.words}`;
}

const clock = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const nameOf = (p) => p?.name || p?.address || "?";

// One terminal's history as the panel shows it, oldest first: message bubbles (mine: it sent
// it) with sender and time, and state changes as thin lines.
export function historyItems(entries, terminal) {
  return (Array.isArray(entries) ? entries : [])
    .filter((e) => e?.id != null && (e.kind === "state" ? e.from?.address : e.kind === "message" && e.from?.address && e.to?.address))
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
    .map((e) => (e.kind === "state"
      ? { kind: "state", id: e.id, text: `${nameOf(e.from)} ${e.state} · ${clock(e.ts)}` }
      : { kind: "message", id: e.id, mine: e.from.address === terminal, who: nameOf(e.from), to: nameOf(e.to), time: clock(e.ts), text: e.text ?? "" }));
}
