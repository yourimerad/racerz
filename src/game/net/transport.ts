import type { Member, Msg } from "./protocol";

// How messages travel. A channel is a named room everybody who joins it can talk in, with a list of who is there ("presence"). The game only
// knows this interface; three things implement it:
//   - supabaseTransport: the hosted realtime service (broadcast + presence), for real players over the internet;
//   - localTransport: the browser's BroadcastChannel, so two tabs of one browser can race each other (`?net=local`: handy to try the mode
//     without any server);
//   - MemoryHub: an in-memory network with latency, jitter and loss that a test drives by hand (scripts/check-net.ts).

export type ChannelStatus = "joined" | "error" | "closed";

export type ChannelHandlers = {
  /** A message from someone else on the channel (own messages do not come back). Unchecked: it comes from the wire. */
  onMessage(raw: unknown): void;
  /** Who is on the channel now, this player included. Unchecked. */
  onPresence(raw: unknown[]): void;
  onStatus(status: ChannelStatus, detail?: string): void;
};

export interface Channel {
  send(msg: Msg): void;
  /** Changes what the others see of this player (name, car, mode…). */
  track(meta: Member): void;
  leave(): void;
}

export interface Transport {
  join(name: string, meta: Member, h: ChannelHandlers): Channel;
  /** Drops the connection altogether (no channel left). */
  close?(): void;
}

// ---------- the hosted service ----------

/**
 * Supabase Realtime: broadcast for the snapshots and the start message, presence for who is in a queue or a room. Needs no table and no
 * login: only the project's public URL and key (the same two variables as the accounts). It gets its own client, so it never touches a
 * signed-in player's session.
 */
export async function supabaseTransport(url: string, key: string): Promise<Transport> {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // The default allows 10 messages a second per client: a snapshot every 100 ms would hit it with the slightest extra.
    realtime: { params: { eventsPerSecond: 30 } },
  });
  return {
    join(name, meta, h) {
      const ch = client.channel(name, { config: { broadcast: { self: false, ack: false }, presence: { key: meta.id, enabled: true } } });
      const everyone = () => Object.values(ch.presenceState<Record<string, unknown>>()).flat();
      ch.on("presence", { event: "sync" }, () => h.onPresence(everyone()));
      ch.on("broadcast", { event: "m" }, (p) => h.onMessage(p.payload));
      ch.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          h.onStatus("joined");
          void ch.track(meta).catch(() => undefined);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") h.onStatus("error", err?.message ?? status);
        else if (status === "CLOSED") h.onStatus("closed");
      });
      return {
        send: (msg) => {
          void ch.send({ type: "broadcast", event: "m", payload: msg }).catch(() => undefined);
        },
        track: (m) => {
          void ch.track(m).catch(() => undefined);
        },
        leave: () => {
          void client.removeChannel(ch).catch(() => undefined);
        },
      };
    },
    close: () => {
      void client.realtime.disconnect();
    },
  };
}

/**
 * A transport that is made only when a channel is first joined (the Supabase client is a separate chunk, loaded on demand). The channel it
 * returns can be used at once: what is sent before the real one is up is kept and sent as soon as it is.
 */
export function lazyTransport(make: () => Promise<Transport>): Transport {
  let real: Promise<Transport> | null = null;
  return {
    join(name, meta, h) {
      if (!real) real = make();
      let ch: Channel | null = null;
      let closed = false;
      let latest = meta;
      const queued: Parameters<Channel["send"]>[0][] = [];
      real.then(
        (t) => {
          if (closed) return;
          ch = t.join(name, latest, h);
          for (const m of queued.splice(0)) ch.send(m);
        },
        (e: unknown) => {
          if (!closed) h.onStatus("error", e instanceof Error ? e.message : "indisponible");
        },
      );
      return {
        send: (msg) => {
          if (ch) ch.send(msg);
          else if (queued.length < 50) queued.push(msg);
        },
        track: (m) => {
          latest = m;
          ch?.track(m);
        },
        leave: () => {
          closed = true;
          ch?.leave();
        },
      };
    },
    close() {
      const r = real;
      real = null;
      void r?.then((t) => t.close?.());
    },
  };
}

// ---------- two tabs of one browser ----------

type LocalPacket = { k: "msg"; from: string; data: Msg } | { k: "hello"; meta: Member } | { k: "bye"; id: string } | { k: "who" };

