// Hidden debug mode: off by default, unlocked for the session by the URL
// (?debug=1) or by typing the "debug" secret sequence. Plain external store
// (no React) so Game.tsx can read it with useSyncExternalStore and avoid any
// hydration mismatch on this statically prerendered page.

let active = false;
// The panel is part of the same store so switching debug mode off always
// closes it too: it never reopens on its own next time debug mode unlocks.
let panelOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeDebugMode(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Same store as subscribeDebugMode: either flag changing notifies both. */
export const subscribeDebugPanel = subscribeDebugMode;

export function getDebugMode() {
  return active;
}

/** The server never sees the query string on this static page: always off. */
export function getServerDebugMode() {
  return false;
}

export function setDebugMode(v: boolean) {
  if (v === active) return;
  active = v;
  if (!active) panelOpen = false;
  emit();
}

export function toggleDebugMode() {
  setDebugMode(!active);
}

export function getDebugPanelOpen() {
  return panelOpen;
}

export function getServerDebugPanelOpen() {
  return false;
}

/** No-op while debug mode is locked, so it can never leave a stale open state. */
export function toggleDebugPanel() {
  if (!active) return;
  panelOpen = !panelOpen;
  emit();
}

/** True if the current URL unlocks debug mode (?debug=1). */
export function debugModeFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

export const SECRET_WORD = "debug";

/** Slides a single key into the buffer, keeping only the last letters typed. */
export function advanceSecretBuffer(buffer: string, key: string): string {
  if (!/^[a-z]$/i.test(key)) return buffer;
  return (buffer + key.toLowerCase()).slice(-SECRET_WORD.length);
}
