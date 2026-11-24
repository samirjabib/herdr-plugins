// Agents as a tree: the Workspace Boss, each org's orchestrator under it, the org's projects
// under that (a one-line summary each), and the agents working in each project under it, with
// their branch, time, state and their live processes folded under them. The rail keeps a
// numbered list. Parents take their most urgent sub-agent's place.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, hc, readTextFile, checking } from "herdr";
import * as fs from "fs/promises";
import { helperLabels, helperBadge, projectLook, roleMark, roleOf, placeOf, orchOf, orgRootOf, isJob, buildTree, headBranch, hasGithub, projectSummary, parsePs, processTree, plumbingNote, procTotal, formatMem, bgState, bgLabel, bgVisible, sleepersOf, sleepTip, sleepEtas, sleepsIn, asleepIn, jobInfo } from "./model.js";

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

const ORG_LABEL = { workspace: "Workspace", cs: "CS", ag: "AG", personal: "Personal", other: "Other" };

// Space avatar colors (spaces-ws MARK: the same in every mod that draws space avatars).
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// The mac-workspace core (console server); it serves the app's picks at /api/colors.
const CORE = "http://127.0.0.1:4317";

// An org's color: the one picked in the mac-workspace app (via the core), else the color of
// its space here (the space at ~/mac-workspace/<org>), else null.
function orgColor(org) {
  const picked = (shared("workspace.colors") ?? {})[org];
  if (/^#[0-9a-f]{6}$/.test(picked ?? "")) return picked;
  const sp = spaces().find((x) => new RegExp(`/mac-workspace/${org}/?$`).test(x.folder ?? x.cwd ?? ""));
  return sp ? MARK[(shared("space.colors") ?? {})[sp.id]] ?? null : null;
}

// A role's quiet mark: the collie glyph (Collie is the app), no box, tinted per role: the Boss
// amber, an org lead its org's color, a project lead the accent, a worker muted, a helper dim.
// The tooltip names the role in one line. Fainter when the seat is off.
function roleIcon(t, id, mark, org, off = false) {
  if (!mark) return null;
  const color = { boss: t.warning ?? t.blocked, org: orgColor(org) ?? t.accent, project: t.accent, worker: t.muted, helper: t.dim }[mark.role] ?? t.dim;
  return svg("mods/agents-tree/collie.svg").id(id).size(12).flex_none().text_color(off ? color + "99" : color).tooltip(mark.tip);
}

// Where an agent runs, quiet: a branch glyph and the checkout's short name, dim, no box.
function placeChip(t, id, place) {
  return h_flex().id(id).flex_none().gap(3).items_center().text_size(10.5).text_color(t.dim)
    .tooltip(place === "main" ? "Runs in the main checkout" : `Runs in worktree ${place}`)
    .child(svg("mods/workspace-chrome/git-branch.svg").size(10).flex_none()).child(place);
}

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

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
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
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

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    this.helpersOpen = new Set(); // owners whose helpers are unfolded as rows
    // Finished terminals dismissed with their ×: hidden at once, and removed with `hc rm`.
    this.dismissed = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    // The org colors picked in the mac-workspace app, through its core (the bridge between the
    // two apps): shared as "workspace.colors" so every mod can paint an org the same way.
    const colors = async (cx) => {
      try {
        const r = await fetch(`${CORE}/api/colors`);
        const got = r.ok ? (await r.json())?.colors ?? {} : null;
        if (got && JSON.stringify(got) !== JSON.stringify(shared("workspace.colors") ?? {})) {
          setShared("workspace.colors", got);
          cx.notify();
        }
      } catch {} // core down: keep the last colors
    };
    cx.spawn(colors);
    // Sleeping agents (their terminals ended), from the same core: shown under their checkout
    // with a zzz, so the tree still says who works where.
    this.sleepers = [];
    const sleepers = async (cx) => {
      try {
        const r = await fetch(`${CORE}/api/agents`);
        if (!r.ok) return;
        const got = await r.json();
        const rows = Array.isArray(got) ? got : got?.agents;
        const etas = sleepEtas(rows);
        if (JSON.stringify([...etas]) !== JSON.stringify([...(this.etas ?? [])])) { this.etas = etas; cx.notify(); }
        const next = sleepersOf(rows);
        if (JSON.stringify(next) !== JSON.stringify(this.sleepers)) { this.sleepers = next; cx.notify(); }
      } catch {} // core down: keep the last list
    };
    this.refreshSleepers = sleepers;
    cx.spawn(sleepers);
    cx.timer.every(15000, (cx) => cx.spawn(sleepers));
    // Colors change rarely: once a minute is enough, and the core only reads one small file.
    cx.timer.every(60000, (cx) => cx.spawn(colors));
    // Live processes under each agent (S4) and each project's summary: read only in a live
    // window, never during a check.
    this.procs = new Map(); // agent address -> processTree ({ rows, plumbing })
    this.use = new Map(); // background terminal -> { cpu, rss } (procTotal)
    this.fg = {}; // background terminal -> its foreground program's argv (hc get)
    this.finished = new Map(); // finished terminals (terminals() lists live ones only) -> hc get

    this.procOpen = new Set(); // agents whose processes are unfolded
    this.pids = {}; // terminal -> its process id (hc get), stable for a terminal's life
    this.facts = new Map(); // project folder -> { branch, worktrees, github, behind, at, behindAt }
    this.bases = new Map(); // project folders the tree shows -> the space to open
    if (checking()) return;
    cx.timer.every(5000, (cx) => this.refreshProcs(cx));
    cx.timer.every(15000, (cx) => this.refreshFacts(cx));
    // The first look soon after start, once the tree has named its projects.
    cx.timer.after(1500, (cx) => { this.refreshProcs(cx); this.refreshFacts(cx); });
  }

  // Shown: the sidebar wide (the tree is drawn) and not hidden.
  shown() {
    return !narrow() && !find(layout(), "sidebar")?.hidden;
  }

  // One `ps` per refresh (at most every 5 s, only while shown), walked down from each local
  // agent's terminal process (its pid from `hc get`, asked once per terminal).
  refreshProcs(cx) {
    if (this.readingProcs || !this.shown()) return;
    this.readingProcs = true;
    cx.spawn(async (cx) => {
      try {
        const list = agents().filter((a) => !a.address.includes("/"));
        // Background terminals and jobs the tree shows (render keeps them in this.bg).
        const bg = [...(this.bg ?? [])].filter((x) => !x.includes("/"));
        for (const a of [...list, ...bg.map((address) => ({ address }))]) {
          if (this.pids[a.address]) continue;
          const r = await hc(["get", a.address, "--json"]).catch(() => null);
          const got = r?.code === 0 ? JSON.parse(r.stdout) : null;
          if (got?.pid) this.pids[a.address] = got.pid;
          if (got?.foreground?.argv) this.fg[a.address] = got.foreground.argv;
        }
        // Finished background terminals and job runs, for their done/failed and last run:
        // one `hc ls --all`, then one `hc get` per newly finished one (it no longer changes).
        const ls = await hc(["ls", "--all", "--json"]).catch(() => null);
        const ended = ls?.code === 0 ? (JSON.parse(ls.stdout).terminals ?? []).filter((x) => x.state === "finished") : [];
        const finished = new Map();
        for (const x of ended) {
          let got = this.finished.get(x.address);
          if (!got) {
            const r = await hc(["get", x.address, "--json"]).catch(() => null);
            got = r?.code === 0 ? JSON.parse(r.stdout) : null;
          }
          if (got && bgVisible(got, Date.now(), this.dismissed)) finished.set(x.address, got);
        }
        if ([...finished.keys()].join() !== [...this.finished.keys()].join()) { this.finished = finished; cx.notify(); }
        const ps = await exec("ps", ["-axo", "pid,ppid,pcpu,rss,command"]).catch(() => null);
        if (ps?.code !== 0) return;
        const procs = parsePs(ps.stdout);
        const next = new Map();
        for (const a of list) {
          const pid = this.pids[a.address];
          // A pid no longer alive belongs to a gone terminal: ask again next time.
          if (!pid || !procs.has(pid)) { delete this.pids[a.address]; continue; }
          const hide = ["claude", a.program?.key, a.program?.name?.toLowerCase()].filter(Boolean);
          next.set(a.address, processTree(procs, pid, { hide }));
        }
        const use = new Map();
        for (const address of bg) {
          const total = this.pids[address] ? procTotal(procs, this.pids[address]) : null;
          if (total) use.set(address, total);
          else delete this.pids[address];
        }
        const before = JSON.stringify([[...this.procs], [...this.use]]);
        if (JSON.stringify([[...next], [...use]]) !== before) { this.procs = next; this.use = use; cx.notify(); }
      } catch {} finally { this.readingProcs = false; }
    });
  }

  // Each shown project's summary from files (HEAD, config, registered worktrees) every 15 s;
  // how far local main is behind origin/main (as last fetched, never fetching) once a minute.
  refreshFacts(cx) {
    if (this.readingFacts || !this.shown()) return;
    this.readingFacts = true;
    cx.spawn(async (cx) => {
      try {
        let changed = false;
        const now = Date.now();
        for (const base of this.bases.keys()) {
          const git = `${base}/main/.git`;
          const old = this.facts.get(base);
          const head = await readTextFile(`${git}/HEAD`).catch(() => null);
          const config = await readTextFile(`${git}/config`).catch(() => null);
          const worktrees = await fs.readdir(`${git}/worktrees`).then((d) => d.length).catch(() => 0);
          let behind = old?.behind ?? null, behindAt = old?.behindAt ?? 0;
          if (now - behindAt >= 60000) {
            const r = await exec("git", ["rev-list", "--count", "refs/heads/main..refs/remotes/origin/main"], { cwd: `${base}/main` }).catch(() => null);
            behind = r?.code === 0 ? Number(r.stdout.trim()) : null;
            behindAt = now;
          }
          const next = { branch: headBranch(head), worktrees, github: hasGithub(config), behind, behindAt };
          if (JSON.stringify(next) !== JSON.stringify(old)) { this.facts.set(base, next); changed = true; }
        }
        if (changed) cx.notify();
      } catch {} finally { this.readingFacts = false; }
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

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = [], skip = null) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live" && !skip?.has(k.address));
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"], skip),
      ];
    });
  }

  // tree() as shown: children running somewhere else than their parent sit one level
  // deeper, under a row naming that place: "main" (the main checkout) or the worktree.
  // skip: agents the tree places elsewhere (an orchestrator's workers sit under their project).
  shownTree(all, addr, lead = [], skip = null) {
    const home = placeOf(all.find((x) => x.address === addr)?.cwd);
    const now = Date.now();
    const kids = all.filter((k) => k.parent === addr && bgVisible(k, now, this.dismissed) && !skip?.has(k.address));
    const moved = (k) => placeOf(k.cwd) !== null && placeOf(k.cwd) !== home;
    const away = new Map();
    for (const k of kids.filter(moved)) away.set(placeOf(k.cwd), [...(away.get(placeOf(k.cwd)) ?? []), k]);
    const items = [...kids.filter((k) => !moved(k)).map((k) => ({ k })), ...[...away].map(([w, ks]) => ({ w, ks }))];
    const branch = (k, me, below) => [{ t: k, lines: me }, ...this.shownTree(all, k.address, below, skip)];
    return items.flatMap((it, i) => {
      const last = i === items.length - 1;
      const me = [...lead, last ? "└" : "├"];
      const below = [...lead, last ? "" : "│"];
      if (it.k) return branch(it.k, me, below);
      return [{ wt: it.w, lines: me }, ...it.ks.flatMap((k, j) => {
        const end = j === it.ks.length - 1;
        return branch(k, [...below, end ? "└" : "├"], [...below, end ? "" : "│"]);
      })];
    });
  }

  wtRow(t, s) {
    return h_flex()
      .id(`wt-${s.lines.length}-${s.wt}`)
      .pl(39)
      .pr(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(14).mr(8).flex_none().text_color(s.wt === "main" ? t.accent : t.dim))
      .child(div().flex_1().truncate().text_color(s.wt === "main" ? t.accent : t.dim).child(s.wt));
  }

  // A worktree's header under its project: a branch glyph and the worktree's name, with its
  // fold. Its agents and background terminals hang under it (main is the project row itself).
  checkoutRow(t, key, place, count, top) {
    return h_flex().id(key).px(8).h(24).flex_none().rounded(8).items_center().gap(6).text_size(12)
      .tooltip(`Worktree ${place}`)
      .child(svg("mods/workspace-chrome/git-branch.svg").size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(place))
      .child(this.nodeFold(t, key, count, top));
  }

  // A tree line cell in front of a nested row.
  lineCells(t, lines) {
    return lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
      .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
      .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6)));
  }

  // A quiet sleep tag, text only: "zzz 2" on an org, "zzz 4m" on an idle agent.
  sleepTag(t, id, text, tip) {
    return div().id(id).flex_none().text_size(10.5).text_color(t.dim).tooltip(tip).child(text);
  }

  // A row owner's helper count: the other agents and sleepers in its folder, never rows of their
  // own until a click unfolds them under it (again folds). The hover lists names and states; a
  // helper that needs you (blocked, done) colors it like a fold count.
  helperChip(t, owner, helpers, labelOf) {
    const b = helperBadge(helpers, labelOf);
    if (!b) return null;
    const open = this.helpersOpen.has(owner);
    return div().id(`helpers-${owner}`).flex_none().h(18).px(3).rounded(4).flex().items_center().text_size(11)
      .text_color(b.need ? t[b.need] ?? t.dim : open ? t.foreground : t.dim).cursor_pointer()
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .tooltip(`${b.tip}\nClick to ${open ? "fold" : "show"} them`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.helpersOpen.delete(owner) : this.helpersOpen.add(owner);
        cx.notify();
      })
      .child(b.text);
  }

  // A sleeper's icon: the Claude icon dimmed with a zzz floating over it.
  sleepIcon(t) {
    return div().relative().w(16).h(16).flex_none()
      .child(image("icons/claude.svg").w(14).h(14).mt(2).opacity(0.4))
      .child(div().absolute().left(9).top(-6).text_size(9).font_semibold().text_color(t.accent)
        .frames(["z", "zz", "zzz", "zzz"], 650).loop("opacity", { from: 0.35, to: 1, period: 2600 }));
  }

  // The Wake button of a sleeper (`ws agent wake <name>`).
  wakeButton(t, s) {
    return div().id(`wake-${s.name}`).flex_none().px(7).h(20).rounded(5).flex().items_center()
      .text_size(11).bg(t.accent + "24").text_color(t.accent).cursor_pointer()
      .hover((el) => el.bg(t.accent + "40"))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (this.waking) return;
        this.waking = s.name;
        cx.notify();
        cx.spawn(async (cx) => {
          await exec("/bin/zsh", ["-c", '"$HOME/mac-workspace/bin/ws" agent wake "$1"', "wake", s.name]).catch(() => null);
          this.waking = null;
          await this.refreshSleepers?.(cx);
          cx.notify();
        });
      })
      .child("Wake");
  }

  // A sleeping agent: the Claude icon dimmed with a zzz floating over it, its task in grey and
  // how long it has slept. Hover: its recap, and a Wake button (ws agent wake), which resumes
  // the same conversation in its tab.
  // opts: `name` (a seat's sleeping owner reads as its seat), `mark` its role icon, `badge` its helper count.
  sleepRow(t, s, now, { name = null, mark = null, badge = null } = {}) {
    const key = `sleep-${s.name}`;
    const ago = s.since > 1e12 ? duration(now - s.since) : "";
    const waking = this.waking === s.name;
    return h_flex().id(key).px(8).h(30).flex_none().rounded(8).items_center().gap(7)
      .hover((el) => el.bg(t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = key;
        else if (this.hovered === key) this.hovered = null;
        cx.notify();
      })
      .tooltip(sleepTip(s, ago))
      .child(this.sleepIcon(t))
      .child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().min_w(0).truncate().text_color(t.dim).child(name ?? s.title))
        .when(Boolean(mark), (el) => el.child(mark)))
      .when(Boolean(badge), (el) => el.child(badge))
      .when(waking, (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).frames(["waking", "waking.", "waking..", "waking..."], 300)))
      .when(!waking && this.hovered === key, (el) => el.child(this.wakeButton(t, s)))
      .when(!waking && this.hovered !== key && Boolean(ago), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago)));
  }

  // A background terminal (no agent status: a dev server, a test run an agent started with
  // `hc run --bg`): name or short command · live|done|failed|closed · CPU · memory. Click: focus
  // its pane, else peek at it. A finished one shows a × on hover that dismisses it.
  bgRow(t, k, lines = [], pl = 8) {
    const st = bgState(k);
    const label = bgLabel({ ...k, argv: this.fg[k.address] ?? k.argv });
    const use = this.use.get(k.address);
    const color = st === "failed" ? t.blocked : st === "live" ? t.working : t.dim;
    const inPane = panes().some((p) => p.terminal === k.address);
    const hoverKey = `bg-${k.address}`;
    const dismiss = div().id(`dismiss-${k.address}`).flex_none().ml(4).p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Dismiss: remove this finished terminal (hc rm)")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.dismissed.add(k.address);
        this.finished.delete(k.address);
        this.hovered = null;
        hc(["rm", k.address]).catch(() => null);
        cx.notify();
      })
      .child(svg("mods/workspace-chrome/x.svg").size(11));
    return h_flex().id(hoverKey).pl(pl).pr(8).rounded(8).h(24).flex_none().gap(0).items_center().text_size(12)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = hoverKey;
        else if (this.hovered === hoverKey) this.hovered = null;
        cx.notify();
      })
      .on_click(() => (inPane ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(this.lineCells(t, lines))
      .child(svg("mods/workspace-chrome/terminal.svg").size(12).mr(6).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(label))
      .child(div().flex_none().ml(6).text_size(11).text_color(color).child(st))
      .when(st !== "live" && this.hovered === hoverKey, (el) => el.child(dismiss))
      .when(Boolean(use), (el) => el
        .child(div().flex_none().w(36).text_right().text_size(11).text_color(t.dim).child(`${use.cpu}%`))
        .child(div().flex_none().w(46).text_right().text_size(11).text_color(t.dim).child(formatMem(use.rss))));
  }

  // A job (job-* terminal): a clock, its name, its schedule or "on watch", its state, its
  // last run; running, its CPU and memory.
  jobRow(t, k, pl = 8) {
    const j = jobInfo(k, Date.now());
    const use = this.use.get(k.address);
    const color = j.state === "failed" ? t.blocked : j.state === "running" ? t.working : t.dim;
    return h_flex().id(`job-${k.address}`).pl(pl).pr(8).rounded(8).h(24).flex_none().gap(6).items_center().text_size(12)
      .cursor_pointer().hover((el) => el.bg(t.hover)).on_click(() => this.peek(k.address))
      .tooltip(`${j.name}: ${j.schedule}${j.last ? ` · last run ${j.last}` : ""}`)
      .child(svg("mods/workspace-chrome/clock.svg").size(12).flex_none().text_color(t.dim))
      .child(div().min_w(0).flex_shrink(1).truncate().text_color(t.muted).child(j.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(j.schedule))
      .child(div().flex_none().text_size(11).text_color(color).child(j.state === "done" && j.last ? j.last : j.state))
      .when(j.state === "running" && Boolean(use), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${use.cpu}% · ${formatMem(use.rss)}`)));
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    if (!this.listed.has(k.address) && !k.program?.agent && !k.status) return this.bgRow(t, k, s.lines, 39);
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
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(this.lineCells(t, s.lines))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .when(Boolean(orchOf(k.name)), el => el.child(div().flex_none().mr(6).px(5).h(16).rounded(4).flex().items_center().text_size(10.5).font_semibold()
        .bg(t.accent).text_color(t.background).child("◆ orchestrator")))
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


  // Tree lines in front of a level's children: one straight line down past every child but
  // the last, with a tick to each; the last one gets the rounded elbow.
  branches(t, id, groups, pl = 16) {
    return groups.filter((els) => els.length).map((els, i, kept) => {
      const last = i === kept.length - 1;
      return h_flex().id(`${id}-${i}`).items_stretch().pl(pl)
        .child(v_flex().w(9).mr(2).flex_none().border_color(t.input).when(!last, (el) => el.border_l(1.5))
          .child(div().h(15).border_b(1.5).border_color(t.input).when(last, (el) => el.border_l(1.5).rounded_bl(6))))
        .child(v_flex().flex_1().min_w(0).children(els));
    });
  }

  // The fold chevron of a tree node (a seat, a project); folded, how many it hides, colored
  // by the most urgent state there.
  nodeFold(t, key, count, top) {
    const open = !this.folded.has(key);
    return div().id(`fold-${key}`).h(18).px(3).gap(3).flex().flex_none().items_center().rounded(4).text_size(11)
      .text_color(open ? t.dim : (t[top] ?? t.dim)).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.folded.add(key) : this.folded.delete(key);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!open, (el) => el.child(String(count)));
  }

  // A project row: the project's lead on main IS the row, and looks the same live or asleep
  // (projectLook): its icon, the project name, a quiet `main` chip, the project-lead mark, the
  // summary (⚠ branch, ↓N, ⑂ N, GitHub), its helper count and fold. Asleep only dims it and adds
  // the zzz (recap on hover, Wake on hover); live adds its processes, sleep countdown and state,
  // and a click focuses it. With nothing on main, live or asleep: a muted folder and name, no
  // state, and a click opens the space its first worker is in.
  projectRow(t, p, { leadTask, now, mark, badge }) {
    const look = projectLook(p);
    const facts = projectSummary(this.facts.get(p.base));
    const key = `proj-${p.org}-${p.name}`;
    const lead = p.lead;
    const live = lead && !lead.sleeping ? lead : null;
    const kids = p.workers;
    const count = kids.length + p.background.filter((x) => x !== lead).length + p.jobs.length;
    const top = kids.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
    const space = (live ?? kids[0])?.space;
    const pic = look.folder ? svg("mods/workspace-chrome/folder.svg").size(13).flex_none().text_color(t.dim)
      : look.asleep ? this.sleepIcon(t) : icon(lead.program, 16, t.foreground);
    const eta = !live || live.status === "working" || live.status === "blocked" ? null : sleepsIn(this.etas?.get(live.address), now);
    const procs = live ? this.procChip(t, live) : null;
    const idle = live?.status === "idle" && !live.focused;
    const hover = this.hovered === key;
    const ago = look.asleep && lead.since > 1e12 ? duration(now - lead.since) : "";
    const waking = look.asleep && this.waking === lead.name;
    return h_flex().id(key).px(8).h(30).flex_none().rounded(8).items_center().gap(7).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = key;
        else if (this.hovered === key) this.hovered = null;
        cx.notify();
      })
      .when(Boolean(live?.focused), (el) => el.bg(t.selected))
      .tooltip(look.asleep ? sleepTip(lead, ago) : live ? `${p.name} on main${leadTask ? `: ${leadTask}` : ""}. Its worktrees hang under it` : `${p.name}: nothing on main`)
      .on_click(() => (live ? run("pane.focus", { pane: live.pane }) : !lead && space && run("space.select", { id: space })))
      .child(pic)
      .child(div().min_w(0).flex_shrink(1).truncate().text_color(look.dim ? t.dim : idle ? t.muted : t.foreground).child(look.name))
      .when(Boolean(look.tag), (el) => el.child(placeChip(t, `${key}-main`, look.tag)))
      .when(Boolean(mark), (el) => el.child(mark))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(11).overflow_hidden()
        .children(facts.map((f) => (f.kind === "github"
          ? svg("mods/agents-tree/github.svg").id(`${key}-gh`).size(11).flex_none().text_color(t.dim).tooltip(f.tip)
          : div().id(`${key}-${f.kind}`).flex_none().text_color(f.warn ? t.ansi1 : t.dim).tooltip(f.tip).child(f.text)))))
      .when(Boolean(procs), (el) => el.child(procs))
      .when(Boolean(badge), (el) => el.child(badge))
      .when(Boolean(eta), (el) => el.child(this.sleepTag(t, `eta-${live?.address}`, eta, "Auto-sleep puts it to sleep then: its summary goes to Engram and its terminal ends")))
      .when(count > 0, (el) => el.child(this.nodeFold(t, key, count, top)))
      .when(Boolean(live), (el) => el.child(this.status(t, live, true)))
      .when(waking, (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).frames(["waking", "waking.", "waking..", "waking..."], 300)))
      .when(look.asleep && !waking && hover, (el) => el.child(this.wakeButton(t, lead)))
      .when(look.asleep && !waking && !hover && Boolean(ago), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago)));
  }

  // An agent's live processes, unfolded: name, CPU and memory, on tree lines.
  procRows(t, a) {
    const rows = this.procs.get(a.address)?.rows ?? [];
    return rows.map((r, i) => h_flex().id(`proc-${a.address}-${r.pid}`).pl(26).pr(8).h(22).flex_none().gap(0).items_center()
      .text_size(11.5).text_color(t.muted)
      .child(div().self_start().mt(-4).w(9).h(15).mr(6).flex_none().border_l(1.5).border_color(t.input)
        .border_b(1.5).rounded_bl(6).when(i < rows.length - 1, (el) => el.rounded_bl(0)))
      .child(div().flex_1().min_w(0).truncate().child(r.count > 1 ? `${r.name} ×${r.count}` : r.name))
      .child(div().flex_none().w(36).text_right().text_color(r.cpu >= 50 ? t.blocked : t.dim).child(`${r.cpu}%`))
      .child(div().flex_none().w(46).text_right().text_color(t.dim).child(formatMem(r.rss))));
  }

  // The chip that folds an agent's processes: a terminal glyph and how many.
  procChip(t, a) {
    const view = this.procs.get(a.address);
    const rows = view?.rows ?? [];
    if (!rows.length) return null;
    const hid = plumbingNote(view.plumbing);
    const open = this.procOpen.has(a.address);
    const n = rows.reduce((s, r) => s + r.count, 0);
    return h_flex().id(`procs-${a.address}`).flex_none().h(18).px(3).gap(3).items_center().rounded(4).text_size(11)
      .text_color(open ? t.foreground : t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(`${n} live process${n === 1 ? "" : "es"} under this agent${hid ? ` (${hid})` : ""}. Click to ${open ? "fold" : "show"} them`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.procOpen.delete(a.address) : this.procOpen.add(a.address);
        cx.notify();
      })
      .child(svg("mods/workspace-chrome/terminal.svg").size(11).flex_none())
      .child(String(n));
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    const termOf = (a) => all.find((x) => x.address === a.address);
    const nameOf = (a) => termOf(a)?.name;
    const cwdOf = (a) => termOf(a)?.cwd ?? a.cwd;
    const isOrch = (a) => Boolean(orchOf(nameOf(a)));
    // A kept sub-agent (one with a pane) is in agents() too: where a worker's tree shows it,
    // it gets no row of its own, unless it's pinned. An orchestrator's agents are not nested:
    // they sit under their project.
    const nested = new Set(collapsed ? [] : list.filter((a) => !isOrch(a)).flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const listedAgents = new Set(list.map((a) => a.address));
    // The organization the Spaces switcher shows (spaces-ws, following Collie).
    const org = shared("spaces.org") ?? "all";
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    // Terminals that aren't agents nor in a pane: jobs (job-*), and background terminals whose
    // launcher isn't a listed agent (those show under the agent that started them).
    const inPanes = new Set(panes().map((p) => p.terminal).filter(Boolean));
    const live = new Set(all.map((x) => x.address));
    const terms = [...all, ...[...this.finished.values()].filter((x) => !live.has(x.address))];
    const extras = terms.filter((x) => !this.listed.has(x.address) && !inPanes.has(x.address) && bgVisible(x, now, this.dismissed)
      && (isJob(x.name) || !this.listed.has(x.parent)) && !orchOf(x.name))
      // A sleeper whose terminal is live again (just woken) is an agent row, not a zzz.
      .concat((this.sleepers ?? []).filter((z) => !all.some((x) => x.state === "live" && x.name === z.name)));
    // Background terminals whose CPU and memory the timer reads: extras and agents' kids.
    this.bg = all.filter((x) => x.state === "live" && !this.listed.has(x.address) && !inPanes.has(x.address)).map((x) => x.address);
    const tree = buildTree(list.map((a) => ({ ...a, name: nameOf(a), cwd: cwdOf(a), rank: rankOf(a) || RANK.idle, since: this.since(a), seq: a.seq ?? 0 })), { org, byPriority, extras });
    const extraEls = (x) => [x.sleeping ? this.sleepRow(t, x, now) : isJob(x.name) ? this.jobRow(t, x) : this.bgRow(t, x)];
    const jobsGroup = (id, jobs) => (jobs.length ? [div().id(id).px(8).h(22).flex_none().flex().items_center().text_size(11).text_color(t.dim).child("Jobs"),
      ...jobs.map((j) => this.jobRow(t, j))] : []);
    // Projects whose summary the timer reads, with the space to open.
    this.bases = new Map(tree.seats.flatMap((s) => s.projects.map((p) => [p.base, p])));
    // The order agent.next walks: the tree's, top to bottom.
    const order = [...tree.pinned, tree.boss, ...tree.helpers, ...tree.seats.flatMap((s) => [
      s.orch, ...s.helpers, ...s.projects.flatMap((p) => [p.lead, ...p.workers]), ...s.loose])].filter((a) => a && this.listed.has(a.address));
    // Every placed agent's role mark, and each owner's helpers (shown as a count on its row).
    const roles = roleOf(tree);
    const badges = new Map([[tree.boss?.address, tree.helpers], ...tree.seats.flatMap((s) => [[s.orch?.address, s.helpers],
      ...s.projects.flatMap((p) => [[p.lead?.address, p.helpers], ...p.checkouts.map((c) => [c.lead?.address, c.helpers])])])]);
    const markOf = (a) => roleIcon(t, `role-${a.address}`, roles.get(a.address), orchOf(a.name) ?? null);
    setAgentOrder(order.map((a) => a.address));
    if (collapsed) list = order;

    const withKids = (a, i, skip = null, grouped = false) => {
      const subs = collapsed ? [] : this.tree(all, a.address, [], skip);
      const r = row(a, i, subs, grouped);
      if (collapsed) return [r];
      const procs = this.procOpen.has(a.address) ? this.procRows(t, a) : [];
      if (this.folded.has(a.address)) return [r, ...procs];
      return [r, ...procs, ...this.shownTree(terms, a.address, [], skip).map((s) => (s.wt ? this.wtRow(t, s) : this.subRow(t, s, shown, false)))];
    };

    // The fold chevron of an agent's sub-agents; folded, the count too, colored by the most urgent one.
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

    // A worker row reads its task: a tab someone named or the agent's own title, never an
    // automatic tab number unless two rows would otherwise read the same. Pinned rows (out
    // of the tree) name their space too.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    // The Boss's helpers never read as a second Boss.
    if (tree.boss) for (const [k, v] of helperLabels(tree.helpers.filter((a) => !a.sleeping).map((a) => a.address), labels.get(tree.boss.address) ?? tree.boss.title, (k) => labels.get(k))) labels.set(k, v);
    const label = (a) => labels.get(a.address);
    const helperName = (h) => (h.sleeping ? h.title : label(h));
    const badgeOf = (a) => this.helperChip(t, a.address, badges.get(a.address) ?? [], helperName);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // grouped: the row sits under its checkout's header, which already names the place.
    const row = (a, i, subs = [], grouped = false) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const dir = cwdOf(a);
      const where = grouped ? null : placeOf(dir);
      const orch = orchOf(nameOf(a));
      const root = where || orch ? null : orgRootOf(dir);
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
      const eta = a.status === "working" || a.status === "blocked" ? null : sleepsIn(this.etas?.get(a.address), now);
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
      // In the tree the project row above names the place; a pinned row names its space.
      const full = isPinned && !orch;
      const name = orch ? ORG_LABEL[orch] : full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const procs = this.procChip(t, a);
      const mark = isPinned ? null : markOf(a);
      const helpers = badgeOf(a);
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(7)
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
          .when(Boolean(where), el => el.child(placeChip(t, `where-${a.address}`, where)))
          .when(Boolean(mark), el => el.child(mark))
          .when(!mark && Boolean(root), el => el.child(h_flex().id(`root-${a.address}`).flex_none().gap(3).items_center().text_size(10.5).text_color(t.dim)
            .tooltip(`Runs at the ${root} root (~/mac-workspace/${root})`)
            .child(svg("mods/workspace-chrome/folder.svg").size(10).flex_none()).child(`${root} root`)))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(Boolean(procs), el => el.child(procs))
        .when(Boolean(helpers), el => el.child(helpers))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(Boolean(eta), el => el.child(this.sleepTag(t, `eta-${a.address}`, eta, "Auto-sleep puts it to sleep then: its summary goes to Engram and its terminal ends")))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, true));
    };

    // A seat that isn't running: "<Org> orchestrator · off", muted; Other has no orchestrator.
    const offRow = (o) => h_flex()
      .id(`orch-off-${o}`)
      .px(8)
      .h(30)
      .flex_none()
      .rounded(8)
      .items_center()
      .gap(9)
      .when(o !== "other", (el) => el.tooltip(`Not running. Start it from the mac-workspace app or with: ws orchestrator start ${o}`))
      .child(div().size(16).flex_none())
      .child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().truncate().text_color(t.dim).child(ORG_LABEL[o]))
        .when(o !== "other", (el) => el.child(roleIcon(t, `role-off-${o}`, roleMark(o === "workspace" ? "boss" : "org"), o, true))))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(o === "other" ? "outside the orgs" : "off"));

    // A row's owner (the Boss, an org lead, a worktree's worker), live or asleep, with its helpers
    // unfolded under it when its helper count was clicked; folded they are only that count.
    const helperEls = (owner, helpers) => (owner && helpers?.length && this.helpersOpen.has(owner.address)
      ? this.branches(t, `help-${owner.address}`, helpers.map((h) => (h.sleeping ? [this.sleepRow(t, h, now, { mark: markOf(h) })] : withKids(h, 0, null, true))), 10)
      : []);
    const ownerEls = (a, i, skip = null, grouped = false, name = null) => [
      ...(a.sleeping ? [this.sleepRow(t, a, now, { name, mark: markOf(a), badge: badgeOf(a) })] : withKids(a, i, skip, grouped)),
      ...helperEls(a, badges.get(a.address)),
    ];

    // An org's seat: its orchestrator (or the off row), then its projects and their workers.
    const seatEls = (s, i) => {
      const key = `seat-${s.org}`;
      const head = s.orch ? ownerEls(s.orch, i, listedAgents, false, ORG_LABEL[s.org]) : [offRow(s.org)];
      const count = s.projects.length + s.loose.length + s.jobs.length;
      const top = [...s.projects.flatMap((p) => [...(p.lead ? [p.lead] : []), ...p.workers]), ...s.loose].reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      if (!count) return head;
      const [first, ...rest] = head;
      const zzz = asleepIn(s);
      const headRow = h_flex().id(`${key}-head`).items_center().child(div().flex_1().min_w(0).child(first))
        .when(zzz > 0, (el) => el.child(this.sleepTag(t, `${key}-zzz`, `zzz ${zzz}`, `${zzz} agent${zzz === 1 ? "" : "s"} asleep in ${ORG_LABEL[s.org] ?? s.org}`)))
        .child(this.nodeFold(t, key, count, top));
      if (this.folded.has(key)) return [headRow, ...rest];
      // A project's worktrees: one header per worktree, under it its worker (live agents first,
      // else its most recent sleeper) carrying the rest as helpers, and its background terminals.
      const checkoutEls = (pk, c) => {
        const ck = `${pk}-co-${c.place}`;
        const top = c.workers.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
        const head = this.checkoutRow(t, ck, c.place, (c.lead ? 1 : 0) + c.helpers.length + c.background.length, top);
        return this.folded.has(ck) ? [head] : [head, ...this.branches(t, `${ck}-w`,
          [...(c.lead ? [ownerEls(c.lead, 0, null, true)] : []), ...c.background.map(extraEls)], 10)];
      };
      const projectEls = (p) => {
        const pk = `proj-${p.org}-${p.name}`;
        const pr = this.projectRow(t, p, { leadTask: p.lead ? detail.get(p.lead.address) : null, now,
          mark: p.lead ? markOf(p.lead) : null, badge: p.lead ? badgeOf(p.lead) : null });
        if (this.folded.has(pk)) return [pr];
        // The lead's own sub-agents and processes (its row is the project row) and its helpers when
        // unfolded, then the main checkout's terminals with no header, then each worktree.
        const leadKids = p.lead && !p.lead.sleeping ? withKids(p.lead, 0, null, true).slice(1) : [];
        return [pr, ...leadKids, ...helperEls(p.lead, p.helpers), ...this.branches(t, `${pk}-w`, [
          ...p.main.background.map(extraEls), ...p.checkouts.map((c) => checkoutEls(pk, c)), jobsGroup(`${pk}-jobs`, p.jobs)], 10)];
      };
      return [headRow, ...rest, ...this.branches(t, `${key}-p`, [jobsGroup(`${key}-jobs`, s.jobs), ...s.projects.map(projectEls),
        ...s.loose.map((a) => (this.listed.has(a.address) ? withKids(a, 0) : extraEls(a)))], 12)];
    };

    const rows = collapsed ? list.flatMap((a, i) => withKids(a, i)) : [
      ...(tree.pinned.length ? [div().id("pinned").px(8).pt(8).h(30).flex_none().flex().items_center().text_size(11).font_medium().text_color(t.dim).child("Pinned"),
        ...tree.pinned.flatMap((a) => withKids(a, 0))] : []),
      // The Workspace Boss gives the orders: the org orchestrators hang under it, with tree lines.
      // Its helpers (other Claudes at the workspace root) are a count on its row; with no Boss
      // running they keep rows of their own. Terminals at the root hang under it with its jobs.
      ...(tree.boss ? ownerEls(tree.boss, 0, listedAgents, false, ORG_LABEL.workspace) : [offRow("workspace")]),
      ...this.branches(t, "seat-branch", [jobsGroup("boss-jobs", tree.jobs), ...tree.root.map(extraEls),
        ...(tree.boss ? [] : tree.helpers.map((h) => (h.sleeping ? [this.sleepRow(t, h, now)] : withKids(h, 0)))), ...tree.seats.map(seatEls)]),
    ];

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
                .on_click(() => openOverlay({ mod: "agents-tree", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
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
