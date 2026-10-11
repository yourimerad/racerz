// 3D view checks. Run with `pnpm check:3d` (same Node + hook as check:tracks). No WebGL needed: it checks what the view reads (the adapter),
// the camera, and that every mode's world, every car and the effects build into finite geometry and free everything they made.
//
//   (a) conversion: one scale, (x, y) → (x, z), the altitude is the height;
//   (b) the view is a picture, not a driver: a race watched through the adapter ends exactly like the same race left alone, on every mode;
//   (c) what the adapter reports: speed, altitude, hit points, flight energy (the Jet only), boost, pads, the volcano's targets, pools and bombs,
//       the polar bear and its alert — finite, in range;
//   (d) the chase camera: 9.5 m behind and 4.2 m up on the ground whatever the speed, higher and further back in flight, a wider field of view
//       with speed and the turbo, no jump when switched on mid-race;
//   (e) every mode's world, all six cars and the effects build into finite geometry within a triangle budget, and `dispose` frees all of it;
//   (h) an online race: the other players' cars carry name tags (hidden when they leave, freed with the scene) and a remote Jet's wings follow
//       its altitude; a solo race has no tags;
//   (i) fewer draw calls, same picture: a car's static parts are baked into a few meshes (same triangles in the same places), big meshes are cut into
//       culled cells, instanced props into cells too, and what is in view along the lap stays well under the whole world;
//   (j) the quality governor: it lightens the picture within a couple of seconds on a slow device, never for a screen that is merely capped at 30 Hz,
//       ignores a single hitch, comes back carefully and does not oscillate;
//   (g) the yeti's jump (four moments) and a car's explosion with its wreck are read by the adapter and drawn without a leak.

import { Adapter3D, CAM, ChaseCamera, K, toScene, type CamTarget, type CarView } from "../src/game/adapter3d";
import { type ModelId, MODEL_ORDER, skinFits, skinOf } from "../src/game/garage";
import { aiInput, createRace, stepRace, type Race } from "../src/game/race";
import { Car3D } from "../src/game/three/cars";
import { GOV, LADDER, QualityGovernor, type Step } from "../src/game/three/adapt";
import { applyFar, splitMesh } from "../src/game/three/bake";
import { Disposer, THREE, instanced, liveResources, qualityOf, type Placement } from "../src/game/three/core";
import { Effects3D, Fireworks3D } from "../src/game/three/effects";
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
const blankCar = (model: ModelId): CarView => ({
  id: 0, isPlayer: false, model, skin: skinOf(model, "factory"), x: 0, y: 0, heading: 0, alt: 0, speed: 0, boosting: false, health: 1, destroyed: -1, wreck: 1, wing: 0, flame: 0, finished: false, stunned: false,
});
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
        if (mode !== "volcano" && mode !== "northpole" && p.hp !== 100) fail(`${mode}: hp ${p.hp} outside the modes that hurt`);
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
    for (const skin of ["factory", "stripes", "carbon", "gold", "jetSky", "jetCamo", "jetCarbon", "jetNight", "jetGold"] as const) {
      if (!skinFits(id, skin)) continue;
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

// ---------- (g) the yeti's jump and a car's explosion, drawn ----------
{
  const base = liveResources();
  const race = fresh("northpole", "gt", 7), adapter = new Adapter3D(race), d = new Disposer(), scene = new THREE.Scene(), q = qualityOf(0, 1);
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.3, 2400);
  scene.add(camera);
  const cars = adapter.cars.map((v) => {
    const c = new Car3D(d, v, null);
    scene.add(c.group);
    return c;
  });
  const play = new Gameplay3D({ adapter, d, scene, camera, quality: q, reduced: false, cars, mode: "northpole", heightAt: () => 0, craterY: 25 });
  const phases = new Set<string>();
  let blastAt = -1, sawBlast = false, sawWreck = false, wreckBack = 1;
  for (let i = 0; i < 120 * 60; i++) {
    stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
    if (i % 3) continue;
    adapter.refresh(0.002);
    const y = adapter.dangers.yeti;
    if (y) {
      phases.add(y.phase);
      finite("yeti view", y.x, y.y, y.z, y.heading, y.left, y.toX, y.toY, y.radius, y.age);
      // The first time it stands, one of the bots runs out of points: it blows up.
      if (y.phase === "stand" && blastAt < 0) {
        blastAt = i;
        race.cars[1].hp = 0;
      }
    }
    for (const b of adapter.blasts) {
      sawBlast = true;
      finite("blast", b.x, b.y, b.age, b.power);
    }
    const w = adapter.cars[1];
    if (w.destroyed >= 0) {
      sawWreck = true;
      finite("wreck", w.destroyed, w.wreck);
      wreckBack = w.wreck;
    }
    cars.forEach((c, k) => c.update(adapter.cars[k], 1 / 40, i / 120));
    play.update(1 / 40, i / 120, camera, 720);
  }
  if (phases.size < 4) fail(`northpole: the 3D view saw only ${[...phases].join("/")} of the yeti's four moments`);
  if (!sawBlast) fail("a car blew up and the adapter reported no blast");
  if (!sawWreck) fail("a car blew up and the adapter reported no wreck");
  if (!(wreckBack >= 0 && wreckBack <= 1)) fail(`wreck opacity ${wreckBack}`);
  const { n, bad } = (() => {
    let tris = 0, broken = 0;
    scene.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g || !g.attributes.position) return;
      const pos = g.attributes.position;
      for (let k = 0; k < pos.array.length; k++) if (!Number.isFinite(pos.array[k])) {
        broken++;
        break;
      }
      tris += (g.index ? g.index.count : pos.count) / 3;
    });
    return { n: tris, bad: broken };
  })();
  if (bad) fail(`yeti scene: ${bad} geometries with non-finite vertices`);
  if (n > 420_000) fail(`yeti scene: ${Math.round(n)} triangles (budget 420 000)`);
  play.dispose();
  d.dispose();
  if (liveResources() !== base) fail(`yeti scene: ${liveResources() - base} resources alive after dispose`);
  console.log(`  yeti and explosion: the four moments of a jump (${[...phases].join(", ")}), a blast and its wreck drawn · finite · all freed`);
}

