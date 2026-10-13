import type { Car } from "../car";
import { type ModelId, type SkinId, MODELS, SKIN_ORDER, skinFits } from "../garage";
import type { MultiPlayer } from "../race";
import { THEME_ORDER, type ThemeId } from "../themes";

// The online mode's language: what a game says to the others, and how what arrives is checked before anything trusts it. Nothing here
// knows how messages travel (transport.ts) nor what a session does with them (session.ts). Every game plays its own car and tells the others
// where it is; what comes in is data from strangers, so every field is checked, clamped and, when it is not what it should be, dropped.

export const NET = {
  /** Snapshots of one's own car per second in a race of three (more with two players, fewer with four, see `snapshotHz`). Kept low on purpose: the hosted realtime service meters messages. */
  SEND_HZ: 10,
  /** Opponents are drawn at least this far in the past (s): the least delay that still hides the network's jitter. */
  INTERP_DELAY: 0.1,
  /** How long (s) a missing snapshot is bridged by the last velocity, no longer. */
  EXTRAP_MAX: 0.3,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  /** Once every game is ready (its race built, its 3D prepared) the host sets the green light this far ahead (ms): the 3 s countdown plus room for a slow message. */
  GO_LEAD_MS: 4000,
  /** The start waits for the slowest game at most this long (ms, from the start message): a game that never gets ready is left behind and joins the race where it is. */
  READY_MAX_MS: 25_000,
  /** After that, a host that has not even said it is ready is passed over: the next player on the list gives the green light. */
  HOST_GRACE_MS: 3000,
  /** A game that is ready says so again this often (ms) until it hears the green light (a message lost, or said before the others had joined). */
  READY_REPEAT_MS: 1000,
  /** The green light is said again this often (ms) for GO_REPEATS times, and to anyone who says "ready" after it. */
  GO_REPEAT_MS: 250,
  GO_REPEATS: 8,
  /** A game that is waiting measures the round trip to the host: this often (ms) for the first PING_SAMPLES, then a third as often, keeping the shortest of the last twelve. Kept light: every message is also delivered to each of the others. */
  PING_EVERY_MS: 500,
  PING_SAMPLES: 4,
  /** A green light handled more than this long (ms) after the last tick of the start's timer was probably queued while the game was frozen: its arrival time is unknown, so it is not used (a fresh one is asked for). */
  STALL_MS: 500,
  /** A player that has not joined the race channel at all (nor been heard) this long (ms) after the start never got the message: it is not waited for. */
  JOIN_MAX_MS: 10_000,
  /** A host that comes back ready after the wait is over first listens this long (ms): the next player may already have given the green light. */
  LISTEN_MS: 1500,
  /** A player gone from the race channel's presence this long (ms), and not heard from in that time, is out of the start (a blink of the list is not). */
  ABSENT_MS: 4000,
  /** Quick match: the longest-waiting player starts the game with whoever is there once they have waited this long (ms), or at once with a full table. */
  QUEUE_WAIT_MS: 7000,
  /** An opponent we have heard nothing from for this long (ms) during a race has left. */
  STALE_MS: 6000,
  /** After the local player has finished, the place waits at most this long (s) for the rivals who are still driving (see `RaceSync.pending`). */
  SETTLE_MAX: 20,
  NAME_MAX: 14,
  /** How many times, and how often (ms), the starter repeats its start message (a lost one would leave a player behind). */
  START_REPEATS: 6,
  START_REPEAT_MS: 500,
} as const;

/** A player as the others see them: who, what car, and since when they have been waiting / in the room (their own clock; only an order). */
export type Member = MultiPlayer & { since: number; /** The room's mode, as chosen by whoever hosts it. */ mode?: ThemeId };

/** One snapshot of a car: where it is and how it stands in the race. Short keys: it is sent ten times a second. */
export type Snap = {
  /** Sequence number (grows by one per snapshot): an older one arriving late is dropped. */
  s: number;
  x: number; y: number; vx: number; vy: number;
  /** Heading (rad) and altitude (m, the Racerz Jet). */
  a: number; z: number;
  hp: number;
  /** Laps done, unrolled progress along the centre line (samples), finishing time (s on its own clock) or null. */
  lap: number; p: number; f: number | null;
  /** The sender's race time when it sent this (s): how far its game has got, which a slow machine's can lag far behind the wall clock. */
  t: number;
  /** The car has blown up. */
  d: boolean;
  /** Under a turbo. */
  b: boolean;
};

