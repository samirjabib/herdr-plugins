// Pure helpers of the pane header (no herdr imports, so node tests load them).

// Which checkout a folder is in, for the header's worktree chip:
// the mac-workspace layout (<group>/<name>/main or <group>/<name>/worktrees/<wt>)
// and Herdr's own ~/.herdr/worktrees/<repo>/<wt>. Null for any other folder.
export function worktreeOf(cwd) {
  if (!cwd) return null;
  const ws = cwd.match(/\/mac-workspace\/[^/]+\/([^/]+)\/(?:worktrees\/([^/]+)|(main))(?:\/|$)/);
  if (ws) return { project: ws[1], wt: ws[2] ?? "main" };
  const hd = cwd.match(/\/\.herdr\/worktrees\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (hd) return { project: hd[1], wt: hd[2] };
  return null;
}

// A theme color with alpha `aa` (two hex digits), replacing any alpha it has:
// theme colors can already be #rrggbbaa, and appending to those is invalid.
export function withAlpha(color, aa) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color ?? "");
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split("").map((ch) => ch + ch).join("") : m[1].slice(0, 6);
  return `#${hex}${aa}`;
}

// Main's marker in the header: "live" on a project's main checkout when it is on
// main (or master), the place to update and to orchestrate from; "off-main" when
// that checkout is on another branch; null anywhere else or before git answers.
export function mainState(wt, branch) {
  if (wt?.wt !== "main" || !branch) return null;
  return branch === "main" || branch === "master" ? "live" : "off-main";
}
