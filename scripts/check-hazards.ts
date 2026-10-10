// Volcano aimed-bomb checks: fairness, damage, pools and bots. Run with `pnpm check:hazards`
// (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
//
//   (a) fairness over seeded all-AI races: no target in the first 8 s, only between 2.2 s and 7 s of the
//       eruption cycle, never within 90 (design) units of a car or 150 of the start / finish, at most 3
//       at once, 1.2 s or more between two targets, every target warned for the full 1.5 s, and no
//       damage that is not a bomb on a warned target or a burning pool; HP only ever goes down, never
//       below 0, and every car still finishes without stalling;
//   (b) a bomb on the player: -20 HP, shake, red screen, "-20", a pool left behind; 1 s of invulnerability
//       to bombs afterwards; the pool burns 5 HP per second for 9 s then is harmless;
//   (c) HP states: speed -40 % at 25 %, smoke from 50 %; at 0 HP a car BLOWS UP (health.ts): a blast for the views and the
//       sound, it stops, never finishes and ranks behind every car still racing, it can lose nothing more, and when it is
//       the player's the race is over for them; bombs and pools never count as contacts;
//   (d) the decorative eruption bombs hurt nobody, and the race is identical with the aimed bombs off;
//   (e) bots brake for a target in their way (and go round it when they can).

import { aiInput, createRace, standings, stepRace, TOTAL_LAPS, type Race } from "../src/game/race";
import { NO_INPUT, speedOf } from "../src/game/car";
import { HEALTH, isDestroyed } from "../src/game/health";
import { ERUPTION, HZ, HZ_SCALE as S, type VolcanoHazard } from "../src/game/modes/volcano";

const DT = 1 / 120;
const SEEDS = [1, 2, 3, 4, 5, 6];
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const near = (what: string, got: number, want: number, tol: number) => {
  if (Math.abs(got - want) > tol) fail(`${what}: ${got.toFixed(3)} (expected ${want} ± ${tol})`);
};

function newRace(seed: number): { race: Race; vz: VolcanoHazard } {
  const race = createRace("volcano", { model: "gt", skin: "factory", level: 1 }, seed);
  race.boost.enabled = false; // this check is about the bombs: speeds are measured without a turbo
  return { race, vz: race.hazard as VolcanoHazard };
}
/** Steps to the green light, so `race.time >= 0` and the hazard clock is running. */
function toGreen(race: Race) {
  while (race.phase === "countdown") stepRace(race, NO_INPUT, DT);
}
const runFor = (race: Race, seconds: number) => {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) stepRace(race, NO_INPUT, DT);
};
const hp = (_vz: VolcanoHazard, c: { hp: number }) => c.hp;
const aiRace = (race: Race, until: number) => {
  while (race.time < until && race.cars.some((c) => c.finishTime === null && !isDestroyed(c))) stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
};
/** Moves the bots far away so a scripted scene is not disturbed. */
const parkOthers = (race: Race) => race.cars.slice(1).forEach((c, i) => (c.pos = { x: c.pos.x + 6000 * (i + 1), y: c.pos.y }));

console.log("Volcano aimed-bomb checks\n");

