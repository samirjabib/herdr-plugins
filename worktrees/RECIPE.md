# Worktrees

Git worktrees the mac-workspace way in Herdr's default layout: the sidebar
shows one row per project, every pane says which checkout and branch it is in,
the space menu makes and opens checkouts as splits beside you instead of new
spaces, a clean up removes the ones that are done, and `⌘⇧U` brings a
project's main up to date.

**How it behaves**

- **The Spaces sidebar** (`spaces-ws`, a copy of Herdr's `spaces`): one row
  per project. A space belongs to the repo its first terminal is in now
  (`git rev-parse --git-common-dir`), so the main checkout's space and every
  worktree's space are one row, named after the project (`<name>` for
  `.../mac-workspace/<group>/<name>/main`, else the repo's folder). A click
  goes to the space on the main checkout, else the row's first; clicking the
  row again goes to the project's next space, round, so every space is a
  click away. Spaces outside a repo keep a row each. After the name, left to
  right:
  - how many spaces the row merges, when more than one (`2`);
  - a dot per agent in the project's spaces, sub-agents after their parent:
    working (filled, the working color), needs you (the needs-you color), idle
    or done (hollow). One idle agent alone shows no dot;
  - `▸N`: terminals those spaces started with `hc run` that aren't agents
    (watchers, jobs, dev servers) and still run; red when one ended with an
    error (a killed one doesn't count);
  - main's state, only when it isn't fresh: `↓N` (yellow) commits behind its
    upstream as last fetched (the sidebar never fetches), or `⚠` (red) when
    `ws update` couldn't fast-forward it, with why on hover: on another
    branch, uncommitted changes (tracked files), commits ahead of upstream.
    Up to date says nothing.

  Rows that need you come first, then rows with an agent working, then the
  rest in their own order, which dragging a row changes (a row's spaces move
  together and stay next to each other). Hover a row for its agents and their
  status, under each space's name when the row has several. The narrow rail shows the avatar, ringed in the needs-you color when
  something there needs you. The branch isn't in the row: the pane header
  shows it.
- **Update main** (`⌘⇧U`, or right-click a project → Update main): runs
  `~/mac-workspace/bin/ws update <project>` on the space's machine for the
  focused (or right-clicked) space's project and shows its one line in a toast
  (`<project>: main ↓N → up to date`, `<project>: main already up to date`, or
  `<project>: <reason>, not touched`), then the row looks again. Without
  `ws update` the toast says it isn't installed. The key is `cmd-shift-u` in
  the plugin's `keys.json` (section `layout:main-accounts`, action
  `spaces-ws.update`), merged into yours by `scripts/install.sh` unless
  `--no-keys`; a key you already bind there is kept.
- **The pane header** (`pane-branch`, a copy of Herdr's `pane`). Left to right:
  the program, a chip with the checkout as `<project> › <worktree>` (hover:
  the full path), the branch, and the agent's status. The middle stays empty so
  the drag grip covers nothing. Folders outside a known layout show their path
  instead of the chip. The branch comes from `git branch --show-current` in the
  pane's live folder every 5 s (one at a time), since Herdr's own `branch` is empty for
  terminals. The split buttons open the new terminal in that pane's folder,
  not the focused pane's.
- **Files and Changes panels** (`files-ws`, `changes-ws`, copies of Herdr's).
  They already follow the focused pane's checkout; a row under the title now
  says which: the same `<project> › <worktree>` chip (hover: the path) and its
  branch, read again when the focused folder changes.
- **Click the chip:** the switcher. Every checkout of the repo with its branch
  and age, filtered as you type. Picking one focuses the pane already in it,
  else opens it as a split on the right with Claude running.
- **Where checkouts go.** A repo whose main checkout is
  `.../mac-workspace/<group>/<name>/main` gets new ones in
  `.../<group>/<name>/worktrees/<branch slug>`. Any other repo keeps Herdr's
  `~/.herdr/worktrees/<repo>/<branch slug>`. The sidebar puts both in the
  repo's row, since it groups by `git rev-parse --git-common-dir`.
- **The space menu** (right-click a space; `spaces-ws` → `menu-ws` →
  `worktree-ws`, copies of Herdr's): Update main, New worktree, Open worktree
  and Clean up worktrees use this plugin; Remove worktree is still Herdr's.
- **Clean up** (the switcher's "Clean up…" button, `ctrl-d` there, or the space
  menu). Every linked checkout with its size and age, and badges: "in main"
  (its branch is merged: a merged PR from it, which catches squash merges, or
  git sees it in `origin/main`, `origin/staging` or `origin/master`) and "on
  remote" (no commit missing from every remote). Removing a worktree keeps its
  branch and commits, so one can go when nothing is uncommitted, every commit
  is on a remote and no pane is in it, on a branch or detached (as after
  `git checkout origin/main`; "in main" when its commit is in a base). Merged
  ones are chosen by default;
  pushed but unmerged ones can be chosen by hand; the rest are greyed out with
  what would be lost ("uncommitted changes", "2 only on this Mac"), or who is
  using it ("in use · Claude working", "in use · shell", in the working color). Click or `space` toggles one; the "Remove N · size" button removes
  the chosen ones with `git worktree remove` (never forced) and shows the
  space freed.
- **Buttons.** The switcher has "+ New worktree" and "Clean up…"; the create,
  remove and clean up dialogs have Cancel and their action. The keys still work.
- **Agents list** (`agents-ws`, a copy of Herdr's `agents`). Agents look and
  sort as before. Background processes an agent started with `hc run`
  (watchers, jobs, dev servers) sit under it, at any depth, with a ▸ and
  `running`, `✓ <age>` or `exit <code>`. Click one to read its last 40 lines in
  a popup, no new tab (× or Esc closes it). Finished ones leave after 5
  minutes; failed ones stay until you have opened them once. Plain shells in
  tabs are not processes.
- **The layout** (`main-accounts`): Herdr's default with claude-accounts' usage
  in the status bar, the sidebar's spaces from `spaces-ws`, the Agents list from
  `agents-ws`, pane headers from `pane-branch`, and the Files and Changes panels
  from `files-ws` and `changes-ws`.

**Updates.** The seven mods are copies of Herdr's shipped ones, so they don't
follow Herdr's updates. If Herdr's own spaces list or pane header gains
something, clone it again and reapply this plugin's changes.
