// Background processes in the Agents list: watchers, jobs and dev servers an
// agent (or another process) started with `hc run`. Pure rules, no Herdr calls,
// so test/worktrees-agents-model.test.js can hold them.

// A finished OK process stays this long, then leaves the list.
export const FADE_MS = 5 * 60000;
// Records of processes that left the core are forgotten after this.
const FORGET_MS = 86400000;

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// A shell with nothing but flags (`zsh -l`) is someone's prompt, not a job.
const bareShell = (t) => Boolean(t.program?.shell) && (t.argv ?? []).slice(1).every((a) => a.startsWith("-"));

// Launched by another terminal, not an agent (no status, not an agent program),
// and running a command rather than an interactive shell.
export function isProcess(t) {
  if (!t?.parent) return false;
  if (t.program?.agent || t.status) return false;
  return !bareShell(t);
}

export function procName(t) {
  return t.name || (t.argv?.length ? t.argv.join(" ") : "") || t.program?.name || t.address;
}

const finished = (t) => t.state !== "live";
const ok = (t) => t.exit_code === 0;
const endedAt = (t, rec) => t.finished_ms ?? rec?.at;

// rec: this list's record of the process (see track).
export function procState(t, rec, now) {
  if (!finished(t)) return { kind: "running", text: "running" };
  if (ok(t)) return { kind: "done", text: `✓ ${duration(now - (endedAt(t, rec) ?? now))}` };
  return { kind: "failed", text: `exit ${t.exit_code ?? t.signal ?? "?"}` };
}

// Running ones always; OK ones for FADE_MS; failed ones until opened once.
export function shown(t, rec, now) {
  if (!finished(t)) return true;
  if (ok(t)) return now - (endedAt(t, rec) ?? now) < FADE_MS;
  return !rec?.seen;
}

// Updates store (address -> {live} | {at, seen?, gone?}) from the core's list.
// `at`: when this list first saw it finished. `vanished`: running ones that
// left the list (removed, or the list holds live ones only): look them up once.
export function track(store, all, now) {
  let dirty = false;
  const listed = new Set();
  for (const t of all) {
    if (!isProcess(t)) continue;
    listed.add(t.address);
    const rec = store[t.address];
    if (!finished(t)) {
      if (!rec?.live) { store[t.address] = { live: true }; dirty = true; }
    } else if (!rec || rec.live) {
      store[t.address] = { at: now };
      dirty = true;
    }
  }
  const vanished = [];
  for (const [address, rec] of Object.entries(store)) {
    if (listed.has(address)) continue;
    if (rec.live) {
      store[address] = { at: now, gone: true };
      vanished.push(address);
      dirty = true;
    } else if (now - (rec.at ?? 0) > FORGET_MS) {
      delete store[address];
      dirty = true;
    }
  }
  return { dirty, vanished };
}

// The core's list plus the final state of processes looked up after they left it.
export function withEnded(all, ended) {
  const listed = new Set(all.map((t) => t.address));
  return [...all, ...Object.values(ended).filter((t) => t && !listed.has(t.address))];
}

// What `addr` launched, depth first, each with the tree lines in front of it:
// live sub-agents (as the shipped list has them) and processes still shown.
// proc: whether the row is a process.
export function tree(all, addr, store, now, lead = []) {
  const kids = all.filter((k) => k.parent === addr && (isProcess(k) ? shown(k, store[k.address], now) : k.state === "live"));
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [
      { t: k, lines: [...lead, last ? "└" : "├"], proc: isProcess(k) },
      ...tree(all, k.address, store, now, [...lead, last ? "" : "│"]),
    ];
  });
}
