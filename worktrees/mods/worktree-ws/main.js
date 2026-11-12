// Worktree dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { branch, tab, argv }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, spaces, panes, exec, home } from "herdr";
import { ROOT, slug, checkoutDir, repoTitle, cleanVerdict, mergedSet, size, withAlpha } from "./model.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Checkouts go to <ROOT>/<repo>/<branch, slashes as dashes>.
// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// A dialog button; `primary` is the solid one, `disabled` greys it out.
const button = (t, id, label, onClick, { primary = false, disabled = false } = {}) =>
  h_flex()
    .id(id)
    .flex_none()
    .h(28)
    .px(12)
    .items_center()
    .rounded(7)
    .border_1()
    .text_size(12)
    .border_color(primary ? t.solid : t.input)
    .bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .when(disabled, (el) => el.opacity(0.45))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }))
    .child(label);

// Every checkout of a repo (`git worktree list`), the main one first, then
// the most recently committed: { path, branch, main, at }.
async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on);
  const when = new Map(refs.out.split("\n").map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) || 0]));
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

// The space showing a checkout: its first terminal is in it (the deepest checkout wins).
function spaceOf(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The submodule repos git keeps for a checkout (nested ones too, checked out
// or not): { name, dir, pinned }. `config` is the args that read its
// .gitmodules; `pinned` is the commit its parent records ("" if none).
async function modules(gitDir, config, on, out = [], parent = "") {
  const keys = await git(gitDir, ["--git-dir", gitDir, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);
  if (!keys.ok) return out; // no .gitmodules, or no submodules in it
  // -z: "key\nvalue" records ended by NUL, so names and paths may hold spaces.
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const dir = `${gitDir}/modules/${name}`;
    if (!(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue; // never checked out
    const pinned = await git(gitDir, ["--git-dir", gitDir, "rev-parse", `HEAD:${record.slice(at + 1)}`], on);
    // Names are only unique within their parent: nested ones carry its name.
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
    if ((await git(gitDir, ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"], on)).ok) await modules(dir, ["--blob", "HEAD:.gitmodules"], on, out, `${parent + name}/`);
  }
  return out;
}

// The worktree's submodules, and the names of those with commits that exist
// nowhere else: not on a remote, and not the commit the parent pins (git
// fetches that by hash, so it is often on no remote branch here).
async function submodules(top, on) {
  const gitDir = await git(top, ["rev-parse", "--absolute-git-dir"], on);
  if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
  const mods = await modules(gitDir.out, ["--file", `${top}/.gitmodules`], on);
  const unpushed = [];
  for (const m of mods) {
    const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])], on);
    if (!local.ok) throw new Error(local.err || `Couldn't check submodule ${m.name}.`);
    if (local.out) unpushed.push(m.name);
  }
  return { mods, unpushed };
}

// The repo a folder belongs to: its main checkout and name, and whether
// the folder is itself a linked worktree. null outside git.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

export default class Worktree extends View {
  init(_props, cx) {
    this.on = this.space()?.machine;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    this.cleaning = props()?.action === "clean";
    this.picked = new Set(); // clean: paths chosen for removal
    this.freed = 0; // clean: KB removed in this dialog
    this.text = props()?.branch ?? "";
    this.list = undefined; // open: the checkouts, once read
    this.at = 0;
    this.input = InputState.new({ value: this.text, placeholder: this.opening ? "filter worktrees" : "branch name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.handle = cx.focus_handle();
    this.handle.focus(); // the root is mounted from the first frame: keep the keyboard here while loading
    if (props()?.action !== "remove" && !this.cleaning) this.input.focus();
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in git
    this.dirty = false;
    this.unpushed = [];
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          let result;
          try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); } catch {}
          if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: this.on });
          if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
          this.userHome = result.stdout.trim().replace(/\\/g, "/");
        }
        this.folder = props()?.folder || place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until the warnings it consents to are known.
        const repo = await repoOf(this.folder, this.on);
        if (repo && props().action === "remove") {
          this.dirty = (await git(repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on)).out !== "";
          this.unpushed = (await submodules(repo.top, this.on)).unpushed;
        }
        if (repo && this.opening) this.list = await checkouts(repo, this.on);
        if (repo && this.cleaning) this.list = await this.cleanList(repo);
        this.repo = repo;
        cx.notify();
        // The list (and with it the filter input) only mounts once loading is
        // done, so the keyboard must move there now — a focus call made while
        // loading lands on nothing and the dialog stays keyboard-dead.
        this.handle.focus();
        if (props().action !== "remove" && !this.cleaning) cx.timer.after(100, () => this.input.focus());
        if (props().branch) await this.work(cx);
      } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
    });
  }

  space() {
    const p = props() ?? {};
    return spaces().find((s) => s.id === p.space) ?? (p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined);
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.busy || !this.repo) return;
    cx.spawn(async (cx) => this.work(cx));
  }

  async work(cx) {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try { this.error = props().action === "remove" ? await this.remove() : await this.create(); }
    catch (error) { this.error = String(error); }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  async create() {
    const branch = this.text.trim();
    if (!branch) return "Type a branch name.";
    const path = `${checkoutDir(this.repo, this.userHome)}/${slug(branch)}`;
    const exists = (await git(this.repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], this.on)).ok;
    const add = exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"];
    const r = await git(this.repo.top, add, this.on, 600_000);
    if (!r.ok) return r.err || "git worktree add failed.";
    const p = props();
    this.openHere(path, p.argv);
    return "";
  }

  // Open a checkout as a split right of the focused pane in the menu's space, with
  // Claude running (props.argv overrides). Reuse a pane already in that checkout.
  openHere(path, argv) {
    const s = this.space();
    if (s?.id && !s.active) run("space.select", { id: s.id });
    const there = panes().find((q) => q.cwd && (q.cwd === path || q.cwd.startsWith(path + "/")));
    if (there) { run("pane.focus", { pane: there.pane }); return; }
    run("terminal.open", { folder: path, place: "right", argv: argv ?? ["claude"] });
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f));
  }

  open(c) {
    if (!c) return;
    this.close();
    this.openHere(c.path);
  }

  async remove() {
    const s = this.space();
    const status = await git(this.repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on);
    if (!status.ok) return status.err || "git status failed.";
    // git refuses a worktree with submodules unless forced, because their
    // history goes with it. The popup already showed what's at risk; only
    // risk that appeared since it opened gets one more warning.
    const { mods, unpushed } = await submodules(this.repo.top, this.on);
    const changed = (status.out && !this.dirty) || unpushed.some((name) => !this.unpushed.includes(name));
    this.dirty ||= status.out !== "";
    this.unpushed = [...new Set([...this.unpushed, ...unpushed])];
    if (changed) return "It changed since this opened. Enter again removes it anyway.";
    // Terminals first: a shell sitting in the folder keeps it busy on Windows.
    run("space.close", { id: s.id, confirmed: true });
    const force = this.dirty || mods.length > 0;
    const r = await git(this.repo.main, ["worktree", "remove", ...(force ? ["--force"] : []), this.repo.top], this.on, 600_000);
    return r.ok ? "" : r.err || "git worktree remove failed.";
  }

  // Clean up: every linked checkout with what decides whether it can go.
  async cleanList(repo) {
    const all = (await checkouts(repo, this.on)).filter((c) => !c.main);
    // Merged: a merged PR from that branch (squash merges too), else git sees it in a base.
    let prs = "";
    if (!this.on) {
      try {
        const r = await exec("gh", ["pr", "list", "--state", "merged", "--limit", "500", "--json", "headRefName", "--jq", ".[].headRefName"], { cwd: repo.main, timeout: 30_000 });
        if (r.code === 0) prs = r.stdout;
      } catch {}
    }
    const bases = [];
    for (const base of ["origin/main", "origin/staging", "origin/master"]) {
      const r = await git(repo.main, ["branch", "--merged", base, "--format=%(refname:short)"], this.on);
      if (r.ok) bases.push(r.out);
    }
    const merged = mergedSet(prs, ...bases);
    const paneList = panes();
    const rows = await Promise.all(all.map(async (c) => {
      const [st, ahead, du] = await Promise.all([
        git(c.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on),
        git(c.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"], this.on),
        exec("du", ["-sk", c.path], { on: this.on, timeout: 60_000 }).catch(() => null),
      ]);
      const row = {
        ...c,
        merged: Boolean(c.branch && merged.has(c.branch)),
        dirty: !st.ok || st.out !== "",
        unpushed: ahead.ok ? Number(ahead.out) || 0 : 1,
        open: paneList.some((q) => q.cwd && (q.cwd === c.path || q.cwd.startsWith(c.path + "/"))),
        kb: du && du.code === 0 ? Number(du.stdout.split(/\s/)[0]) || 0 : 0,
      };
      return { ...row, ...cleanVerdict(row) };
    }));
    // Merged ones first and chosen by default, then the other removable ones,
    // then those that would lose something; biggest first in each.
    rows.sort((a, b) => b.suggested - a.suggested || b.safe - a.safe || b.kb - a.kb);
    this.picked = new Set(rows.filter((r) => r.suggested).map((r) => r.path));
    return rows;
  }

  // Removes the chosen checkouts (git worktree remove, never forced: a checkout
  // that changed since the list was read stays). Branches stay.
  async removePicked(cx) {
    if (this.busy || this.picked.size === 0) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    const failed = [];
    for (const c of (this.list ?? []).filter((r) => r.safe && this.picked.has(r.path))) {
      const r = await git(this.repo.main, ["worktree", "remove", c.path], this.on, 600_000);
      if (r.ok) this.freed += c.kb;
      else failed.push(`${c.branch}: ${r.err || "git worktree remove failed"}`);
    }
    this.list = await this.cleanList(this.repo);
    this.at = 0;
    this.error = failed.join("\n");
    this.busy = false;
    cx.notify();
  }

  // Swap this dialog for another mode of it on the same repo.
  switchTo(action, width, height) {
    this.close();
    openOverlay({ mod: "worktree-ws", kind: "dialog", width, height, props: { space: props()?.space, folder: this.folder, action } });
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (this.cleaning) {
      const rows = this.list ?? [];
      const n = rows.length;
      if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else if (e.key === "space" && rows[this.at]?.safe) {
        const path = rows[this.at].path;
        this.picked.has(path) ? this.picked.delete(path) : this.picked.add(path);
      } else if (e.key === "enter") { cx.spawn(async (cx) => this.removePicked(cx)); }
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (this.opening && e.keystroke === "ctrl-d") {
      cx.stop_propagation();
      return this.switchTo("clean", 640, 540);
    }
    if (this.opening) {
      const n = this.shown().length;
      if (e.key === "enter") this.open(this.shown()[this.at]);
      else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && props()?.action === "remove") return this.go(cx);
  }

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces();
    const paneList = panes();
    const row = (c, i) => {
      const on = i === this.at;
      const there = spaceOf(c.path, all, this.on, spaceList, paneList);
      return v_flex()
        .id(`wt-${i}`)
        .flex_none()
        .h(44)
        .px(10)
        .justify_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => this.open(c))
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.branch ?? "detached"))
            .when(c.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main checkout")))
            .when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
            .when(!there && c.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at)))),
        )
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(c.path, this.userHome ?? "")));
    };
    const count = rows.length === all.length ? `${all.length} checkouts` : `${rows.length}/${all.length} checkouts`;
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open worktree${r ? ` of ${repoTitle(r)}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : "")))
      .when(r === undefined || (r && this.list === undefined), (el) => el.child(div().text_color(t.muted).child("\u2026")))
      .when(r === null, (el) => el.child(div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a git repository.`)))
      .when(Boolean(r && this.list), (el) =>
        el
          .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground))
          .child(
            div()
              .relative()
              .flex_1()
              .min_h(0)
              .child(
                v_flex()
                  .id("wt-list")
                  .size_full()
                  .overflow_y_scroll()
                  .children(rows.map(row))
                  .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No matching worktrees."))),
              )
              .child(Scrollbar.vertical("wt-list").absolute().inset_0()),
          ),
      )
      .child(h_flex().gap(8).items_center()
        .child(button(t, "wt-new", "+ New worktree", () => this.switchTo("new", 440, 260), { disabled: !r }))
        .child(button(t, "wt-clean", "Clean up\u2026", () => this.switchTo("clean", 640, 540), { disabled: !r }))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("\u2191\u2193 choose \u00b7 \u21b5 open \u00b7 \u2303d clean up \u00b7 esc close")));
  }

  renderClean(t) {
    const r = this.repo;
    const rows = this.list ?? [];
    const chosen = rows.filter((c) => c.safe && this.picked.has(c.path));
    const kb = chosen.reduce((sum, c) => sum + c.kb, 0);
    const badge = (text, color) => div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(withAlpha(color, "26")).text_size(10.5).font_semibold().text_color(color).child(text);
    const row = (c, i) => {
      const on = i === this.at;
      const picked = c.safe && this.picked.has(c.path);
      return h_flex()
        .id(`wc-${i}`)
        .flex_none()
        .h(46)
        .px(10)
        .gap(10)
        .items_center()
        .rounded(7)
        .when(c.safe, (el) => el.cursor_pointer())
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => {
          this.at = i;
          if (c.safe) picked ? this.picked.delete(c.path) : this.picked.add(c.path);
          cx.notify();
        })
        .child(div().flex_none().size(14).rounded(4).border(1).border_color(c.safe ? (picked ? t.accent : t.border) : withAlpha(t.border, "66")).when(picked, (el) => el.bg(t.accent)))
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .child(h_flex().gap(6).items_center()
              .child(div().flex_1().min_w(0).truncate().text_color(c.safe ? t.foreground : t.muted).child(c.branch ?? "detached"))
              .when(c.inMain, (el) => el.child(badge("in main", t.done)))
              .when(c.onRemote, (el) => el.child(badge("on remote", t.done)))
              .children(c.why.map((w) => badge(w, t.blocked))))
            .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(c.path, this.userHome ?? ""))),
        )
        .child(div().flex_none().w(64).text_size(11.5).text_color(t.dim).child(size(c.kb)))
        .child(div().flex_none().w(32).text_size(11).text_color(t.dim).child(c.at > 0 ? ago(c.at) : ""));
    };
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Clean up worktrees${r ? ` of ${repoTitle(r)}` : ""}`))
        .child(div().text_size(11).text_color(t.dim).child(this.freed > 0 ? `${size(this.freed)} freed` : r ? `${rows.length} worktrees` : "")))
      .child(div().text_size(12).text_color(t.muted).child("Removing a worktree keeps its branch. One can go when nothing is uncommitted and every commit is on a remote; merged ones are chosen. The rest say what would be lost."))
      .when(r === undefined || (r && this.list === undefined), (el) => el.child(div().text_color(t.muted).child("Reading worktrees\u2026")))
      .when(Boolean(r && this.list), (el) =>
        el.child(
          div().relative().flex_1().min_h(0)
            .child(v_flex().id("wc-list").size_full().overflow_y_scroll().children(rows.map(row))
              .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No worktrees besides the main checkout."))))
            .child(Scrollbar.vertical("wc-list").absolute().inset_0()),
        ),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(11).text_color(t.dim).child("click or space selects \u00b7 esc close"))
        .child(div().flex_1())
        .when(this.busy, (el) => el.child(div().text_size(11).text_color(t.dim).frames(["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"], 90)))
        .child(button(t, "wc-cancel", this.freed > 0 ? "Done" : "Cancel", () => this.close()))
        .child(button(t, "wc-remove", this.busy ? "Removing\u2026" : chosen.length ? `Remove ${chosen.length} \u00b7 ${size(kb) || "0 KB"}` : "Remove", (cx) => cx.spawn(async (cx) => this.removePicked(cx)), { primary: true, disabled: this.busy || chosen.length === 0 })));
  }

  render(cx) {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    if (this.cleaning) return this.renderClean(t);
    const remove = props()?.action === "remove";
    const s = this.space();
    const r = this.repo;
    const title = remove ? `Remove worktree ${s?.name ?? ""}?` : `New worktree${r ? ` of ${repoTitle(r)}` : ""}`;
    const detail =
      r === undefined
        ? "…"
        : r === null
          ? `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`
          : remove
            ? !r.linked
              ? "This is the repository's main checkout, not a worktree."
              : `Closes the space and deletes ${tilde(r.top, this.userHome)}. The branch stays.`
            : `A split with Claude on a checkout in ${tilde(checkoutDir(r, this.userHome), this.userHome)}/. A branch that exists is checked out; a new one starts from here.`;
    const blocked = !r || (remove && !r.linked);
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(remove && this.dirty, (el) => el.child(div().text_color(t.blocked).child("It has uncommitted changes: they will be lost.")))
      .when(remove && this.unpushed.length > 0, (el) => el.child(div().text_color(t.blocked).child(`Submodule ${this.unpushed.join(", ")} has commits that aren't pushed anywhere: they will be lost.`)))
      .when(!remove && !blocked, (el) =>
        el.child(
          Input.new(this.input)
            .h(32)
            .px(10)
            .items_center()
            .rounded(6)
            .border(1)
            .border_color(this.inputFocused ? t.accent : t.input)
            .bg(t.background)
            .text_color(t.foreground),
        ),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .gap(6)
          .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
          .child(this.busy ? "working…" : blocked ? "esc close" : remove ? "↵ remove · esc cancel" : "↵ create · esc cancel")
          .child(div().flex_1())
          .child(button(t, "w-cancel", "Cancel", () => this.close()))
          .when(!blocked, (el) => el.child(button(t, "w-go", remove ? "Remove" : "Create", (cx) => this.go(cx), { primary: true, disabled: this.busy }))),
      );
  }
}