export type StartMsg = {
  type: "start";
  /** Id of the race channel (also what makes two starts of the same room different). */
  game: string;
  mode: ThemeId;
  /** Shared seed: the track's hazards play out from the same dice in every game. */
  seed: number;
  /** Who started the game: it gives the green light once everybody is ready (see `RaceSync`). Always one of the players. */
  host: string;
  /** The grid, in order (the order fixes everyone's starting slot): the same list for everybody. */
  players: MultiPlayer[];
};
export type SnapMsg = { type: "snap"; from: string; snap: Snap };
export type ByeMsg = { type: "bye"; from: string };
/** "My game is built and my 3D is up": said by every player on the race channel, again and again until the green light is heard. */
export type ReadyMsg = { type: "ready"; from: string };
/**
 * The green light, as a duration so that no clock is compared with another: `in` ms after the sender sent this (negative: it came that long
 * ago, the race is already running). The receiver puts it on its own clock from when the message arrived, less the trip (see `RaceSync`).
 */
export type GoMsg = { type: "go"; from: string; in: number };
/** A round trip to measure how long a message takes between two games: `ping` goes to `to`, who answers `pong` with the same number. */
export type PingMsg = { type: "ping"; from: string; to: string; n: number };
export type PongMsg = { type: "pong"; from: string; to: string; n: number };
export type Msg = StartMsg | SnapMsg | ByeMsg | ReadyMsg | GoMsg | PingMsg | PongMsg;

/**
 * Snapshots per second for a race of `players`: every message is also delivered to each of the others, so the load grows with the square of the
 * room. A free Supabase project allows about 100 messages a second in all: 2 players make 60, 3 players 90, 4 players 96 with these rates.
 */
export const snapshotHz = (players: number): number => (players <= 2 ? 15 : players === 3 ? NET.SEND_HZ : 6);
/** How far in the past (s) the opponents are drawn: about a snapshot and a bit, so there is nearly always one ahead to blend toward. */
export const interpDelay = (players: number): number => Math.max(NET.INTERP_DELAY, 1.15 / snapshotHz(players));

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEME_ORDER as readonly string[]).includes(v);
const isModelId = (v: unknown): v is ModelId => typeof v === "string" && Object.prototype.hasOwnProperty.call(MODELS, v);
const isSkinId = (v: unknown): v is SkinId => typeof v === "string" && (SKIN_ORDER as readonly string[]).includes(v);

/** A name fit for the screen: no control characters, one space at a time, at most NAME_MAX characters, never empty. */
export function cleanName(raw: unknown): string {
  const s = (typeof raw === "string" ? raw : "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NET.NAME_MAX).trim();
  return s || "Pilote";
}

/** An id as sent by a stranger: short, plain. */
const cleanId = (raw: unknown): string | null => (typeof raw === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(raw) ? raw : null);

export function parsePlayer(raw: unknown): MultiPlayer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>, id = cleanId(o.id), level = num(o.level, 1, 10);
  if (!id || level === null || !isModelId(o.model) || !isSkinId(o.skin)) return null;
  // A skin that does not fit the car is shown in the factory paint, never refused (the car itself is what matters).
  const skin: SkinId = skinFits(o.model, o.skin) ? o.skin : "factory";
  return { id, name: cleanName(o.name), model: o.model, skin, level: Math.round(level) };
}

export function parseMember(raw: unknown): Member | null {
  const p = parsePlayer(raw);
  if (!p) return null;
  const o = raw as Record<string, unknown>, since = num(o.since, 0, 1e15);
  if (since === null) return null;
  return { ...p, since, ...(isThemeId(o.mode) ? { mode: o.mode } : {}) };
}