// ---------- (a) fairness in full all-AI races ----------
{
  let totalTargets = 0, bombHits = 0, poolTicks = 0, damagedCars = 0, minGap = Infinity, minWarn = Infinity;
  for (const seed of SEEDS) {
    const { race, vz } = newRace(seed);
    const hzs = vz.hazards;
    const lost = new Map<number, number>(); // HP each car lost through damage()
    let badBombs = 0;
    const damage = hzs.damage.bind(hzs);
    hzs.damage = (car, amount, small) => {
      const before = hp(vz, car);
      damage(car, amount, small);
      lost.set(car.id, (lost.get(car.id) ?? 0) + (before - hp(vz, car)));
      if (small) poolTicks++;
      else {
        bombHits++;
        // A bomb lands only on a target that has shown its warning for the full time (it is still listed while it lands).
        if (!hzs.targets.some((t) => t.age >= HZ.WARN_TIME)) badBombs++;
      }
    };
    const born = new Map<number, number>();
    let lastBirth = -Infinity;
    const prevHp = race.cars.map(() => 100), still = race.cars.map(() => 0);
    while (race.time < 400 && race.cars.some((c) => c.finishTime === null && !isDestroyed(c))) {
      const before = hzs.targets.map((t) => t.id);
      stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
      if (hzs.targets.length > HZ.MAX_TARGETS) fail(`seed ${seed}: ${hzs.targets.length} targets at once`);
      for (const tg of hzs.targets) {
        if (born.has(tg.id)) continue;
        born.set(tg.id, race.time);
        totalTargets++;
        const t = race.time, cyc = vz.eruption.t;
        if (t < HZ.NO_HAZARD_FIRST) fail(`seed ${seed}: a target at t=${t.toFixed(2)}s (< 8 s)`);
        if (cyc < HZ.ACTIVE_FROM - 0.02 || cyc > HZ.ACTIVE_TO + 0.02) fail(`seed ${seed}: a target at ${cyc.toFixed(2)}s of the eruption (window ${HZ.ACTIVE_FROM}-${HZ.ACTIVE_TO} s)`);
        for (const c of race.cars) {
          const d = Math.hypot(c.pos.x - tg.x * S, c.pos.y - tg.y * S);
          // 8 world units of slack: a car moves up to ~6 in the step we measure after.
          if (d < HZ.MIN_SPAWN_DIST * S - 8) fail(`seed ${seed}: a target ${(d / S).toFixed(0)} units from ${c.name} (< ${HZ.MIN_SPAWN_DIST})`);
        }
        const fin = Math.hypot(race.track.path[0].x - tg.x * S, race.track.path[0].y - tg.y * S) / S;
        if (fin < HZ.SAFE_FINISH_DIST - 1) fail(`seed ${seed}: a target ${fin.toFixed(0)} units from the start / finish (< ${HZ.SAFE_FINISH_DIST})`);
        if (lastBirth > -Infinity) minGap = Math.min(minGap, t - lastBirth);
        lastBirth = t;
      }
      // Warned for the full 1.5 s: a target is removed only once its age reached WARN_TIME.
      for (const id of before) {
        if (!hzs.targets.some((t) => t.id === id)) minWarn = Math.min(minWarn, race.time - (born.get(id) ?? race.time));
      }
      race.cars.forEach((c, i) => {
        const h = hp(vz, c);
        if (h > prevHp[i]) fail(`seed ${seed}: ${c.name} gained HP (${prevHp[i]} → ${h})`);
        if (h < 0) fail(`seed ${seed}: ${c.name} below 0 HP`);
        prevHp[i] = h;
        still[i] = c.finishTime === null && !isDestroyed(c) && Math.abs(speedOf(c)) < 5 ? still[i] + DT : 0;
        if (still[i] > 5) {
          fail(`seed ${seed}: ${c.name} stayed almost still for over 5 s (t=${race.time.toFixed(1)}s)`);
          still[i] = -1e9;
        }
      });
    }
    if (badBombs) fail(`seed ${seed}: ${badBombs} bomb hit(s) with no warned target landing`);
    for (const c of race.cars) {
      if (100 - hp(vz, c) !== (lost.get(c.id) ?? 0)) fail(`seed ${seed}: ${c.name} HP ${hp(vz, c)} does not match the damage dealt (${lost.get(c.id) ?? 0})`);
      if (hp(vz, c) < 100) damagedCars++;
      if (c.finishTime === null && !isDestroyed(c)) fail(`seed ${seed}: ${c.name} did not finish ${TOTAL_LAPS} laps`);
      if (isDestroyed(c) && c.hp !== 0) fail(`seed ${seed}: ${c.name} blew up with ${c.hp} HP left`);
    }
    console.log(`  seed ${seed}: race ${race.time.toFixed(0)}s · ${born.size} targets · HP ${race.cars.map((c) => hp(vz, c)).join("/")} · contacts ${race.cars.map((c) => c.hits).join("/")}`);
  }
  console.log(`  total ${totalTargets} targets · ${bombHits} bomb hits · ${poolTicks} pool ticks · cars damaged ${damagedCars} · min gap ${Number.isFinite(minGap) ? minGap.toFixed(2) : "-"}s · min warning ${Number.isFinite(minWarn) ? minWarn.toFixed(2) : "-"}s`);
  if (totalTargets < SEEDS.length * 3) fail(`only ${totalTargets} targets over ${SEEDS.length} races: too few`);
  if (Number.isFinite(minGap) && minGap < HZ.SPAWN_MIN - 2 * DT) fail(`two targets only ${minGap.toFixed(2)}s apart (< ${HZ.SPAWN_MIN} s)`);
  if (minWarn < HZ.WARN_TIME - 2 * DT) fail(`a bomb landed ${minWarn.toFixed(2)}s after its target appeared (< ${HZ.WARN_TIME} s)`);
}

