// Player progression: cars, skins, race payouts and upgrade tiers ("paliers").
// The player profile is persisted to localStorage (debug mode's profile is not).

export type ModelId = "gt" | "mx5" | "p911" | "aventador" | "f8";
export type SkinId = "factory" | "pearl" | "electric" | "mantis" | "arancio" | "stripes" | "carbon" | "gold";

export type CarModel = {
  id: ModelId;
  name: string;
  /** Short hook shown under the name in the garage card. */
  tagline: string;
  price: number;
  /** Multipliers on PHYS for top speed, acceleration and grip. */
  speed: number;
  accel: number;
  grip: number;
  /** Factory paint. */
  factory: Skin;
};

export type Skin = {
  name: string;
  body: string;
  accent: string;
  matte?: boolean;
  pattern?: "stripes" | "carbon" | "metal";
};

export const MODELS: Record<ModelId, CarModel> = {
  gt: {
    id: "gt", name: "Racerz GT", tagline: "Polyvalente", price: 0, speed: 1, accel: 1, grip: 1,
    factory: { name: "Usine", body: "#e63946", accent: "#9d1c27" },
  },
  mx5: {
    id: "mx5", name: "Mazda MX-5", tagline: "Agile, très accrocheuse", price: 5_000, speed: 1.04, accel: 1.02, grip: 1.3,
    factory: { name: "Jaune Sunburst", body: "#f5c518", accent: "#b8860b" },
  },
  p911: {
    id: "p911", name: "Porsche 911 Carrera", tagline: "Équilibrée et efficace", price: 20_000, speed: 1.1, accel: 1.12, grip: 1.18,
    factory: { name: "Argent GT", body: "#c3c6ca", accent: "#7f848a" },
  },
  aventador: {
    id: "aventador", name: "Lamborghini Aventador SVJ", tagline: "Puissante et stable", price: 60_000, speed: 1.16, accel: 1.2, grip: 1.12,
    factory: { name: "Noir mat", body: "#1d1d20", accent: "#3a3a40", matte: true },
  },
  f8: {
    id: "f8", name: "Ferrari F8 Spider", tagline: "La plus rapide, mais glissante", price: 150_000, speed: 1.24, accel: 1.3, grip: 0.8,
    factory: { name: "Rosso Corsa", body: "#d40000", accent: "#8a0000" },
  },
};
export const MODEL_ORDER: ModelId[] = ["gt", "mx5", "p911", "aventador", "f8"];

export const SKINS: Record<Exclude<SkinId, "factory">, Skin & { price: number }> = {
  pearl: { name: "Blanc nacré", body: "#f2f0ea", accent: "#c9c4b8", price: 4_000 },
  electric: { name: "Bleu électrique", body: "#1f6fff", accent: "#0b3a99", price: 6_000 },
  mantis: { name: "Verde Mantis", body: "#6fd12a", accent: "#3c7a12", price: 9_000 },
  arancio: { name: "Arancio", body: "#ff7a00", accent: "#a84f00", price: 9_000 },
  stripes: { name: "Bandes racing", body: "#f4f4f4", accent: "#1f4fbf", pattern: "stripes", price: 15_000 },
  carbon: { name: "Carbone", body: "#2a2c30", accent: "#15161a", pattern: "carbon", price: 22_000 },
  gold: { name: "Or", body: "#d4af37", accent: "#8a6d12", pattern: "metal", price: 40_000 },
};
export const SKIN_ORDER: SkinId[] = ["factory", "pearl", "electric", "mantis", "arancio", "stripes", "carbon", "gold"];

export function skinOf(model: ModelId, skin: SkinId): Skin {
  return skin === "factory" ? MODELS[model].factory : SKINS[skin];
}

export type OwnedCar = { level: number; paliers: number; skin: SkinId };
export type Profile = {
  money: number;
  cars: Partial<Record<ModelId, OwnedCar>>;
  selected: ModelId;
  /** Skins bought once, usable on every car. */
  skins: SkinId[];
};

