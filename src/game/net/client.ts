import { IDLE_SESSION, NetSession, type SessionState } from "./session";
import { NET, cleanName } from "./protocol";
import { type Transport, lazyTransport, localTransport, supabaseTransport } from "./transport";

// The browser's side of the online mode: which network to use, who this player is, and the one session the page shares.

// Read with these exact names so Next can put the two public values into the page (see account.ts, which uses the same project).
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type NetKind = "supabase" | "local" | null;

/** Which network the online mode uses here: the hosted service, two tabs of one browser (`?net=local`, to try it without a server), or none. */
export function netKind(): NetKind {
  if (typeof window === "undefined") return null;
  try {
    if (new URLSearchParams(window.location.search).get("net") === "local") return "local";
  } catch {
    // no URL to read: fall through
  }
  return SB_URL && SB_KEY ? "supabase" : null;
}

const NAME_KEY = "racerz.mp.v1";
let memoryId: string | null = null;

/** This tab's id in the online mode: new for every tab (two tabs of one browser are two players), plain letters and digits. */
export function myId(): string {
  try {
    const kept = window.sessionStorage.getItem("racerz.mp.id");
    if (kept && /^[A-Za-z0-9_-]{4,40}$/.test(kept)) return kept;
  } catch {
    // storage blocked: the id lives in memory
  }
  if (!memoryId) {
    const bytes = new Uint8Array(9);
    window.crypto.getRandomValues(bytes);
    memoryId = "p" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 13);
    try {
      window.sessionStorage.setItem("racerz.mp.id", memoryId);
    } catch {
      // keep it in memory only
    }
  }
  return memoryId;
}

/** The name shown to the others: what the player typed (kept on this device), or "Pilote" and a number. */
export function getPlayerName(): string {
  try {
    const raw = window.localStorage.getItem(NAME_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { name?: unknown };
      if (typeof o.name === "string" && o.name.trim()) return cleanName(o.name);
    }
  } catch {
    // unreadable: a default name
  }
  return `Pilote${100 + (parseInt(myId().slice(-3), 36) % 900)}`;
}
export function setPlayerName(name: string): string {
  const clean = cleanName(name);
  try {
    window.localStorage.setItem(NAME_KEY, JSON.stringify({ name: clean }));
  } catch {
    // not kept
  }
  return clean;
}

let session: NetSession | null = null;

/** The page's one session (made on first use, in the browser). */
export function netSession(): NetSession {
  if (!session) {
    const kind = netKind();
    const transport: Transport =
      kind === "local"
        ? localTransport()
        : lazyTransport(async () => {
            if (!SB_URL || !SB_KEY) throw new Error("mode en ligne non configuré");
            return supabaseTransport(SB_URL, SB_KEY);
          });
    session = new NetSession(transport, { id: myId(), name: getPlayerName(), model: "gt", skin: "factory", level: 1 });
  }
  return session;
}

// useSyncExternalStore parts.
export const subscribeNet = (l: () => void) => netSession().subscribe(l);
export const getNetState = (): SessionState => netSession().getState();
export const getServerNetState = (): SessionState => IDLE_SESSION;

/** `?room=ABCD` in the address: a friend's invitation. */
export function roomFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("room");
  } catch {
    return null;
  }
}
/** The invitation the page was opened with, read once when the page loads (the panel takes it out of the address when it uses it). */
export const INVITE_AT_LOAD: string | null = typeof window === "undefined" ? null : roomFromUrl();

/** Takes the invitation out of the address once it has been used (a reload must not join again). */
export function clearRoomFromUrl() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("room");
    window.history.replaceState(null, "", u.toString());
  } catch {
    // nothing to clean
  }
}
/** The address a friend can open to join a room (keeps `?net=local` when it is on). */
export function inviteLink(code: string): string {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  if (netKind() === "local") u.searchParams.set("net", "local");
  u.searchParams.set("room", code);
  return u.toString();
}

export const MAX_ONLINE_PLAYERS = NET.MAX_PLAYERS;
