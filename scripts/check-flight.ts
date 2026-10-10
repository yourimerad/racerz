// Racerz Jet checks (flight, garage, shop). Run with `pnpm check:flight` (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
//
//   (a) garage and economy: 550 000 €, bars 92 / 85 / 70 / Vol 100 on the existing scale (the other cars' bars did not move), purchase with and
//       without enough money, save and reload, the Jet's own skins (they fit the Jet only, the other cars' skins never fit it, prices, buying, equipping, saving),
//       payouts unchanged;
//   (b) the flight state machine: wings 0.6 s, climb to 80 m, energy -1/s in the air and +0.6/s on the ground, 20 % to take off, release → descent,
//       re-press → climb again, energy 0 → forced landing + 1 s cooldown, the flight speed multiplier ×1 → ×1.10 and its combination with the others;
//   (c) what a car above 20 m passes over (hay bales, polar bear, other cars, lava pools, volcano targets and bombs, boost pads) — and what stays
//       solid (walls), what it never counts (contacts), and that a grounded car still meets all of them;
//   (d) the line is never crossed in the air (also at turbo speed), no takeoff in the zones nor during the countdown, finish detected as ever;
//   (e) only the human flies; any other car is unaffected.

import { BOOST } from "../src/game/boost";
import { AIRBORNE_ALT, NO_INPUT, PHYS, isAirborne, speedOf, stepCar, type Car } from "../src/game/car";
import { FLY, FlightController, distToLine, type FlightAdapter } from "../src/game/flight";
import {
  FLY_BAR, MODELS, MODEL_ORDER, NEW_PROFILE, PAYOUTS, SKINS, SKIN_ORDER, STAT_RANGE, buyCar, buySkin, carStats, equipSkin, formatMoney, parseProfile, selectCar,
  settleRace, skinFits, skinOf, skinsFor, type Profile, type SkinId,
} from "../src/game/garage";
import { JET_SCALE } from "../src/game/jetArt";
import { aiInput, createRace, stepRace, TOTAL_LAPS, type Race } from "../src/game/race";
import type { VolcanoHazard } from "../src/game/modes/volcano";
import type { ThemeId } from "../src/game/themes";
import { locate } from "../src/game/track";

const DT = 1 / 120;
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const near = (what: string, got: number, want: number, tol: number) => {
  if (Math.abs(got - want) > tol) fail(`${what}: ${got.toFixed(3)} (expected ${want} ± ${tol})`);
};
const check = (cond: boolean, msg: string) => {
  if (!cond) fail(msg);
};

console.log("Racerz Jet checks\n");