export function parseSnap(raw: unknown): Snap | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const s = num(o.s, 0, 1e9), x = num(o.x, -1e5, 1e5), y = num(o.y, -1e5, 1e5), vx = num(o.vx, -5000, 5000), vy = num(o.vy, -5000, 5000);
  const a = num(o.a, -1000, 1000), z = num(o.z, 0, 500), hp = num(o.hp, 0, 100), lap = num(o.lap, 0, 50), p = num(o.p, -1e5, 1e6), t = num(o.t, -60, 1e5);
  if (s === null || x === null || y === null || vx === null || vy === null || a === null || z === null || hp === null || lap === null || p === null || t === null) return null;
  const f = o.f === null ? null : num(o.f, 0, 1e5);
  if (o.f !== null && f === null) return null;
  return { s, x, y, vx, vy, a, z, hp, lap: Math.floor(lap), p, f, t, d: o.d === true, b: o.b === true };
}

/** How far from now a green light may be (ms): a minute ahead, or up to an hour ago for a game that joins a race already under way. */
const MAX_AHEAD_MS = 60_000;
const MAX_AGO_MS = 3_600_000;

/** What arrives from the wire, as a message we understand — or null. Never throws. */
export function parseMsg(raw: unknown): Msg | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type === "snap") {
    const from = cleanId(o.from), snap = parseSnap(o.snap);
    return from && snap ? { type: "snap", from, snap } : null;
  }
  if (o.type === "bye") {
    const from = cleanId(o.from);
    return from ? { type: "bye", from } : null;
  }
  if (o.type === "ready") {
    const from = cleanId(o.from);
    return from ? { type: "ready", from } : null;
  }
  if (o.type === "go") {
    const from = cleanId(o.from), at = num(o.in, -MAX_AGO_MS, MAX_AHEAD_MS);
    return from && at !== null ? { type: "go", from, in: at } : null;
  }
  if (o.type === "ping" || o.type === "pong") {
    const from = cleanId(o.from), to = cleanId(o.to), n = num(o.n, 0, 1e9);
    return from && to && n !== null ? { type: o.type, from, to, n: Math.floor(n) } : null;
  }
  if (o.type === "start") {
    const game = cleanId(o.game), seed = num(o.seed, 0, 2 ** 32 - 1);
    if (!game || seed === null || !isThemeId(o.mode) || !Array.isArray(o.players)) return null;
    const players: MultiPlayer[] = [];
    for (const raw of o.players.slice(0, NET.MAX_PLAYERS)) {
      const p = parsePlayer(raw);
      if (p && !players.some((q) => q.id === p.id)) players.push(p);
    }
    if (players.length < NET.MIN_PLAYERS) return null;
    // The host is one of the players; a message that names someone else (or nobody) falls back to the first on the grid.
    const named = cleanId(o.host);
    const host = named && players.some((p) => p.id === named) ? named : players[0].id;
    return { type: "start", game, mode: o.mode, seed: Math.floor(seed), host, players };
  }
  return null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
/** The snapshot of one of our cars (numbers rounded: a decimetre is plenty). */
export function snapOf(car: Car, seq: number, boosting: boolean, time: number): Snap {
  return {
    s: seq, x: r1(car.pos.x), y: r1(car.pos.y), vx: Math.round(car.vel.x), vy: Math.round(car.vel.y), a: Math.round(car.angle * 1000) / 1000, z: r1(car.alt),
    hp: Math.round(car.hp), lap: car.lap, p: r1(car.progress), f: car.finishTime === null ? null : Math.round(car.finishTime * 1000) / 1000, t: Math.round(time * 100) / 100, d: car.destroyedAt !== null, b: boosting,
  };
}

/** Room codes: four characters without the look-alikes (no 0/O, 1/I/L). */
export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function makeRoomCode(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return s;
}
/** What a person typed as a code → the code, or null when it cannot be one. */
export function cleanCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 4 && [...s].every((c) => ROOM_ALPHABET.includes(c)) ? s : null;
}

/** The channels: the quick-match queue of a mode, a friends' room, and one race. */
export const queueChannel = (mode: ThemeId) => `racerz-q-${mode}`;
export const roomChannel = (code: string) => `racerz-r-${code}`;
export const raceChannel = (game: string) => `racerz-g-${game}`;
