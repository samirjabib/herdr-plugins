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
