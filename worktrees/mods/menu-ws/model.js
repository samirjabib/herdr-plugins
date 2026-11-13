// Pure helpers of the context menu (no herdr imports, so node tests load them).

// agent-sleep's command to sleep the checkout `folder` is in: the deepest entry
// of `git worktree list --porcelain` holding it, as `sleep-workspace.<hex>` with
// the path's UTF-8 bytes in lowercase hex (agent-sleep's sleepWorkspaceCommand).
// Null when no entry holds it.
export function sleepCommandFor(folder, porcelain) {
  const paths = (porcelain ?? "").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9).replace(/\/+$/, ""));
  const hit = paths.filter((p) => folder === p || folder.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
  if (!hit) return null;
  // UTF-8 bytes through encodeURIComponent, as agent-sleep spells them (no TextEncoder in mods).
  let enc;
  try { enc = encodeURIComponent(hit); } catch { return null; }
  let hex = "";
  for (let i = 0; i < enc.length; i += 1) {
    if (enc[i] === "%") { hex += enc.slice(i + 1, i + 3).toLowerCase(); i += 2; }
    else hex += enc.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return `agent-sleep.sleep-workspace.${hex}`;
}
