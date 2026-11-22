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
  Tabs above the list pick the organization: ALL, then AG, CS, PERSONAL (the
  mac-workspace group a space's folder is in) and OTHER, each with its count
  and a dot in the needs-you color when an agent there needs you. Jumping to a
  space of another organization switches the tab; clicking "Spaces" hides the
  bar and lists every space.
- **The `+`** (`space-picker`): the same organization tabs, a search, and the
  organization's projects with their worktrees (↑/↓, Enter, Tab for the next
  organization, Esc). A project that has a space goes there, else a space opens
  on its main with Claude; a worktree opens as a tab in its project's space; a
  catalogued project not cloned here says to run `ws clone`; "Other folder…"
  opens the system's folder picker.
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
- **Agents list** (`agents-tree`, a copy of Herdr's `agents` that keeps its look).
  Two additions:
  - each orchestrator wears a tag for where it runs: `⑂ main` (a project's
    main checkout), `⑂ <worktree>`, or `📁 root` / `📁 <group> root` (the
    workspace root, `~/mac-workspace/<group>`);
  - processes an orchestrator starts somewhere else (main or a worktree) sit
    one level deeper, under a row naming that place; ones started where it runs
    stay at the first level, as Herdr draws them.
  A mac-workspace orchestrator (`orch-<org>`, from `ws orchestrator start`) wears
  a quiet `workspace orchestrator` tag; the Workspace Boss (`orch-workspace`) a
  `workspace boss` one, first and under every org filter, with the supervisors
  hanging under it on tree lines (it gives them their orders). They sit in a "Workspace agents" section
  at the top, one row per org (cs, ag, personal), quiet and "off" when not running.
  The list follows the Spaces org filter (ALL / AG / CS / PERSONAL): spaces-ws shares
  it as `spaces.org`.
  Finished processes leave the list at once, as in Herdr's own. `agents-ws`
  (the earlier copy with the gold `★`, finished processes kept a while and
  orphan processes grouped by project) stays installable; the layout no longer
  uses it.
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
  the Agents list from `agents-tree`, pane headers from `pane-branch`, and the
  Files and Changes panels from `files-ws` and `changes-ws`. `requires`
  installs claude-accounts and agent-sleep first.

**Updates.** The seven mods are copies of Herdr's shipped ones, so they don't
follow Herdr's updates. If Herdr's own spaces list or pane header gains
something, clone it again and reapply this plugin's changes.
