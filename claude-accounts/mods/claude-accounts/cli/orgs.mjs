// One active account per mac-workspace org (odd/tasks/autoswitch-orgs.md S1).
//
// mac-workspace keeps its projects in ~/mac-workspace/<org>/ (cs, ag,
// personal) and lists each org's Claude accounts in
// harness/claude-profiles.tsv (`name<TAB>org<TAB>dir<TAB>default`). A saved
// account belongs to the org of the row whose dir is its config dir (System
// default's is ~/.claude). The pools:
//   cs, ag     the accounts of that org's rows, never another org's;
//   personal   every account (Samir 2026-11-24: personal uses every Claude
//              account, only for its quota).
// Each org has its own active account, `active.<org>` in the state folder
// (the `active` file's format: the exact config dir, "" for System default).
// An org with no such file, or one naming an account outside its pool,
// follows the global `active` when that account is in its pool, else it has
// none (the mac-workspace shim then runs the org's default). The launcher
// (bin/claude) reads the same files, by the folder's org.
//
// Without the tsv (another Mac layout, the tests' sandboxes) there are no
// pools: readProfiles is null and everything stays global, as before.
//
// A terminal's org comes from its folder: the first part of its path under
// ~/mac-workspace, when it is cs, ag or personal and the folder lies inside it.

import { readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { FILES } from "./paths.mjs";
import { writeAtomic } from "./files.mjs";

export const ORGS = Object.freeze(["cs", "ag", "personal"]);
export const GROUP_ACCOUNTS = "group-accounts";

const userHome = (env) => env.HOME || homedir();

// The mac-workspace root: $CLAUDE_ACCOUNTS_WORKSPACE, else ~/mac-workspace.
export const workspaceRoot = (env = process.env) => env.CLAUDE_ACCOUNTS_WORKSPACE || join(userHome(env), "mac-workspace");

export const profilesFile = (env = process.env) => join(workspaceRoot(env), "harness", "claude-profiles.tsv");

export const orgActiveFile = (org) => `${FILES.active}.${org}`;

const expand = (dir, env) => (dir === "~" ? userHome(env) : dir.startsWith("~/") ? join(userHome(env), dir.slice(2)) : dir);

// Parses the tsv text: [{ name, org, dir }], dirs with ~ expanded. Comments,
// the header and rows of an unknown org are skipped.
export function parseProfiles(text, env = process.env) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, org, dir] = line.split("\t").map((s) => (s ?? "").trim());
    if (!name || !dir || !ORGS.includes(org)) continue;
    rows.push({ name, org, dir: expand(dir, env) });
  }
  return rows;
}

// The tsv's rows, or null when there is no tsv.
export async function readProfiles(env = process.env) {
  const text = await readFile(profilesFile(env), "utf8").catch(() => null);
  return text === null ? null : parseProfiles(text, env);
}

// The folder an account's Claude runs on: ~/.claude for System default.
const folderOf = (account, env) => (account.isDefault ? join(userHome(env), ".claude") : account.configDir);

// The org of an account by its folder's tsv row, or null.
export function orgOfAccount(account, rows, env = process.env) {
  const dir = folderOf(account, env);
  return rows.find((r) => r.dir === dir)?.org ?? null;
}

// The ids of an org's pool, from knownAccounts' list.
export function poolOf(org, accounts, rows, env = process.env) {
  return new Set(accounts.filter((a) => org === "personal" || orgOfAccount(a, rows, env) === org).map((a) => a.id));
}

// The org of a folder, from its path under the workspace root, or null.
// Both spellings count: as given and with links resolved.
export async function orgOfCwd(cwd, env = process.env) {
  if (typeof cwd !== "string" || !cwd) return null;
  const root = workspaceRoot(env);
  const roots = [root, await realpath(root).catch(() => root)];
  const paths = [cwd, await realpath(cwd).catch(() => cwd)];
  for (const r of roots) {
    for (const p of paths) {
      if (!p.startsWith(r + sep)) continue;
      // Inside the org's folder, as the launcher reads it: <root>/<org>/<x>.
      const [first, next] = p.slice(r.length + 1).split(sep);
      if (ORGS.includes(first) && next) return first;
    }
  }
  return null;
}

// The orgs group-accounts pins to one folder (bin/claude's rule 0): their
// Claudes never follow a switch, so they never switch automatically.
export async function pinnedOrgs(home) {
  const text = await readFile(join(home, GROUP_ACCOUNTS), "utf8").catch(() => "");
  const out = new Set();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [group, folder] = line.split("\t");
    if (ORGS.includes(group) && folder) out.add(group);
  }
  return out;
}

// { cs: "<dir>" | undefined, ... }: each org's file as written (undefined:
// no file).
export async function readOrgActives(home) {
  const out = {};
  for (const org of ORGS) {
    const raw = await readFile(join(home, orgActiveFile(org)), "utf8").catch(() => undefined);
    out[org] = raw === undefined ? undefined : raw.split("\n")[0];
  }
  return out;
}

const idOfDir = (dir, accounts) => (dir === "" ? "default" : (accounts.find((a) => !a.isDefault && a.configDir === dir)?.id ?? null));

// The account each org's Claudes start on (the pure rule above):
// { cs: id | null, ag: ..., personal: ..., none: <global active> }.
export function effectiveActives({ known, rows, orgDirs, env = process.env }) {
  const out = { none: known.active };
  for (const org of ORGS) {
    const pool = poolOf(org, known.accounts, rows, env);
    const own = orgDirs[org] === undefined ? null : idOfDir(orgDirs[org], known.accounts);
    out[org] = own && pool.has(own) ? own : pool.has(known.active) ? known.active : null;
  }
  return out;
}

// Writes org's active file: the account's exact folder ("" for System default).
export async function writeOrgActive(home, org, account) {
  await writeAtomic(join(home, orgActiveFile(org)), account.isDefault ? "" : (account.configDir ?? ""));
}

export async function removeOrgActive(home, org) {
  await rm(join(home, orgActiveFile(org)), { force: true });
}

// The orgs (and "none", outside any org) whose Claudes went from `from` to
// `to` between two effectiveActives readings.
export function movedScopes(before, after, from, to) {
  return new Set(Object.keys(after).filter((k) => before[k] === from && after[k] === to));
}
