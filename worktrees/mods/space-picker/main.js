// The Spaces "+": open something of an organization the way mac-workspace is laid out.
// Header: the Spaces sidebar's workspace switcher (tile, org name, chevrons; Tab cycles) and
// a search in that org's name. Then, by section:
// - Here: the org's orchestrator (focus it when running, else `ws orchestrator start <org>`)
//   and a terminal at ~/mac-workspace/<org>;
// - Recent: projects of the org opened from here, then ones with a space open;
// - Projects: every catalog project of the org (workspace.tsv), with main's branch (a red ⚠
//   when main is on another branch), `⑂ N` worktrees, and those not on this Mac muted with
//   "clone" (Enter clones it in a new terminal, then Claude starts in it). → (or the chevron)
//   lists a project's worktrees with their branches, ← folds them.
// - Other folder… and New terminal, quietly last.
// A project with a space goes there, else a space opens on its main with Claude; a worktree
// opens as a tab in its project's space. ⌘⏎ opens New worktree for the selected project.
// The folders are read once per opening (one shell read of HEAD files, no git per checkout).
// Props: { org }.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popup, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, run, exec, theme, props, closeOverlay, openOverlay, home, readTextFile, notify, pickFolder, settings, checking } from "herdr";
import {
  ORG_IDS, orgFace, nextOrg, placeholder, orgMenu, parseCatalog, parseHeads, projectsOf, mainFact,
  remember, recentOf, buildRows, selectable, step, firstRow, arrow, cloneArgv, HEADS_SCRIPT,
} from "./model.js";

// State for `herdr-app check` copies: { heads, catalog, history, org, expanded, query, running }.
const FIXTURE = null;

const tint = (c, alpha, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? `${c}${alpha}` : fallback);

