// What org-links does with a Cmd-clicked link, without Herdr (tested in test/org-links-model.test.js).
// A web link of a terminal on this Mac goes to mac-workspace's `ws open <url> --cwd <its folder>`:
// ws takes the org from the folder and opens the link in that org's ego lite profile, or in the
// default browser when the folder is in no org (and says so). Everything else passes.

const WEB = /^https?:\/\//i;

/** The ws call for a click, or null to pass it to Herdr's usual opener. */
export function wsOpen(click, home) {
  const link = click?.link;
  const source = click?.source ?? {};
  if (link?.kind !== "url" || !WEB.test(link.url ?? "")) return null;
  if (source.machine) return null; // another machine's folders mean nothing to this Mac's ws
  const args = ["open", link.url];
  if (source.cwd) args.push("--cwd", source.cwd);
  return { command: `${home}/mac-workspace/bin/ws`, args, cwd: home };
}

const lastLine = (text) => (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

/** The toast for ws open's answer: null when it opened in ego lite (the browser shows it). */
export function toastFor(result) {
  if (result.code !== 0) {
    return { title: "Link not opened", body: lastLine(result.stderr) || lastLine(result.stdout) || `ws open exited ${result.code}`, level: "error" };
  }
  const said = lastLine(result.stdout);
  if (said.includes("default browser") || said.includes("default opener")) {
    return { title: "Opened in the default browser", body: said, level: "info" };
  }
  return null;
}