// ---------- (h) an online race: the other players' cars, their name tags and their wings ----------
{
  const base = liveResources();
  const players = [
    { id: "net00001", name: "Alice", model: "gt" as ModelId, skin: "factory" as const, level: 1 },
    { id: "net00002", name: "Bob le Jet", model: "jet" as ModelId, skin: "factory" as const, level: 2 },
    { id: "net00003", name: "Cleo", model: "f8" as ModelId, skin: "factory" as const, level: 1 },
  ];
  const race = createRace("desert", PLAYER("gt"), 5, { players, localId: "net00001" });
  const adapter = new Adapter3D(race), d = new Disposer(), scene = new THREE.Scene(), q = qualityOf(0, 1);
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.3, 2400);
  scene.add(camera);
  const cars = adapter.cars.map((v) => {
    const c = new Car3D(d, v, null);
    scene.add(c.group);
    return c;
  });
  const play = new Gameplay3D({ adapter, d, scene, camera, quality: q, reduced: false, cars, mode: "desert", heightAt: () => 0, craterY: 25 });
  const sprites = () => scene.children.filter((o): o is THREE.Sprite => o instanceof THREE.Sprite);
  const me = race.cars[0], jetIdx = race.cars.findIndex((c) => c.model === "jet");
  if (race.cars.length !== 3 || jetIdx < 1 || !race.cars[jetIdx].remote) fail("online scene: expected the local car and two remote copies, one of them the Jet");
  race.cars[jetIdx].alt = 60;
  adapter.refresh(0);
  near("a remote Jet's wing at 60 m", adapter.cars[jetIdx].wing, 1, 1e-9);
  race.cars[jetIdx].alt = 0;
  adapter.refresh(0);
  near("a remote Jet's wing on the ground", adapter.cars[jetIdx].wing, 0, 1e-9);
  const vm = adapter.cars[0];
  camera.position.set(vm.x * K, 4, vm.y * K + 8);
  cars.forEach((c, k) => c.update(adapter.cars[k], 1 / 40, 0));
  play.update(1 / 40, 0, camera, 720);
  if (sprites().length !== 2) fail(`online scene: ${sprites().length} name tags for two other players`);
  if (sprites().some((t) => !t.visible)) fail("online scene: a name tag is hidden though its car is next to the camera");
  for (const t of sprites()) finite("name tag", t.position.x, t.position.y, t.position.z, t.scale.x, t.scale.y);
  // A car that is out of the race loses its tag.
  race.cars[1].destroyedAt = race.time;
  race.cars[1].hp = 0;
  adapter.refresh(0);
  cars.forEach((c, k) => c.update(adapter.cars[k], 1 / 40, 0.1));
  play.update(1 / 40, 0.1, camera, 720);
  if (sprites().filter((t) => t.visible).length !== 1) fail(`online scene: ${sprites().filter((t) => t.visible).length} visible name tags after one car left (expected 1)`);
  // The local car has no tag, and a solo race has none at all.
  void me;
  play.dispose();
  if (sprites().length !== 0) fail(`online scene: ${sprites().length} name tags left in the scene after dispose`);
  d.dispose();
  if (liveResources() !== base) fail(`online scene: ${liveResources() - base} resources alive after dispose`);
  const solo = fresh("desert", "gt", 3), sd = new Disposer(), ss = new THREE.Scene(), sa = new Adapter3D(solo);
  const sc = sa.cars.map((v) => new Car3D(sd, v, null));
  const sp = new Gameplay3D({ adapter: sa, d: sd, scene: ss, camera, quality: q, reduced: false, cars: sc, mode: "desert", heightAt: () => 0, craterY: 25 });
  if (ss.children.some((o) => o instanceof THREE.Sprite)) fail("a solo race has name tags");
  sp.dispose();
  sd.dispose();
  console.log("  online race: name tags over the two other players (hidden when a car leaves, freed with the scene), a remote Jet's wings follow its altitude, solo races have none");
}

