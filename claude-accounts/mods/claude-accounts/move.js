// Move this session to… (S4): moves one terminal's Claude to another account,
// without changing the active account and without touching any other
// terminal. Opened by the `move-session` command (its key, or `herdr-app do
// claude-accounts.move-session`) for the terminal focused when it ran. What it
// says and runs is move-model.js's; this file draws it.
//   props: { view: "move", terminal, title }
//
// A row runs the CLI's `resume --terminal <t> --account <id>`. A pay-per-use
// account (Enterprise, Team: S3) asks first, and nothing runs until Move;
// Cancel or Esc runs nothing. A started move closes the dialog with a toast,
// and its job goes in shared(MOVES_KEY), where the footer's toasts follow it
// (busy, moved, or why it failed). A move that couldn't start (the terminal
// isn't Claude, it has nothing to resume…) keeps the dialog open with the
// CLI's own words. A copy without an overlay (herdr-app check) only draws.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, openOverlay, closeOverlay, exec, readTextFile, notify, shared, setShared, home, appHome } from "herdr";
import { MOD, FILES, stateDir, cliPath, readAccounts } from "./store.js";
import { MOVES_KEY, moveModel, moveStep, moveStarted, addMove } from "./move-model.js";

const SPINNER = Object.freeze(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);

export function openMove(target) {
  return openOverlay({ mod: MOD, kind: "dialog", modal: true, width: 440, props: { view: "move", terminal: target?.terminal ?? null, title: target?.title ?? null } });
}

export default class Move {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.overlay = pr.overlay ?? null;
    this.target = pr.terminal ? { terminal: pr.terminal, title: pr.title ?? null } : null;
    this.accounts = readAccounts(null);
    this.on = null; // `terminal <t> --json`: the account it runs on
    this.pending = null; // the pay-per-use account waiting for Move
    this.error = null;
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(600, () => this.handle.focus());
    if (!this.overlay) return;
    cx.spawn(async (cx) => {
      try {
        this.accounts = readAccounts(await readTextFile(`${stateDir(home())}/${FILES.contract}`));
      } catch {
        // No file yet: no accounts to list.
      }
      if (this.target) {
        const r = await exec(cliPath(appHome()), ["terminal", this.target.terminal, "--json"]).catch(() => null);
        if (r?.code === 0) {
          try {
            this.on = JSON.parse(r.stdout);
          } catch {
            this.on = null;
          }
        }
      }
      cx.notify();
    });
  }

  state() {
    return { accounts: this.accounts, target: this.target, on: this.on, pending: this.pending };
  }

  act(cx, event) {
    if (this.busy) return;
    const step = moveStep(this.state(), event);
    this.pending = step.pending;
    this.error = null;
    // moveArgs: resume --terminal <t> --account <id> --json.
    if (step.run) this.run(cx, step.run, step.run[4]);
    cx.notify();
  }

  // Runs the move in a task no view owns, so a dialog closed meanwhile still
  // records the job its toasts follow.
  run(cx, argv, id) {
    this.busy = true;
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    cx.spawn(async () => {
      try {
        let r;
        try {
          r = await exec(cliPath(appHome()), argv);
        } catch (e) {
          r = e;
        }
        const started = moveStarted(r, { accounts: this.accounts, target: this.target, id });
        this.busy = false;
        if (!started.job) {
          this.error = started.error;
          return;
        }
        setShared(MOVES_KEY, addMove(shared(MOVES_KEY), started.job, this.target, Date.now()));
        if (started.notify) notify(started.notify);
        closeOverlay(this.overlay);
      } finally {
        settle();
      }
    }, { owner: null });
    cx.spawn(async (cx) => {
      await settled;
      try {
        cx.notify();
      } catch {
        // Closed meanwhile.
      }
    });
  }

  close() {
    closeOverlay(this.overlay ?? props()?.overlay);
  }

  key(e, cx) {
    if (e.key === "escape") {
      if (this.pending) this.act(cx, { type: "cancel" });
      else this.close();
    } else if (e.key === "enter" && this.pending) this.act(cx, { type: "confirm" });
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const m = moveModel({ ...this.state(), error: this.error });
    const root = v_flex().id("ca-move").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().bg(t.popover).text_color(t.foreground).text_size(12.5);
    const c = m.confirm;
    const header = h_flex().flex_none().px(18).pt(16).pb(4).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(c ? c.title : m.title))
      .child(div().text_size(11).text_color(t.dim).child(this.busy ? "" : "Esc"));
    const body = v_flex().id("ca-move-body").max_h(380).px(18).pt(4).pb(10).gap(10).overflow_y_scrollbar()
      .when(Boolean(c), (el) => el.child(div().text_color(t.muted).child(c?.body ?? "")))
      .when(!c && Boolean(m.subtitle), (el) => el.child(div().text_color(t.muted).child(m.subtitle ?? "")))
      .when(!c && m.rows.length > 0, (el) => el.child(this.list(t, m)))
      .when(Boolean(m.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(m.error ?? "")));
    const footer = h_flex().flex_none().px(18).py(14).gap(8).items_center().justify_end().border_t_1().border_color(t.border);
    if (c) {
      footer
        .child(this.button(t, "ca-move-cancel", c.cancel, false, !this.busy, (cx) => this.act(cx, { type: "cancel" })))
        .child(this.button(t, "ca-move-confirm", c.move, true, !this.busy, (cx) => this.act(cx, { type: "confirm" }))
          .when(this.busy, (b) => b.child(div().w(10).flex_none().frames(SPINNER, 90).child(SPINNER[0]))));
    } else {
      footer.child(this.button(t, "ca-move-close", "Close", false, !this.busy, () => this.close()));
    }
    return root.child(header).child(body).child(footer);
  }

  // One row per account it can go to: its email, its plan, the pay-per-use
  // tag, or why it can't be picked.
  list(t, m) {
    return v_flex().id("ca-move-list").p(6).gap(1).rounded(8).bg(t.chrome).border_1().border_color(t.border)
      .children(m.rows.map((r) => h_flex().id(`ca-move-row-${r.id}`).h(30).px(8).gap(8).items_center().rounded(5)
        .when(!r.disabled && !this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.act(cx, { type: "pick", id: r.id })))
        .child(div().flex_1().min_w(0).truncate().text_color(r.disabled ? t.muted : t.foreground).child(r.label))
        .when(Boolean(r.hint), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(r.hint ?? "")))
        .when(Boolean(r.tag), (el) => el.child(div().flex_none().px(6).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.working).child(r.tag ?? "")))
        .when(Boolean(r.plan), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(r.plan ?? "")))));
  }

  button(t, id, label, primary, enabled, action) {
    return h_flex().id(id).h(32).px(14).gap(6).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)))
      .when(!enabled, (el) => el.opacity(0.5))
      .child(label);
  }
}