export default class SpacePicker extends View {
  init(_props, cx) {
    const start = FIXTURE?.org ?? props()?.org;
    this.org = ORG_IDS.includes(start) ? start : "ag";
    this.filter = FIXTURE?.query ?? "";
    this.expanded = new Set(FIXTURE?.expanded ?? []);
    this.root = `${home()}/mac-workspace`;
    this.heads = parseHeads(FIXTURE?.heads ?? "");
    this.catalog = parseCatalog(FIXTURE?.catalog ?? "");
    this.history = FIXTURE?.history ?? this.loadHistory();
    this.starting = false;
    this.menuOpen = false;
    this.menuClosedAt = 0;
    this.byOrg = {};
    this.rebuild();
    this.at = firstRow(this.rows(), this.filter);
    this.scroll = ScrollHandle.new();
    // One search per org: an input's placeholder is fixed when it is made, and it names the org.
    this.inputs = Object.fromEntries(ORG_IDS.map((o) => {
      const input = InputState.new({ placeholder: placeholder(o), value: this.filter });
      input.on("change", (_e, cx) => {
        if (o !== this.org) return;
        this.filter = input.value();
        this.at = firstRow(this.rows(), this.filter);
        cx.notify();
      });
      input.on("submit", (_e, cx) => this.go(this.rows()[this.at], cx));
      return [o, input];
    }));
    this.input = this.inputs[this.org];
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    if (FIXTURE || checking()) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", HEADS_SCRIPT, "sh", this.root]);
        this.heads = parseHeads(r.stdout ?? "");
      } catch {}
      try { this.catalog = parseCatalog(await readTextFile(`${this.root}/workspace.tsv`)); } catch {}
      this.rebuild();
      this.at = firstRow(this.rows(), this.filter);
      cx.notify();
    });
  }

  loadHistory() {
    try { return JSON.parse(localStorage.getItem("picker.recent") ?? "[]"); } catch { return []; }
  }

  saveHistory(org, name) {
    this.history = remember(this.history, org, name);
    try { localStorage.setItem("picker.recent", JSON.stringify(this.history)); } catch {}
  }

  // Every org's projects, once per read (never per frame).
  rebuild() {
    this.byOrg = Object.fromEntries(ORG_IDS.map((o) => [o, projectsOf(o, { catalog: this.catalog, heads: this.heads, root: this.root })]));
  }

  // The org's orchestrator terminal (`ws orchestrator start <org>` names it orch-<org>), live.
  orchestrator() {
    if (FIXTURE) return FIXTURE.running ? { address: "t0" } : null;
    return terminals().find((x) => x.name === `orch-${this.org}` && x.state === "live") ?? null;
  }

  rows() {
    const projects = this.byOrg[this.org] ?? [];
    const open = spaces().filter((s) => (s.machine ?? null) === null).map((s) => s.name);
    const recent = recentOf(projects, this.history, open);
    const orch = this.org === "other" ? null : { running: Boolean(this.orchestrator()) };
    return buildRows({ org: this.org, projects, recent, orch, query: this.filter, expanded: this.expanded, root: this.root });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // The space already holding a project: named after it, or with a terminal in it.
  spaceOf(p) {
    const inside = `${p.main.slice(0, -"/main".length)}/`;
    const ps = panes();
    return spaces().find((s) => {
      if ((s.machine ?? null) !== null) return false;
      if (s.name === p.name) return true;
      const tabs = new Set((s.tabs ?? []).map((t) => t.id));
      return ps.some((x) => tabs.has(x.tab) && (x.cwd ?? "").startsWith(inside));
    }) ?? null;
  }

  go(r, cx) {
    if (!selectable(r)) return;
    // Herdr's own "+": a plain terminal in the focused one's folder.
    if (r.kind === "terminal") { this.close(); run("space.new"); return; }
    if (r.kind === "root") { this.close(); run("space.new", { name: orgFace(this.org).label, folder: r.path, machine: "" }); return; }
    if (r.kind === "other") {
      this.close();
      pickFolder({ prompt: "Open a folder as a space" }).then((folder) => {
        if (folder) run("space.new", { folder, machine: "" });
      }).catch(() => {});
      return;
    }
    if (r.kind === "orch") return this.orch(cx);
    const p = r.project;
    this.saveHistory(p.org, p.name);
    this.close();
    if (!p.cloned) {
      // `ws clone` in a new space at the org's root; Claude starts in main once it is there.
      run("space.new", { name: p.name, folder: `${this.root}/${p.org}`, argv: cloneArgv(p), machine: "" });
      return;
    }
    const space = this.spaceOf(p);
    if (r.kind === "worktree") {
      if (space) run("tab.new", { space: space.id, name: r.label, folder: r.path, argv: ["claude"] });
      else run("space.new", { name: p.name, folder: r.path, argv: ["claude"], machine: "" });
      return;
    }
    if (space) run("space.select", { id: space.id });
    else run("space.new", { name: p.name, folder: p.main, argv: ["claude"], machine: "" });
  }

  // The org's orchestrator: focus it when it runs, else start it with ws (which makes or
  // reuses the org's space and names its tab), then close.
  orch(cx) {
    const live = this.orchestrator();
    if (live) { this.close(); run("agent.focus", { terminal: live.address }); return; }
    if (this.starting) return;
    this.starting = true;
    cx.notify();
    const org = this.org;
    cx.spawn(async (cx) => {
      let r = null;
      try { r = await exec("zsh", ["-lc", '"$1" orchestrator start "$2"', "zsh", `${this.root}/bin/ws`, org]); } catch (e) { r = { code: 1, stderr: String(e) }; }
      this.starting = false;
      if (r?.code !== 0) {
        notify({ title: `${orgFace(org).label} orchestrator didn't start`, body: (r?.stderr || r?.stdout || "").trim().split("\n").at(-1) || `Run: ws orchestrator start ${org}`, level: "warning" });
        cx.notify();
        return;
      }
      this.close();
    });
  }

  // ⌘⏎ on a cloned project or worktree: the New worktree dialog for its repo.
  newWorktree(r) {
    if (!r?.project?.cloned) return;
    this.close();
    openOverlay({ mod: "worktree-ws", kind: "dialog", width: 560, height: 480, props: { folder: r.project.main, action: "new" } });
  }

  toggle(name, cx) {
    this.expanded.has(name) ? this.expanded.delete(name) : this.expanded.add(name);
    cx.notify();
  }

  setOrg(org, cx) {
    this.org = org;
    this.at = firstRow(this.rows(), this.filter);
    // The org's own search (its placeholder names it) takes the typed text and the keyboard.
    this.input = this.inputs[org];
    if (this.input.value() !== this.filter) this.input.set_value(this.filter);
    this.input.focus();
    cx.notify();
  }

  // An org's tile, as the Spaces switcher draws it: a rounded square with its initials.
  orgTile(initials, t) {
    return h_flex().size(24).flex_none().rounded(8).items_center().justify_center()
      .bg(tint(t.foreground, "1a", t.hover)).text_color(t.muted).text_size(10).font_semibold()
      .child(initials);
  }

  // The Spaces sidebar's workspace switcher: the pill opens a menu of the orgs, each with
  // its tile, how many projects it has and a check on the shown one.
  orgSwitch(t) {
    const face = orgFace(this.org);
    const counts = Object.fromEntries(ORG_IDS.map((o) => [o, (this.byOrg[o] ?? []).length]));
    const close = () => { this.menuOpen = false; this.menuClosedAt = Date.now(); };
    const trigger = h_flex().id("sp-org-pill").w_full().h(36).px(8).gap(8).items_center().rounded(12)
      .bg(t.raised).hover((s) => s.bg(t.selected)).cursor_pointer()
      .tooltip("Workspace (Tab: next one)")
      .on_click((_e, cx) => {
        if (Date.now() - this.menuClosedAt < 300) return;
        this.menuOpen = !this.menuOpen;
        cx.notify();
      })
      .child(this.orgTile(face.initials, t))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(t.foreground).child(face.label))
      .child(svg("mods/spaces-ws/chevrons-up-down.svg").size(13).flex_none().text_color(t.dim));
    const item = (m) => h_flex().id(`sp-org-${m.id}`).h(32).px(8).gap(8).items_center().rounded(8)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { close(); this.setOrg(m.id, cx); })
      .child(this.orgTile(m.initials, t))
      .child(div().flex_1().min_w(0).truncate().text_size(13)
        .text_color(m.on ? t.foreground : t.muted).when(m.on, (el) => el.font_semibold()).child(m.label))
      .child(div().flex_none().text_size(12).text_color(t.dim).child(String(m.count)))
      .child(div().w(14).flex_none().when(m.on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(13).text_color(t.accent))));
    const content = v_flex().w(252).mt(6).p(4).gap(1).rounded(12).border_1().border_color(t.border).bg(t.popover)
      .on_mouse_down_out((_e, cx) => { if (this.menuOpen) { close(); cx.notify(); } })
      .child(div().px(8).pt(4).pb(2).text_size(12).font_medium().text_color(t.dim).child("Workspaces"))
      .children(orgMenu(counts, this.org).map(item));
    return Popup.new("sp-org-switch", trigger).w_full().anchor("top_left").when(this.menuOpen, (el) => el.content(content));
  }

  render() {
    const t = theme();
    const mono = settings().font_family ?? "JetBrains Mono";
    const rows = this.rows();
    if (!selectable(rows[this.at])) this.at = firstRow(rows, this.filter);
    const fact = (text, color = t.dim) => div().flex_none().text_size(12).font_family(mono).text_color(color).child(text);
    const icon = (path, color = t.dim) => svg(path).size(14).flex_none().text_color(color);
    const lead = (r) => {
      if (r.kind === "orch") {
        const on = r.running;
        return div().w(16).flex_none().flex().justify_center()
          .child(div().size(7).rounded(4).bg(on ? tint(t.ansi2, "cc", t.accent) : tint(t.dim, "66", t.dim)));
      }
      if (r.kind === "root") return icon("mods/workspace-chrome/terminal.svg");
      if (r.kind === "terminal") return icon("mods/workspace-chrome/plus.svg");
      if (r.kind === "other") return icon("mods/workspace-chrome/folder-plus.svg");
      if (r.kind === "worktree") return icon("mods/workspace-chrome/branch.svg");
      if (r.recent) return icon("mods/workspace-chrome/clock.svg");
      return icon("mods/workspace-chrome/folder.svg", r.project.cloned ? t.muted : t.dim);
    };
    const facts = (r) => {
      const out = [];
      if (r.kind === "orch") out.push(fact(this.starting ? "starting…" : r.running ? "running" : "start", r.running || this.starting ? t.dim : t.muted));
      else if (r.kind === "root" || r.kind === "terminal") out.push(fact("shell"));
      else if (r.kind === "other") out.push(fact("Finder"));
      else if (r.kind === "worktree") out.push(fact(r.branch || "detached"));
      else if (!r.project.cloned) out.push(fact("not on this Mac"), fact("clone", t.muted));
      else {
        const m = mainFact(r.project);
        out.push(m.warn ? fact(m.text, t.ansi1).id(`sp-warn-${r.label}-${r.recent ? "r" : "p"}`).tooltip(m.tip) : fact(m.text));
        if (r.project.worktrees.length) out.push(fact(`⑂ ${r.project.worktrees.length}`));
        if (!r.recent && r.expandable) {
          out.push(div().id(`sp-fold-${r.label}`).size(20).flex_none().flex().items_center().justify_center().rounded(5)
            .hover((s) => s.bg(t.hover)).cursor_pointer().tooltip(r.open ? "Hide worktrees (←)" : "Show worktrees (→)")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(r.label, cx); })
            .child(svg(`mods/workspace-chrome/chevron-${r.open ? "down" : "right"}.svg`).size(12).text_color(t.dim)));
        } else if (!r.recent) out.push(div().w(20).flex_none());
      }
      return out;
    };
    const row = (r, i) => {
      if (r.kind === "section") {
        return div().id(`sp-sec-${i}`).px(8).pt(i ? 10 : 2).pb(3).flex_none().text_size(12).font_medium().text_color(t.dim).child(r.label);
      }
      if (r.kind === "gap") return div().id(`sp-gap-${i}`).mx(8).my(5).h(1).flex_none().bg(t.border);
      if (r.kind === "empty") return div().id(`sp-empty-${i}`).px(8).py(6).flex_none().text_size(12).text_color(t.dim).child(r.label);
      const on = i === this.at;
      const off = r.project && !r.project.cloned;
      const quiet = r.kind === "terminal" || r.kind === "other";
      return h_flex().id(`sp-row-${i}`).min_h(r.kind === "worktree" ? 28 : 32).px(8).gap(9).flex_none().items_center().rounded(8)
        .when(r.kind === "worktree", (el) => el.pl(32))
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .cursor_pointer()
        .on_click((_e, cx) => { this.at = i; this.go(r, cx); })
        .child(lead(r))
        .child(div().flex_1().min_w(0).truncate().text_size(r.kind === "worktree" || quiet ? 12.5 : 13)
          .text_color(off || quiet ? t.dim : r.kind === "worktree" ? t.muted : t.foreground).child(r.label))
        .children(facts(r));
    };
    const move = (dir) => {
      const next = step(rows, this.at, dir);
      if (next >= 0) { this.at = next; this.scroll.scroll_to_item(next); }
    };
    return v_flex()
      .id("space-picker")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") {
          if (this.menuOpen) { this.menuOpen = false; cx.stop_propagation(); cx.notify(); return; }
          return this.close();
        }
        if (k === "enter" && e.modifiers.platform) { cx.stop_propagation(); return this.newWorktree(rows[this.at]); }
        if (k === "down") move(1);
        else if (k === "up") move(-1);
        else if (k === "tab") {
          this.setOrg(nextOrg(this.org, e.modifiers.shift), cx);
          cx.stop_propagation();
          return;
        } else if ((k === "right" || k === "left") && !this.filter) {
          // Only with an empty search, so the arrows still move the caret in typed text.
          const r = rows[this.at];
          const what = arrow(r, k);
          if (!what) return;
          if (what === "parent") {
            this.expanded.delete(r.project.name);
            const next = this.rows();
            this.at = next.findIndex((x) => x.kind === "project" && !x.recent && x.project === r.project);
          } else this.toggle(r.label, cx);
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(v_flex().px(12).pt(12).pb(8).gap(8).flex_none().border_b(1).border_color(t.border)
        .child(this.orgSwitch(t))
        .child(h_flex().h(32).px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(14).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))))
      .child(v_flex().id("sp-list").flex_1().min_h(0).p(6).gap(1).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.length ? rows.map(row) : [div().px(8).py(6).text_size(12).text_color(t.dim).child(`Nothing matches “${this.filter.trim()}”`)]))
      .child(h_flex().px(12).h(30).gap(12).flex_none().items_center().border_t(1).border_color(t.border).text_size(12).text_color(t.dim)
        .child("↑↓ move").child("→ worktrees").child("⏎ open").child("⌘⏎ new worktree").child("tab workspace").child("esc close"));
  }
}
