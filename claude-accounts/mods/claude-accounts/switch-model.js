// Switching safely (odd/tasks/claude-accounts-switching.md S2, S3): what the
// mod says about pay-per-use accounts and the automatic switch. Pure: no
// herdr or gpui-kit import, so `node --test` loads it.
//
//   PAY_PER_USE_TAG, isPayPerUse(account)
//                         Enterprise and Team plans are billed per use through
//                         the API: their rows carry the tag
//   payPerUsePrompt(account, { switchMode, scope })
//                         the question before moving onto such an account by
//                         hand, or null when it needs none. scope "switch"
//                         (the default: the active account, so its copy
//                         follows the restart setting) or "session" (one
//                         terminal's Claude, `resume`)
//   autoSwitchSetting(settings)
//                         Manage Accounts' row for settings.autoSwitch, Off
//                         by default
//   AUTO_SWITCH_FILE, readAutoSwitch(text)
//                         auto-switch.json, the CLI's record of its last
//                         automatic switch or of having no room to switch to
//   autoSwitchToast(record, label)
//                         what the footer says about that record

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);

// ── Pay per use (S3) ───────────────────────────────────────────────────────

export const PAY_PER_USE_TAG = "API · pay per use";
const PAY_PER_USE_PLANS = ["Enterprise", "Team"];

export const isPayPerUse = (account) => isObject(account) && PAY_PER_USE_PLANS.includes(account.plan);

const COST = (who) => `${who} is billed per use through the API, not by a subscription.`;
const RUNNING = {
  restart: "New Claudes start on it, and the Claude sessions running now restart on it, so they're billed per use too.",
  ask: "New Claudes start on it, and you pick which running sessions move to it.",
  keep: "New Claudes start on it; the sessions running now stay on their account.",
};

export function payPerUsePrompt(account, { switchMode = "ask", scope = "switch" } = {}) {
  if (!isPayPerUse(account)) return null;
  const who = str(account.email) ?? str(account.label) ?? "This account";
  if (scope === "session") {
    return {
      title: `Move this session to ${who}?`,
      body: `${COST(who)} This terminal's Claude restarts on it; the other sessions stay where they are.`,
      cancel: "Cancel",
      confirm: "Move to pay per use",
    };
  }
  return {
    title: `Switch to ${who}?`,
    body: `${COST(who)} ${RUNNING[switchMode] ?? RUNNING.ask}`,
    cancel: "Cancel",
    confirm: "Switch to pay per use",
  };
}

// ── The automatic switch (S2) ──────────────────────────────────────────────

const ON_OFF = Object.freeze([
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
]);

export function autoSwitchSetting(settings) {
  const value = settings?.autoSwitch === "on" ? "on" : "off";
  return {
    title: "Switch accounts automatically when one runs out",
    description: `At 95% of the 5-hour or weekly limit, Herdr moves to the Max or Pro account with the most room left. Never to an ${PAY_PER_USE_TAG} account.`,
    value,
    valueLabel: ON_OFF.find((o) => o.value === value).label,
    options: ON_OFF.map((o) => ({ ...o, selected: o.value === value })),
  };
}

export const AUTO_SWITCH_FILE = "auto-switch.json";
const STATES = ["switched", "stuck"];
const WINDOW_NAMES = { session: "5-hour", weekly: "weekly" };

// { state, from, to, at, window, percent, resetsAt }, or null for no file,
// junk or a state this doesn't know. A switched record needs its `to`.
export function readAutoSwitch(text) {
  let raw = text;
  if (typeof text === "string") {
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!isObject(raw) || !STATES.includes(raw.state) || !str(raw.from)) return null;
  if (raw.state === "switched" && !str(raw.to)) return null;
  return {
    ...raw,
    state: raw.state,
    from: raw.from,
    to: str(raw.to),
    at: isNumber(raw.at) ? raw.at : null,
    window: Object.hasOwn(WINDOW_NAMES, raw.window) ? raw.window : "session",
    percent: isNumber(raw.percent) ? Math.round(raw.percent) : null,
    resetsAt: isNumber(raw.resetsAt) ? raw.resetsAt : null,
  };
}

// label(id) names an account. The key says when it's the same news.
export function autoSwitchToast(record, label) {
  if (!record) return null;
  const limit = `${record.percent ?? 95}% of its ${WINDOW_NAMES[record.window]} limit`;
  const from = label(record.from);
  if (record.state === "switched") {
    return {
      key: `auto:${record.at ?? ""}:${record.from}:${record.to}`,
      toast: { title: `Switched to ${label(record.to)} automatically`, body: `${from} reached ${limit}.`, level: "info" },
    };
  }
  return {
    key: `auto:${record.at ?? ""}:${record.from}:stuck`,
    toast: { title: `${from} reached ${limit}`, body: `No other Max or Pro account has room, so it stays on ${from}.`, level: "warning" },
  };
}
