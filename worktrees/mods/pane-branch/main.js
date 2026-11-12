// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane-branch" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, exec, openOverlay } from "herdr";
import { worktreeOf, withAlpha } from "./model.js";

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.gitBranch = "";
    cx.timer.every(5000, (cx) => this.refreshBranch(cx));
    this.refreshBranch(cx);
  }

  // panes()[i].branch can be empty for terminals; read it from git in the pane's live folder.
  refreshBranch(cx) {
    const p = this.me();
    // One git at a time per header: a slow one must not pile up behind the timer.
    if (!p?.cwd || this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      let r = { code: 1, stdout: "" };
      try { r = await exec("git", ["branch", "--show-current"], { cwd: p.cwd, on: p.machine }); } catch {}
      this.reading = false;
      const next = r.code === 0 ? r.stdout.trim() : "";
      if (next !== this.gitBranch) { this.gitBranch = next; cx.notify(); }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        // A split starts in the focused terminal's folder, which may be another pane's:
        // focus this pane and open the split in its own live folder instead.
        if (command === "pane.split" && this.me()?.cwd) {
          run("pane.focus", { pane: args.pane });
          run("terminal.open", { place: args.direction, folder: this.me().cwd });
          return;
        }
        run(command, args);
      })
      .child(svg(`mods/pane-branch/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const wt = worktreeOf(p.cwd);
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .when(Boolean(wt), el => el.child(h_flex().flex_none().gap(4).items_center().max_w(320)
        .id(`ph-wt-${pane}`)
        .px(6).h(18).rounded(5).bg(withAlpha(t.accent, "1f"))
        .hover((s) => s.bg(withAlpha(t.accent, "3d")))
        .tooltip(`${folder(p.cwd)} · click to switch worktree`)
        .on_click((_e, cx) => {
          // Quick switcher: every checkout of this repo with its branch; picking one
          // focuses the pane already in it, else opens it as a split with Claude.
          cx.stop_propagation();
          openOverlay({ mod: "worktree-ws", kind: "dialog", width: 560, height: 480, props: { folder: p.cwd, action: "open" } });
        })
        .child(svg("mods/pane-branch/worktree.svg").size(12).flex_none().text_color(t.accent))
        .child(div().truncate().text_color(t.dim).child(wt?.project ?? ""))
        .child(div().text_color(t.dim).child("›"))
        .child(div().truncate().font_semibold().text_color(t.foreground).child(wt?.wt ?? ""))))
      .when(Boolean(p.branch || this.gitBranch), el => el.child(h_flex().flex_none().gap(4).items_center().max_w(240).text_color(t.accent)
        .child(svg("mods/pane-branch/git-branch.svg").size(12).flex_none())
        .child(div().truncate().child(p.branch || this.gitBranch))))
      .when(!wt && Boolean(p.cwd), el => el.child(div().flex_none().max_w(280).truncate().text_color(t.dim).child(folder(p.cwd))))
      .child(div().flex_1())
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(withAlpha(t.blocked, "26")).text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
