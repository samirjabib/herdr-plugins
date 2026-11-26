// org-links: a Cmd-clicked web link opens in the ego lite profile of the org its terminal is in
// (mac-workspace `ws open`), never another org's. No ws on this Mac: Herdr's usual opener.
import { exec, home, notify, readTextFile } from "herdr";
import { wsOpen, toastFor } from "./model.js";

export async function handleLink(click) {
  const call = wsOpen(click, home());
  if (!call) return "pass";
  if ((await readTextFile(call.command)) === null) return "pass"; // no mac-workspace here
  let result;
  try {
    result = await exec(call.command, call.args, { cwd: call.cwd, timeout: 25000 });
  } catch (e) {
    // Started but failed (a timeout...): say so, never fall back to another browser.
    result = { code: 1, stdout: "", stderr: String(e?.message ?? e) };
  }
  const toast = toastFor(result);
  if (toast) notify(toast);
  return "handled";
}
