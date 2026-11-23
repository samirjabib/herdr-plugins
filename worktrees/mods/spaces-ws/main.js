// Workspace spaces, in the collie-sheeps sidebar: the header (title, Collie's link, +) and
// Collie's workspace switcher. The list of spaces left the wide sidebar: the Agents tree
// (agents-tree) is the map of who runs where, and project health lives in Collie. The rail
// (collapsed) keeps numbered space tiles, the only way there to switch spaces: click to
// switch, right-click for its menu.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Popup } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, notify, home, readTextFile, checking } from "herdr";
import { repoName, worktreeCount, mainPane, mainCheckout, spacePlace, orgOf, orgFace, orgMenu, collieWorkspace, followCollie, linkStatus, orgView, showsList, blockSize } from "./model.js";

// Collie, the mac-workspace app. Its core (the console server) is the bridge: it serves the
// org colors Collie picked at /api/colors, and answering there is what "connected" means.
// The workspace Collie shows has no endpoint yet, so it is read from Collie's own settings
// file, the one the core reads the colors from.
const CORE = "http://127.0.0.1:4317";
const COLLIE_DIR = () => `${home()}/Library/Application Support/mac-workspace`;
const COLLIE_APP = "com.samiros.collie";
// A 6-digit hex color at a share of its strength (theme colors are hex); else the fallback.
const tint = (c, alpha, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? `${c}${alpha}` : fallback);

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

// Each terminal's foreground program's folder, from `hc get` (read every few
// seconds): Herdr's own folders lag behind where Claude actually runs.
let LIVE = {};
// Where a space is now (spacePlace). `ps`: panes(), read once by the caller.
function place(s, ps) {
  return spacePlace(s, ps, LIVE);
}
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);

// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    // The workspace switcher: which organization is shown ("all" or an ORGS id), and
    // whether the switcher shows at all (click "Spaces" to hide it; hidden still filters by the pick).
    this.org = localStorage.getItem("spaces.org") ?? "all";
    setShared("spaces.org", this.org);
    this.tabsShown = localStorage.getItem("spaces.tabs") !== "off";
    this.lastActive = null;
    this.switchOpen = false;
    this.switchClosedAt = 0;
    // The link to Collie: its core's last answer ({ok}, null before the first) and the
    // workspace Collie showed when last read (followCollie).
    this.link = null;
    this.collieSeen = null;
    if (!checking()) {
      this.refreshLink(cx);
      cx.timer.every(15000, (cx) => this.refreshLink(cx));
      this.watchCollie(cx);
    }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    this.refreshLive(cx);
    cx.timer.every(5000, (cx) => this.refreshLive(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  // Collie's core, every 15 s and on a click: reachable or not, and the org colors it serves
  // (shared as "workspace.colors", as agents-tree does). Then what Collie shows now.
  refreshLink(cx) {
    if (this.linking) return;
    this.linking = true;
    cx.spawn(async (cx) => {
      let next;
      try {
        const r = await fetch(`${CORE}/api/colors`);
        next = { ok: r.ok };
        const got = r.ok ? (await r.json())?.colors ?? null : null;
        if (got && JSON.stringify(got) !== JSON.stringify(shared("workspace.colors") ?? {})) setShared("workspace.colors", got);
      } catch {
        next = { ok: false };
      }
      this.linking = false;
      if (JSON.stringify(next) !== JSON.stringify(this.link)) { this.link = next; cx.notify(); }
      await this.readCollie(cx);
    });
  }

  // Herdr follows Collie: when Collie switches workspace, the list switches with it.
  async readCollie(cx) {
    const text = await readTextFile(`${COLLIE_DIR()}/desktop.json`).catch(() => null);
    const next = followCollie({ org: this.org, seen: this.collieSeen }, collieWorkspace(text));
    this.collieSeen = next.seen;
    if (next.org !== this.org) { this.setOrg(next.org); cx.notify(); }
  }

  // Collie saves its workspace when it switches: follow at once, not only on the 15 s look.
  watchCollie(cx) {
    cx.spawn(async (cx) => {
      try {
        while (!this.closed) {
          this.collieWatch = watchFolder(COLLIE_DIR());
          await this.collieWatch;
          if (!this.closed) await this.readCollie(cx);
        }
      } catch {} // no such folder (Collie never ran here): the 15 s look still reads it
    });
  }

  close() {
    this.closed = true;
    this.collieWatch?.cancel?.();
  }

  refreshLive(cx) {
    if (this.readingLive) return;
    this.readingLive = true;
    cx.spawn(async (cx) => {
      try {
        // `hc ls` has no foreground: one `hc get` per terminal in a pane (a few ms each).
        const next = {};
        for (const t of new Set(panes().filter((p) => p.terminal && !p.machine).map((p) => p.terminal))) {
          const r = await hc(["get", t, "--json"]).catch(() => null);
          const cwd = r?.code === 0 ? JSON.parse(r.stdout).foreground?.cwd : null;
          if (cwd) next[t] = cwd;
        }
        if (JSON.stringify(next) !== JSON.stringify(LIVE)) { LIVE = next; cx.notify(); }
      } catch {}
      this.readingLive = false;
    });
  }

  // The block takes only what it shows (blockSize): the header and switcher when wide, a
  // share of the column on the rail. Asked again only when the size the layout has differs.
  fitBlock() {
    if (checking()) return;
    const node = find(layout(), "spaces");
    if (node?.content?.mod !== "spaces-ws") return;
    const want = blockSize({ collapsed: narrow(), switcher: this.tabsShown });
    const has = node.size ?? {};
    if (want.px ? has.px === want.px : has.weight === want.weight && has.px == null) return;
    const key = JSON.stringify(want);
    if (this.fitAsked?.key === key && Date.now() - this.fitAsked.at < 2000) return;
    this.fitAsked = { key, at: Date.now() };
    run("layout.resize", { id: "spaces", ...want });
  }

  checkNew(cx) {
    this.fitBlock();
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        await Promise.all(keys.map((key) => this.check(key, cx)));
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      ]);
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts, trees] = await Promise.all([
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
        exec("git", ["worktree", "list", "--porcelain"], { cwd, on }),
      ]);
      const name = repoName(repo);
      // The project's main checkout: its branch and how far behind its upstream it is,
      // as last fetched (the list never fetches). behind null: no upstream.
      const main = trees.code === 0 ? mainCheckout(trees.stdout) : null;
      const late = main ? await exec("git", ["rev-list", "--count", "HEAD..@{upstream}"], { cwd: main.path, on }).catch(() => null) : null;
      const mainInfo = main && { path: main.path, branch: main.branch, behind: late?.code === 0 ? Number(late.stdout.trim()) : null };
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, worktrees: trees.code === 0 ? worktreeCount(trees.stdout) : 0, main: mainInfo, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // The rows of the organization shown (orgView in model.js has the rules).
  inOrg(rows, collapsed) {
    const ps = panes();
    for (const r of rows) r.org = orgOf(place(r.w, ps));
    const view = orgView({ org: this.org, lastActive: this.lastActive, collapsed,
      rows: rows.map((r) => ({ id: r.w.id, org: r.org, active: r.w.active, r })) });
    this.lastActive = view.lastActive;
    if (view.org !== this.org) this.setOrg(view.org);
    this.orgRows = rows;
    return view.rows.map((v) => v.r);
  }

  setOrg(org) {
    this.org = org;
    try { localStorage.setItem("spaces.org", org); } catch {}
    // The Agents list (agents-tree) follows the same organization.
    setShared("spaces.org", org);
  }

  // An org's tile, as Collie draws it: a rounded square with its initials (All: a stack),
  // grey on a faint tint of the text color. Orgs have no color here, as in Collie.
  orgTile(initials, t) {
    return h_flex().size(24).flex_none().rounded(8).items_center().justify_center()
      .bg(tint(t.foreground, "1a", t.hover)).text_color(t.muted).text_size(10).font_semibold()
      .child(initials ? initials : svg("mods/workspace-chrome/layers.svg").size(12));
  }

  // The workspace switcher, Collie's: one pill (tile, the shown org's name, chevrons) that
  // opens a menu of every organization with spaces (and the shown one), each with its
  // count and a dot in the needs-you color when an agent there needs you. A pick filters
  // the list; the pill wears that dot when an org it hides needs you.
  orgSwitch(t) {
    const menu = orgMenu(this.orgRows ?? [], this.org);
    const face = orgFace(this.org);
    const hiddenNeeds = this.org !== "all" && menu.some((m) => m.id !== "all" && !m.on && m.needs);
    const close = () => { this.switchOpen = false; this.switchClosedAt = Date.now(); };
    const trigger = h_flex().id("org-switch-pill").w_full().h(36).px(8).gap(8).items_center().rounded(12)
      .bg(t.raised).hover((s) => s.bg(t.selected)).cursor_pointer()
      .tooltip("Workspace: follows the one Collie shows")
      .on_click((_e, cx) => {
        // The press that closed the menu (outside it) is this click's own: leave it closed.
        if (Date.now() - this.switchClosedAt < 300) return;
        this.switchOpen = !this.switchOpen;
        cx.notify();
      })
      .child(this.orgTile(face.initials, t))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(t.foreground).child(face.label))
      .when(hiddenNeeds, (el) => el.child(div().size(6).rounded(3).flex_none().bg(t.blocked)))
      .child(svg("mods/spaces-ws/chevrons-up-down.svg").size(13).flex_none().text_color(t.dim));
    const item = (m) => h_flex().id(`org-${m.id}`).h(32).px(8).gap(8).items_center().rounded(8)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { close(); this.setOrg(m.id); cx.notify(); })
      .child(this.orgTile(m.initials, t))
      .child(div().flex_1().min_w(0).truncate().text_size(13)
        .text_color(m.on ? t.foreground : t.muted).when(m.on, (el) => el.font_semibold()).child(m.label))
      .when(m.needs, (el) => el.child(div().size(6).rounded(3).flex_none().bg(t.blocked)))
      .child(div().flex_none().text_size(12).text_color(t.dim).child(String(m.count)))
      .child(div().w(14).flex_none().when(m.on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(13).text_color(t.accent))));
    const content = v_flex().w(252).mt(6).p(4).gap(1).rounded(12).border_1().border_color(t.border).bg(t.popover)
      .on_mouse_down_out((_e, cx) => { if (this.switchOpen) { close(); cx.notify(); } })
      .child(div().px(8).pt(4).pb(2).text_size(11).font_semibold().text_color(t.dim).child("Workspaces"))
      .children(menu.map(item));
    return div().px(8).pb(8).flex_none()
      .child(Popup.new("org-switch", trigger).w_full().anchor("top_left")
        .when(this.switchOpen, (el) => el.content(content)));
  }

  // How the link to Collie is: a quiet dot and "linked collie" beside the title, muted
  // "collie off" when its core doesn't answer. Click: bring Collie to the front (and look
  // again when off).
  linkBadge(t) {
    const working = agents().filter((a) => a.status === "working").length;
    const s = linkStatus(this.link, working);
    const dot = this.link?.ok ? tint(t.ansi2, "99", t.dim) : t.dim;
    return h_flex().id("collie-link").flex_none().h(22).px(6).gap(5).items_center().rounded(6)
      .text_size(11).text_color(t.dim)
      .cursor_pointer().hover((st) => st.bg(t.hover)).tooltip(s.tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        if (s.loose || !this.link) this.refreshLink(cx);
        this.showCollie(cx);
      })
      .child(div().size(6).rounded(3).flex_none().bg(dot))
      .child(s.text);
  }

  // Collie to the front: by name (~/Applications/Collie.app), else by its bundle id.
  showCollie(cx) {
    if (checking()) return;
    cx.spawn(async () => {
      const r = await exec("open", ["-a", "Collie"]).catch(() => null);
      if (r?.code !== 0) await exec("open", ["-b", COLLIE_APP]).catch(() => {});
    });
  }

  // Entering a space lands on its main checkout's pane, where the orchestrator
  // sits; clicking the space you are already in leaves focus where it is.
  open(w) {
    const target = !w.active && mainPane(w, panes(), LIVE);
    run("space.select", { id: w.id });
    if (target) run("pane.focus", { pane: target });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu-ws", kind: "popup", width: 210, height: 300, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.inOrg(this.ordered(), collapsed);
    const draw = (r) => this.compact(r, t);
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) return [head];
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      return [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
    });
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => this.open(w))
      .on_mouse_down("right", () => this.menu(w))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // The rows first: they fill this.orgRows, which the switcher counts. Wide, no list is
    // drawn, but the org view still runs: focusing another org's space switches the pick.
    const list = showsList(collapsed);
    const rows = list ? this.grouped(t, collapsed) : (this.inOrg(this.ordered(), collapsed), []);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child(div().id("spaces-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground))
          .tooltip(this.tabsShown ? "Hide the workspace switcher" : "Show the workspace switcher")
          .on_click((_e, cx) => {
            this.tabsShown = !this.tabsShown;
            try { localStorage.setItem("spaces.tabs", this.tabsShown ? "on" : "off"); } catch {}
            cx.notify();
          })
          // Hidden switcher: the title still says which org the list is filtered to.
          .child(this.tabsShown || this.org === "all" ? "Spaces" : `Spaces \u00b7 ${orgFace(this.org).label}`))
          .child(this.linkBadge(t)))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          // The project picker, on the organization shown (ALL starts on AG).
          .on_click(() => openOverlay({ mod: "space-picker", kind: "dialog", width: 560, height: 540, props: { org: this.org === "all" ? "ag" : this.org } }))
          .child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .when(!collapsed && this.tabsShown, (el) => el.child(this.orgSwitch(t)))
      .when(list, (el) => el.child(v_flex().flex_1().min_h(0).pb(14).overflow_y_scrollbar().mode("always").children(rows)));
  }
}
