# Worktrees

Git worktrees the mac-workspace way in Herdr's default layout: every pane says
which checkout and branch it is in, the space menu makes and opens checkouts
as splits beside you instead of new spaces, and a clean up removes the ones
that are done.

**How it behaves**

- **The pane header** (`pane-branch`, a copy of Herdr's `pane`). Left to right:
  the program, a chip with the checkout as `<project> › <worktree>` (hover:
  the full path), the branch, and the agent's status. The middle stays empty so
  the drag grip covers nothing. Folders outside a known layout show their path
  instead of the chip. The branch comes from `git branch --show-current` in the
  pane's live folder every 3 s, since Herdr's own `branch` is empty for
  terminals. The split buttons open the new terminal in that pane's folder,
  not the focused pane's.
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
  worktrees use this plugin; Remove worktree is still Herdr's.
- **Clean up** (menu, or `ctrl-d` in the switcher). Every linked checkout with
  its size and age. One can go only when its branch is merged (a merged PR
  from that branch, which catches squash merges, or git sees it in
  `origin/main`, `origin/staging` or `origin/master`), nothing is uncommitted,
  no commit is missing from every remote, and no pane is in it. Those are
  chosen by default; the rest are greyed out with the reason. `space`
  toggles one, Enter removes the chosen ones with `git worktree remove` (never
  forced) and shows the space freed. Branches stay.
- **The layout** (`main-accounts`): Herdr's default with claude-accounts' usage
  in the status bar, the sidebar's spaces from `spaces-ws` and pane headers from
  `pane-branch`.

**Updates.** The four mods are copies of Herdr's shipped ones, so they don't
follow Herdr's updates. If Herdr's own spaces list or pane header gains
something, clone it again and reapply this plugin's changes.
