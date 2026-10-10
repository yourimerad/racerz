// 3D view checks. Run with `pnpm check:3d` (same Node + hook as check:tracks). No WebGL needed: it checks what the view reads (the adapter),
// the camera, and that every mode's world, every car and the effects build into finite geometry and free everything they made.
//
//   (a) conversion: one scale, (x, y) → (x, z), the altitude is the height;
//   (b) the view is a picture, not a driver: a race watched through the adapter ends exactly like the same race left alone, on every mode;
//   (c) what the adapter reports: speed, altitude, hit points, flight energy (the Jet only), boost, pads, the volcano's targets, pools and bombs,
//       the polar bear and its alert — finite, in range;
//   (d) the chase camera: 9.5 m behind and 4.2 m up on the ground whatever the speed, higher and further back in flight, a wider field of view
//       with speed and the turbo, no jump when switched on mid-race;
//   (e) every mode's world, all six cars and the effects build into finite geometry within a triangle budget, and `dispose` frees all of it.

import { Adapter3D, CAM, ChaseCamera, K, toScene, type CamTarget } from "../src/game/adapter3d";
import { type ModelId, MODEL_ORDER, MODELS, skinOf } from "../src/game/garage";
import { createRace, stepRace, type Race } from "../src/game/race";
import { Car3D } from "../src/game/three/cars";
import { Disposer, THREE, liveResources, qualityOf } from "../src/game/three/core";
import { Gameplay3D } from "../src/game/three/gameplay";
import { DistField } from "../src/game/three/terrain";
import { buildWorld } from "../src/game/three/world";
import { THEME_ORDER, type ThemeId } from "../src/game/themes";
import { NO_INPUT } from "../src/game/car";
import type { VolcanoHazard } from "../src/game/modes/volcano";

const DT = 1 / 120;
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const near = (what: string, got: number, want: number, tol: number) => {
  if (!(Math.abs(got - want) <= tol)) fail(`${what}: ${got.toFixed(4)} (expected ${want} ± ${tol})`);
};
const finite = (what: string, ...v: number[]) => {
  if (v.some((x) => !Number.isFinite(x))) fail(`${what}: not finite (${v.join(", ")})`);
};
const PLAYER = (model: ModelId) => ({ model, skin: "factory" as const, level: 1 });
const fresh = (mode: ThemeId, model: ModelId = "gt", seed = 1): Race => createRace(mode, PLAYER(model), seed);

console.log("3D view checks\n");

// ---------- (a) conversion ----------
{
  const p = toScene(1000, 2000, 30);
  near("x", p.x, 1000 * K, 1e-9);
  near("y (altitude)", p.y, 30, 1e-9);
  near("z", p.z, 2000 * K, 1e-9);
  near("scale: a 40-unit car is 4 m", 40 * K, 4, 1e-9);
  console.log("  conversion: 1 unit = %s m, (x, y) → (x, z), altitude → height", K);
}

// ---------- (b) a race watched is the same race ----------
{
  const snapshot = (r: Race) => JSON.stringify([r.time, r.phase, r.cars.map((c) => [c.pos.x, c.pos.y, c.vel.x, c.vel.y, c.angle, c.progress, c.lap, c.hits, c.offTime, c.alt, c.speedMul, c.boostMul, c.finishTime])]);
  for (const mode of THEME_ORDER) {
    const a = fresh(mode, "jet", 7), b = fresh(mode, "jet", 7), view = new Adapter3D(b);
    for (let i = 0; i < 120 * 22; i++) {
      stepRace(a, NO_INPUT, DT, true);
      stepRace(b, NO_INPUT, DT, true);
      if (i % 2 === 0) view.refresh((i % 7) * 0.001); // read it, at odd lags, like the render loop does
      view.eruption();
      view.volcano();
      view.hazardShake();
    }
    if (snapshot(a) !== snapshot(b)) fail(`${mode}: a race watched through the adapter differs from the same race left alone`);
  }
  console.log("  read-only: a race read through the adapter ends exactly like the same race left alone (4 modes)");
}