// ---------- (a) garage and economy ----------
{
  const jet = MODELS.jet;
  check(jet.id === "jet" && jet.name === "Racerz Jet" && jet.price === 550_000, "the Jet's id / name / price");
  check(MODEL_ORDER.includes("jet") && MODEL_ORDER[MODEL_ORDER.length - 1] === "jet", "the Jet is the last car of the shop");
  check(/^550\s000\s€$/u.test(formatMoney(jet.price).replace(/[  ]/g, " ")), `price display "${formatMoney(jet.price)}"`);
  // The other cars' bars are where they always were (the Jet is not part of the scale).
  const old = { speed: { min: 0.944416, max: 1.4632 }, accel: { min: 0.92188, max: 1.651 }, grip: { min: 0.74, max: 1.3 } };
  for (const k of ["speed", "accel", "grip"] as const) {
    near(`STAT_RANGE.${k}.min`, STAT_RANGE[k].min, old[k].min, 1e-6);
    near(`STAT_RANGE.${k}.max`, STAT_RANGE[k].max, old[k].max, 1e-6);
  }
  const bar = (k: "speed" | "accel" | "grip", v: number) => ((v - STAT_RANGE[k].min) / (STAT_RANGE[k].max - STAT_RANGE[k].min)) * 100;
  const st = carStats("jet", 1);
  near("Jet bar: speed", bar("speed", st.speed), 92, 0.5);
  near("Jet bar: accel", bar("accel", st.accel), 85, 0.5);
  near("Jet bar: grip", bar("grip", st.grip), 70, 0.5);
  near("Jet bar: fly", FLY_BAR, 100, 0);
  console.log(`  bars at level 1: speed ${bar("speed", st.speed).toFixed(1)} · accel ${bar("accel", st.accel).toFixed(1)} · grip ${bar("grip", st.grip).toFixed(1)} · fly ${FLY_BAR} (physics ×${st.speed} / ×${st.accel} / ×${st.grip})`);
  // Buying: with and without enough money.
  const poor: Profile = { ...NEW_PROFILE, money: 549_999 };
  check(buyCar(poor, "jet") === poor, "bought the Jet with 549 999 €");
  const rich = buyCar({ ...NEW_PROFILE, money: 600_000 }, "jet");
  check(rich.money === 50_000 && rich.cars.jet?.level === 1 && rich.cars.jet?.skin === "factory" && rich.selected === "jet", `buying: money ${rich.money}, selected ${rich.selected}`);
  check(buyCar(rich, "jet") === rich, "bought the Jet twice");
  const exact = buyCar({ ...NEW_PROFILE, money: 550_000 }, "jet");
  check(exact.money === 0 && !!exact.cars.jet, "buying with exactly 550 000 €");
  // Saved and reloaded (the profile goes through JSON in localStorage), selection included.
  const back = parseProfile(JSON.parse(JSON.stringify(rich)));
  check(back.cars.jet?.level === 1 && back.selected === "jet" && back.money === 50_000, "the purchase is not kept by save / reload");
  check(selectCar(back, "gt").selected === "gt" && selectCar(selectCar(back, "gt"), "jet").selected === "jet", "selecting the Jet again");
  // The Jet's own skins: factory white and red by default, six more that fit the Jet only; the other cars' skins never fit the Jet.
  const JET_SKINS: Record<string, number> = { jetSky: 12_000, jetSunset: 15_000, jetCamo: 20_000, jetCarbon: 28_000, jetNight: 35_000, jetGold: 70_000 };
  const OLD_SKINS: Record<string, number> = { pearl: 4_000, electric: 6_000, mantis: 9_000, arancio: 9_000, stripes: 15_000, carbon: 22_000, gold: 40_000 };
  for (const [id, price] of Object.entries(JET_SKINS)) check(SKINS[id as SkinId as Exclude<SkinId, "factory">]?.price === price, `Jet skin ${id}: price ${SKINS[id as Exclude<SkinId, "factory">]?.price}`);
  for (const [id, price] of Object.entries(OLD_SKINS)) check(SKINS[id as Exclude<SkinId, "factory">].price === price, `the price of the skin ${id} changed`);
  const hex = /^#[0-9a-f]{6}$/i;
  for (const id of SKIN_ORDER) {
    const sk = skinOf(id === "factory" || !SKINS[id].jet ? "gt" : "jet", id);
    check(hex.test(sk.body) && hex.test(sk.accent) && sk.name.length > 0, `skin ${id}: bad colours or name`);
  }
  check(skinsFor("jet").join() === ["factory", ...Object.keys(JET_SKINS)].join(), `skins offered for the Jet: ${skinsFor("jet").join()}`);
  check(skinsFor("gt").join() === ["factory", ...Object.keys(OLD_SKINS)].join(), `skins offered for the GT: ${skinsFor("gt").join()}`);
  for (const id of MODEL_ORDER) {
    check(skinFits(id, "factory"), `the factory paint does not fit ${id}`);
    for (const sk of SKIN_ORDER) {
      if (sk === "factory") continue;
      check(skinFits(id, sk) === (id === "jet" ? sk in JET_SKINS : sk in OLD_SKINS), `skinFits(${id}, ${sk}) is wrong`);
    }
  }
  check(skinOf("jet", "factory").body === "#f2f6fa" && skinOf("jet", "factory").accent === "#d63a2f", "the Jet's factory paint is not white and red");
  check(skinOf("jet", "gold").body === "#f2f6fa", "an ordinary skin painted the Jet");
  check(skinOf("gt", "jetGold").body === MODELS.gt.factory.body, "a Jet skin painted the GT");
  check(skinOf("jet", "jetCamo").pattern === "camo" && skinOf("jet", "jetNight").matte === true && skinOf("jet", "jetGold").pattern === "metal", "a Jet skin lost its finish");
  const shop: Profile = { ...rich, money: 100_000, skins: ["factory", "gold"] };
  check(equipSkin(shop, "gold") === shop, "an ordinary skin was equipped on the Jet");
  check(buySkin(shop, "pearl") === shop, "an ordinary skin was bought while the Jet is selected");
  const poorBuy = buySkin({ ...shop, money: 11_999 }, "jetSky");
  check(poorBuy.money === 11_999 && !poorBuy.skins.includes("jetSky"), "a Jet skin was bought below its price");
  const bought = buySkin(shop, "jetSky");
  check(bought.money === 88_000 && bought.skins.includes("jetSky") && bought.cars.jet?.skin === "jetSky", `buying jetSky: money ${bought.money}, skin ${bought.cars.jet?.skin}`);
  check(buySkin(bought, "jetSky") === bought, "a Jet skin was bought twice");
  const dear = buySkin(bought, "jetGold");
  check(dear.money === 18_000 && dear.cars.jet?.skin === "jetGold", `buying jetGold: money ${dear.money}`);
  const back2 = equipSkin(dear, "jetSky");
  check(back2.cars.jet?.skin === "jetSky" && back2.money === dear.money, "equipping an owned Jet skin");
  check(equipSkin(back2, "jetCamo") === back2, "an unowned Jet skin was equipped");
  check(equipSkin(back2, "factory").cars.jet?.skin === "factory", "going back to the factory paint");
  const onGt = selectCar(bought, "gt");
  check(buySkin(onGt, "jetCamo") === onGt, "a Jet skin was bought while the GT is selected");
  check(equipSkin(onGt, "jetSky") === onGt, "a Jet skin was equipped on the GT");
  check(equipSkin(onGt, "factory").cars.gt?.skin === "factory", "the GT lost its factory paint");
  const kept = parseProfile(JSON.parse(JSON.stringify(dear)));
  check(kept.cars.jet?.skin === "jetGold" && kept.skins.includes("jetSky") && kept.skins.includes("jetGold"), "the Jet's skin is not kept by save / reload");
  const stale = parseProfile({ ...rich, skins: ["factory", "gold", "jetSky"], cars: { gt: { level: 1, paliers: 0, skin: "jetSky" }, jet: { level: 2, paliers: 1, skin: "gold" } } });
  check(stale.cars.jet?.skin === "factory" && stale.cars.gt?.skin === "factory", "a stored skin stayed on a car it does not fit");
  const ghost = parseProfile({ ...rich, skins: ["factory", "jetNope"], cars: { jet: { level: 2, paliers: 1, skin: "jetNope" } } });
  check(ghost.cars.jet?.skin === "factory" && !ghost.skins.includes("jetNope" as SkinId), "an unknown skin id was accepted");
  // A skin is only paint: the physics, the stats and the bars do not move.
  check(JSON.stringify(carStats("jet", 3)) === JSON.stringify({ speed: 1.422 * 1.04, accel: 1.542 * 1.06, grip: 1.132 }), "the Jet's stats changed");
  const plain = createRace("desert", { model: "jet", skin: "factory", level: 1 }, 5), dressed = createRace("desert", { model: "jet", skin: "jetGold", level: 1 }, 5);
  check(dressed.cars[0].skin.body === "#d4af37" && plain.cars[0].skin.body === "#f2f6fa", "the race did not wear the skin");
  for (let i = 0; i < 600; i++) {
    stepRace(plain, { ...NO_INPUT, throttle: i > 120 }, DT);
    stepRace(dressed, { ...NO_INPUT, throttle: i > 120 }, DT);
  }
  check(plain.cars[0].pos.x === dressed.cars[0].pos.x && plain.cars[0].pos.y === dressed.cars[0].pos.y && plain.cars[0].vel.x === dressed.cars[0].vel.x, "a skin changed the driving");
  // Economy untouched: same payouts, same palier rule.
  const settled = settleRace({ ...rich, money: 0 }, 1, 0, 0);
  check(settled.report.earned === PAYOUTS[0] && settled.profile.money === PAYOUTS[0], "payout changed");
  check(PAYOUTS.join() === "5000,2500,1000" && MODELS.gt.price === 0 && MODELS.f8.price === 150_000, "an existing price or payout changed");
  console.log("  shop: 550 000 € · no purchase below it · saved · 6 Jet skins (Jet only, bought / equipped / saved) · payouts untouched");
}

