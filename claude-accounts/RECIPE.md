# Claude accounts

Orca's Claude usage and accounts, in Herdr. The sidebar footer shows how much
of its session, weekly and Fable limits the active Claude account has used,
and when each one resets. A popover and a panel show every account. Manage
Accounts signs accounts in, adds and removes them, and picks which one new
Claude terminals start on. When you switch accounts while Claude is running
in terminals, those conversations can restart on the new account. Turned on,
it switches on its own when the active Max or Pro account runs out, and never
to an account billed per use.

All the logic is a command-line program, `claude-accounts`, that ships inside
the mod. The mod only draws and runs it. Other plugins (Spotlight first) read
the same files and run the same commands: see [CONTRACT.md](CONTRACT.md).

![Claude accounts](preview.png)

**What you see**

- **Footer** (the sidebar's status row, right of the workspace status): the
  active account's usage,
  `Used [Claude icon][bar] 41% 3h 2m · 65% 4d 6h · 22% Fable [refresh]`:
  session, weekly and Fable, each with the time left until it resets.
  - Colors: under 60% `muted`, 60–79% `working` (amber), 80% or more
    `blocked` (red).
  - As the column narrows: bars and labels, then one number per window, then
    only the most-used window's number (`--` when there's none). Never the
    icon alone, which would read as all clear.
  - Signed out: "Sign in to see usage" and a **Sign in** action.
  - An Enterprise or Team account (billed per use through the API) shows
    "API usage" at every width, never a bar or a percentage: its usage is
    in the Claude Console. Signed out, it says "Sign in to see usage".
  - Click it for the popover; click again to close it.
- **Popover** (above the footer): `Usage`, a refresh button and a
  `Detailed | Compact` toggle for the footer. Then the `Claude` row with
  "Resets in 3h 2m" and its `5h`, `wk` and `Fable` bars (it opens the
  panel) and `Manage Accounts…`.
- **Claude panel:** "Claude · Updated 3m ago" (or "Not yet updated"). The
  active account's card: Session, Weekly and Fable, each "N% used · Resets
  in …", plus the monthly spend and credits when the account has them. Then
  the `Other accounts` list: each saved account but the active one, with
  their `wk` and `Fable` bars. System default, the Mac's own login (what
  `claude` uses outside Herdr), isn't listed here or in Manage Accounts
  unless it's the active account. Click one to switch. An Enterprise or
  Team account (billed per use through the API) carries an "API · pay per
  use" tag and "API usage" in place of its bars (the card and the
  popover's Claude row say "API usage" too when it's active), and its click
  opens Manage Accounts on the question below. An
  active account that needs signing in keeps its row, with its ✓, to do it
  from there. An account whose login lapsed says "Sign in again to use this
  account", and its row opens the sign-in tab. One whose folder got someone
  else's login (a `/login` inside its Claude) keeps its saved email and says
  "Now signed in as {login}", with no bars, because those numbers aren't its
  own; its row opens the sign-in tab too. "No other accounts" when there are
  none.
- **Manage Accounts** (a dialog):
  - One row per account: its email, its plan ("Max 5x", "Enterprise"…),
    "API · pay per use" for an Enterprise or Team plan, "This device",
    `org · date` of its last
    sign-in ("Now signed in as {login}" under it when its folder got someone
    else's login), its sign-in status as the last tag ("Signed in", "Signed
    out", or "Signed in as {login}" when its folder got someone else's login;
    an expired token Claude refreshes on its own still reads "Signed in"),
    `Sign in ▾` only when it isn't signed in as itself (its menu: "Copy
    sign-in link instead") and `Remove`. Then `Add account ▾`, with the same
    menu.
  - Only while System default is the active account: "System default:
    {email}" / "Use your current {email} Claude login.", and Orca's notice
    when it is signed in as an email that is also a saved account.
  - "Switching applies to the next Claude you start in any tab."
  - The setting **When you switch accounts while Claude is running in
    terminals**, "Restarting continues each terminal conversation on the new
    account.": Ask, Always restart or Never restart.
  - "Reconnect Remote Control after a restart": On or Off (Off by default).
    On, every restarted session comes back with `--remote-control`, signed in
    as the new account, so it stays in the Claude app on your phone. A
    session started with `--remote-control` keeps it either way.
  - **Switch accounts automatically when one runs out**, "At 95% of the
    5-hour or weekly limit, Herdr moves to the Max or Pro account with the
    most room left. Never to an API · pay per use account.": On or Off (Off
    by default).
  - Picking a pay-per-use account asks first, in place of the list:
    "Switch to {account}?", "{account} is billed per use through the API,
    not by a subscription." and, by the switch setting, "New Claudes start
    on it, and the Claude sessions running now restart on it, so they're
    billed per use too." (Always restart), "New Claudes start on it, and you
    pick which running sessions move to it." (Ask) or "New Claudes start on
    it; the sessions running now stay on their account." (Never restart).
    **Cancel** and **Switch to pay per use**; Esc cancels. Moving one
    terminal's session there asks "Move this session to {account}?", "…
    This terminal's Claude restarts on it; the other sessions stay where
    they are.", **Move to pay per use**.
