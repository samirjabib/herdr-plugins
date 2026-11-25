// Every Claude plan in one place (odd/tasks/team-usage.md S2). Pure: no
// herdr, gpui-kit or node import, so the mod, the CLI and `node --test` all
// load it.
//
//   PLANS                 the table: one entry per plan, see below
//   planOf(oauthAccount)  the name Claude Code's login names, for people:
//                         "Max 5x", "Team Premium", …; a type this table
//                         doesn't know keeps its raw name ("claude_new"); null
//                         without one
//   planByName(name)      the table's entry for that name, or null
//   hasPlanWindows(account)
//                         its usage data has a 5-hour or weekly window
//   billsPerUse(account)  it's billed per use (API rates), decided from its
//                         plan and, where the plan can go either way, from
//                         its usage data (S1)
//   isAutoSwitchPlan(name) the automatic switch may move onto it
//
// An entry: { name, organizationType, windows, extraUsage, autoSwitch, how }
//   windows     "always": a subscription with 5-hour and weekly limits;
//               "never": billed per use, no limits;
//               "usage": either one (a Team seat, a legacy seat-based or a
//               usage-based Enterprise): its usage data decides
//   extraUsage  it can buy usage past its limits, or is billed per use
//   autoSwitch  the automatic switch may move onto it (an individual
//               subscription the owner pays for: Pro, Max, Ultra)
//   how         how it's told apart, for RECIPE.md
// Names checked against https://claude.com/pricing and the Help Center (see
// RECIPE.md, "Plans").

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const PLANS = Object.freeze([
  { name: "Free", organizationType: "claude_free", windows: "always", extraUsage: false, autoSwitch: false, how: "organizationType claude_free" },
  { name: "Pro", organizationType: "claude_pro", windows: "always", extraUsage: true, autoSwitch: true, how: "organizationType claude_pro" },
  { name: "Max 5x", organizationType: "claude_max", windows: "always", extraUsage: true, autoSwitch: true, how: "organizationType claude_max, organizationRateLimitTier …_max_5x" },
  { name: "Max 20x", organizationType: "claude_max", windows: "always", extraUsage: true, autoSwitch: true, how: "organizationType claude_max, organizationRateLimitTier …_max_20x" },
  { name: "Max", organizationType: "claude_max", windows: "always", extraUsage: true, autoSwitch: true, how: "organizationType claude_max with no tier" },
  { name: "Ultra", organizationType: "claude_ultra", windows: "always", extraUsage: true, autoSwitch: true, how: "organizationType claude_ultra, or claude_max with an …_ultra tier" },
  { name: "Team Standard", organizationType: "claude_team", windows: "usage", extraUsage: true, autoSwitch: false, how: "organizationType claude_team with a seatTier and no Max user tier" },
  { name: "Team Premium", organizationType: "claude_team", windows: "usage", extraUsage: true, autoSwitch: false, how: "organizationType claude_team, userRateLimitTier …_claude_max_…" },
  { name: "Team", organizationType: "claude_team", windows: "usage", extraUsage: true, autoSwitch: false, how: "organizationType claude_team, seat unknown" },
  { name: "Enterprise", organizationType: "claude_enterprise", windows: "usage", extraUsage: true, autoSwitch: false, how: "organizationType claude_enterprise: usage-based (no limits) or a legacy seat with limits" },
  { name: "Console (API)", organizationType: "claude_api", windows: "never", extraUsage: true, autoSwitch: false, how: "organizationType claude_api or api: an Anthropic Console login" },
].map(Object.freeze));

const byName = new Map(PLANS.map((p) => [p.name, p]));
export const planByName = (name) => byName.get(name) ?? null;

const TYPE_NAMES = { claude_free: "Free", claude_pro: "Pro", claude_ultra: "Ultra", claude_enterprise: "Enterprise", claude_api: "Console (API)", api: "Console (API)" };

function maxPlan(tier) {
  if (/_ultra$/.test(tier)) return "Ultra";
  const x = /_(\d+x)$/.exec(tier);
  return x ? `Max ${x[1]}` : "Max";
}

function teamPlan(account) {
  if (/_claude_max_/.test(text(account.userRateLimitTier) ?? "")) return "Team Premium";
  return text(account.seatTier) ? "Team Standard" : "Team";
}

export function planOf(account) {
  const type = text(account?.organizationType);
  if (!type) return null;
  if (type === "claude_max") return maxPlan(text(account.organizationRateLimitTier) ?? "");
  if (type === "claude_team") return teamPlan(account);
  return TYPE_NAMES[type] ?? type;
}

export function hasPlanWindows(account) {
  const usage = isObject(account?.usage) ? account.usage : {};
  return ["session", "weekly"].some((k) => isObject(usage[k]) && Number.isFinite(usage[k].percent));
}

// A known subscription never is; Console always is. A plan that can go either
// way, or one this table doesn't know, is until its usage data shows a 5-hour
// or weekly window: asking before a switch that may cost is the safe side.
export function billsPerUse(account) {
  if (!isObject(account) || !text(account.plan)) return false;
  const windows = planByName(account.plan)?.windows ?? "usage";
  if (windows === "always") return false;
  if (windows === "never") return true;
  return !hasPlanWindows(account);
}

export const isAutoSwitchPlan = (name) => planByName(name)?.autoSwitch === true;