// ---------- (b) the state machine, on its own ----------
function lab() {
  const car = { id: 0, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, finishTime: null, alt: 0, flyMul: 1 } as unknown as Car;
  const events: string[] = [];
  const A: FlightAdapter = {
    speed: () => 0, setSpeedMultiplier: (c, f) => (c.flyMul = f), distToFinish: () => Infinity, distToStart: () => Infinity, noFlyAt: () => false,
    floorAlt: () => 0, inWorld: () => true,
    onTakeoff: () => events.push("takeoff"), onLand: () => events.push("land"),
  };
  const fc = new FlightController(A);
  let t = 0;
  const run = (seconds: number, shift: boolean) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      fc.update(DT, car, shift);
      t += DT;
    }
  };
  return { car, fc, A, events, run, time: () => t };
}
{
  const { car, fc, run, events } = lab();
  const s = fc.st(car);
  run(0.3 - 0.01, true);
  check(s.alt === 0, "the car climbed before the wings were half open");
  near("wings after 0.29 s", s.wing, 0.29 / 0.6, 0.03);
  run(0.31, true); // 0.6 s
  near("wings open after 0.6 s", s.wing, 1, 0.02);
  // Press at t = 0: wings 0.6 s, climbing from 0.3 s at 100 m/s, so 80 m at 1.1 s; energy falls 1 per second from the press.
  const { car: c2, fc: f2, run: r2 } = lab();
  r2(0.3 + 0.2 + 0.02, true);
  check(isAirborne(c2) && f2.isAirborne(c2) === isAirborne(c2), `not above ${AIRBORNE_ALT} m 0.5 s into the takeoff (alt ${c2.alt.toFixed(1)})`);
  run(0.5, true); // 1.1 s after the press
  near("altitude 1.1 s after the press", s.alt, FLY.MAX_ALT, 1.5);
  run(0.02, true);
  check(s.mode === "fly", `mode ${s.mode} at full altitude`);
  near("flight multiplier at full altitude", car.flyMul, 1.1, 1e-6);
  near("energy 1.12 s after the press (-1/s)", s.energy, 5 - 1.12, 0.05);
  run(1, true);
  near("energy 2.12 s after the press", s.energy, 5 - 2.12, 0.05);
  check(car.alt === s.alt, "car.alt does not follow the flight state");
  // Release: down in 0.8 s, wings fold in 0.6 s.
  run(0.4, false);
  near("altitude 0.4 s after the release", s.alt, 80 - 40, 1.5);
  near("flight multiplier half way down", car.flyMul, 1.05, 0.01);
  run(0.41, false);
  near("altitude after 0.8 s of descent", s.alt, 0, 1);
  check(!isAirborne(car) || car.alt < 1, "still airborne at the ground");
  run(0.62, false);
  check(s.mode === "ground" && s.wing === 0 && events.join() === "takeoff,land", `landing ended in ${s.mode}, wing ${s.wing.toFixed(2)}, events ${events.join()}`);
  check(car.flyMul === 1, "the flight multiplier stays after landing");
  // Energy comes back on the ground at 0.6 / s.
  const before = s.energy;
  run(2, false);
  near("recharge on the ground (+0.6/s)", s.energy - before, 1.2, 0.05);
  // Full in about 8 s from empty.
  s.energy = 0;
  run(8.33 + 0.02, false);
  near("empty to full on the ground", s.energy, FLY.MAX_ENERGY, 0.02);
  console.log("  flight: wings 0.6 s · 80 m in 1.1 s · down in 0.8 s · energy -1/s up there, +0.6/s down here · ×1.10 at full altitude");
}
{
  // Takeoff needs 20 % of the energy; releasing during the takeoff comes back down; pressing again during the descent climbs again.
  const { car, fc, run } = lab();
  const s = fc.st(car);
  const mode = () => s.mode as string; // (the checks below follow the machine through its modes)
  s.energy = 0.9;
  run(0.05, true); // 0.93: under 20 %
  check(mode() === "ground", `took off with less than 20 % energy (${s.energy.toFixed(2)})`);
  run(0.13, true); // the tank passes 1.0 (20 %)
  check(mode() === "takeoff", `no takeoff once 20 % is reached (mode ${mode()}, energy ${s.energy.toFixed(2)})`);
  run(0.5, true); // alt ≈ (0.5 - 0.3 s) × 100 = 20 m and wings open
  const alt1 = s.alt;
  check(alt1 > 10, `alt ${alt1.toFixed(1)} after 0.5 s of takeoff`);
  run(0.1, false);
  check(mode() === "landing" && s.alt < alt1, "released during the takeoff but the car did not come down");
  const down = s.alt;
  run(0.05, true);
  check(mode() === "takeoff", `pressed again during the descent: mode ${mode()}`);
  run(0.3, true);
  check(s.alt > down, "pressed again during the descent but the car did not climb");
}
{
  // Energy at zero: forced landing, then a second before the next takeoff (and 20 % of energy).
  const { car, fc, run } = lab();
  const s = fc.st(car);
  s.mode = "fly";
  s.alt = FLY.MAX_ALT;
  s.wing = 1;
  const mode = () => s.mode as string;
  s.energy = 0.3;
  run(0.35, true);
  check(mode() === "landing" && s.energy === 0, `energy ran out: mode ${mode()}, energy ${s.energy}`);
  run(0.85, true); // landed, wings folding or folded, still holding Shift
  check(mode() !== "takeoff" && s.alt === 0, "took off again with no energy");
  let tookOffAt = -1;
  for (let i = 0; i < 4 / DT && tookOffAt < 0; i++) {
    run(DT, true);
    if (mode() === "takeoff") tookOffAt = i * DT;
  }
  // Energy from 0 reaches 20 % after 1/0.6 = 1.67 s, which is after the 1 s cooldown.
  check(tookOffAt >= 0.7, `took off ${tookOffAt.toFixed(2)} s after landing with an empty tank`);
  console.log(`  forced landing at 0 energy · next takeoff ~${(tookOffAt + 0.85 + 0.35).toFixed(1)} s later (cooldown 1 s, then 20 % energy)`);
}
{
  // The multipliers combine: flight × turbo × volcano damage (and the surface), on top speed AND acceleration.
  const mods = { trackGrip: 1, offGrip: 1, offDrag: 1, offMax: 1, lavaDrag: 1, lavaMax: 1 };
  const race = createRace("desert", { model: "gt", skin: "factory", level: 1 }, 1);
  const car = race.cars[0];
  const top = (fly: number, boost: number, dmg: number, surface: Car["surface"] = "track") => {
    car.pos = { x: 0, y: 0 };
    car.vel = { x: 0, y: 0 };
    car.angle = 0;
    car.surface = surface;
    car.stun = 0;
    car.flyMul = fly;
    car.boostMul = boost;
    car.speedMul = dmg;
    let m = 0, at05 = 0;
    for (let t = 0; t < 14; t += DT) {
      stepCar(car, { ...NO_INPUT, throttle: true }, DT, mods);
      m = Math.max(m, speedOf(car));
      if (Math.abs(t - 0.5) < DT / 2) at05 = speedOf(car);
    }
    return { m, at05 };
  };
  const base = top(1, 1, 1);
  near("top speed ×1.10 in flight", top(1.1, 1, 1).m / base.m, 1.1, 0.01);
  near("acceleration ×1.10 in flight", top(1.1, 1, 1).at05 / base.at05, 1.1, 0.06);
  near("flight × turbo", top(1.1, 1.5, 1).m / base.m, 1.65, 0.02);
  near("flight × turbo × damage (0.6)", top(1.1, 1.5, 0.6).m / base.m, 0.99, 0.02);
  near("flight × off-road limit", top(1.1, 1, 1, "offtrack").m / top(1, 1, 1, "offtrack").m, 1.1, 0.01);
  console.log(`  multipliers: ×1.10 flight · ×1.65 with turbo · ×0.99 with turbo and 25 % health (${(1.1 * 1.5 * 0.6).toFixed(2)})`);
}

