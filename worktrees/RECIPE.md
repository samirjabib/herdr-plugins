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
  Above the list, Collie's workspace switcher picks the organization (the
  mac-workspace group a space's folder is in): one pill as wide as the sidebar
  (36 px, radius 12, the `raised` tone) with a 24 px rounded tile holding the
  org's initials (`CS`, `AG`, `P`, `O`; a stack icon for All workspaces), its
  name (Coldsmoke, Arctic Grey, Personal, Other) and an up/down chevron. A
  click opens a menu, "Workspaces": All workspaces, Coldsmoke, Arctic Grey,
  Personal and Other (those with spaces, and the shown one), each with its
  tile, its space count, a dot in the needs-you color when an agent there needs
  you, and an accent check on the shown one; the pill wears that dot when an
  org it hides needs you. A pick filters the list; a click beside the menu
  closes it. Greys only: the check is the one accent. Jumping to a space of
  another organization switches the pick; clicking "Spaces" hides the switcher
  and lists every space.
- **Linked to Collie** (the mac-workspace app). The pick follows Collie: when
  Collie switches workspace (it saves it in
  `~/Library/Application Support/mac-workspace/desktop.json`, watched and read
  again every 15 s), the list switches with it; a pick made here stays until
  Collie picks again. Herdr can't move Collie yet: Collie reads that file only
  at start and its core has no workspace endpoint. Beside "Spaces", how the
  link is, in Collie's words: a quiet grey-green dot and `herding N` (N agents
  working here) or `on watch` while Collie's core answers
  (`http://127.0.0.1:4317/api/colors`, every 15 s; the org colors it serves
  are shared as `workspace.colors`); an amber dot and `sheep loose` when it
  doesn't (tooltip: Collie unreachable). Click: retry when loose, else open
  Collie (`open -b com.samiros.collie`).
- **The `+`** (`space-picker`), laid out the way mac-workspace is. On top, the
  Spaces sidebar's workspace switcher (the same pill, tile and menu; Tab and
  shift-Tab cycle Coldsmoke, Arctic Grey, Personal, Other) and a search named
  after the org ("Search Arctic Grey projects…"). Then, in sections: **Here**,
  the org's seat: "<Org> orchestrator" (Enter focuses `orch-<org>` when it
  runs, else runs `ws orchestrator start <org>`) and "Terminal at
  ~/mac-workspace/<org>"; **Recent**, the org's projects opened from here, then
  ones with a space open; **Projects**, every catalog project of the org
  (`workspace.tsv`, only that group's) with main's branch on the right (`main`,
  or a red `⚠ <branch>` when main is on another branch), `⑂ N` worktrees, and
  the ones not on this Mac muted with "clone" (Enter runs `ws clone <name>` in
  a new space, then Claude in its main). → or the chevron lists a project's
  worktrees with their branches (← folds them, only while the search is
  empty); a search also opens projects that match by a worktree. "Other
  folder…" (the system's folder picker) and "New terminal" sit quietly last. A
  project that has a space goes there, else a space opens on its main with
  Claude; a worktree opens as a tab in its project's space; ⌘⏎ opens New
  worktree for the selected project. The folders are read once per opening
  (HEAD files straight from disk, no git per checkout).
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
  a quiet `orchestrator` tag in its org's color: the one picked in the mac-workspace
  app, read from its core (`http://127.0.0.1:4317/api/colors`, shared as
  `workspace.colors`), else its space's color; the Workspace Boss (`orch-workspace`) a
  `workspace boss` one, first and under every org filter, with the supervisors
  hanging under it on tree lines (it gives them their orders). They sit in a "Workspace agents" section
  at the top, one row per org (cs, ag, personal), quiet and "off" when not running.
  The list follows the Spaces workspace switcher (and so Collie): spaces-ws shares
  the pick as `spaces.org` (`all`, `cs`, `ag`, `personal`, `other`).
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
- **The layout** (`collie-sheeps`, "Collie Sheeps": Collie's sibling): Herdr's default with claude-accounts' usage
  and agent-sleep's moon (its popup: Sleep now, Wake all, automatic sleep, off
  until turned on) in the status bar, the sidebar's spaces from `spaces-ws`,
  the Agents list from `agents-tree`, pane headers from `pane-branch`, and the
  Files and Changes panels from `files-ws` and `changes-ws`. `requires`
  installs claude-accounts and agent-sleep first. It was called `main-accounts`:
  installing removes that copy (the install's manifest owns it), so switch to
  it with `herdr-app do layout.switch '{"name":"collie-sheeps"}'`.

**Updates.** The seven mods are copies of Herdr's shipped ones, so they don't
follow Herdr's updates. If Herdr's own spaces list or pane header gains
something, clone it again and reapply this plugin's changes.
