// Player progression: cars, skins, race payouts and upgrade tiers ("paliers").
// Kept in memory for the session (no persistence).

export type ModelId = "gt" | "aventador" | "f8";
export type SkinId = "factory" | "pearl" | "electric" | "mantis" | "arancio" | "stripes" | "carbon" | "gold";

export type CarModel = {
  id: ModelId;
  name: string;
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
  gt: { id: "gt", name: "Racerz GT", price: 0, speed: 1, accel: 1, grip: 1, factory: { name: "Usine", body: "#e63946", accent: "#9d1c27" } },
  aventador: {
    id: "aventador", name: "Lamborghini Aventador SVJ", price: 32_500, speed: 1.07, accel: 1.12, grip: 1.05,
    factory: { name: "Noir mat", body: "#1d1d20", accent: "#3a3a40", matte: true },
  },
  f8: {
    id: "f8", name: "Ferrari F8 Spider", price: 300_000, speed: 1.12, accel: 1.15, grip: 1.1,
    factory: { name: "Rosso Corsa", body: "#d40000", accent: "#8a0000" },
  },
};
export const MODEL_ORDER: ModelId[] = ["gt", "aventador", "f8"];

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

export const NEW_PROFILE: Profile = { money: 0, cars: { gt: { level: 1, paliers: 0, skin: "factory" } }, selected: "gt", skins: ["factory"] };

export const PAYOUTS = [20_000, 1_500, 1_000]; // 1st, 2nd, 3rd
export const PALIERS_PER_LEVEL = 5;
export const MAX_LEVEL = 10;
/** A won race only earns a tier when it was driven cleanly. */
export const CLEAN_MAX_OFF = 0.05;
export const CLEAN_MAX_HITS = 2;

export function carStats(model: ModelId, level: number) {
  const m = MODELS[model], l = level - 1;
  return { speed: m.speed * (1 + 0.02 * l), accel: m.accel * (1 + 0.03 * l), grip: m.grip };
}

export const formatMoney = (n: number) => `${n.toLocaleString("fr-FR")} cr`;

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
