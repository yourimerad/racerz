// Player settings (for now: sound on/off), saved in localStorage so they survive a reload, and
// mirrored to the player's account when one is signed in (see account.ts). An external store, so
// React reads it with useSyncExternalStore without any hydration mismatch.

export type Settings = { muted: boolean };

const STORAGE_KEY = "racerz.settings.v1";
const DEFAULTS: Settings = { muted: false };

function read(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return { muted: typeof raw?.muted === "boolean" ? raw.muted : DEFAULTS.muted };
  } catch {
    return DEFAULTS;
  }
}

let current: Settings | null = null;
const listeners = new Set<() => void>();
let syncHook: ((s: Settings) => void) | null = null;

export function getSettings(): Settings {
  return (current ??= read());
}

export function getServerSettings(): Settings {
  return DEFAULTS;
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(s: Settings, push: boolean) {
  current = s;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage disabled or full: the setting just lasts for this session.
  }
  for (const l of listeners) l();
  if (push) syncHook?.(s);
}

export function setMuted(muted: boolean) {
  if (getSettings().muted !== muted) commit({ ...getSettings(), muted }, true);
}

/** A value read from the account wins over the local one, without being pushed back. */
export function applyRemoteMuted(muted: boolean) {
  if (getSettings().muted !== muted) commit({ ...getSettings(), muted }, false);
}

/** account.ts registers how to push a changed setting to the signed-in account. */
export function registerSettingsSync(fn: ((s: Settings) => void) | null) {
  syncHook = fn;
}
