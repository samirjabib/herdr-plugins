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
- **Sleeping agents in the tree** (`agents-tree`). mac-workspace puts idle agents
  to sleep (summary in Engram, terminal ended); the tree reads them from Collie's
  core (`/api/agents`, every 15 s) and keeps each under its checkout: the Claude
  icon dimmed with a `z → zz → zzz` floating over it, its task in grey and how long
  it has slept. Hover: its recap's first lines and a **Wake** button
  (`ws agent wake <name>`), which resumes the same conversation in its tab. A
  sleeper whose terminal is live again shows as its agent row.
  Quick tags, in the accent: `asleep` on each sleeper, `zzz N` on a project or org
  holding N sleepers, and `zzz 12m` (`zzz soon` in its last minute) on an idle
  agent: when auto-sleep will take it (the core's `sleepAtMs`; orchestrators and
  your own sessions never get one).
- **The tab bar by level** (`tabs-level`, a copy of Herdr's `tabs`). It shows only
  the tabs on the active tab's level: the same checkout (`<project>/main` or one
  worktree) or, for an orchestrator, the same org root (`~/mac-workspace/<org>`).
  A tab's level is where its agent runs (else its first terminal). So an org
  orchestrator's bar holds the org's own tabs, not every worker's, and a
  worktree's bar holds the agents and terminals open there (open more with `+`
  to run several on the same branch). The wheel cycles those tabs only. A tab
  outside mac-workspace shows every tab of the space.