/** The browser's own BroadcastChannel: members announce themselves every second and are dropped when they stop (a closed tab). */
export function localTransport(): Transport {
  return {
    join(name, meta, h) {
      const bc = new BroadcastChannel(`racerz-mp:${name}`);
      let me = meta;
      const others = new Map<string, { meta: Member; seen: number }>();
      let closed = false;
      const publish = () => h.onPresence([me, ...[...others.values()].map((o) => o.meta)]);
      const hello = () => bc.postMessage({ k: "hello", meta: me } satisfies LocalPacket);
      bc.onmessage = (e: MessageEvent<LocalPacket>) => {
        const p = e.data;
        if (!p || typeof p !== "object") return;
        if (p.k === "msg") h.onMessage(p.data);
        else if (p.k === "hello") {
          const known = others.has(p.meta.id);
          others.set(p.meta.id, { meta: p.meta, seen: Date.now() });
          if (!known) {
            hello(); // a newcomer: tell them about me right away
            publish();
          } else publish();
        } else if (p.k === "bye") {
          if (others.delete(p.id)) publish();
        } else if (p.k === "who") hello();
      };
      const timer = setInterval(() => {
        hello();
        let changed = false;
        for (const [id, o] of others) {
          if (Date.now() - o.seen <= 8000) continue; // generous: a tab busy drawing a 3D scene can be slow to answer
          others.delete(id);
          changed = true;
        }
        if (changed) publish();
      }, 1000);
      queueMicrotask(() => {
        if (closed) return;
        h.onStatus("joined");
        bc.postMessage({ k: "who" } satisfies LocalPacket);
        hello();
        publish();
      });
      return {
        send: (msg) => bc.postMessage({ k: "msg", from: me.id, data: msg } satisfies LocalPacket),
        track: (m) => {
          me = m;
          hello();
          publish();
        },
        leave: () => {
          closed = true;
          clearInterval(timer);
          bc.postMessage({ k: "bye", id: me.id } satisfies LocalPacket);
          bc.close();
        },
      };
    },
  };
}

// ---------- a network in memory, for tests ----------

export type HubOptions = {
  /** One-way delay (ms) of a message, and its random extra (0..jitter). */
  latency: number;
  jitter: number;
  /** Share of messages lost (0..1): snapshots only unless `lossy` says more; presence and start messages are never lost, as on a real connection that retries them. */
  loss: number;
  /** The kinds of message `loss` applies to. */
  lossy: readonly string[];
  /** A seeded random source (tests replay). */
  random: () => number;
};

/**
 * A fake internet: every `join` goes through `hub.transport()`, messages and presence changes arrive after the configured delays, and time
 * only moves when the test calls `advance`.
 */
export class MemoryHub {
  now = 0;
  opts: HubOptions;
  /** How many messages were sent, lost and delivered (a test reads them). */
  stats = { sent: 0, lost: 0, delivered: 0 };
  private seq = 0;
  private queue: { at: number; n: number; run: () => void }[] = [];
  private rooms = new Map<string, Map<Channel, { meta: Member; h: ChannelHandlers; link: { out?: number; in?: number }; lastPresence: number }>>();

  constructor(opts: Partial<HubOptions> = {}) {
    this.opts = { latency: 40, jitter: 20, loss: 0, lossy: ["snap"], random: Math.random, ...opts };
  }

  private later(delay: number, run: () => void) {
    this.queue.push({ at: this.now + delay, n: this.seq++, run });
  }
  private delay() {
    return this.opts.latency + this.opts.random() * this.opts.jitter;
  }

  /** Runs everything due in the next `ms` milliseconds, in order. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i];
        if (q.at <= end && (best < 0 || q.at < this.queue[best].at || (q.at === this.queue[best].at && q.n < this.queue[best].n))) best = i;
      }
      if (best < 0) break;
      const [q] = this.queue.splice(best, 1);
      this.now = q.at;
      q.run();
    }
    this.now = end;
  }

  private presenceSeq = 0;
  private presence(room: string) {
    const members = this.rooms.get(room);
    if (!members) return;
    const metas = [...members.values()].map((m) => m.meta);
    const n = ++this.presenceSeq;
    for (const [, m] of members) {
      const copy = metas.map((x) => ({ ...x }));
      // As the real service does, a list that arrives after a newer one is dropped (presence is a state, not a stream).
      this.later(this.delay(), () => {
        if (n < m.lastPresence) return;
        m.lastPresence = n;
        m.h.onPresence(copy);
      });
    }
  }

  /** A connection to the hub. `link` adds delay (ms) to what this machine sends (`out`) and to what it receives (`in`): a player far away, or one whose line is slower one way. */
  transport(link: { out?: number; in?: number } = {}): Transport {
    return {
      join: (name, meta, h) => {
        let members = this.rooms.get(name);
        if (!members) this.rooms.set(name, (members = new Map()));
        const room = members;
        const ch: Channel = {
          send: (msg) => {
            this.stats.sent++;
            const lossy = this.opts.lossy.includes(msg.type);
            for (const [other, m] of room) {
              if (other === ch) continue;
              if (lossy && this.opts.random() < this.opts.loss) {
                this.stats.lost++;
                continue;
              }
              const copy = JSON.parse(JSON.stringify(msg)) as unknown;
              this.later(this.delay() + (link.out ?? 0) + (m.link.in ?? 0), () => {
                if (!room.has(other)) return; // left meanwhile
                this.stats.delivered++;
                m.h.onMessage(copy);
              });
            }
          },
          track: (m) => {
            const entry = room.get(ch);
            if (entry) entry.meta = { ...m };
            this.presence(name);
          },
          leave: () => {
            if (!room.delete(ch)) return;
            this.presence(name);
          },
        };
        room.set(ch, { meta: { ...meta }, h, link, lastPresence: 0 });
        this.later(this.delay(), () => h.onStatus("joined"));
        this.presence(name);
        return ch;
      },
    };
  }
}