export const NEW_PROFILE: Profile = { money: 2_000, cars: { gt: { level: 1, paliers: 0, skin: "factory" } }, selected: "gt", skins: ["factory"] };
/** Debug mode plays with a separate profile; its purchases/earnings never touch the player's. */
export const DEBUG_PROFILE: Profile = { ...NEW_PROFILE, money: 1_000_000 };

export const PAYOUTS = [5_000, 2_500, 1_000]; // 1st, 2nd, 3rd
export const PALIERS_PER_LEVEL = 5;
export const MAX_LEVEL = 10;
/** A won race only earns a tier when it was driven cleanly. */
export const CLEAN_MAX_OFF = 0.05;
export const CLEAN_MAX_HITS = 2;

export function carStats(model: ModelId, level: number) {
  const m = MODELS[model], l = level - 1;
  return { speed: m.speed * (1 + 0.02 * l), accel: m.accel * (1 + 0.03 * l), grip: m.grip };
}

export type StatKey = "speed" | "accel" | "grip";

/**
 * Display range per stat, derived from MODELS: from the weakest base car (level 1) to the
 * strongest at MAX_LEVEL, with a small margin below so the weakest value stays visible.
 */
export const STAT_RANGE: Record<StatKey, { min: number; max: number }> = (() => {
  const ids = Object.keys(MODELS) as ModelId[];
  const range = (key: StatKey) => {
    const lo = Math.min(...ids.map((id) => carStats(id, 1)[key]));
    const hi = Math.max(...ids.map((id) => carStats(id, MAX_LEVEL)[key]));
    return { min: lo - (hi - lo) * 0.12, max: hi };
  };
  return { speed: range("speed"), accel: range("accel"), grip: range("grip") };
})();

export const formatMoney = (n: number) => `${n.toLocaleString("fr-FR")} €`;

export type RaceReport = {
  place: number;
  earned: number;
  palier: boolean;
  checks: { label: string; ok: boolean }[];
  levelUp: number | null;
};

export function settleRace(p: Profile, place: number, offRatio: number, hits: number): { profile: Profile; report: RaceReport } {
  const earned = PAYOUTS[place - 1] ?? 0;
  const car = p.cars[p.selected] ?? { level: 1, paliers: 0, skin: "factory" as SkinId };
  const checks = [
    { label: "Victoire", ok: place === 1 },
    { label: `Hors-piste ${Math.round(offRatio * 100)} % (max ${CLEAN_MAX_OFF * 100} %)`, ok: offRatio <= CLEAN_MAX_OFF },
    { label: `Contacts barrière ${hits} (max ${CLEAN_MAX_HITS})`, ok: hits <= CLEAN_MAX_HITS },
  ];
  const palier = checks.every((c) => c.ok) && car.level < MAX_LEVEL;
  let { level, paliers } = car;
  let levelUp: number | null = null;
  if (palier && ++paliers >= PALIERS_PER_LEVEL) {
    level++;
    paliers = 0;
    levelUp = level;
  }
  return {
    profile: { ...p, money: p.money + earned, cars: { ...p.cars, [p.selected]: { ...car, level, paliers } } },
    report: { place, earned, palier, checks, levelUp },
  };
}

export function buyCar(p: Profile, id: ModelId): Profile {
  if (p.cars[id] || p.money < MODELS[id].price) return p;
  return { ...p, money: p.money - MODELS[id].price, cars: { ...p.cars, [id]: { level: 1, paliers: 0, skin: "factory" } }, selected: id };
}

export function buySkin(p: Profile, id: SkinId): Profile {
  if (id === "factory" || p.skins.includes(id) || p.money < SKINS[id].price) return p;
  return equipSkin({ ...p, money: p.money - SKINS[id].price, skins: [...p.skins, id] }, id);
}