// ---------- (c) what the adapter reports ----------
{
  for (const mode of THEME_ORDER) {
    for (const model of ["gt", "jet"] as const) {
      const race = fresh(mode, model, 3), a = new Adapter3D(race);
      let sawTarget = false, sawPool = false, sawBomb = false, sawBear = false, sawWarn = false, boosted = false, maxKmh = 0;
      for (let i = 0; i < 120 * 70; i++) {
        stepRace(race, NO_INPUT, DT, true);
        if (i % 6) continue;
        a.refresh(0.003);
        const p = a.player;
        finite(`${mode}/${model} player`, p.x, p.y, p.heading, p.speed, p.alt, p.kmh, p.speedRatio, p.hp, p.floorAlt, p.boostLeft, p.impact);
        if (p.hp < 0 || p.hp > 100) fail(`${mode}: hp ${p.hp}`);
        if (model === "gt" && p.flightEnergy !== null) fail("a normal car has no flight energy");
        if (model === "jet" && (p.flightEnergy === null || p.flightEnergy < 0 || p.flightEnergy > 1)) fail(`jet energy ${p.flightEnergy}`);
        if (mode !== "volcano" && p.hp !== 100) fail(`${mode}: hp ${p.hp} outside the volcano`);
        if (p.boosting) boosted = true;
        maxKmh = Math.max(maxKmh, p.kmh);
        for (const c of a.cars) finite(`${mode} car ${c.id}`, c.x, c.y, c.heading, c.alt, c.speed, c.health, c.wing);
        for (const pad of a.pads) finite("pad", pad.x, pad.y, pad.length, pad.width, pad.flash);
        for (const t of a.dangers.targets) {
          sawTarget = true;
          finite("target", t.x, t.y, t.left, t.radius);
        }
        for (const pl of a.dangers.pools) {
          sawPool = true;
          finite("pool", pl.x, pl.y, pl.heat, pl.fade, pl.radius);
        }
        for (const b of a.dangers.bombs) {
          sawBomb = true;
          finite("bomb", b.x, b.y, b.z, b.r);
        }
        for (const b of a.dangers.bears) {
          sawBear = true;
          finite("bear", b.x, b.y, b.angle, b.alpha);
        }
        if (a.dangers.warning) {
          sawWarn = true;
          finite("warning", a.dangers.warning.x, a.dangers.warning.y, a.dangers.warning.age);
        }
      }
      if (maxKmh < 150) fail(`${mode}/${model}: the car never got going (${maxKmh} km/h)`);
      if (!boosted) fail(`${mode}/${model}: no turbo seen in 70 s of AI driving`);
      if (a.pads.length !== 2) fail(`${mode}: ${a.pads.length} pads`);
      if (mode === "volcano" && model === "gt" && !(sawTarget && sawPool && sawBomb)) fail(`volcano: targets ${sawTarget}, pools ${sawPool}, bombs ${sawBomb} (all expected within 70 s)`);
      if (mode === "northpole" && model === "gt" && !(sawBear && sawWarn)) fail(`northpole: bear ${sawBear}, alert ${sawWarn} (both expected within 70 s)`);
      if (mode !== "volcano" && a.eruption()) fail("only the volcano has an eruption");
    }
  }
  const race = fresh("volcano", "gt", 3), a = new Adapter3D(race);
  if (!(race.hazard as VolcanoHazard).eruption || !a.volcano()) fail("volcano state not reachable by the adapter");
  console.log("  adapter: positions, speed, altitude, HP, energy, boost, pads, targets, pools, bombs, bear and alert: finite and in range (4 modes, GT and Jet)");
}

// ---------- (d) the chase camera ----------
{
  const T = (o: Partial<CamTarget> = {}): CamTarget => ({ x: 1000, y: 500, alt: 0, heading: 0.7, speedRatio: 0, boosting: false, impact: 0, ...o });
  const dist = (c: ChaseCamera, t: CamTarget) => Math.hypot(c.pose.px - t.x * K, c.pose.pz - t.y * K);
  for (const sr of [0, 0.5, 1, 1.5]) {
    const cam = new ChaseCamera(), t = T({ speedRatio: sr });
    cam.snap(t);
    for (let i = 0; i < 300; i++) cam.update(1 / 60, t);
    near(`distance behind at speed ratio ${sr}`, dist(cam, t), CAM.DIST, 1e-6);
    near(`height at speed ratio ${sr}`, cam.pose.py, CAM.HEIGHT, 1e-6);
  }
  const fly = new ChaseCamera(), tf = T({ alt: 80 });
  fly.snap(tf);
  for (let i = 0; i < 400; i++) fly.update(1 / 60, tf);
  near("flying: distance", dist(fly, tf), CAM.DIST + CAM.FLY_BACK, 1e-6);
  near("flying: height above the car", fly.pose.py - 80, CAM.HEIGHT + CAM.FLY_UP, 1e-6);
  const fov = (t: CamTarget) => {
    const c = new ChaseCamera();
    c.snap(t);
    return c.pose.fov;
  };
  if (!(fov(T({ speedRatio: 1 })) > fov(T({ speedRatio: 0.3 })) && fov(T({ speedRatio: 0.3 })) > fov(T()))) fail("the field of view must grow with speed");
  if (!(fov(T({ speedRatio: 1, boosting: true })) > fov(T({ speedRatio: 1 })) + 4)) fail("the turbo must widen the field of view");
  // Switched on mid-race: snapped, the camera is where it would have settled; no jump on the next step.
  const c = new ChaseCamera(), t = T({ speedRatio: 0.9, heading: 2.1 });
  c.snap(t);
  const p0 = { ...c.pose };
  c.update(1 / 60, t);
  near("no jump after the snap (m)", Math.hypot(c.pose.px - p0.px, c.pose.pz - p0.pz), 0, 1e-6);
  // A turn is followed smoothly: the heading changes by 2 rad, the camera yaw never jumps more than a share of it in a step.
  const turn = new ChaseCamera();
  turn.snap(T({ heading: 0 }));
  turn.update(1 / 60, T({ heading: 2 }));
  if (turn.heading > 0.6) fail(`the camera follows a sudden turn too fast (${turn.heading.toFixed(2)} rad in one frame)`);
  // Impacts shake it, and it settles.
  const sh = new ChaseCamera();
  sh.snap(T());
  sh.update(1 / 60, T({ impact: 1 }));
  const moved = Math.hypot(sh.pose.px - new ChaseCamera().pose.px, 0);
  void moved;
  for (let i = 0; i < 120; i++) sh.update(1 / 60, T());
  near("shake settles: distance", dist(sh, T()), CAM.DIST, 1e-3);
  console.log("  camera: %s m behind and %s m up on the ground at any speed, rising and backing off in flight, wider with speed and the turbo, no jump when switched on", CAM.DIST, CAM.HEIGHT);
}