// ---------- (b) a bomb on the player: damage, effects, invulnerability, pool ----------
{
  const { race, vz } = newRace(21);
  const hzs = vz.hazards, p = race.cars[0];
  hzs.armed = false; // only the targets placed here
  toGreen(race);
  parkOthers(race);
  runFor(race, 0.5);
  const x0 = p.pos.x / S, y0 = p.pos.y / S;
  hzs.addTarget(x0, y0);
  runFor(race, 0.5);
  hzs.addTarget(x0, y0); // lands 0.5 s after the first one: inside the 1 s of invulnerability
  runFor(race, HZ.WARN_TIME - 0.5 - 0.05);
  if (hp(vz, p) !== 100) fail(`the car lost HP before the bomb landed (${hp(vz, p)})`);
  let maxShake = 0, sawPopup = false;
  for (let i = 0; i < Math.round(0.3 / DT); i++) {
    stepRace(race, NO_INPUT, DT);
    const sh = vz.shake!(p.pos);
    maxShake = Math.max(maxShake, Math.hypot(sh.x, sh.y));
    if (hzs.popups.some((q) => q.text === "-20")) sawPopup = true;
  }
  if (hp(vz, p) !== 80) fail(`direct hit: HP ${hp(vz, p)} (expected 80)`);
  if (maxShake < 1) fail(`direct hit: no camera shake (max ${maxShake.toFixed(2)})`);
  if (Math.abs(p.hurtAt - race.time) > 0.6) fail(`direct hit: the red screen's clock was not stamped (hurtAt ${p.hurtAt.toFixed(2)}, now ${race.time.toFixed(2)})`);
  if (!sawPopup) fail('direct hit: no "-20" shown');
  if (race.cues.filter((c) => c.kind === "thud").length < 1) fail("no impact sound requested");
  runFor(race, 0.4); // the second bomb lands 0.5 s after the first
  if (hzs.targets.length) fail("the second target is still there");
  if (hp(vz, p) !== 80) fail(`a second bomb 0.5 s after the first changed HP to ${hp(vz, p)} (1 s of invulnerability)`);
  if (p.hits !== 0) fail(`bombs counted as ${p.hits} contact(s)`);
  // The car sits in the pools: they burn 5 HP per second, whatever the number of pools, and stop once cooled.
  runFor(race, 14);
  const final = hp(vz, p);
  if (final > 80 - 5 * 7 || final < 80 - 5 * 11) fail(`pool damage: HP ${final} after the pools cooled (expected about ${80 - 45})`);
  runFor(race, 3);
  if (hp(vz, p) !== final) fail("a cooled pool still hurts");
  if (hzs.pools.length) fail(`${hzs.pools.length} pool(s) still there after cooling`);
  if (p.hits !== 0) fail(`pools counted as ${p.hits} contact(s)`);
  console.log(`  direct hit 100 → 80, shake ${maxShake.toFixed(1)}, red screen stamped, pools then left HP at ${final} (${(80 - final) / 5} ticks of 5)`);

  // After the invulnerability a bomb hurts again.
  const x1 = p.pos.x / S, y1 = p.pos.y / S;
  hzs.addTarget(x1, y1);
  runFor(race, HZ.WARN_TIME + 0.05);
  if (hp(vz, p) !== final - 20) fail(`a bomb after the invulnerability: HP ${hp(vz, p)} (expected ${final - 20})`);

  // A target nobody is near hurts nobody.
  const h = hp(vz, p);
  hzs.addTarget(x1 + 400, y1 + 400);
  runFor(race, HZ.WARN_TIME + 0.05);
  if (hp(vz, p) < h - 5) fail("a bomb far from the car hurt it");
}