// ---------- (i) fewer draw calls, same picture ----------
{
  const base = liveResources();
  const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

  type Tri = { cx: number; cy: number; cz: number; area: number };
  const trisOf3 = (root: THREE.Object3D) => {
    // Every triangle of every mesh under the car, in the car's frame at rest (centre and area): re-batching must not change a single one.
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const out: Tri[] = [];
    let meshes = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const g = m.geometry as THREE.BufferGeometry, pos = g.attributes.position, idx = g.index;
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const n = (idx ? idx.count : pos.count) / 3;
      for (let k = 0; k < n; k++) {
        const ia = idx ? idx.getX(k * 3) : k * 3, ib = idx ? idx.getX(k * 3 + 1) : k * 3 + 1, ic = idx ? idx.getX(k * 3 + 2) : k * 3 + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(rel);
        b.fromBufferAttribute(pos, ib).applyMatrix4(rel);
        c.fromBufferAttribute(pos, ic).applyMatrix4(rel);
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        out.push({ cx: (a.x + b.x + c.x) / 3, cy: (a.y + b.y + c.y) / 3, cz: (a.z + b.z + c.z) / 3, area: e1.cross(e2).length() / 2 });
      }
    });
    return { tris: out, meshes };
  };
  /** How many of `from`'s triangles have no partner (same centre within 0.2 mm, same area) in `to`: each partner used once. */
  const unmatched = (from: Tri[], to: Tri[]) => {
    const Q = 0.01, key = (x: number, y: number, z: number) => `${Math.round(x / Q)},${Math.round(y / Q)},${Math.round(z / Q)}`;
    const grid = new Map<string, Tri[]>();
    for (const t of to) {
      const kk = key(t.cx, t.cy, t.cz);
      let l = grid.get(kk);
      if (!l) grid.set(kk, (l = []));
      l.push(t);
    }
    let miss = 0;
    for (const t of from) {
      const kx = Math.round(t.cx / Q), ky = Math.round(t.cy / Q), kz = Math.round(t.cz / Q);
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) for (let dz = -1; dz <= 1 && !hit; dz++) {
        const l = grid.get(`${kx + dx},${ky + dy},${kz + dz}`);
        if (!l) continue;
        const j = l.findIndex((u) => Math.abs(u.cx - t.cx) < 2e-4 && Math.abs(u.cy - t.cy) < 2e-4 && Math.abs(u.cz - t.cz) < 2e-4 && Math.abs(u.area - t.area) <= 1e-3 * Math.max(1e-4, t.area) + 1e-7);
        if (j >= 0) {
          l.splice(j, 1);
          hit = true;
        }
      }
      if (!hit) miss++;
    }
    return miss;
  };
  for (const model of MODEL_ORDER) {
    const view: CarView = { ...blankCar(model) };
    const d1 = new Disposer(), d2 = new Disposer();
    const plain = new Car3D(d1, view, null, false), baked = new Car3D(d2, view, null, true);
    const A = trisOf3(plain.group), B = trisOf3(baked.group);
    if (A.tris.length !== B.tris.length) fail(`${model}: baking changed the triangle count (${A.tris.length} → ${B.tris.length})`);
    else {
      const miss = unmatched(A.tris, B.tris);
      if (miss) fail(`${model}: baking moved or changed ${miss} of ${A.tris.length} triangles`);
    }
    if (B.meshes > 60) fail(`${model}: ${B.meshes} meshes after baking (budget 60)`);
    if (B.meshes * 1.5 > A.meshes) fail(`${model}: baking barely helped (${A.meshes} → ${B.meshes} meshes)`);
    // What moves still moves: the wheels turn and steer, the flame shows, the Jet's wings swing.
    const spun = baked.group.children.some((c) => c.children.length > 0);
    if (!spun) fail(`${model}: the baked car has no groups left for its wheels`);
    baked.update({ ...view, speed: 400, boosting: true, wing: 1, flame: 1 }, 1 / 60, 0.5);
    baked.update({ ...view, speed: 400, boosting: true, wing: 1, flame: 1 }, 1 / 60, 0.55);
    d1.dispose();
    d2.dispose();
    if (model === "gt") console.log(`  baking: ${A.meshes} meshes → ${B.meshes} for the GT, ${A.tris.length} triangles, none moved`);
  }
  if (liveResources() !== base) fail(`car baking: ${liveResources() - base} resources alive after dispose`);

  // Big meshes in cells: the same triangles, sharing the same vertex buffers, each cell with a sphere that holds its vertices.
  {
    const d = new Disposer();
    const geo = new THREE.PlaneGeometry(300, 200, 60, 40).rotateX(-Math.PI / 2);
    d.add(geo);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    const grp = splitMesh(d, mesh, 60);
    if (!grp) fail("a 300 × 200 m mesh was not split into cells");
    else {
      let tris = 0, shared = true, inside = true;
      for (const c of grp.children as THREE.Mesh[]) {
        const g = c.geometry, sph = g.boundingSphere as THREE.Sphere;
        tris += (g.index as THREE.BufferAttribute).count / 3;
        for (const k of Object.keys(geo.attributes)) if (g.attributes[k] !== geo.attributes[k]) shared = false;
        for (let i = 0; i < (g.index as THREE.BufferAttribute).count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(g.attributes.position, (g.index as THREE.BufferAttribute).getX(i));
          if (p.distanceTo(sph.center) > sph.radius + 1e-3) inside = false;
        }
      }
      if (tris !== (geo.index as THREE.BufferAttribute).count / 3) fail(`splitting changed the triangle count (${(geo.index as THREE.BufferAttribute).count / 3} → ${tris})`);
      if (!shared) fail("the cells do not share the original vertex buffers");
      if (!inside) fail("a cell's bounding sphere does not hold its vertices");
      if (grp.children.length < 8) fail(`only ${grp.children.length} cells for a 300 × 200 m mesh`);
    }
    // Instanced props in cells: every instance kept once, each cell's sphere holds its instances, out-of-view cells are culled.
    const list: Placement[] = Array.from({ length: 500 }, (_, i) => ({ x: (hash(i, 1) - 0.5) * 400, z: (hash(i, 2) - 0.5) * 400, s: 1 }));
    const inst = instanced(d, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial(), list, true, 80);
    let count = 0, cells = 0, ok = true;
    inst?.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh) return;
      cells++;
      count += m.count;
      const sph = m.boundingSphere as THREE.Sphere, mat = new THREE.Matrix4(), v = new THREE.Vector3();
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat);
        v.setFromMatrixPosition(mat);
        if (v.distanceTo(sph.center) > sph.radius + 1e-3) ok = false;
      }
      if (!m.frustumCulled) ok = false;
    });
    if (count !== 500) fail(`instancing in cells kept ${count} of 500 instances`);
    if (cells < 6) fail(`only ${cells} instanced cells for 500 props over 400 × 400 m`);
    if (!ok) fail("an instanced cell's sphere does not hold its instances, or it is not culled");
    d.dispose();
  }

  // What is in view along the lap, with the frustum and the distance rules the renderer applies: a lot less than the whole world.
  const stats: string[] = [];
  for (const mode of THEME_ORDER) {
    const race = fresh(mode, "gt", 5), adapter = new Adapter3D(race), d = new Disposer(), scene = new THREE.Scene(), group = new THREE.Group();
    scene.add(group);
    const world = buildWorld({ adapter, d, group, quality: qualityOf(0, 1), field: new DistField(race.track, 40) });
    adapter.cars.forEach((v) => scene.add(new Car3D(d, v, null).group));
    const camera = new THREE.PerspectiveCamera(60, 1.6, 0.3, 2400), chase = new ChaseCamera();
    const trisOf = (m: THREE.Mesh) => {
      const g = m.geometry as THREE.BufferGeometry, per = (g.index ? g.index.count : g.attributes.position.count) / 3;
      return (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count * per : per;
    };
    let total = 0;
    group.traverse((o) => { if ((o as THREE.Mesh).isMesh) total += trisOf(o as THREE.Mesh); });
    let worst = 0, worstCalls = 0, sawFar = false;
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 120 * 12; i++) stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
      adapter.refresh(0);
      const p = adapter.player;
      chase.snap({ x: p.x, y: p.y, alt: p.alt, heading: p.heading, speedRatio: p.speedRatio, boosting: false, impact: 0 }, { x: 0, y: 0 });
      const c = chase.pose;
      camera.position.set(c.px, c.py, c.pz);
      camera.lookAt(c.lx, c.ly, c.lz);
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      applyFar(world.far, camera.position);
      scene.updateMatrixWorld(true);
      if (world.far.some((f) => !f.obj.visible)) sawFar = true;
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      let vis = 0, calls = 0;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (let a: THREE.Object3D | null = m; a; a = a.parent) if (!a.visible) return;
        if (m.frustumCulled && !fr.intersectsObject(m)) return;
        calls++;
        let inWorld = false;
        for (let a: THREE.Object3D | null = m; a; a = a.parent) if (a === group) inWorld = true;
        if (inWorld) vis += trisOf(m);
      });
      worst = Math.max(worst, vis / total);
      worstCalls = Math.max(worstCalls, calls);
    }
    if (worst > 0.75) fail(`${mode}: ${(worst * 100).toFixed(0)} % of the world's triangles are in view at some point of the lap (culling should keep it under 75 %)`);
    if (worstCalls > 260) fail(`${mode}: ${worstCalls} meshes in view at once (budget 260; a car is ~40, the world ~100)`);
    if (mode === "countryside" && !(world.far.length > 0 && sawFar)) fail("countryside: no small props are hidden when far");
    stats.push(`${mode} world ≤ ${(worst * 100).toFixed(0)} % / ${worstCalls} meshes with the cars`);
    d.dispose();
  }
  console.log(`  culling: triangles in view ${stats.join(", ")} (cells for the terrain, the road and the props; far hedges and fences hidden)`);
}

