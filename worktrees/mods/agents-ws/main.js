// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// agents-ws: Herdr's `agents` (0.1.15) plus background processes (watchers, jobs,
// dev servers) nested under whoever launched them, a click shows their output;
// Claudes that haven't reported a status yet; agents named by their terminal name
// rather than a tab number; a gold star on the main orchestrator (a project's main
// checkout on main); and Background, for processes whose agent has ended.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, hc, exec, theme, settings, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";
import { isProcess, procName, procState, track, withEnded, tree as procTree, quietAgents, bySpace, orphans, projectOf, isLiveMain } from "./model.js";

// The main orchestrator's star, the same soft gold as the pane header's.
const GOLD = "#c9a75a";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const PROCS_KEY = "procs";
const loadJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};
// A process's state color: running in the working color, done green, failed in the blocked color.
const procColor = (t, kind) => (kind === "running" ? t.working : kind === "done" ? t.ansi2 ?? t.done : t.blocked);

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    if (props()?.output) return this.initOutput(cx);
    // Background processes this list has seen (see model.js track), and the final
    // state of ones that left the core's list, looked up once with `hc get`.
    this.procs = loadJSON(PROCS_KEY, {});
    this.ended = {};
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    // Which agents are the main orchestrator: their program's live folder (`hc get`,
    // Herdr's pane folder lags) and its branch, looked at every 10 s.
    this.main = {};
    this.agentAddrs = [];
    cx.timer.every(10000, (cx) => this.refreshMain(cx));
  }

  refreshMain(cx) {
    if (this.readingMain) return;
    this.readingMain = true;
    cx.spawn(async (cx) => {
      const next = {};
      for (const address of this.agentAddrs) {
        if (address.includes("/")) continue; // another machine's
        try {
          const r = await hc(["get", address, "--json"]);
          const cwd = r.code === 0 ? JSON.parse(r.stdout).foreground?.cwd : null;
          if (!cwd || !isLiveMain(cwd, "main")) continue; // only a main checkout needs its branch read
          const b = await exec("git", ["branch", "--show-current"], { cwd });
          if (b.code === 0 && isLiveMain(cwd, b.stdout.trim())) next[address] = true;
        } catch {}
      }
      this.readingMain = false;
      if (JSON.stringify(next) !== JSON.stringify(this.main)) { this.main = next; cx.notify(); }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents and shown processes of `addr`, depth first, each with the
  // tree lines in front of it (model.js tree).
  tree(all, addr) {
    return procTree(all, addr, this.procs, this.now ?? Date.now());
  }

  // Stamps processes and looks up, once, the final state of ones that left the list.
  trackProcs(all, now, cx) {
    const { dirty, vanished } = track(this.procs, all, now);
    if (dirty) localStorage.setItem(PROCS_KEY, JSON.stringify(this.procs));
    for (const address of vanished) {
      cx.spawn(async (cx) => {
        try {
          const r = await hc(["get", address, "--json"]);
          const t = r.code === 0 ? JSON.parse(r.stdout) : null;
          if (t && isProcess(t)) this.ended[address] = t;
        } catch {}
        cx.notify();
      });
    }
  }

  openOutput(k, state) {
    // Opening a process counts as having seen it: a failed one leaves the list.
    this.procs[k.address] = { ...(this.procs[k.address] ?? {}), seen: true };
    localStorage.setItem(PROCS_KEY, JSON.stringify(this.procs));
    openOverlay({ mod: "agents-ws", kind: "popup", width: 460, height: 320, props: { output: k.address, name: procName(k), state } });
  }

  // A process row: tree lines, a ▸, its name, and running / ✓ age / exit code.
  procRow(t, s, now) {
    const k = s.t;
    const state = procState(k, this.procs[k.address], now);
    return h_flex()
      .id(`proc-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(24)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(11.5)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.openOutput(k, state))
      .tooltip(`${procName(k)} · ${k.address}`)
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(16).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .child(div().w(14).mr(8).flex_none().text_size(10).text_color(t.dim).text_center().child("▸"))
      .child(div().flex_1().min_w(0).truncate().font_family(settings().font_family ?? "JetBrains Mono").text_color(t.dim).child(procName(k)))
      .child(div().flex_none().pl(6).text_size(10.5).font_family(settings().font_family ?? "JetBrains Mono").text_color(procColor(t, state.kind)).child(state.text));
  }

  // The output popup: a process's last 40 lines, read again every 2 s while it runs.
  initOutput(cx) {
    this.procs = loadJSON(PROCS_KEY, {});
    this.text = "";
    const read = (cx) => cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", props().output, "--lines", "40"]);
        this.text = r.code === 0 ? r.stdout : (r.stderr || "Its output is gone.").trim();
      } catch (error) { this.text = String(error); }
      cx.notify();
    });
    read(cx);
    cx.timer.every(2000, (cx) => {
      const k = terminals().find((x) => x.address === props().output);
      if (k?.state === "live") read(cx);
    });
  }

  output(t) {
    const p = props();
    const k = terminals().find((x) => x.address === p.output);
    const state = k ? procState(k, this.procs?.[k.address], Date.now()) : p.state;
    const mono = settings().font_family ?? "JetBrains Mono";
    return v_flex()
      .size_full()
      .bg(t.popover)
      .child(h_flex()
        .px(10)
        .h(34)
        .flex_none()
        .gap(10)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .font_family(mono)
        .text_size(12)
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`▸ ${p.name}`))
        .when(Boolean(state), el => el.child(div().flex_none().text_size(10.5).text_color(procColor(t, state.kind)).child(state.text)))
        .child(div()
          .id("output-close")
          .flex_none()
          .px(4)
          .rounded(4)
          .text_size(14)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Close (Esc)")
          .on_click(() => closeOverlay(p.overlay))
          .child("×")))
      .child(div()
        .id("output-text")
        .flex_1()
        .min_h(0)
        .p(10)
        .overflow_y_scrollbar()
        .font_family(mono)
        .text_size(11.5)
        .text_color(t.muted)
        .children((this.text || "Reading…").replace(/\s+$/, "").split("\n").map((line) => div().min_h(15).child(line))));
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) || k.paned ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.output) return this.output(t);
    const collapsed = narrow();
    const sort = sortOf();
    const sp = spaces();
    const ps = panes();
    let list = agents();
    list = bySpace([...list, ...quietAgents(ps, new Set(list.map((a) => a.address)), sp)], sp);
    const firstLook = !this.agentAddrs.length && list.length;
    this.agentAddrs = list.map((a) => a.address);
    if (firstLook) this.refreshMain(cx);
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const live = terminals();
    const names = new Map(live.filter((k) => k.name).map((k) => [k.address, k.name]));
    const paned = new Set(ps.map((p) => p.terminal).filter(Boolean));
    for (const k of live) k.paned = paned.has(k.address);
    this.migratePins(live);
    const shown = focused()?.agent;
    const now = Date.now();
    this.now = now;
    this.track(list, now);
    this.trackProcs(live, now, cx);
    const all = withEnded(live, this.ended);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => (s.proc ? this.procRow(t, s, now) : this.subRow(t, s, shown, byPriority)))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      // A name given to the terminal (`hc run --name orch-1`) wins; a tab number never shows.
      const plain = more ?? label(a);
      const name = full ? a.space_name || label(a) : names.get(a.address) || (/^\d+$/.test(plain) ? a.program?.name || plain : plain);
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(Boolean(this.main[a.address]), el => el.child(div().id(`main-${a.address}`).flex_none().text_size(11).text_color(GOLD)
            .tooltip("Main orchestrator: the project's main checkout, on main").child("\u2605")))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    // Background: processes whose agent has ended, under the group of their project
    // (by folder), else in a group of their own at the end.
    const lost = collapsed ? [] : orphans(all, this.procs, now);
    const home = new Map();
    for (const k of lost) {
      const g = !byPriority && groups.find((x) => x.id !== "pinned" && x.label && x.label === projectOf(k.cwd));
      const id = g ? g.id : "background";
      home.set(id, [...(home.get(id) ?? []), k]);
    }
    const background = (id) => {
      const ks = home.get(id) ?? [];
      if (!ks.length) return [];
      return [
        h_flex().id(`bg-${id}`).pl(39).h(24).flex_none().items_center().text_size(11.5).italic().text_color(t.dim).child("Background"),
        ...ks.map((k, i) => this.procRow(t, { t: k, lines: [i === ks.length - 1 ? "└" : "├"] }, now)),
      ];
    };
    if (home.has("background")) groups.push({ id: "background", label: "Background", status: null, members: [] });
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : [...g.members.flatMap(withKids), ...background(g.id)])]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agents-ws", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
