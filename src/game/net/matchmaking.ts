import { NET } from "./protocol";

// Quick match: everybody waiting for a game of a mode is in the same presence list, and everybody works out the same tables from it — the
// players in the order they started waiting, four to a table. Only the leader of a table (its longest-waiting player) ever acts on it, so
// two games cannot start the same table; the start message names the players, so the others follow whatever their own list says.

export type Seeker = { id: string; since: number };
export type Table = { ids: string[]; leader: string; /** The leader may start this table now. */ ready: boolean };

/**
 * The tables of the players waiting. The same list gives the same tables on every machine (the order is by waiting time, then id). A table
 * is ready when it is full, or when it has at least MIN_PLAYERS and its leader has waited `waitMs` — measured on the leader's own clock,
 * which is the only one that matters since only the leader acts.
 */
export function planTables(seekers: readonly Seeker[], now: number, waitMs: number = NET.QUEUE_WAIT_MS): Table[] {
  const seen = new Set<string>();
  const sorted = seekers
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tables: Table[] = [];
  for (let i = 0; i < sorted.length; i += NET.MAX_PLAYERS) {
    const group = sorted.slice(i, i + NET.MAX_PLAYERS), leader = group[0];
    const ready = group.length >= NET.MIN_PLAYERS && (group.length === NET.MAX_PLAYERS || now - leader.since >= waitMs);
    tables.push({ ids: group.map((g) => g.id), leader: leader.id, ready });
  }
  return tables;
}

/** A deterministic shuffle (Fisher-Yates with the given random source): the grid order of a game. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