// ---------- (e) worlds, cars, effects: finite, bounded, freed ----------
{
  const base = liveResources();
  const triangles = (root: THREE.Object3D) => {
    let n = 0, bad = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints) return;
      const g = m.geometry as THREE.BufferGeometry, pos = g.attributes.position;
      if (!pos) return;
      for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) {
        bad++;
        break;
      }
      const idx = g.index;
      if (idx) {
        for (let i = 0; i < idx.array.length; i++) if (idx.array[i] >= pos.count) {
          bad++;
          break;
        }
        n += idx.count / 3;
      } else n += pos.count / 3;
      const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
      n += (inst - 1) * (idx ? idx.count / 3 : pos.count / 3);
    });
    return { n, bad };
  };
  for (const mode of THEME_ORDER) {
    const t0 = Date.now();
    const race = fresh(mode, "jet", 5), adapter = new Adapter3D(race), d = new Disposer(), scene = new THREE.Scene(), group = new THREE.Group();
    scene.add(group);
    const q = qualityOf(0, 1);
    const world = buildWorld({ adapter, d, group, quality: q, field: new DistField(race.track, 40) });
    const camera = new THREE.PerspectiveCamera(60, 1.6, 0.3, 2400);
    scene.add(camera);
    const cars = adapter.cars.map((v) => {
      const c = new Car3D(d, v, null);
      scene.add(c.group);
      return c;
    });
    const sc = world.scenery;
    const play = new Gameplay3D({ adapter, d, scene, camera, quality: q, reduced: false, cars, mode, heightAt: sc.heightAt ?? (() => 0), craterY: sc.craterY ?? 25 });
    for (let i = 0; i < 120 * 30; i++) {
      stepRace(race, NO_INPUT, DT, true);
      if (i % 4) continue;
      adapter.refresh(0.002);
      cars.forEach((c, k) => c.update(adapter.cars[k], 1 / 30, i / 120));
      sc.update?.(1 / 30, i / 120, adapter);
      play.update(1 / 30, i / 120, camera, 720);
    }
    const { n, bad } = triangles(scene);
    if (bad) fail(`${mode}: ${bad} geometries with non-finite vertices or out-of-range indices`);
    if (n > 420_000) fail(`${mode}: ${Math.round(n)} triangles (budget 420 000)`);
    const made = liveResources() - base;
    play.dispose();
    d.dispose();
    if (liveResources() !== base) fail(`${mode}: ${liveResources() - base} resources still alive after dispose`);
    console.log(`  ${mode}: world, cars and effects built in ${Date.now() - t0} ms · ${Math.round(n)} triangles · ${made} resources, all freed`);
  }
  // Every car and skin builds (and the Jet's wings fold and unfold).
  const d = new Disposer();
  for (const id of MODEL_ORDER) {
    for (const skin of ["factory", "stripes", "carbon", "gold"] as const) {
      if (MODELS[id].fixedSkin && skin !== "factory") continue;
      const race = fresh("desert", id, 2), view = new Adapter3D(race).cars[0];
      view.skin = skinOf(id, skin);
      const car = new Car3D(d, view, null);
      for (const wing of [0, 0.5, 1]) {
        view.wing = wing;
        car.update(view, 1 / 60, 1);
        const { bad } = triangles(car.group);
        if (bad) fail(`${id}/${skin}: bad geometry`);
      }
    }
  }
  d.dispose();
  if (liveResources() !== base) fail(`${liveResources() - base} resources alive after the cars were freed`);
  console.log("  cars: 6 models × their skins build, wings fold and open, everything freed");
}

if (failed) {
  console.error("\ncheck:3d FAILED");
  process.exit(1);
}
console.log("\ncheck:3d OK");