// ---------- (c) HP states and the explosion ----------
{
  const topSpeed = (setHp: number) => {
    const { race, vz } = newRace(31);
    vz.hazards.armed = false;
    const p = race.cars[0];
    toGreen(race);
    parkOthers(race);
    if (setHp < 100) vz.hazards.damage(p, 100 - setHp, false);
    let top = 0;
    for (let i = 0; i < Math.round(10 / DT); i++) {
      // Steered by the bot AI, full throttle: only the speed cap matters.
      stepRace(race, { ...aiInput(race, p, DT, false), throttle: true, brake: false }, DT);
      top = Math.max(top, speedOf(p));
    }
    return { top, mul: p.speedMul, smoke: vz.hazards.puffs.length };
  };
  const full = topSpeed(100), half = topSpeed(50), low = topSpeed(25);
  console.log(`  top speed · 100 HP ${full.top.toFixed(0)} · 50 HP ${half.top.toFixed(0)} · 25 HP ${low.top.toFixed(0)}`);
  near("speedMul at 50 %", half.mul, 1, 1e-9);
  near("speedMul at 25 %", low.mul, HEALTH.LOW_SLOW, 1e-9);
  if (low.top > full.top * (HEALTH.LOW_SLOW + 0.05)) fail(`at 25 % the car still reaches ${(low.top / full.top).toFixed(2)} of full speed`);
  if (half.smoke < 1) fail("no smoke at 50 % HP");
  if (low.smoke <= half.smoke) fail(`no thicker smoke at 25 % HP (${low.smoke} vs ${half.smoke})`);

  const clean = newRace(33);
  clean.vz.hazards.armed = false;
  toGreen(clean.race);
  runFor(clean.race, 3);
  if (clean.vz.hazards.puffs.length) fail("smoke on an undamaged car");
}
{
  // 0 HP: the PLAYER's car blows up. The blast, the sound and the shake are asked for; it stops; the race is over for them; it ranks last.
  const { race, vz } = newRace(32);
  vz.hazards.armed = false;
  const p = race.cars[0];
  toGreen(race);
  parkOthers(race);
  runFor(race, 1);
  for (let i = 0; i < 600; i++) stepRace(race, { ...aiInput(race, p, DT, false), throttle: true, brake: false }, DT); // up to speed, on the road
  const speed0 = speedOf(p);
  const hits0 = p.hits;
  vz.hazards.damage(p, 100, false);
  vz.hazards.damage(p, 20, false);
  vz.hazards.damage(p, 5, true);
  if (p.hp !== 0) fail(`a car at 0 HP changed HP (${p.hp})`);
  if (p.destroyedAt !== null) fail("the car blew up before the next step");
  stepRace(race, { ...aiInput(race, p, DT, false), throttle: true }, DT);
  if (p.destroyedAt === null) fail("a car at 0 HP did not blow up");
  if (race.blasts.length !== 1 || race.blasts[0].carId !== p.id || race.blasts[0].power !== 1) fail(`blast list: ${JSON.stringify(race.blasts)}`);
  if (!race.cues.some((c) => c.kind === "explode")) fail("no explosion sound requested");
  if (!race.crashes.includes(1)) fail("no camera shake for the player's explosion");
  if (race.phase !== "finished") fail(`the race is not over for a destroyed player (${race.phase})`);
  runFor(race, 4);
  if (speedOf(p) > 5) fail(`the wreck is still moving at ${speedOf(p).toFixed(0)} u/s (was ${speed0.toFixed(0)})`);
  if (p.finishTime !== null) fail("a destroyed car finished");
  if (standings(race)[race.cars.length - 1] !== p) fail("the destroyed player does not rank last");
  if (p.hp !== 0 || p.hits !== hits0) fail(`a wreck lost points or counted contacts (hp ${p.hp}, hits ${p.hits - hits0})`);
  console.log(`  player at 0 HP: blast, sound, shake, stopped (${speed0.toFixed(0)} → ${speedOf(p).toFixed(0)} u/s), race over, ranked last, no contact counted`);
}
{
  // A BOT at 0 HP blows up too: it never finishes, it ranks behind the cars still racing, and the race goes on for everyone else.
  const { race, vz } = newRace(35);
  vz.hazards.armed = false;
  const p = race.cars[0], bot = race.cars[2];
  toGreen(race);
  runFor(race, 2);
  vz.hazards.damage(bot, 100, false);
  while (race.time < 900 && p.finishTime === null) stepRace(race, aiInput(race, p, DT, false), DT);
  if (!isDestroyed(bot)) fail("a bot at 0 HP did not blow up");
  if (bot.finishTime !== null) fail("a destroyed bot finished");
  if (p.finishTime === null) fail("the player could not finish with a bot blown up");
  const order = standings(race);
  if (order[order.length - 1] !== bot) fail(`the destroyed bot ranks ${order.indexOf(bot) + 1}, not last`);
  if (race.blasts.length > 8) fail(`${race.blasts.length} blasts kept`);
  console.log(`  a bot at 0 HP blows up (never finishes, ranks last); the player finished in ${(p.finishTime ?? 0).toFixed(0)}s · contacts ${p.hits}`);
  // A blown-up car is solid for nobody: a car driven through its wreck is not bounced or counted.
  const r2 = newRace(36);
  r2.vz.hazards.armed = false;
  const a = r2.race.cars[0], b = r2.race.cars[1];
  toGreen(r2.race);
  runFor(r2.race, 1);
  r2.vz.hazards.damage(b, 100, false);
  runFor(r2.race, 0.1);
  // The wreck lies on the road, a car comes up behind it at speed: it drives through (nothing solid, nothing counted).
  const tr = r2.race.track, ib = 120, tb = tr.tangents[ib], ia = ib - 12;
  b.pos = { ...tr.path[ib] };
  b.vel = { x: 0, y: 0 };
  a.pos = { ...tr.path[ia] };
  a.angle = Math.atan2(tr.tangents[ia].y, tr.tangents[ia].x);
  a.vel = { x: tb.x * 400, y: tb.y * 400 };
  a.lastIndex = ia;
  let slowest = Infinity;
  const before = a.hits;
  for (let i = 0; i < 90; i++) {
    stepRace(r2.race, { ...aiInput(r2.race, a, DT, false), throttle: true }, DT);
    slowest = Math.min(slowest, speedOf(a));
  }
  if (a.hits !== before) fail("driving through a wreck counted a contact");
  if (slowest < 300) fail(`a car driving through a wreck was slowed to ${slowest.toFixed(0)} u/s`);
}

