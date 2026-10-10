import type { SupabaseClient, Session } from "@supabase/supabase-js";
import { type ProfileActions } from "./actions";
import {
  type Profile, type RaceReport, buyCar, buySkin, equipSkin, getPlayerProfile, hasLocalProgress, getLocalProfile, parseProfile, selectCar,
  setAccountProfile,
} from "./garage";
import { applyRemoteMuted, registerSettingsSync } from "./settings";

// Player accounts, on Supabase. Passwords never touch this code: Supabase Auth owns them. The
// account's profile (money, cars, skins, level, selected car, sound setting) lives in the
// `profiles` table (supabase/schema.sql), which no client can write directly: every change goes
// through a server function that recomputes the money. Locally we update optimistically so the
// garage stays snappy, then replace our copy with what the server answers (or re-read it if the
// server refused). The localStorage save stays the guest's backup and is never touched while
// signed in. Without NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY the whole thing stays switched off.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const accountConfigured = Boolean(URL && KEY);

export type AccountState = {
  status: "off" | "loading" | "signedOut" | "signedIn";
  email: string | null;
  /** A request (sign-in, import…) is running. */
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** The account is new and a guest save with progress exists: offer to move it over. */
  importOffer: boolean;
};

const OFF: AccountState = { status: "off", email: null, busy: false, error: null, notice: null, importOffer: false };
const INITIAL: AccountState = accountConfigured ? { ...OFF, status: "loading" } : OFF;
let state: AccountState = INITIAL;
const listeners = new Set<() => void>();

export const getAccountState = () => state;
export const getServerAccountState = () => INITIAL;
export function subscribeAccount(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function set(patch: Partial<AccountState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
export const isSignedIn = () => state.status === "signedIn";
export const dismissAccountMessage = () => set({ error: null, notice: null });

let client: SupabaseClient | null = null;
let userId: string | null = null;
let started = false;

const MESSAGES: Record<string, string> = {
  "Invalid login credentials": "E-mail ou mot de passe incorrect.",
  "Email not confirmed": "Adresse e-mail pas encore confirmée : ouvre le lien reçu par e-mail.",
  "User already registered": "Un compte existe déjà avec cette adresse e-mail.",
  not_enough_money: "Pas assez d'argent sur le compte.",
  already_owned: "Déjà possédé.",
  fixed_skin: "Le serveur n'a pas encore les skins de la Racerz Jet : rejoue supabase/schema.sql dans Supabase.",
  unknown_skin: "Ce skin n'existe pas encore sur le serveur : rejoue supabase/schema.sql dans Supabase.",
  skin_mismatch: "Ce skin ne va pas sur cette voiture (ceux de la Racerz Jet ne vont que sur elle).",
  unknown_car: "Cette voiture n'existe pas encore sur le serveur : rejoue supabase/schema.sql dans Supabase.",
  race_not_valid: "Course non validée par le serveur : gain refusé.",
  bad_result: "Résultat de course refusé par le serveur.",
  already_imported: "La progression locale a déjà été reprise.",
};
function messageOf(e: unknown): string {
  const raw = typeof e === "string" ? e : typeof (e as { message?: unknown } | null)?.message === "string" ? (e as { message: string }).message : "";
  for (const [k, v] of Object.entries(MESSAGES)) if (raw.includes(k)) return v;
  return raw ? `Erreur : ${raw}` : "Erreur inconnue.";
}

/** Calls a server function; resolves with its JSON answer. */
async function remote(name: string, args?: Record<string, unknown>): Promise<unknown> {
  if (!client) throw new Error("Compte indisponible");
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

// One server call at a time, in the order the player made them (a buy then a skin must not race).
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

/** Adopts the server's profile JSON as the player profile (and its sound setting). */
function adopt(json: unknown): Profile {
  const profile = parseProfile(json);
  setAccountProfile(profile);
  const muted = (json as { settings?: { muted?: unknown } } | null)?.settings?.muted;
  if (typeof muted === "boolean") applyRemoteMuted(muted);
  return profile;
}

async function loadProfile(): Promise<void> {
  const json = await remote("get_profile");
  adopt(json);
  const imported = Boolean((json as { imported?: unknown } | null)?.imported);
  set({ importOffer: !imported && hasLocalProgress() });
}

async function onSession(session: Session | null) {
  if (!session) {
    userId = null;
    setAccountProfile(null);
    set({ status: "signedOut", email: null, busy: false, importOffer: false });
    return;
  }
  if (session.user.id === userId) return; // same user (a tab refocus re-announces the session)
  userId = session.user.id;
  set({ status: "signedIn", email: session.user.email ?? null, busy: true });
  try {
    await loadProfile();
    set({ busy: false });
  } catch (e) {
    // No profile means no safe way to play on this account (progress would silently stay local).
    set({ busy: false, error: `Profil du compte indisponible. ${messageOf(e)}` });
    await client?.auth.signOut();
  }
}

/** Call once on the client (Game.tsx). `inject` lets tests supply a fake Supabase client. */
export async function initAccount(inject?: SupabaseClient) {
  if (started || (!accountConfigured && !inject)) return;
  started = true;
  const { createClient } = await import("@supabase/supabase-js");
  client = inject ?? createClient(URL!, KEY!);
  registerSettingsSync(({ muted }) => {
    if (isSignedIn()) void enqueue(() => remote("save_settings", { p_muted: muted })).catch(() => undefined);
  });
  // INITIAL_SESSION also fires here, so a page reload restores the session without a getSession call.
  // Supabase asks not to call its own API inside this callback: defer.
  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => void onSession(session), 0);
  });
}