export function equipSkin(p: Profile, id: SkinId): Profile {
  const car = p.cars[p.selected];
  if (!car || !p.skins.includes(id)) return p;
  return { ...p, cars: { ...p.cars, [p.selected]: { ...car, skin: id } } };
}

export function selectCar(p: Profile, id: ModelId): Profile {
  return p.cars[id] ? { ...p, selected: id } : p;
}

function isModelId(x: unknown): x is ModelId {
  return typeof x === "string" && x in MODELS;
}

function isSkinId(x: unknown): x is SkinId {
  return x === "factory" || (typeof x === "string" && x in SKINS);
}

/**
 * Sanitizes whatever a localStorage read might produce: corrupted JSON, an old
 * shape, or ids from models/skins that no longer exist (or don't exist yet).
 * Unknown ids are dropped; valid ones are accepted automatically against the
 * live MODELS/SKINS tables, so future additions need no change here.
 */
export function parseProfile(raw: unknown): Profile {
  if (typeof raw !== "object" || raw === null) return NEW_PROFILE;
  const r = raw as Record<string, unknown>;

  const money = Number.isInteger(r.money) && (r.money as number) >= 0 ? (r.money as number) : NEW_PROFILE.money;

  const skins: SkinId[] = ["factory"];
  if (Array.isArray(r.skins)) {
    for (const s of r.skins) {
      if (isSkinId(s) && s !== "factory" && !skins.includes(s)) skins.push(s);
    }
  }

  const cars: Partial<Record<ModelId, OwnedCar>> = { gt: { level: 1, paliers: 0, skin: "factory" } };
  if (typeof r.cars === "object" && r.cars !== null) {
    for (const [id, owned] of Object.entries(r.cars as Record<string, unknown>)) {
      if (!isModelId(id) || typeof owned !== "object" || owned === null) continue;
      const o = owned as Record<string, unknown>;
      const level = Number.isInteger(o.level) && (o.level as number) >= 1 && (o.level as number) <= MAX_LEVEL ? (o.level as number) : 1;
      const paliers = Number.isInteger(o.paliers) && (o.paliers as number) >= 0 && (o.paliers as number) < PALIERS_PER_LEVEL ? (o.paliers as number) : 0;
      const skin = isSkinId(o.skin) && skins.includes(o.skin) ? o.skin : "factory";
      cars[id] = { level, paliers, skin };
    }
  }

  const selected = isModelId(r.selected) && cars[r.selected] ? r.selected : "gt";

  return { money, cars, selected, skins };
}

const STORAGE_KEY = "racerz.profile.v1";

function readStoredProfile(): Profile {
  if (typeof window === "undefined") return NEW_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseProfile(JSON.parse(raw)) : NEW_PROFILE;
  } catch {
    // Corrupted JSON, private browsing, or storage disabled: start fresh.
    return NEW_PROFILE;
  }
}

function writeStoredProfile(p: Profile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Quota exceeded or storage disabled: fall back to in-memory only.
  }
}

let cachedPlayerProfile: Profile | null = null;
const playerProfileListeners = new Set<() => void>();

/**
 * The player profile as an external store backed by localStorage, so
 * Game.tsx can read it with useSyncExternalStore and avoid any hydration
 * mismatch on the statically prerendered page (the server always sees
 * `getServerPlayerProfile`, never the real storage).
 */
export function getPlayerProfile(): Profile {
  if (cachedPlayerProfile === null) cachedPlayerProfile = readStoredProfile();
  return cachedPlayerProfile;
}

export function getServerPlayerProfile(): Profile {
  return NEW_PROFILE;
}

export function subscribePlayerProfile(listener: () => void) {
  playerProfileListeners.add(listener);
  return () => playerProfileListeners.delete(listener);
}

/** Persists the player profile and notifies subscribers. Never used for the debug profile. */
export function savePlayerProfile(p: Profile) {
  cachedPlayerProfile = p;
  writeStoredProfile(p);
  for (const l of playerProfileListeners) l();
}