- **Switch dialog** (Ask): "Switched to {account}", the sessions still
  running on the previous account with a checkbox each: each shows its last
  prompt, its terminal's title, and whether it's Working or Idle, live. Then "Don't ask again
  (restart automatically)", **Keep as is** and **Restart N sessions**.
- **Move this session to…** (a dialog, `cmd-alt-m` or `herdr-app do
  claude-accounts.move-session`, for the terminal focused then): "Claude in
  {terminal}. The active account and your other sessions stay as they are.",
  then each account it can go to (every one but the one it runs on; System
  default only while it's the active account) with its plan, and "API · pay
  per use" on an Enterprise or Team account. One that needs signing in shows
  "Sign in again to use this account" and can't be picked. Picking a pay-per-use
  account asks first: "Move this session to pay per use?", "{email} is billed
  per API use. This Claude session continues on it, and what it uses from now
  on is charged per use. The active account and your other sessions stay as
  they are.", **Cancel** and **Move to pay per use**. With no terminal
  focused: "Click a Claude terminal first, then choose Move this session to….".
- **Toasts:** "Restarting N Claude sessions on {account}", "N other sessions
  weren't moved." with **Review**, a terminal waiting for idle, a restart
  that failed with the `claude --resume <session>` command to run by hand,
  "Claude in … is asking a question" with the question a restarted Claude
  stopped at, "Sign-in link copied. Open it in a private window to sign
  in with a different account.", "Switched to {account} automatically" /
  "{previous} reached 96% of its 5-hour limit.", "{account} reached 98%
  of its weekly limit" / "No other Max or Pro account has room, so it stays
  on {account}.", and for a move: "Moving Claude in … to {account}" / "It
  restarts there once it's idle. Your other sessions stay as they are.",
  "Claude in … is busy" / "It moves to {account} once it's idle.", "Moved
  Claude in … to {account}", or why it failed with the line to run by hand.

**How it behaves**

- **Accounts.**
  - System default is `~/.claude`, the login Claude uses with no
    `CLAUDE_CONFIG_DIR`.
  - A saved account is a Claude config folder with its own login in the
    macOS Keychain. Orca's accounts are imported the first time, in place
    (they're never moved, which would mean signing in again), along with
    Orca's active account and switch setting. `claude-accounts import-orca`
    imports again: the Orca accounts added since, and fresh emails, orgs
    and sign-in dates. It never changes the active account or the switch
    setting.
  - **Add account** makes a new folder under
    `~/.config/herdr-app/claude-accounts-profiles/`, sharing your
    `~/.claude` settings, skills, agents, commands and history through
    symlinks, with a copy of `~/.claude.json` minus its login and every
    account-bound key (as Orca does). It's kept only when the sign-in
    succeeds with an email and org that aren't saved yet; otherwise the
    folder goes.
  - An account whose folder holds no login, or someone else's, can't be
    picked until it signs in again, as in Orca.
  - **Sign in** opens a Herdr tab running `claude auth login`. Closing the
    tab cancels it. "Copy sign-in link instead" puts the one-click link on
    the clipboard instead of opening the browser.
  - **Remove** forgets the account. It deletes the folder only for one added
    here, and never touches the Keychain. Removing the active account goes
    back to System default.
- **Usage.**
  - Each account's limits come from Claude's usage endpoint, with its own
    login. It's asked every 15 minutes, at most every 5 minutes per account
    (30 seconds with refresh, 60 for accounts that aren't active), less often
    after failures, and not before a rate limit's Retry-After.
  - Between polls, the numbers follow every Claude turn: Claude Code hands
    its statusline the current limits, and the statusline drops them in the
    state folder. Fable comes from polling only.
  - Logins are never refreshed, written or logged: Claude Code owns them. An
    account whose login lapsed shows "Sign in again".
  - Numbers belong to the login they were read from. When a folder's login
    changes (System default's too), or after a sign-in here, its numbers go
    and it's read again. A folder holding someone else's login isn't read at
    all, and its statusline drops are ignored.
- **Switching on its own** (the setting On).
  - Every `usage` run (the 15-minute poll and each Claude turn's merge)
    checks the active account after its reads. When its 5-hour or weekly
    window is at 95% or more, it switches to the eligible account with the
    most room left (95 minus its most used of the two), through `use`'s own
    path, so the switch setting applies to running terminals as for a click.
  - Eligible: a saved account on a Max or Pro plan, signed in as itself, and
    both windows under 95%. Nobody runs Claude on the other accounts, so their
    tokens lapse and their numbers age: their last numbers count, a window past
    its reset counts as empty, and fresh numbers win a tie on room. Never
    Enterprise or Team (billed per use), never System default or
    an account of the same login, never one excluded with `claude-accounts
    auto-switch exclude <id>` (`include <id>` takes it back; no row for it
    in Manage Accounts).
  - Only a Max or Pro active account moves: one billed per use was chosen by
    hand and stays. Stale or failed numbers on the active account move
    nothing. A saved account with System default's newer numbers for the
    same login is judged by those, as the footer shows it.
  - No eligible account with room: it stays, and says so once per window.
  - No flapping: the new account is under the line, so the next poll does
    nothing. A full account counts again only once its window resets (the
    contract drops a window past its reset).
  - A switch happens only while the account it read is still the active
    one, so two runs at once switch once.
- **Which account a terminal runs.** Inside Herdr, the `claude` launcher
  starts each new Claude on the active account. A running terminal's
  account is the config folder holding its live session file.
- **Switching while Claude runs.**
  - Always restart: every Claude terminal on the previous account restarts
    on the new one, continuing its conversation. Ask: the switch dialog
    first. Never restart: they stay as they are.
  - A terminal on a saved account's folder counts only as that account. One
    on System default also counts as a saved account signed in to the same
    login (same email and same org, as in Orca): it moves when you leave that
    account, and stays when you switch to it.
  - A restart waits until that terminal's Claude finishes its turn, however
    long it takes, stops it, types `CLAUDE_ACCOUNTS_DIR=<folder> claude <its
    flags> --resume <session>` in the same shell, and checks the new Claude
    landed on the new account. Terminals restart independently.
  - Background subagents don't hold the restart up, as in Orca: they stop
    with Claude, and the resumed Claude gets a message naming the ones that
    were still running, so it launches them again. A Claude waiting on a
    question isn't restarted until it's answered.
  - If you quit Claude yourself (`/exit`) while its restart waits, the
    resume line goes in at once, on the new account.
  - Only safe flags are kept (`--model`, `--permission-mode`, `--effort`,
    `--settings`, `--add-dir`, `--dangerously-skip-permissions`), so a
    resumed agent never gets its first task again.
  - A terminal whose program is Claude itself (no shell to come back to)
    can't move, and says so.
  - A terminal whose Claude has nothing to resume yet (no message since it
    started or since `/clear`) isn't restarted. It counts as one Claude
    couldn't move, as in Orca.
  - If Claude refuses the resume line (say, the conversation isn't there),
    the restart fails within seconds with Claude's own message and the line
    to run by hand, instead of waiting out the 2-minute limit.
  - If the restarted Claude stops at a startup question (the folder trust
    check, "Allow external CLAUDE.md file imports?"), a toast says the
    question, for a `resume` from another plugin too (Spotlight's moves).
    The restart waits up to 10 minutes for your answer instead of 2, then
    ends with the question and no line to run, since Claude is running.
    Orca says nothing in that case.
  - A Claude that sits for 10 minutes with no session file while its
    restart waits (one stopped at such a question never writes one) isn't
    restarted: the restart fails with the question it asks, so you answer
    it and switch again.
  - A Claude that agent-sleep is putting to sleep, or put to sleep, isn't
    restarted: claude-accounts reads agent-sleep's
    `<Herdr home>/agent-sleep/sleeping.json` (read only) and drops that
    terminal's restart, or holds it while agent-sleep can still undo its
    stop. agent-sleep's wake starts that Claude on the active account, where
    the restart would have moved it. Orca restarts every terminal once it's
    idle. One gap: a working Claude that agent-sleep interrupts to sleep its
    workspace can still be restarted in the moment before agent-sleep writes
    its record.
  - A later switch moves restarts still waiting for idle to the account
    selected then, and drops the ones whose terminal is already on it.
- **Moving one session** (Move this session to…). It runs `resume --terminal
  <t> --account <id>` for that terminal only: the active account doesn't
  change, no other terminal is restarted, and the restart is the same one a
  switch does (waits for idle, resumes the conversation, checks it landed).
  A pay-per-use account (plan Enterprise or Team) runs nothing until you
  confirm; Cancel or Esc runs nothing. A move that can't start keeps the
  dialog open with the CLI's own words ("Terminal t2 isn't running Claude.",
  "There's no conversation to resume yet in terminal t6: …", a terminal whose
  program is Claude itself). A started one closes it; its job id goes in the
  shared value `claude-accounts.moves`, and the footer's toasts follow that
  job (other plugins' `resume` jobs stay theirs: no toast).

**Install**

```sh
scripts/install.sh claude-accounts
```

- The footer lives in the projects layout's status row
  (`projects-sidebar/layouts/projects.json`), so install `projects-sidebar`
  too and switch to the `projects` layout.
- New terminals follow the active account only through the `claude`
  launcher (a wrapper script on the PATH), which reads the `active` file.
- Live numbers between polls need the statusline drop in
  `~/.claude/statusline.sh`.
- Node 22.15 or newer on the PATH Herdr's `exec` sees.

**Built from**

- **Mod `mods/claude-accounts/`** (`mod.json` `{ "place": "none" }`), one mod
  in views picked by `props.view`:
  - none or `footer` = `footer.js`: the copy that reads key commands. It
    also keeps the 15-minute timer and the watch on the state folder, and
    turns the CLI's progress into toasts (`toasts.js`).
  - `status` = `status.js`: Herdr's bottom status bar (machine, branch,
    agents, the palette hint) with the usage before the hint. It is the
    footer in another frame, so it reads key commands too; a layout uses it
    in place of the `workspace-status` mod, and drops the footer.
  - `popup` = `popup.js`, `panel` = `panel.js`, `accounts` = `accounts.js`,
    `confirm` = `confirm.js`, `move` = `move.js`.
  - Pure modules, tested with `node --test`: `store.js` (reading the CLI's
    files), `format.js` (percent, durations, dates, colors, error copy,
    density), `footer-model.js`
    (what the footer, popover and panel draw, and where they open),
    `accounts-model.js` (what the accounts and confirm views draw),
    `switch-model.js` (the pay-per-use tag, `isPayPerUse` and question, the
    automatic switch's setting and toasts), `move-model.js` (what the move
    dialog draws and runs) and `toasts.js`.
- **CLI `mods/claude-accounts/bin/claude-accounts`** (Node, `cli/*.mjs`).
  Every command takes `--json`:

  | Command | Does |
  |---|---|
  | `list` | the accounts and the active one |
  | `use <id\|default>` | switches the active account, then applies the switch setting to running terminals |
  | `remove <id>` | forgets an account |
  | `login <id\|new\|default> [--link]` | signs an account in, in the current terminal |
  | `import-orca` | imports Orca's accounts again |
  | `settings [set switchMode ask\|restart\|keep]` | reads or sets the switch setting |
  | `settings set remoteControl on\|off` | restarted sessions come back with `--remote-control` (on) or as they were (off) |
  | `settings set autoSwitch on\|off` | switches on its own when the active account runs out (on); off by default |
  | `auto-switch check` | runs the automatic switch's check now and prints its decision |
  | `auto-switch exclude\|include <id>` | keeps a saved account out of the automatic switch, or back in |
  | `usage [--refresh] [--force] [--account <id>]` | the usage, fetched when due; `--force` has no floor (`use` runs it for the new account) |
  | `terminal <t>` | a Herdr terminal's account, session and status |
  | `restart --cancel <t>` | cancels a terminal's restart or job that hasn't stopped Claude yet |
  | `restart --answer keep\|restart [--terminal <t>]...` | the switch dialog's answer: keep, or restart the ticked sessions |
  | `resume --terminal <t> --account <id\|default> [--message <text>] [--wait <s>]` | restarts one terminal on an account and sends a message; `--status <job>`, `--cancel <job>` |
  | `--version` | its version |

  Exit codes: 0 ok, 1 any other failure (a state file that can't be read,
  a failed sign-in), 2 no session id, 3 terminal missing or not Claude, 4
  timeout, 5 account needs sign-in, 6 landed on another account, 7 unknown
  account or job, 8 terminal can't move, 9 job failed, 10 job cancelled, 11
  `resume` with a live job to another account, 64 bad usage, 75 still running
  (under `--wait`). The contract other plugins
  code against (`accounts.v1.json`, and `list`, `usage`, `terminal`, `use`
  and `resume` with their output shapes) is [CONTRACT.md](CONTRACT.md).
- **Commands:** `claude-accounts.open-popup`, `claude-accounts.open-panel`,
  `claude-accounts.open-accounts`, `claude-accounts.open-confirm`,
  `claude-accounts.move-session` and `claude-accounts.refresh`, reached
  through the footer copy (`herdr-app do claude-accounts.<name>`).
  `keys.json` binds `cmd-alt-m` to `move-session` (Herdr's palette lists
  only app commands, and a terminal's right-click menu can't take another
  plugin's items, so a key is how it's reached).
- **Herdr functions:** `exec`, `run`, `readTextFile`, `watchFolder`,
  `openOverlay`, `closeOverlay`, `notify`, `shared`, `setShared`, `settings`,
  `window`, `theme`, `props`, `nextCommand`, `focused`, `terminals`, `home`,
  `appHome`.
- **Programs the CLI runs:** `security find-generic-password` (reads a
  login, never writes one), `/usr/bin/sqlite3` (Orca's settings, read-only),
  `hc` (Herdr's terminals: list, read, type), `claude auth login`,
  and HTTPS to `api.anthropic.com/api/oauth/usage`.

**Files**

The state folder is `~/.config/herdr-app/claude-accounts/`
(`$CLAUDE_ACCOUNTS_HOME` replaces it, for tests). The CLI is its only
writer, except `live/`, which only the statusline writes. Every write is a
temporary file and a rename, under a lock held only for the write. A state
file that isn't valid JSON stops the CLI with its path (exit 1) and is never
overwritten.

| File | Holds |
|---|---|
| `accounts.json` | the saved accounts: id, email, org, config folder, last sign-in, whether Orca or Herdr made it, and `excludeFromAutoSwitch` |
| `active` | the active account's config folder, the exact string; empty for System default |
| `settings.json` | the switch setting (`ask`, `restart` or `keep`), `remoteControl` and `autoSwitch` (`on` or `off`) |
| `auto-switch.json` | the automatic switch's last word: `switched` (from, to, window, percent) or `stuck` (no account had room) |
| `accounts.v1.json` | what other plugins read: every account with its usage ([CONTRACT.md](CONTRACT.md)) |
| `usage-state.json` | when each account was fetched, its last data, the login that data was read from, and its failures |
| `restart.json` | the queued restarts and `resume` jobs, with their progress |
| `pending-switch.json` | what the last switch found: the sessions on the previous account and the others (`mode` ask: the switch dialog's question; `mode` restart: the restart notice and its Review list) |
| `live/` | the statusline's latest limits, one file per account |
| `login-link` | a captured sign-in link |
| `lock/` | the lock |

**Watch out**

- **It reads your Claude logins.** The CLI reads each account's OAuth token
  from the Keychain to ask for its usage. Tokens never leave that request:
  they aren't logged, written or refreshed.
- **The usage endpoint, Claude's session files and the statusline limits
  aren't documented.** A Claude Code update can change them; the footer then
  shows "Usage unavailable" or stale numbers.
- **A restart stops Claude.** It waits for idle first, but a half-typed
  prompt in that terminal is lost. Never restart (or Ask) avoids it.
- **exec's 30 s limit:** restarts run in a detached
  process, so a command returns at once and the work goes on.
- **Orca shares the accounts.** Imported accounts are Orca's own folders, so
  signing in or out in either app affects both.
- **Install by copying.** Herdr doesn't load a mod folder that is a symlink;
  `scripts/install.sh claude-accounts` copies it and lists what it copied in
  `<home>/.herdr-plugins/claude-accounts.txt`.
- **`herdr-app check` draws only the footer.** `scripts/check-views.sh
  claude-accounts/mods/claude-accounts <views…>` checks the others.

**Done when**

- `node --test 'test/*.test.js'` reports `fail 0`, and
  `scripts/check-views.sh claude-accounts/mods/claude-accounts footer popup
  panel accounts confirm move` prints `ok` for each view.
- `claude-accounts list --json` shows System default and each Orca account,
  with the active one marked.
- The footer shows the active account's session, weekly and Fable usage, and
  the popover, panel and Manage Accounts show Orca's texts with the same
  numbers.
- Switching accounts with a Claude terminal open restarts it on the new
  account (Always restart) or asks first (Ask), and the conversation goes on.
- Move this session to… moves one terminal's Claude to the picked account,
  asking first for a pay-per-use one, while the active account and the other
  terminals stay as they were.