// ---------- (c) integration: a Jet in a race ----------
const PLAYER = { model: "jet" as const, skin: "factory" as const, level: 1 };
/** A one-car race with the Jet on the green light. */
function solo(mode: ThemeId, seed = 1): { race: Race; car: Car } {
  const race = createRace(mode, PLAYER, seed);
  race.cars.splice(1);
  while (race.phase === "countdown") stepRace(race, NO_INPUT, DT);
  return { race, car: race.cars[0] };
}
/** Puts the car in the air, wings open, full tank: a stand-in for a few seconds of Shift. */
function lift(race: Race, car: Car) {
  const s = race.flight!.st(car);
  s.mode = "fly";
  s.alt = FLY.MAX_ALT;
  s.wing = 1;
  s.energy = FLY.MAX_ENERGY;
  car.alt = FLY.MAX_ALT;
  car.flyMul = 1.1;
}
const FLYING: typeof NO_INPUT = { ...NO_INPUT, fly: true };
const AT = (x: number, y: number) => ({ x, y });
/** Teleports a car and keeps its centre-line index in step, as a real move would (the line zones read it). */
function tp(race: Race, car: Car, x: number, y: number) {
  car.pos = { x, y };
  car.lastIndex = locate(race.track, car.pos).index;
}
{
  // The bots and a normal car never fly; a Racerz GT has no flight at all.
  const gt = createRace("desert", { model: "gt", skin: "factory", level: 1 }, 3);
  check(gt.flight === null, "a Racerz GT has a flight controller");
  const jetRace = createRace("desert", PLAYER, 3);
  check(jetRace.flight !== null, "the Jet has no flight controller");
  let maxBotAlt = 0, maxGtAlt = 0;
  while (jetRace.time < 30) {
    stepRace(jetRace, { ...aiInput(jetRace, jetRace.cars[0], DT, false), fly: true }, DT, true); // Shift held for the whole race, bots on their own
    for (const c of jetRace.cars.slice(1)) maxBotAlt = Math.max(maxBotAlt, c.alt);
  }
  while (gt.time < 20) {
    stepRace(gt, { ...NO_INPUT, throttle: true, fly: true }, DT);
    for (const c of gt.cars) maxGtAlt = Math.max(maxGtAlt, c.alt);
  }
  check(maxBotAlt === 0, `a bot flew (${maxBotAlt} m)`);
  check(maxGtAlt === 0 && gt.cars.every((c) => c.flyMul === 1), "Shift made a Racerz GT fly");
  console.log("  only the human's Jet flies: bots at 0 m for the whole race, a GT ignores Shift");
}
{
  // Hay bales: over them in the air, stopped by them on the ground.
  const run = (air: boolean) => {
    const { race, car } = solo("countryside");
    const bale = race.scene.bumpers![10];
    tp(race, car, bale.x - 120, bale.y);
    car.angle = 0;
    car.vel = { x: 600, y: 0 };
    if (air) lift(race, car);
    const hits0 = car.hits;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < 0.45 / DT; i++) {
      stepRace(race, air ? { ...FLYING, throttle: true } : { ...NO_INPUT, throttle: true }, DT);
      minX = Math.min(minX, car.pos.x);
      maxX = Math.max(maxX, car.pos.x);
    }
    return { crossed: car.pos.x > bale.x + 30, hits: car.hits - hits0, stun: car.stun, bale, race, car, minX, maxX };
  };
  const air = run(true), ground = run(false);
  check(air.crossed && air.hits === 0 && air.car.stun === 0, `hay bale in the air: crossed ${air.crossed}, hits ${air.hits}, stun ${air.car.stun}`);
  check(!ground.crossed && ground.hits >= 1, `hay bale on the ground: crossed ${ground.crossed}, hits ${ground.hits}`);
}
{
  // Polar bear.
  const run = (air: boolean) => {
    const { race, car } = solo("northpole");
    const hz = race.hazard!;
    while (!(hz.bodies?.() ?? []).length && race.time < 120) stepRace(race, aiInput(race, car, DT, false), DT);
    const bear = (hz.bodies?.() ?? [])[0];
    if (!bear) {
      fail("no bear appeared");
      return { hits: -1, through: false };
    }
    const dx = Math.cos(bear.angle), dy = Math.sin(bear.angle);
    tp(race, car, bear.x + dx * 160, bear.y + dy * 160);
    car.angle = Math.atan2(-dy, -dx);
    car.vel = { x: -dx * 380, y: -dy * 380 };
    if (air) lift(race, car);
    const hits0 = car.hits;
    let minGap = Infinity;
    for (let i = 0; i < 1.0 / DT; i++) {
      stepRace(race, air ? { ...FLYING, throttle: true } : { ...NO_INPUT, throttle: true }, DT);
      const b = (hz.bodies?.() ?? [])[0];
      if (b) minGap = Math.min(minGap, Math.hypot(car.pos.x - b.x, car.pos.y - b.y));
    }
    return { hits: car.hits - hits0, through: minGap < 25 };
  };
  const air = run(true), ground = run(false);
  check(air.hits === 0 && air.through, `polar bear in the air: hits ${air.hits}, went through ${air.through}`);
  check(ground.hits === 1 && !ground.through, `polar bear on the ground: hits ${ground.hits}, through ${ground.through}`);
}
{
  // Other cars: no collision in the air, the usual one on the ground.
  const run = (air: boolean) => {
    const race = createRace("desert", PLAYER, 1);
    while (race.phase === "countdown") stepRace(race, NO_INPUT, DT);
    race.cars.splice(2);
    const [me, bot] = race.cars;
    const idx = 150, base = race.track.path[idx], tg = race.track.tangents[idx];
    tp(race, me, base.x, base.y);
    tp(race, bot, base.x + tg.x * 18, base.y + tg.y * 18);
    me.vel = { x: tg.x * 400, y: tg.y * 400 };
    bot.vel = { x: 0, y: 0 };
    me.angle = Math.atan2(tg.y, tg.x);
    bot.angle = me.angle;
    if (air) lift(race, me);
    race.boost.enabled = false;
    stepRace(race, air ? FLYING : NO_INPUT, DT);
    return { dv: bot.vel.x, gap: Math.hypot(bot.pos.x - me.pos.x, bot.pos.y - me.pos.y) };
  };
  const air = run(true), ground = run(false);
  check(Math.abs(air.dv) < 10 && air.gap < 40, // (the bot's own throttle adds a few u/s per step)
     `another car in the air: it was pushed (dv ${air.dv.toFixed(1)})`);
  check(ground.dv > 50, `another car on the ground: no impact (dv ${ground.dv.toFixed(1)})`);
}
{
  // Volcano: targets, bombs, pools — over them in the air, hurt on the ground.
  const run = (air: boolean, what: "bomb" | "pool") => {
    const { race, car } = solo("volcano");
    const vz = race.hazard as VolcanoHazard;
    vz.hazards.armed = false;
    race.boost.enabled = false;
    const S = 40 / 28;
    if (air) lift(race, car);
    const input = air ? FLYING : NO_INPUT;
    car.vel = { x: 0, y: 0 };
    vz.hazards.addTarget(car.pos.x / S, car.pos.y / S);
    for (let i = 0; i < (what === "bomb" ? 1.7 : 5.5) / DT; i++) {
      // keep the car where the target fell (the pool burns the car that stays in it)
      if (what === "pool") car.vel = { x: 0, y: 0 };
      stepRace(race, input, DT);
      if (what === "pool" && air) lift(race, car); // flying all the time
    }
    return vz.hazards.st(car).hp;
  };
  check(run(true, "bomb") === 100, "a bomb hurt a flying car");
  check(run(false, "bomb") === 80, "a bomb did not hurt a grounded car (control)");
  check(run(true, "pool") === 100, "a lava pool burned a flying car");
  check(run(false, "pool") <= 85, "a lava pool did not burn a grounded car (control)");
  console.log("  over the pools, targets and bombs of the volcano; hurt on the ground as before");
}
{
  // Boost pads do not fire for a car in the air.
  const run = (air: boolean) => {
    const { race, car } = solo("desert");
    const pad = race.boost.pads[0];
    tp(race, car, pad.x, pad.y);
    car.angle = pad.heading;
    car.vel = { x: Math.cos(pad.heading) * 300, y: Math.sin(pad.heading) * 300 };
    if (air) lift(race, car);
    for (let i = 0; i < 10; i++) stepRace(race, air ? FLYING : NO_INPUT, DT);
    return race.boost.isBoosting(car);
  };
  check(!run(true), "a boost pad fired under a flying car");
  check(run(false), "a boost pad did not fire for a grounded car (control)");
}
{
  // Below the wall's height a flying Jet still hits the wall: the usual bounce, and a contact (check:walls covers flying over it).
  const run = (air: boolean) => {
    const { race, car } = solo("desert");
    race.boost.enabled = false;
    const i = 60, p = race.track.path[i], t = race.track.tangents[i];
    const nx = -t.y, ny = t.x;
    tp(race, car, p.x + nx * (race.track.barrier - 60), p.y + ny * (race.track.barrier - 60));
    car.angle = Math.atan2(ny, nx);
    car.vel = { x: nx * 700, y: ny * 700 };
    if (air) {
      lift(race, car);
      race.flight!.st(car).alt = 30; // above the 20 m of "in the air", under the canyon's 60 m
      car.alt = 30;
    }
    let maxDist = 0;
    const hits0 = car.hits;
    for (let k = 0; k < 1.2 / DT; k++) {
      stepRace(race, air ? { ...FLYING, throttle: true } : { ...NO_INPUT, throttle: true }, DT);
      let best = Infinity;
      for (const q of race.track.path) best = Math.min(best, Math.hypot(q.x - car.pos.x, q.y - car.pos.y));
      maxDist = Math.max(maxDist, best);
    }
    return { maxDist, hits: car.hits - hits0, limit: race.track.barrier };
  };
  const air = run(true), ground = run(false);
  check(air.maxDist <= air.limit, `a Jet at 30 m went through the 60 m wall (${air.maxDist.toFixed(0)} > ${air.limit})`);
  check(air.hits >= 1, `a Jet that hit the wall too low did not get a contact (${air.hits})`);
  check(ground.hits >= 1 && ground.maxDist <= ground.limit, `the barrier on the ground: hits ${ground.hits}`);
}
{
  // Under a covered section the ceiling stays opaque for a Jet overhead (so the high layer shows it flying over).
  const { race, car } = solo("desert");
  const cover = race.track.covers[0];
  const idx = Math.round((cover.start + cover.end) / 2) % race.track.path.length;
  const run = (air: boolean) => {
    race.overheadOpacity = 1;
    car.pos = AT(race.track.path[idx].x, race.track.path[idx].y);
    car.vel = { x: 0, y: 0 };
    car.lastIndex = idx;
    if (air) lift(race, car);
    else {
      race.flight!.st(car).alt = 0;
      car.alt = 0;
    }
    for (let i = 0; i < 0.6 / DT; i++) {
      car.pos = AT(race.track.path[idx].x, race.track.path[idx].y);
      car.lastIndex = idx;
      stepRace(race, air ? FLYING : NO_INPUT, DT);
    }
    return race.overheadOpacity;
  };
  check(run(true) > 0.9, "the bridge fades out over a Jet flying above it");
  check(run(false) < 0.5, "the bridge no longer fades over a grounded car (control)");
}