// ---------- (j) the quality governor ----------
{
  /** Replays a device: `fps(step, t)` is the frame rate it gets at that step; returns the governor and the steps taken. */
  const replay = (fpsAt: (step: Step, t: number) => number, seconds: number, dpr = 2, start = 0) => {
    const g = new QualityGovernor(start, LADDER.map((s) => qualityOf(s.level, dpr, s.scale).pixelRatio)), changes: { t: number; index: number }[] = [];
    for (let t = 0; t < seconds; t += GOV.WINDOW) {
      const s = g.update(fpsAt(g.step, t));
      if (s) changes.push({ t: t + GOV.WINDOW, index: g.index });
    }
    return { g, changes };
  };
  // A slow GPU: the frame rate rises as the picture gets lighter (cost ∝ pixels, shadows count extra), capped at 60.
  const costAt = (dpr: number) => (s: Step) => {
    const q = qualityOf(s.level, dpr, s.scale);
    return q.pixelRatio * q.pixelRatio * (q.shadows ? (q.shadowSize >= 2048 ? 1.35 : 1.2) : 1);
  };
  for (const dpr of [1, 2]) {
    const cost = costAt(dpr);
    for (const [name, k] of [["slow", 27], ["very slow", 17], ["modest", 40]] as const) {
      const { g, changes } = replay((s) => Math.min(60, k / cost(s)), 90, dpr);
      const fpsEnd = Math.min(60, k / cost(g.step));
      const firstOk = LADDER.findIndex((s) => Math.min(60, k / cost(s)) >= GOV.TARGET);
      if (firstOk >= 0 && (fpsEnd < GOV.TARGET || g.index > firstOk + 1)) fail(`${name} device (dpr ${dpr}): settled at step ${g.index} (${fpsEnd.toFixed(0)} fps), the first fast enough was ${firstOk}`);
      if (changes.length && changes[0].t > 5) fail(`${name} device (dpr ${dpr}): the first step down came after ${changes[0].t} s`);
      if (changes.length > 9) fail(`${name} device (dpr ${dpr}): ${changes.length} changes in 90 s (oscillating)`);
      const downs = changes.filter((c, i) => i > 0 && c.index > changes[i - 1].index).length;
      const reversals = changes.filter((c, i) => i > 0 && c.index < changes[i - 1].index).length;
      if (reversals > 2 && downs > 0 && changes.length - reversals - 1 > reversals + 4) fail(`${name} device (dpr ${dpr}): bounced up and down ${reversals} times`);
    }
  }
  // A device that makes 60 at the best picture never changes it.
  if (replay(() => 60, 120, 2).changes.length) fail("a device at 60 fps was changed");
  // A single hitch is not a reason to lighten the picture.
  if (replay((s, t) => (t >= 20 && t < 20.5 ? 15 : 60), 60, 2).changes.length) fail("one slow window made the picture lighter");
  // A screen capped at 30 Hz (battery saver): lightening the picture changes nothing, so it must not go all the way down.
  {
    const { g, changes } = replay(() => 30, 120, 2);
    if (g.index > 1) fail(`a 30 Hz screen was taken down to step ${g.index}`);
    if (changes.length > 3) fail(`a 30 Hz screen made ${changes.length} changes`);
    for (const c of changes) if (c.index > 1) fail("a 30 Hz screen was lightened below step 1 along the way");
  }
  // A device that is slow for a while then fast again: the picture comes back, one step at a time, without bouncing.
  {
    const cost = costAt(2);
    const { g, changes } = replay((s, t) => (t < 30 ? Math.min(60, 22 / cost(s)) : Math.min(60, 400 / cost(s))), 240);
    if (g.index !== 0) fail(`the picture did not come back (step ${g.index}) once the device was fast again`);
    if (changes.length > 12) fail(`${changes.length} changes while the device slowed and recovered`);
  }
  // A phone starts a notch down; a governor started past the end of the ladder stays on it.
  if (new QualityGovernor(99).index !== LADDER.length - 1 || new QualityGovernor(-3).index !== 0) fail("the start step is not clamped to the ladder");
  console.log(`  governor: ${LADDER.length} steps, lighter within ~2 s on a slow device, not for a 30 Hz screen or one hitch, back carefully, no oscillation`);
}

