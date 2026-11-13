// The Spaces "+": pick a project by organization (AG, CS, PERSONAL, OTHER tabs,
// as the Spaces list has them) and open it. A project that already has a space
// goes there; otherwise a space opens on its main checkout with Claude. A
// worktree opens as a tab in its project's space. Projects in the catalog that
// aren't cloned here say how to bring them; "Other folder…" asks the system.
// Props: { org }. Type to search, ↑/↓, Enter, Tab for the next organization, Esc.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, run, exec, theme, props, closeOverlay, home, readTextFile, notify, pickFolder } from "herdr";
import { projectsOf, pickRows } from "./model.js";

const ORGS = [["ag", "AG"], ["cs", "CS"], ["personal", "PERSONAL"], ["other", "OTHER"]];

export default class SpacePicker extends View {
  init(_props, cx) {
    const start = props()?.org;
    this.org = ORGS.some(([id]) => id === start) ? start : "ag";
    this.filter = "";
    this.at = 0;
    this.dirs = "";
    this.catalog = "";
    this.input = InputState.new({ placeholder: this.placeholder() });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at], cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    const root = `${home()}/mac-workspace`;
    this.root = root;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", 'ls -d "$1"/*/*/main "$1"/*/*/worktrees/* 2>/dev/null', "sh", root]);
        this.dirs = r.stdout ?? "";
      } catch {}
      try { this.catalog = await readTextFile(`${root}/workspace.tsv`); } catch {}
      cx.notify();
    });
  }

  placeholder() {
    return `Search projects in ${ORGS.find(([id]) => id === this.org)[1]}…`;
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const projects = this.org === "other" ? [] : projectsOf(this.org, this.dirs, this.catalog, this.root);
    return pickRows(projects, this.filter);
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
    if (!r) return;
    if (r.kind === "other") {
      this.close();
      pickFolder({ prompt: "Open a folder as a space" }).then((folder) => {
        if (folder) run("space.new", { folder, machine: "" });
      }).catch(() => {});
      return;
    }
    const p = r.project;
    if (!p.cloned) {
      notify({ title: `${p.name} isn't on this Mac`, body: `Run: ws clone ${p.name}`, level: "info" });
      return;
    }
    this.close();
    const space = this.spaceOf(p);
    if (r.kind === "worktree") {
      if (space) run("tab.new", { space: space.id, name: r.label, folder: r.path, argv: ["claude"] });
      else run("space.new", { name: p.name, folder: r.path, argv: ["claude"], machine: "" });
      return;
    }
    if (space) run("space.select", { id: space.id });
    else run("space.new", { name: p.name, folder: p.main, argv: ["claude"], machine: "" });
  }

  setOrg(org, cx) {
    this.org = org;
    this.at = 0;
    this.input.set_placeholder?.(this.placeholder());
    cx.notify();
  }

  render() {
    const t = theme();
    const rows = this.rows();
    if (this.at >= rows.length) this.at = rows.length - 1;
    const tab = ([id, label]) => {
      const on = this.org === id;
      return div().id(`sp-org-${id}`).h(24).px(8).flex().items_center().rounded(6).text_size(10.5).font_semibold()
        .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .cursor_pointer().on_click((_e, cx) => this.setOrg(id, cx)).child(label);
    };
    const row = (r, i) => {
      const on = i === this.at;
      const off = r.project && !r.project.cloned;
      const meta = r.kind === "other" ? "Finder" : r.kind === "worktree" ? "new tab"
        : off ? `not cloned · ws clone ${r.label}` : this.spaceOf(r.project) ? "space open" : "main";
      return h_flex().id(`sp-row-${i}`).min_h(r.kind === "worktree" ? 26 : 32).px(8).gap(9).flex_none().items_center().rounded(8)
        .when(r.kind === "worktree", (el) => el.pl(30))
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .cursor_pointer()
        .on_click((_e, cx) => { this.at = i; this.go(r, cx); })
        .when(r.kind === "worktree", (el) => el.child(svg("mods/workspace-chrome/branch.svg").size(12).flex_none().text_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().text_size(r.kind === "worktree" ? 12.5 : 13)
          .text_color(off ? t.dim : r.kind === "worktree" ? t.muted : t.foreground).child(r.label))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(meta));
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
        const n = rows.length;
        if (k === "escape") return this.close();
        if (k === "down") this.at = (this.at + 1) % n;
        else if (k === "up") this.at = (this.at + n - 1) % n;
        else if (k === "tab") {
          const i = ORGS.findIndex(([id]) => id === this.org);
          this.setOrg(ORGS[(i + (e.modifiers.shift ? ORGS.length - 1 : 1)) % ORGS.length][0], cx);
          cx.stop_propagation();
          return;
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(v_flex().px(12).pt(12).pb(8).gap(8).flex_none().border_b(1).border_color(t.border)
        .child(h_flex().gap(2).children(ORGS.map(tab)))
        .child(h_flex().h(32).px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(14).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))))
      .child(v_flex().id("sp-list").flex_1().min_h(0).p(6).gap(1).overflow_y_scrollbar()
        .when(this.org === "other", (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("Folders outside mac-workspace: pick one below.")))
        .children(rows.map(row)))
      .child(h_flex().px(12).h(30).gap(14).flex_none().items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child("↑↓ move").child("⏎ open").child("tab next organization").child("esc close"));
  }
}