export async function signUp(email: string, password: string) {
  if (!client) return;
  set({ busy: true, error: null, notice: null });
  try {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // With e-mail confirmation on, there is no session until the link is clicked.
    set({ busy: false, notice: data.session ? null : "Compte créé ! Confirme ton adresse e-mail via le lien reçu, puis connecte-toi." });
  } catch (e) {
    set({ busy: false, error: messageOf(e) });
  }
}

export async function signIn(email: string, password: string) {
  if (!client) return;
  set({ busy: true, error: null, notice: null });
  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange takes it from here; busy stays on until the profile is loaded.
  } catch (e) {
    set({ busy: false, error: messageOf(e) });
  }
}

export async function signOut() {
  await client?.auth.signOut();
}

/** Re-reads the account's profile (after a refused change, so the screen matches the server). */
async function refresh() {
  try {
    adopt(await remote("get_profile"));
  } catch {
    // Offline: keep what we show; the next call will tell.
  }
}

/** Optimistic local change, then the server's say. */
function mutate(optimistic: Profile, name: string, args: Record<string, unknown>) {
  setAccountProfile(optimistic);
  void enqueue(async () => {
    try {
      adopt(await remote(name, args));
    } catch (e) {
      set({ error: messageOf(e) });
      await refresh();
    }
  });
}

/** Garage actions for a signed-in player: priced and paid for on the server. */
export const remoteActions: ProfileActions = {
  buyCar: (id) => mutate(buyCar(getPlayerProfile(), id), "buy_car", { p_model: id }),
  buySkin: (id) => mutate(buySkin(getPlayerProfile(), id), "buy_skin", { p_skin: id }),
  equipSkin: (id) => mutate(equipSkin(getPlayerProfile(), id), "equip_skin", { p_skin: id }),
  selectCar: (id) => mutate(selectCar(getPlayerProfile(), id), "select_car", { p_model: id }),
};

/** Race ticket: the server only pays out a race it saw start (and last at least 20 s). */
export function accountStartRace() {
  void enqueue(() => remote("start_race")).catch(() => undefined);
}

/**
 * Settles a finished race on the server. Resolves with the server's report, or null when it
 * refused (the profile is then re-read, so the screen shows the real balance).
 */
export function accountSettleRace(place: number, offRatio: number, hits: number): Promise<Pick<RaceReport, "earned" | "palier" | "levelUp"> | null> {
  return enqueue(async () => {
    try {
      const res = (await remote("settle_race", { p_place: place, p_off_ratio: Math.min(1, Math.max(0, offRatio)), p_hits: hits })) as {
        profile: unknown;
        report: { earned: number; palier: boolean; levelUp: number | null };
      };
      adopt(res.profile);
      return res.report;
    } catch (e) {
      set({ error: messageOf(e) });
      await refresh();
      return null;
    }
  });
}

/** Moves the guest save onto the account (once; the server caps and sanitizes it). */
export async function importLocalProgress() {
  set({ busy: true, error: null });
  try {
    adopt(await enqueue(() => remote("import_profile", { p_data: getLocalProfile() })));
    set({ busy: false, importOffer: false, notice: "Progression locale reprise sur ton compte." });
  } catch (e) {
    set({ busy: false, error: messageOf(e) });
  }
}

/** Declines the import for good (the guest save stays on this device). */
export async function skipImport() {
  set({ importOffer: false });
  try {
    adopt(await enqueue(() => remote("skip_import")));
  } catch {
    // Not fatal: the offer may come back next time.
  }
}
