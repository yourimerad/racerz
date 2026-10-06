// Headless bot-difficulty simulation. Run with:
//   node --no-warnings --import ./scripts/ts-loader.mjs scripts/sim-bots.ts
// (or `pnpm sim`). No dependency, no network: Node 25 strips the types natively and
// scripts/ts-loader.mjs teaches module resolution to find src/game's extensionless
// relative imports (e.g. `from "./car"`).
//
// For each mode and several seeds, races the 3 bots against a mistake-free AI "proxy"
// driving each car model from the stats table below (see race.ts `aiInput`'s
// `allowMistakes` param and `stepRace`'s `playerIsAi` param, both added for this).
// The proxy stands in for "a good human player" to check that a race is winnable with
// the right car, and not with a cheaper one.
import { NO_INPUT } from "../src/game/car";
import { type Race, type PlayerCar, createRace, stepRace, standings, TOTAL_LAPS } from "../src/game/race";
import { type ThemeId, THEME_ORDER, THEMES } from "../src/game/themes";

// Local only: the real table lives in garage.ts (another, parallel track owns it), and
// it only has gt/aventador/f8 at this point in history. Multipliers at level 1, from
// the task spec (speed / accel / grip).
const CAR_TABLE = {
  gt: { speed: 1.0, accel: 1.0, grip: 1.0 },
  mx5: { speed: 1.04, accel: 1.02, grip: 1.3 },
  p911: { speed: 1.1, accel: 1.12, grip: 1.18 },
  aventador: { speed: 1.16, accel: 1.2, grip: 1.12 },
  f8: { speed: 1.24, accel: 1.3, grip: 0.8 },
} as const;
type CarId = keyof typeof CAR_TABLE;
const CAR_ORDER: CarId[] = ["gt", "mx5", "p911", "aventador", "f8"];

const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 97);
const DT = 1 / 120; // matches Game.tsx's fixed-step loop
const MAX_TIME = 240; // seconds of race time before giving up on a run
const STALL_TIME = 8; // seconds without centerline progress before a car is "blocked"
const PLAYER: PlayerCar = { model: "gt", skin: "factory", level: 1 };

type RunResult = {
  proxyTime: number | null;
  proxyPlace: number;
  botTimes: (number | null)[];
  botMistakes: number[];
  blocked: number[]; // car ids that stalled
  hits: number[]; // barrier-hit count per car
};

function simulate(themeId: ThemeId, carId: CarId, seed: number): RunResult {
  const race: Race = createRace(themeId, PLAYER, seed);
  const stats = CAR_TABLE[carId];
  const proxy = race.cars[0];
  proxy.skill = stats.speed;
  proxy.accelMul = stats.accel;
  proxy.gripMul = stats.grip;

  const lastProgress = race.cars.map((c) => c.progress);
  const stallSince = race.cars.map(() => 0);
  const blocked = new Set<number>();

  while (race.time < MAX_TIME && !(blocked.size + race.cars.filter((c) => c.finishTime !== null).length >= race.cars.length)) {
    stepRace(race, NO_INPUT, DT, true);
    for (const car of race.cars) {
      if (car.finishTime !== null || blocked.has(car.id)) continue;
      if (car.progress > lastProgress[car.id] + 0.02) {
        lastProgress[car.id] = car.progress;
        stallSince[car.id] = race.time;
      } else if (race.time - stallSince[car.id] > STALL_TIME) {
        blocked.add(car.id);
      }
    }
  }

  const order = standings(race);
  return {
    proxyTime: proxy.finishTime,
    proxyPlace: order.findIndex((c) => c.id === proxy.id) + 1,
    botTimes: race.cars.slice(1).map((c) => c.finishTime),
    botMistakes: race.ai.slice(1).map((a) => a.count),
    blocked: [...blocked],
    hits: race.cars.map((c) => c.hits),
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

type ModeReport = {
  botTime: number;
  botFinishRate: number;
  botMistakes: number;
  botHits: number;
  blockedRuns: number;
  perCar: Record<CarId, { time: number; place: number; winRate: number; runs: number }>;
};

function runMode(themeId: ThemeId): ModeReport {
  const allBotTimes: number[] = [];
  let botFinishes = 0, botTotal = 0;
  let totalMistakes = 0;
  let totalHits = 0;
  let blockedRuns = 0;
  const perCar = {} as ModeReport["perCar"];

  for (const carId of CAR_ORDER) {
    const times: number[] = [];
    const places: number[] = [];
    let wins = 0, runs = 0;
    for (const seed of SEEDS) {
      const r = simulate(themeId, carId, seed);
      runs++;
      if (r.blocked.length > 0) blockedRuns++;
      totalMistakes += r.botMistakes.reduce((a, b) => a + b, 0);
      totalHits += r.hits.slice(1).reduce((a, b) => a + b, 0);
      for (const t of r.botTimes) { botTotal++; if (t !== null) { botFinishes++; allBotTimes.push(t); } }
      if (r.proxyTime !== null) times.push(r.proxyTime);
      places.push(r.proxyPlace);
      if (r.proxyPlace === 1) wins++;
    }
    perCar[carId] = { time: mean(times), place: mean(places), winRate: wins / runs, runs };
  }

  return {
    botTime: mean(allBotTimes),
    botFinishRate: botFinishes / botTotal,
    botMistakes: totalMistakes / (CAR_ORDER.length * SEEDS.length * 3),
    botHits: totalHits / (CAR_ORDER.length * SEEDS.length * 3),
    blockedRuns,
    perCar,
  };
}

function printReport() {
  console.log(`racerz — simulation bots (${SEEDS.length} graines/mode, ${TOTAL_LAPS} tours, dt=${DT.toFixed(4)}s)\n`);
  for (const themeId of THEME_ORDER) {
    const theme = THEMES[themeId];
    const report = runMode(themeId);
    console.log(`== ${theme.emoji} ${theme.name} (bots pace ${theme.bots.pace.toFixed(2)} ±${theme.bots.spread.toFixed(3)}, erreurs ${theme.bots.errors}/min) ==`);
    console.log(`  bots: temps moyen ${fmtTime(report.botTime)} · arrivées ${(report.botFinishRate * 100).toFixed(0)} % · erreurs/bot/course ${report.botMistakes.toFixed(1)} · contacts barrière/bot/course ${report.botHits.toFixed(2)} · courses avec blocage ${report.blockedRuns}`);
    console.log(`  proxy par voiture :`);
    let prevTime: number | null = null;
    let ordered = true;
    for (const carId of CAR_ORDER) {
      const p = report.perCar[carId];
      if (Number.isFinite(p.time)) {
        if (prevTime !== null && p.time > prevTime + 1e-6) ordered = false; // should improve (or tie), never regress
        prevTime = p.time;
      }
      console.log(
        `    ${carId.padEnd(10)} temps ${fmtTime(p.time)} · position moyenne ${p.place.toFixed(2)} · victoires ${(p.winRate * 100).toFixed(0)} % (${p.runs} courses)`,
      );
    }
    console.log(`  ordre des temps proxy gt<mx5<p911<aventador<f8 : ${ordered ? "respecté" : "NON respecté"}`);
    console.log("");
  }
}

printReport();