// ---------- (d) decorative bombs hurt nobody; identical race with the aimed bombs off ----------
{
  const finish = (eruptionOnly: boolean) => {
    const { race, vz } = newRace(9);
    vz.hazards.armed = false;
    if (eruptionOnly) {
      // The same race with a hazard that only advances the decorative eruption.
      race.hazard = { eruption: vz.eruption, draw: () => {}, step: (w: Parameters<VolcanoHazard["step"]>[0], dt: number) => void (w.time >= 0 && vz.eruption.update(dt)) } as unknown as VolcanoHazard;
    }
    aiRace(race, 240);
    return { sig: race.cars.map((c) => `${c.finishTime?.toFixed(3)}:${c.hits}`).join(" "), hp: race.cars.map((c) => hp(vz, c)) };
  };
  const a = finish(false), b = finish(true);
  console.log(`  eruption only vs aimed bombs disarmed: ${a.sig === b.sig ? "identical" : "DIFFERENT"} · HP ${a.hp.join("/")}`);
  if (a.sig !== b.sig) fail(`the disarmed hazards changed the race: ${a.sig} vs ${b.sig}`);
  if (a.hp.some((h) => h !== 100)) fail(`the decorative eruption hurt someone: HP ${a.hp.join("/")}`);
  // Cars parked at the foot of the cone while it erupts for 60 s lose nothing.
  const { race, vz } = newRace(10);
  vz.hazards.armed = false;
  toGreen(race);
  race.cars.forEach((c, i) => (c.pos = { x: 1500 + 60 * i, y: 1150 }));
  runFor(race, 60);
  if (race.cars.some((c) => hp(vz, c) !== 100)) fail("cars parked at the crater were hurt by decorative bombs");
  if (vz.eruption.spawned.bombs < 500) fail(`the eruption barely threw bombs (${vz.eruption.spawned.bombs}): the check proves nothing`);
  near("eruption cycle", ERUPTION.cycle, 10.5, 1e-9);
}

