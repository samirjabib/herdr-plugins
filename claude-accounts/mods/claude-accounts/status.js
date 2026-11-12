// The status bar: Herdr's workspace status row (machine, branch, agents, the
// palette hint) with the active account's usage between the agents and the
// hint, so it reads with the workspace, not after the commands.
//   props: { view: "status" }
//
// It is the footer with another frame: it keeps the footer's timer, watch,
// toasts and popover (footer.js), and only draws more around the usage. The
// left side copies Herdr's workspace-status mod, so a layout uses this view
// in that mod's place.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, spaces, agents, keys, run, settings, shared, window as appWindow } from "herdr";
import Footer, { refreshButton } from "./footer.js";
import { FOOTER, UI_KEY, usageMode, footerModel, zoomOf, anchorFrom, rememberAnchor } from "./footer-model.js";

// workspace-status's row: padding and the gap between its groups.
const PAD = 14;
const GAP = 16;
const ICON = 13;
// What the left side and the hint take besides their text: padding, the gaps
// between the five groups, the icons and the agents dot, and some slack.
const CHROME = PAD * 2 + GAP * 4 + ICON * 3 + 40;

// The palette key as bound, as workspace-status words it.
export function paletteHint(bindings, platform) {
  const mac = platform === "macos";
  const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
  const b = (bindings ?? []).find((k) => k.section === "global" && k.action === "app.palette");
  const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
  const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
  return key ? `${key}  commands` : "commands";
}

export default class Status extends Footer {
  render() {
    const t = theme();
    const zoom = zoomOf(settings());
    const space = (spaces() ?? []).find((s) => s.active);
    const list = agents() ?? [];
    const needs = list.filter((a) => a.status === "blocked").length;
    const machine = space?.machine ?? "This computer";
    const agentsText = `${list.length} agents`;
    const needsText = needs > 0 ? `· ${needs} needs you` : "";
    const hint = paletteHint(keys(), appWindow()?.platform);
    // The usage gets what the bar has left after the other groups' text.
    const taken = [machine, space?.branch ?? "", agentsText, needsText, hint].join("").length * FOOTER.char + CHROME;
    const width = typeof this.width === "number" ? this.width - taken : undefined;
    const m = footerModel({ doc: this.doc, mode: usageMode(shared(UI_KEY)), width, now: Date.now() });
    if (this.pressed) rememberAnchor(anchorFrom(this.pressed, zoom));
    const label = (icon, text) => h_flex().gap(6).items_center().flex_none().child(svg(`mods/workspace-chrome/${icon}.svg`).size(ICON)).child(text);
    return h_flex()
      .id("ca-status")
      .size_full()
      .min_w(0)
      .overflow_hidden()
      .px(PAD)
      .gap(GAP)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .whitespace_nowrap()
      .on_size_change((size, cx) => this.measure(size, cx))
      .child(label(space?.machine ? "server" : "monitor", machine))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().flex_none().child(div().size(6).rounded(3).bg(t.dim)).child(agentsText)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(needsText))))
      .child(h_flex().id("ca-status-usage").flex_none().gap(FOOTER.gap - 4).items_center()
        .on_mouse_down("left", (e) => this.press(e))
        .child(this.usage(m, t))
        .when(Boolean(m.signIn), (el) => el.child(this.signIn(m.signIn, t)))
        .when(m.refresh, (el) => el.child(refreshButton("ca-footer-refresh", t, this.refreshing, (cx) => this.refresh(cx)))))
      .child(div().flex_1())
      .child(div().id("ca-status-palette").flex_none().cursor_pointer().text_color(t.dim).on_click(() => run("app.palette")).child(hint));
  }
}