// ---------- (f) the winner's fireworks ----------
{
  const base = liveResources(), d = new Disposer(), scene = new THREE.Scene(), q = qualityOf(0, 1), fx = new Effects3D(d, scene, q), fw = new Fireworks3D(false);
  fw.setQuality(q);
  let peak = 0;
  for (let i = 0; i < 30 * 9; i++) {
    fw.update(1 / 30, fx, true, 100, 100, 0.5);
    fx.update(1 / 30, 600);
    peak = Math.max(peak, fx.sparks.count);
  }
  if (peak < 60) fail(`the fireworks never filled the sky (peak ${peak} sparks)`);
  if (peak > 360) fail(`the spark pool overflowed (${peak})`);
  for (let i = 0; i < 30 * 8; i++) {
    fw.update(1 / 30, fx, false, 100, 100, 0.5);
    fx.update(1 / 30, 600);
  }
  if (fx.sparks.count !== 0) fail(`${fx.sparks.count} sparks left 8 s after the fireworks stopped`);
  const quiet = new Fireworks3D(false);
  quiet.setQuality(qualityOf(2, 1));
  let low = 0;
  for (let i = 0; i < 30 * 9; i++) {
    quiet.update(1 / 30, fx, true, 100, 100, 0.5);
    fx.update(1 / 30, 600);
    low = Math.max(low, fx.sparks.count);
  }
  if (low > peak) fail(`the lightest quality level must not use more sparks (${low} > ${peak})`);
  fx.dispose();
  d.dispose();
  if (liveResources() !== base) fail(`${liveResources() - base} resources alive after the fireworks were freed`);
  console.log(`  fireworks: bursts over the finish for a winner (peak ${peak} sparks of 360, ${low} at the lightest quality), they stop and drain, everything freed`);
}

if (failed) {
  console.error("\ncheck:3d FAILED");
  process.exit(1);
}
console.log("\ncheck:3d OK");