// ---------- (e) bots brake before a target ----------
{
  let slowed = 0, faster = 0, dodged = 0, stillIn = 0, trials = 0, ratioSum = 0;
  for (const seed of SEEDS) {
    for (const botIndex of [1, 2, 3]) {
      const run = (withTarget: boolean) => {
        const { race, vz } = newRace(seed);
        vz.hazards.armed = false;
        toGreen(race);
        aiRace(race, 6);
        const bot = race.cars[botIndex];
        // A target on the bot's own line, about as far ahead as it travels during the warning.
        const n = race.track.path.length;
        let i = bot.lastIndex, d = 0;
        const reach = Math.max(HZ.AHEAD_MAX * S, speedOf(bot) * HZ.WARN_TIME);
        while (d < reach) {
          const a = race.track.path[i], b = race.track.path[(i + 1) % n];
          d += Math.hypot(b.x - a.x, b.y - a.y);
          i = (i + 1) % n;
        }
        const spot = race.track.path[i];
        if (withTarget) vz.hazards.addTarget(spot.x / S, spot.y / S);
        let minDist = Infinity, speed = 0;
        for (let k = 0; k < Math.round(HZ.WARN_TIME / DT) + 2; k++) {
          stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
          minDist = Math.min(minDist, Math.hypot(bot.pos.x - spot.x, bot.pos.y - spot.y));
          speed = speedOf(bot);
        }
        return { minDist, speed };
      };
      const ctl = run(false), tgt = run(true);
      trials++;
      const hitR = HZ.TARGET_R * S + 17 * 0.8;
      ratioSum += tgt.speed / ctl.speed;
      if (tgt.speed < ctl.speed * 0.9) slowed++;
      if (tgt.speed > ctl.speed * 1.02) faster++;
      if (ctl.minDist < hitR && tgt.minDist >= hitR) dodged++;
      if (tgt.minDist < hitR) stillIn++;
    }
  }
  console.log(`  bots (${trials} trials): slowed ${slowed} · dodged what they would have hit ${dodged} · still in the target ${stillIn} · mean speed ${((100 * ratioSum) / trials).toFixed(0)} % of the control`);
  if (slowed < trials * 0.6) fail(`only ${slowed}/${trials} bots slowed down for a target`);
  if (faster > trials * 0.1) fail(`${faster}/${trials} bots went faster with a target ahead`);
  if (ratioSum / trials > 0.9) fail(`bots kept ${((100 * ratioSum) / trials).toFixed(0)} % of their speed near a target (expected clearly less)`);
}

console.log(failed ? "\ncheck:hazards FAILED" : "\ncheck:hazards OK");
process.exit(failed ? 1 : 0);
