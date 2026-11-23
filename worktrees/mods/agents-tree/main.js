// Agents as a tree: the Workspace Boss, each org's orchestrator under it, the org's projects
// under that (a one-line summary each), and the agents working in each project under it, with
// their branch, time, state and their live processes folded under them. The rail keeps a
// numbered list. Parents take their most urgent sub-agent's place.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, hc, readTextFile, checking } from "herdr";
import * as fs from "fs/promises";
import { placeOf, orchOf, orgRootOf, isJob, buildTree, headBranch, hasGithub, projectSummary, parsePs, processTree, plumbingNote, procTotal, formatMem, bgState, bgLabel, bgVisible, jobInfo } from "./model.js";

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

// The seat's tag, quiet: "workspace boss" (amber, layers) for the top one; for a supervisor
// just "orchestrator" in its org's space color (the section already says workspace).
// Fainter when it is off.
function orchTag(t, off, org) {
  const boss = org === "workspace";
  const color = boss ? (t.warning ?? t.blocked) : orgColor(org) ?? t.accent;
  return h_flex().id(`orch-tag-${org}-${off}`).flex_none().gap(3).px(5).h(16).rounded(4).items_center().text_size(10.5)
    .bg(color + (off ? "10" : "1f")).text_color(off ? color + "99" : color)
    .when(boss, (el) => el.child(svg("mods/workspace-chrome/layers.svg").size(10).flex_none()))
    .child(boss ? "workspace boss" : "orchestrator");
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
          if (got && bgVisible(got, Date.now())) finished.set(x.address, got);
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
    const kids = all.filter((k) => k.parent === addr && bgVisible(k, now) && !skip?.has(k.address));
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

  // A tree line cell in front of a nested row.
  lineCells(t, lines) {
    return lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
      .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
      .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6)));
  }

  // A background terminal (no agent status: a dev server, a test run an agent started with
  // `hc run --bg`): name or short command · live|done|failed · CPU · memory. Click: focus
  // its pane, else peek at it.
  bgRow(t, k, lines = [], pl = 8) {
    const st = bgState(k);
    const label = bgLabel({ ...k, argv: this.fg[k.address] ?? k.argv });
    const use = this.use.get(k.address);
    const color = st === "failed" ? t.blocked : st === "done" ? t.dim : t.working;
    const inPane = panes().some((p) => p.terminal === k.address);
    return h_flex().id(`bg-${k.address}`).pl(pl).pr(8).rounded(8).h(24).flex_none().gap(0).items_center().text_size(12)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click(() => (inPane ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(this.lineCells(t, lines))
      .child(svg("mods/workspace-chrome/terminal.svg").size(12).mr(6).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(label))
      .child(div().flex_none().ml(6).text_size(11).text_color(color).child(st))
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

  // A project row: its name, the quiet summary (⚠ branch, ↓N, ⑂ N, GitHub) and its fold.
  // Its own orchestrator (orch-<org>-<project>), when running, is the row: a click focuses
  // it and its state shows. Else a click opens the space its first worker is in.
  projectRow(t, p, statusOf) {
    const facts = projectSummary(this.facts.get(p.base));
    const key = `proj-${p.org}-${p.name}`;
    const kids = p.workers;
    const top = kids.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
    const space = (p.orch ?? kids[0])?.space;
    return h_flex().id(key).px(8).h(28).flex_none().rounded(8).items_center().gap(7).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .when(Boolean(p.orch?.focused), (el) => el.bg(t.selected))
      .on_click(() => (p.orch ? run("pane.focus", { pane: p.orch.pane }) : space && run("space.select", { id: space })))
      .child(svg("mods/workspace-chrome/folder.svg").size(13).flex_none().text_color(t.muted))
      .child(div().min_w(0).flex_shrink(1).truncate().text_color(t.foreground).child(p.name))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(11).overflow_hidden()
        .children(facts.map((f) => (f.kind === "github"
          ? svg("mods/agents-tree/github.svg").id(`${key}-gh`).size(11).flex_none().text_color(t.dim).tooltip(f.tip)
          : div().id(`${key}-${f.kind}`).flex_none().text_color(f.warn ? t.ansi1 : t.dim).tooltip(f.tip).child(f.text)))))
      .when(kids.length > 0, (el) => el.child(this.nodeFold(t, key, kids.length, top)))
      .when(Boolean(p.orch), (el) => el.child(this.status(t, { status: statusOf(p.orch) }, true)));
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
    const extras = terms.filter((x) => !this.listed.has(x.address) && !inPanes.has(x.address) && bgVisible(x, now)
      && (isJob(x.name) || !this.listed.has(x.parent)) && !orchOf(x.name));
    // Background terminals whose CPU and memory the timer reads: extras and agents' kids.
    this.bg = all.filter((x) => x.state === "live" && !this.listed.has(x.address) && !inPanes.has(x.address)).map((x) => x.address);
    const tree = buildTree(list.map((a) => ({ ...a, name: nameOf(a), cwd: cwdOf(a), rank: rankOf(a) || RANK.idle, since: this.since(a), seq: a.seq ?? 0 })), { org, byPriority, extras });
    const extraEls = (x) => [isJob(x.name) ? this.jobRow(t, x) : this.bgRow(t, x)];
    const jobsGroup = (id, jobs) => (jobs.length ? [div().id(id).px(8).h(22).flex_none().flex().items_center().text_size(11).text_color(t.dim).child("Jobs"),
      ...jobs.map((j) => this.jobRow(t, j))] : []);
    // Projects whose summary the timer reads, with the space to open.
    this.bases = new Map(tree.seats.flatMap((s) => s.projects.map((p) => [p.base, p])));
    // The order agent.next walks: the tree's, top to bottom.
    const order = [...tree.pinned, ...(tree.boss ? [tree.boss] : []), ...tree.seats.flatMap((s) => [
      ...(s.orch ? [s.orch] : []), ...s.projects.flatMap((p) => [...(p.orch ? [p.orch] : []), ...p.workers]), ...s.loose])];
    setAgentOrder(order.map((a) => a.address));
    if (collapsed) list = order;

    const withKids = (a, i, skip = null) => {
      const subs = collapsed ? [] : this.tree(all, a.address, [], skip);
      const r = row(a, i, subs);
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
      const dir = cwdOf(a);
      const where = placeOf(dir);
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
          .when(Boolean(orch), el => el.child(orchTag(t, false, orch).tooltip(orch === "workspace" ? "The Workspace Boss: talks with you, classifies and routes to the org supervisors (ws orchestrator start workspace)" : `mac-workspace's ${orch} supervisor: one long-lived Claude at ~/mac-workspace/${orch} (ws orchestrator start ${orch})`)))
          .when(Boolean(where), el => el.child(h_flex().flex_none().gap(3).px(5).h(16).rounded(4).items_center().text_size(10.5)
            .bg((where === "main" ? t.accent : t.dim) + "1f").text_color(where === "main" ? t.accent : t.muted)
            .tooltip(where === "main" ? "Runs in the main checkout" : `Runs in worktree ${where}`)
            .child(svg("mods/workspace-chrome/git-branch.svg").size(10).flex_none()).child(where)))
          .when(Boolean(root), el => el.child(h_flex().flex_none().gap(3).px(5).h(16).rounded(4).items_center().text_size(10.5)
            .bg((t.warning ?? t.blocked) + "1f").text_color(t.warning ?? t.blocked)
            .tooltip(root === "workspace" ? "Runs at the workspace root (~/mac-workspace)" : `Runs at the ${root} root (~/mac-workspace/${root})`)
            .child(svg("mods/workspace-chrome/folder.svg").size(10).flex_none()).child(root === "workspace" ? "root" : `${root} root`)))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(Boolean(procs), el => el.child(procs))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
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
        .when(o !== "other", (el) => el.child(orchTag(t, true, o))))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(o === "other" ? "outside the orgs" : "off"));

    // An org's seat: its orchestrator (or the off row), then its projects and their workers.
    const statusOf = (a) => a.status;
    const seatEls = (s, i) => {
      const key = `seat-${s.org}`;
      const head = s.orch ? withKids(s.orch, i, listedAgents) : [offRow(s.org)];
      const count = s.projects.length + s.loose.length + s.jobs.length;
      const top = [...s.projects.flatMap((p) => p.workers), ...s.loose].reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      if (!count) return head;
      const [first, ...rest] = head;
      const headRow = h_flex().id(`${key}-head`).items_center().child(div().flex_1().min_w(0).child(first)).child(this.nodeFold(t, key, count, top));
      if (this.folded.has(key)) return [headRow, ...rest];
      const projectEls = (p) => {
        const pk = `proj-${p.org}-${p.name}`;
        const pr = this.projectRow(t, p, statusOf);
        return this.folded.has(pk) ? [pr] : [pr, ...this.branches(t, `${pk}-w`, [...p.workers.map((a) => withKids(a, 0)),
          ...p.background.map(extraEls), jobsGroup(`${pk}-jobs`, p.jobs)], 10)];
      };
      return [headRow, ...rest, ...this.branches(t, `${key}-p`, [jobsGroup(`${key}-jobs`, s.jobs), ...s.projects.map(projectEls),
        ...s.loose.map((a) => (this.listed.has(a.address) ? withKids(a, 0) : extraEls(a)))], 12)];
    };

    const rows = collapsed ? list.flatMap((a, i) => withKids(a, i)) : [
      ...(tree.pinned.length ? [div().id("pinned").px(8).pt(8).h(30).flex_none().flex().items_center().text_size(11).font_medium().text_color(t.dim).child("Pinned"),
        ...tree.pinned.flatMap((a) => withKids(a, 0))] : []),
      // The Workspace Boss gives the orders: the org orchestrators hang under it, with tree lines.
      ...(tree.boss ? withKids(tree.boss, 0, listedAgents) : [offRow("workspace")]),
      ...this.branches(t, "seat-branch", [jobsGroup("boss-jobs", tree.jobs), ...tree.seats.map(seatEls)]),
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
