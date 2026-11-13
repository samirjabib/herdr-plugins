# Worktrees

Git worktrees the mac-workspace way in Herdr's default layout: every pane says
which checkout and branch it is in, the space menu makes and opens checkouts
as splits beside you instead of new spaces, a clean up removes the ones that
are done, the main orchestrator wears a gold star, and a space's agents can
go to sleep and come back where they were.

**How it behaves**

- **The pane header** (`pane-branch`, a copy of Herdr's `pane`). Left to right:
  the program, a chip with the checkout as `<project> › <worktree>` (hover:
  the full path), the branch, and the agent's status. The middle stays empty so
  the drag grip covers nothing. Folders outside a known layout show their path
  instead of the chip. The branch comes from `git branch --show-current` in the
  pane's live folder every 5 s (one at a time), since Herdr's own `branch` is empty for
  terminals. After the branch, a project's main checkout gets a small mark: a
  soft gold `★` when it is on main (where to update and make worktrees from),
  a red `⚠` when it is on another branch. The split buttons open the new
  terminal in that pane's folder, not the focused pane's.
- **The Spaces sidebar** (`spaces-ws`). After a space's name, only two things:
  `⑂ N`, how many worktrees its project has, and main's state: `✓` up to date,
  `↓N` (red) behind origin as last fetched (the sidebar never fetches), `⚠`
  (red) when the project's main checkout is on another branch. Clicking the
  `⚠` switches that checkout to main when nothing is uncommitted there (a
  toast says why not otherwise) and lands on its agent: the pane already in
  main, else a new tab there with Claude. A space is where its terminals'
  programs run now (`hc get`, since a space's folder is where it was made and a
  pane's folder is where its shell started); the terminal of the project the
  space is named after comes first, its main checkout before its worktrees.
  Entering a space focuses its pane in main. `☾` marks a space whose agents
  are asleep.
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
  `~/.herdr/worktrees/<repo>/<branch slug>`. The sidebar nests both under the
  repo, since it groups by `git rev-parse --git-common-dir`.
- **The space menu** (right-click a space; `spaces-ws` → `menu-ws` →
  `worktree-ws`, copies of Herdr's): New worktree, Open worktree and Clean up
  worktrees use this plugin; Remove worktree is still Herdr's. Sleep agents
  (this computer's spaces) hands the space's checkout to `agent-sleep`: its
  Claudes end and resume with `claude --resume` when you show the space again,
  its tabs and splits stay, and other programs in front (dev servers) are
  stopped too.
- **Agents list** (`agents-ws`, a copy of Herdr's `agents`). Agents look and
  sort as before, with:
  - Claudes with a pane that haven't reported a status yet (a resumed one),
    which Herdr leaves out, so their sub-agents nest instead of showing loose;
  - the name a terminal was given (`hc run --name orch-1`) instead of a tab
    number;
  - a gold `★` on the main orchestrator: an agent whose program runs in a
    project's main checkout on main (looked at every 10 s);
  - background processes an agent started with `hc run` (watchers, jobs, dev
    servers) under it, at any depth, with a `▸` and `running`, `✓ <age>` or
    `exit <code>`. Click one for its last 40 lines in a popup. Finished ones
    leave after 5 minutes; failed ones stay until opened once;
  - Background: processes whose agent has ended (`--outlive-parent`), under
    their project's space by folder, else in a group of their own.
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
- **The layout** (`main-accounts`): Herdr's default with claude-accounts' usage
  and agent-sleep's moon (its popup: Sleep now, Wake all, automatic sleep, off
  until turned on) in the status bar, the sidebar's spaces from `spaces-ws`,
  the Agents list from `agents-ws`, pane headers from `pane-branch`, and the
  Files and Changes panels from `files-ws` and `changes-ws`. `requires`
  installs claude-accounts and agent-sleep first.

**Updates.** The seven mods are copies of Herdr's shipped ones, so they don't
follow Herdr's updates. If Herdr's own spaces list or pane header gains
something, clone it again and reapply this plugin's changes.