- **The Spaces sidebar** (`spaces-ws`). Only the header (the "Spaces" title,
  Collie's link and `+`) and Collie's workspace switcher: the list of spaces
  left the wide sidebar, since the Agents tree below says who runs where and
  project health (main's branch, behind origin, worktrees) lives in Collie and
  in the tree's project rows. The block shrinks to what it holds
  (`layout.resize` on its own `spaces` block: 88 px, 40 px with the switcher
  hidden). The rail (collapsed sidebar) keeps numbered space tiles, the only
  way there to switch spaces, and gives the block back its share of the
  column. Right-click a tile for the space menu. Git actions (switch main,
  pull) are no longer in Herdr: Collie does them.
  Collie's workspace switcher picks the organization (the
  mac-workspace group a space's folder is in): one pill as wide as the sidebar
  (36 px, radius 12, the `raised` tone) with a 24 px rounded tile holding the
  org's initials (`CS`, `AG`, `P`, `O`; a stack icon for All workspaces), its
  name (Coldsmoke, Arctic Grey, Personal, Other) and an up/down chevron. A
  click opens a menu, "Workspaces": All workspaces, Coldsmoke, Arctic Grey,
  Personal and Other (those with spaces, and the shown one), each with its
  tile, its space count, a dot in the needs-you color when an agent there needs
  you, and an accent check on the shown one; the pill wears that dot when an
  org it hides needs you. A pick filters the Agents tree; a click beside the menu
  closes it. Greys only: the check is the one accent. Jumping to a space of
  another organization switches the pick; clicking "Spaces" hides the switcher
  and lists every space.
- **Linked to Collie** (the mac-workspace app). The pick follows Collie: when
  Collie switches workspace (it saves it in
  `~/Library/Application Support/mac-workspace/desktop.json`, watched and read
  again every 15 s), the list switches with it; a pick made here stays until
  Collie picks again. Herdr can't move Collie yet:
  Collie reads that file only at start and its core has no workspace endpoint.
  Beside "Spaces", the link: a quiet grey-green dot and `linked collie` while
  Collie's core answers (`http://127.0.0.1:4317/api/colors`, every 15 s; the
  org colors it serves are shared as `workspace.colors`), a grey dot and a
  muted `collie off` when it doesn't. The tooltip keeps the detail (herding N
  agents working, or why it's off). Click: Collie to the front (`open -a
  Collie`, else `open -b com.samiros.collie`), and a new look when off.
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
- **Agents tree** (`agents-tree`, a copy of Herdr's `agents` that keeps its look).
  The Workspace Boss (`orch-workspace`, a `workspace boss` tag) on top; under it,
  on tree lines, each org's orchestrator (`orch-cs`, `orch-ag`, `orch-personal`,
  a quiet `orchestrator` tag in its org's color from the mac-workspace app's
  core, else its space's), muted with `off` when not running; under each, its
  org's projects with live agents (by the agent's folder:
  `<org>/<project>/main|worktrees/...`); under each project, its workers grouped
  by checkout: a `main` header (accent branch glyph) first, then one header per
  worktree (its folder name), each folding with a chevron and holding its agents
  (several in one checkout stay together) and background terminals. A worker
  row says the task (a named tab or the agent's title), the time in its state,
  and the state; outside a checkout group (pinned) it keeps a `⑂ main` /
  `⑂ <worktree>` tag. Agents outside the orgs sit under `Other`.
  The tree follows the Spaces workspace switcher (and so Collie): `spaces.org`
  (`all`, `cs`, `ag`, `personal`, `other`); an org picked shows the Boss, that
  org's orchestrator and its agents. Seats, projects and agents fold with a
  chevron; pinned agents leave the tree for a `Pinned` group on top; the sort
  (Priority / Grouped) orders projects and workers. A project's own
  orchestrator (`orch-<org>-<project>`), when running, is its project row.
  - **Project row**: name, then only what needs saying: `⚠ <branch>` when its
    main checkout is on another branch, `↓N` when local main is behind
    `origin/main` (as last fetched; never fetches), `⑂ N` registered worktrees
    and a GitHub mark when a remote points there. Read from `.git/HEAD`,
    `.git/config` and `.git/worktrees` every 15 s, `git rev-list` once a
    minute, never during a check. Click: its orchestrator, else its space.
  - **Processes** (`>_ N` on an agent row, folded by default): the live
    processes under the agent's terminal (one `ps -axo pid,ppid,pcpu,rss,command`
    every 5 s while the sidebar is wide; the terminal's pid from `hc get`),
    each with its short command (Collie's `short_cmd`: no flags, values or
    tokens), CPU and memory. Shells and the agent itself are skipped, a tool's
    own children fold into it (`Playwright · chromium ×2`), and the agent's
    plumbing (MCP servers, caffeinate) is only counted in the tooltip
    ("3 MCP servers hidden"); nothing left, no chip.
  - **Background terminals** (`hc run --bg` without an agent status): under the
    agent that started them (`parent`), else under the project row they run
    in (under its checkout's header): a terminal glyph, its name or its
    program's short command, `live` / `done` (exit 0) / `failed` (its program
    ended on its own with a non-zero code) / `closed` (ended from outside: a
    closed pane, a kill, a hangup or a restart, as hc's `reason`, a signal or
    no exit code say; never `failed`), CPU and memory. Finished ones stay 15
    minutes (read with `hc ls --all`); hovering one shows a `×` that dismisses
    it: it leaves the tree at once and is removed with `hc rm`. Click: its
    pane, else a peek.
  - **Jobs** (terminals named `job-<name>`; Collie's core lists launchd jobs
    without a folder, so it is not read yet): in a quiet `Jobs` group under the
    Boss (run at the workspace root), the org's orchestrator (its root) or the
    project row. Each: its name, schedule (`job.schedule` label, with
    `job.next` in ms: `every 15m · next 4m`) or `on watch`, and `running` with
    CPU and memory, `failed`, `closed`, or when it last ran.
  The rail keeps a numbered list in the tree's order. `agents-ws` (the earlier
  copy with the gold `★`) stays installable; the layout no longer uses it.
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
  until turned on) in the status bar, the sidebar's header and workspace switcher from `spaces-ws`,
  the Agents tree from `agents-tree`, pane headers from `pane-branch`, and the
  Files and Changes panels from `files-ws` and `changes-ws`. `requires`
  installs claude-accounts and agent-sleep first. It was called `main-accounts`:
  installing removes that copy (the install's manifest owns it), so switch to
  it with `herdr-app do layout.switch '{"name":"collie-sheeps"}'`.

**Updates.** The seven mods are copies of Herdr's shipped ones, so they don't
follow Herdr's updates. If Herdr's own spaces list or pane header gains
something, clone it again and reapply this plugin's changes.