// ---------- (d) the line, the zones, the start ----------
{
  // Never across the line in the air, at plain and at turbo speed, and the lap is counted as usual.
  for (const mode of ["desert", "countryside", "northpole", "volcano"] as ThemeId[]) {
    for (const turbo of [false, true]) {
      const { race, car } = solo(mode);
      const n = race.track.path.length;
      race.boost.enabled = false;
      const idx = n - 230; // ~2 500 px before the line
      car.pos = { ...race.track.path[idx] };
      const tg = race.track.tangents[idx];
      car.angle = Math.atan2(tg.y, tg.x);
      car.vel = { x: tg.x * 600, y: tg.y * 600 };
      car.lastIndex = idx;
      car.progress = idx;
      race.guard!.st(car).next = race.guard!.gates.length; // every checkpoint of the lap already crossed
      if (turbo) race.boost.activate(car);
      let crossedAlt = -1, tookOff = false, warned = false, vmax = 0;
      const lap0 = car.lap;
      for (let i = 0; i < 8 / DT && car.lap === lap0; i++) {
        stepRace(race, { ...aiInput(race, car, DT, false), throttle: true, fly: true }, DT);
        if (race.boost.isBoosting(car) && turbo) race.boost.activate(car); // keep the turbo up all along
        tookOff ||= car.alt >= AIRBORNE_ALT;
        warned ||= race.flight!.st(car).warn > 0;
        vmax = Math.max(vmax, speedOf(car));
        if (car.lap > lap0) crossedAlt = car.alt;
      }
      check(car.lap === lap0 + 1, `${mode}${turbo ? " (turbo)" : ""}: the lap was not counted (lap ${car.lap})`);
      check(crossedAlt === 0, `${mode}${turbo ? " (turbo)" : ""}: crossed the line ${crossedAlt.toFixed(1)} m up`);
      check(tookOff, `${mode}${turbo ? " (turbo)" : ""}: never took off on the run-up (the check proves nothing)`);
      check(warned, `${mode}${turbo ? " (turbo)" : ""}: no "Zone d'atterrissage" message`);
      if (mode === "desert") console.log(`  ${mode}${turbo ? " + turbo" : ""}: took off, landed on its own before the line at ${vmax.toFixed(0)} u/s, lap counted`);
    }
  }
  // The finish is detected normally too (last lap).
  {
    const { race, car } = solo("volcano");
    race.boost.enabled = false;
    const n = race.track.path.length, idx = n - 230;
    car.pos = { ...race.track.path[idx] };
    const tg = race.track.tangents[idx];
    car.angle = Math.atan2(tg.y, tg.x);
    car.vel = { x: tg.x * 600, y: tg.y * 600 };
    car.lastIndex = idx;
    car.lap = TOTAL_LAPS - 1;
    car.progress = (TOTAL_LAPS - 1) * n + idx;
    race.guard!.st(car).next = race.guard!.gates.length;
    let alt = -1;
    for (let i = 0; i < 8 / DT && car.finishTime === null; i++) stepRace(race, { ...aiInput(race, car, DT, false), throttle: true, fly: true }, DT);
    alt = car.alt;
    check(car.finishTime !== null && alt === 0, `finish: finishTime ${car.finishTime}, altitude ${alt}`);
    check(race.phase === "finished", "the race did not end when the Jet finished");
  }
}
{
  // No takeoff within 120 px of the line (either side), nor during the countdown; a flying car entering such a zone lands.
  const { race, car } = solo("desert");
  const n = race.track.path.length;
  const stand = (idx: number) => {
    car.pos = { ...race.track.path[idx] };
    car.vel = { x: 0, y: 0 };
    car.lastIndex = idx;
  };
  const press = (s: number) => {
    for (let i = 0; i < s / DT; i++) stepRace(race, FLYING, DT);
  };
  const flight = race.flight!;
  const s = flight.st(car);
  race.boost.enabled = false;
  stand(3); // ~30 px after the line
  check(distToLine(race.track, car) < FLY.NO_FLY_START, "test setup: not in the zone after the line");
  press(0.6);
  check(s.mode === "ground" && s.alt === 0 && s.warn > 0, `took off 30 px after the line (mode ${s.mode})`);
  s.warn = 0;
  stand(n - 4);
  press(0.6);
  check(s.mode === "ground" && s.alt === 0 && s.warn > 0, `took off 40 px before the line (mode ${s.mode})`);
  stand(Math.round(n / 4)); // far from the line
  press(0.6);
  check(s.mode !== "ground", "no takeoff far from the line (control)");
  // Countdown.
  const cd = createRace("desert", PLAYER, 1);
  for (let i = 0; i < 2 * 120; i++) stepRace(cd, FLYING, DT);
  check(cd.phase === "countdown" && cd.flight!.st(cd.cars[0]).mode === "ground", "took off during the countdown");
  console.log("  no takeoff within 120 px of the line, nor during the countdown");
}
{
  // A mode's own no-fly spot: a flying car that enters it lands, the message shows, no takeoff inside.
  const { race, car } = solo("desert");
  race.boost.enabled = false;
  const idx = Math.round(race.track.path.length / 4), p = race.track.path[idx], t = race.track.tangents[idx];
  const zone = { x: p.x + t.x * 900, y: p.y + t.y * 900 };
  race.scene = { ...race.scene, noFly: (x: number, y: number) => Math.hypot(x - zone.x, y - zone.y) < 220 };
  car.pos = { ...p };
  car.angle = Math.atan2(t.y, t.x);
  car.lastIndex = idx;
  car.vel = { x: t.x * 200, y: t.y * 200 };
  lift(race, car);
  let lastAlt = 80, warned = false;
  for (let i = 0; i < 6 / DT; i++) {
    stepRace(race, { ...aiInput(race, car, DT, false), throttle: true, fly: true }, DT);
    warned ||= race.flight!.st(car).warn > 0;
    lastAlt = car.alt;
    if (Math.hypot(car.pos.x - zone.x, car.pos.y - zone.y) < 150) break;
  }
  check(warned && lastAlt < 80, `the no-fly spot did not bring the car down (alt ${lastAlt.toFixed(1)}, warned ${warned})`);
}

// ---------- (e) drawing helpers and scale ----------
near("Jet length vs a normal car", JET_SCALE * 66, 40 * 1.25, 1e-9);
check(Math.abs(BOOST.MULT - 1.5) < 1e-9, "the turbo's multiplier moved");
check(PHYS.maxSpeed === 560 && PHYS.accel === 520, "base physics moved");

console.log(failed ? "\ncheck:flight FAILED" : "\ncheck:flight OK");
process.exit(failed ? 1 : 0);
