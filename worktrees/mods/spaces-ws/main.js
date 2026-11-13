// Workspace spaces, one row per project: every space whose first terminal is
// in the same repo (its main checkout or any worktree) is one row, named after
// the project, with a stable colored avatar. After the name: a dot per agent
// in those spaces (working, needs you, idle), ▸N processes they started with
// hc run (red when one failed), and the state of the repo's main checkout only
// when it isn't fresh (↓N behind, ⚠ can't fast-forward, why on hover). Rows that
// need you come first, then working ones. Grouped by machine when more than one
// is known. Click goes to the project's main checkout space, right-click for its
// menu (Update main among it), drag to reorder; ⌘⇧U updates the focused
// project's main with `ws update`.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, focused, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, notify, nextCommand } from "herdr";
import { mainCheckout, mainState, groupRows, rowActivity, sortRows, rank, dotsShown, rowTooltip, procText, updateArgs, updateToast, needsGather, gatherArgs, contiguousOrder, freshRequest, dropOrder, clickTarget, spaceCount } from "./model.js";

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

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const ROW_HEIGHT = 30;
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// The menu's "Update main" asks through this shared value: { space, at }.
const UPDATE = "spaces-ws.update";

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { repo, path, linked }, null: not a repo
    this.main = {}; // repo -> its main checkout's state (model.js mainState)
    this.updating = new Set(); // repos `ws update` runs for now
    this.handled = shared(UPDATE)?.at ?? null; // the menu's last request, done before this started
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree joins its project's row instead of showing alone first.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // ⌘⇧U (keys.json: "spaces-ws.update"): the focused space's project.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "update") this.update(focused()?.space, cx);
      }
    });
  }

  // Update main: `ws update <project>` on its machine, its one line in a toast,
  // then the row looks again.
  update(spaceId, cx) {
    const row = spaceId && this.rows().find((r) => r.spaces.some((s) => s.id === spaceId));
    if (!row) return;
    if (!row.name) {
      notify({ title: `${row.target.name}: not a git project, no main to update`, level: "warning" });
      return;
    }
    if (this.updating.has(row.repo)) return;
    this.updating.add(row.repo);
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("sh", updateArgs(row.name), { on: row.target.machine, timeout: 120000 }).catch(() => null);
      notify(updateToast(row.name, r));
      this.updating.delete(row.repo);
      this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === row.repo), cx);
      cx.notify();
    });
  }

  // A click: a project in several spaces is gathered into one grid first.
  open(r, cx) {
    if (!needsGather(r) || this.gathering) return run("space.select", { id: clickTarget(r).id });
    this.gathering = true;
    notify({ title: `${r.name}: gathering ${r.spaces.length} spaces into one grid…` });
    cx.spawn(async (cx) => {
      const res = await exec("sh", gatherArgs(mainCheckout(r.path)), { on: r.target.machine, timeout: 180000 }).catch(() => null);
      this.gathering = false;
      if (!res || res.code !== 0) {
        notify({ title: `${r.name}: couldn't gather (${(res?.stderr || "herdr-grid not installed").trim().split("\n").pop()})`, level: "warning" });
        run("space.select", { id: clickTarget(r).id });
      }
      cx.notify();
    });
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    const req = shared(UPDATE);
    if (freshRequest(req, this.handled, now)) {
      this.handled = req.at;
      this.update(req.space, cx);
    }
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

  // `key` and the other places in its repo (a commit there moves its main's state).
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
        const repos = new Set(keys.map((k) => this.git[k]?.repo).filter(Boolean));
        await Promise.all([...repos].map((repo) => this.checkMain(repo)));
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: its repo and whether it is a worktree of it.
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
      this.git[key] = { repo: JSON.stringify([on, repo]), path: repo, linked: repo !== `${top}/.git` };
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  // The repo's main checkout: its branch against the default one, tracked
  // changes, ahead/behind its upstream as last fetched (this never fetches).
  async checkMain(repo) {
    const [on, path] = JSON.parse(repo);
    const cwd = mainCheckout(path);
    if (!cwd) return;
    try {
      const [head, origin, counts, status] = await Promise.all([
        exec("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd, on }),
        exec("git", ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
        // No optional locks: it never writes the index, so the repo's watch stays quiet.
        exec("git", ["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"], { cwd, on }),
      ]);
      if (status.code !== 0) { delete this.main[repo]; return; }
      const branch = head.code === 0 ? head.stdout.trim() : null;
      const defaultBranch = origin.code === 0 ? origin.stdout.trim().replace(/^origin\//, "") : ["main", "master"].includes(branch) ? branch : "main";
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      this.main[repo] = mainState({ branch, defaultBranch, dirty: status.stdout.trim() !== "", ahead, behind });
    } catch {
      // The machine is away: keep what it showed.
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

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu-ws", kind: "popup", width: 210, height: 300, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // One row per project (model.js groupRows), in the spaces' order.
  rows() {
    const ps = panes();
    return groupRows(spaces(), (w) => this.git[where(w, ps)] ?? null);
  }

  // Simulate the batch so later indexes include earlier moves.
  move(order, target) {
    const moved = new Set();
    const machineOf = new Map(spaces().map((s) => [s.id, s.machine ?? null]));
    for (let i = 0; i < target.length; i++) {
      const from = order.indexOf(target[i]);
      if (from === i || from === -1) continue;
      run("space.move", { id: target[i], index: i + 1 });
      moved.add(machineOf.get(target[i]) ?? null);
      order.splice(i, 0, order.splice(from, 1)[0]);
    }
    return [...moved];
  }

  // The rows shown: each project's spaces kept next to each other (its main
  // checkout's first), with what runs in them and their main's state.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const rows = this.rows();
    // An attempted write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = contiguousOrder(rows);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      this.ordering = { key, at: Date.now(), machines: [] };
      this.ordering.machines = this.move(order, target);
    }
    const world = { agents: agents(), panes: ps, terminals: terminals() };
    return rows
      .filter((r) => r.spaces.some((s) => this.shown.has(s.id)))
      .map((r) => ({ ...r, activity: rowActivity(r.spaces, world), main: r.repo ? this.main[r.repo] ?? { kind: "fresh" } : { kind: "fresh" } }));
  }

  // Dropping row `from` on row `onto`: all of from's spaces go after it
  // (dragged down) or before it (dragged up).
  drop(from, onto) {
    const order = spaces().map((s) => s.id);
    this.move(order.slice(), dropOrder(order, from.spaces.map((s) => s.id), onto.spaces.map((s) => s.id)));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    this.shownRows = rows;
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [...new Set([...rows.map(r => r.target.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : sortRows(rows).map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = sortRows(rows.filter((r) => (r.target.machine ?? null) === m));
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

  avatar(r, t, size = 18) {
    const colors = shared("space.colors") ?? {};
    const color = colors[r.target.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const name = r.name ?? r.target.name;
    return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
      .text_size(10.5).font_bold().text_color("#ffffff").child([...name][0]?.toUpperCase() ?? "?");
  }

  // One agent's dot: working filled, needs you filled in its color, idle hollow.
  dot(a, t) {
    const el = div().size(7).flex_none().rounded(4);
    if (a.kind === "work") return el.bg(t.working);
    if (a.kind === "need") return el.bg(t.blocked);
    return el.border(1.5).border_color(t.idle ?? t.dim);
  }

  // After the name: the agents' dots, ▸N processes, main's state (only when not fresh).
  tail(r, t) {
    const { agents: list, procs } = r.activity;
    const count = procText(procs);
    const busy = r.repo && this.updating.has(r.repo);
    return h_flex().flex_1().min_w(0).gap(6).justify_end().items_center().text_size(11.5).text_color(t.dim)
      .when(dotsShown(list), (el) => el.child(h_flex().flex_none().gap(4).items_center().children(list.map((a) => this.dot(a, t)))))
      .when(Boolean(count), (el) => el.child(div().flex_none().text_size(11).text_color(procs.failed ? t.ansi1 : t.dim).child(count)))
      .when(busy, (el) => el.child(div().flex_none().text_color(t.dim).child("updating…")))
      .when(!busy && r.main.kind === "behind", (el) => el.child(div().flex_none().text_color(t.ansi3).child(r.main.text)))
      .when(!busy && r.main.kind === "warn", (el) => el.child(div().id(`main-${r.target.id}`).flex_none().text_color(t.ansi1).tooltip(`main: ${r.main.why}`).child(r.main.text)));
  }

  row(r, t) {
    const on = r.spaces.some((s) => s.active);
    const rowsNow = this.shownRows ?? [];
    const at = (key) => rowsNow.findIndex((x) => x.key === key);
    const pressed = this.pressed && rowsNow.find((x) => x.key === this.pressed);
    const tip = rowTooltip(r.activity.agents, r.main, r.spaces);
    const count = spaceCount(r);
    return v_flex()
      .relative()
      .id(`space-${r.target.id}`)
      .px(8)
      .h(ROW_HEIGHT)
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .when(this.pressed === r.key && this.over !== r.key, (el) => el.opacity(0.5))
      .when(Boolean(pressed) && this.over === r.key && this.pressed !== r.key, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(at(this.pressed) < at(r.key), line => line.bottom(0))
          .when(at(this.pressed) > at(r.key), line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = r.key;
        this.over = r.key;
      })
      .on_mouse_move((_e, cx) => {
        const source = this.pressed && rowsNow.find((x) => x.key === this.pressed);
        // Rows that need you or work keep their place at the top; the rest reorder.
        const over = source && (source.target.machine ?? null) === (r.target.machine ?? null) && rank(source) === 2 && rank(r) === 2 ? r.key : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed && rowsNow.find((x) => x.key === this.pressed);
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from && over === r.key && from.key !== r.key) this.drop(from, r);
        else if (from?.key === r.key) this.open(r, cx);
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(r.target))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .child(this.avatar(r, t))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(r.name ?? r.target.name))
          .when(Boolean(count), (el) => el.child(div().flex_none().px(4).rounded(4).bg(t.raised).text_size(10.5).text_color(t.dim).child(count)))
          .child(this.tail(r, t)),
      );
  }

  // The narrow rail: the avatar, ringed when something there needs you.
  compact(r, t) {
    const on = r.spaces.some((s) => s.active);
    const need = rank(r) === 0;
    const tip = [r.name ?? r.target.name, rowTooltip(r.activity.agents, r.main, r.spaces)].filter(Boolean).join("\n");
    return railCell(h_flex()
      .id(`space-${r.target.id}`)
      .w(RAIL_CELL)
      .h(28)
      .rounded(6)
      .justify_center()
      .items_center()
      .tooltip(tip)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => this.open(r, cx))
      .on_mouse_down("right", () => this.menu(r.target))
      .child(h_flex().size(24).flex_none().rounded(7).items_center().justify_center()
        .when(need, (el) => el.border(2).border_color(t.blocked))
        .child(this.avatar(r, t))));
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
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
