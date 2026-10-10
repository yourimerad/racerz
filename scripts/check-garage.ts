// 3D garage checks (the lobby's showroom). Run with `pnpm check:garage` (same Node + hook as check:tracks). No WebGL needed: it checks what the
// stage shows, how its camera turns, its cache, and that the stage and every car the lists can show build into finite geometry and are freed.
//
//   (a) what the stage shows: the equipped car in its paint by default; a hovered or tapped car in its place (its own paint, the factory one when it
//       is not owned); a hovered skin tried on the equipped car (the shop is for that one), owned or not; a skin that does not fit is ignored;
//   (b) the turntable's camera: it turns by itself only after the player lets go, a drag turns it and clamps the pitch, a flick keeps turning and
//       slows down, the distance eases toward the one that fits (the Jet's open wings need more), `fit` really keeps a sphere in view;
//   (c) the cache: the least recently used car goes first, never the one on the stage, everything it drops is freed;
//   (d) the Jet's wing demo (open 3 s, folded 3 s) and the no-motion setting;
//   (e) the stage's own geometry is finite, small, and `dispose` frees all of it; every car in every paint the lobby can show builds and is freed.

import { MODEL_ORDER, MODELS, NEW_PROFILE, SKINS, SKIN_ORDER, skinFits, skinOf, type ModelId, type Profile } from "../src/game/garage";
import { Lru, Orbit, carKey, carRadius, stageChoice, stageWing } from "../src/game/garageView";
import { Car3D } from "../src/game/three/cars";
import { Disposer, THREE, liveResources } from "../src/game/three/core";
import { TURNTABLE, buildStage } from "../src/game/three/showroom";
import type { CarView } from "../src/game/adapter3d";

let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const check = (ok: boolean, msg: string) => {
  if (!ok) fail(msg);
};
const near = (what: string, got: number, want: number, tol: number) => {
  if (!(Math.abs(got - want) <= tol)) fail(`${what}: ${got.toFixed(4)} (expected ${want} ± ${tol})`);
};

console.log("3D garage checks\n");

// ---------- (a) what the stage shows ----------
{
  const p: Profile = {
    money: 100_000,
    cars: { gt: { level: 1, paliers: 0, skin: "stripes" }, aventador: { level: 2, paliers: 1, skin: "factory" }, jet: { level: 1, paliers: 0, skin: "jetCamo" } },
    selected: "gt", skins: ["factory", "stripes", "jetCamo"],
  };
  let c = stageChoice(p, {});
  check(c.model === "gt" && c.skin === "stripes" && !c.preview, `default: ${JSON.stringify(c)}`);
  c = stageChoice(p, { hoverCar: "aventador" });
  check(c.model === "aventador" && c.skin === "factory" && c.preview, `hovered owned car: ${JSON.stringify(c)}`);
  c = stageChoice(p, { hoverCar: "f8" });
  check(c.model === "f8" && c.skin === "factory" && c.preview, `hovered car not owned: ${JSON.stringify(c)}`);
  c = stageChoice(p, { focusCar: "jet" });
  check(c.model === "jet" && c.skin === "jetCamo" && c.preview, `tapped Jet wears its own skin: ${JSON.stringify(c)}`);
  c = stageChoice(p, { hoverCar: "mx5", focusCar: "jet" });
  check(c.model === "mx5", "a hover must win over a tap");
  c = stageChoice(p, { hoverSkin: "gold" });
  check(c.model === "gt" && c.skin === "gold" && c.preview, `a skin tried on the equipped car (not owned): ${JSON.stringify(c)}`);
  c = stageChoice(p, { hoverSkin: "stripes" });
  check(c.skin === "stripes" && !c.preview, "hovering the skin already worn is not a preview");
  c = stageChoice(p, { hoverCar: "aventador", hoverSkin: "gold" });
  check(c.model === "gt" && c.skin === "gold", "the shop is for the equipped car, whatever card the pointer left last");
  c = stageChoice(p, { hoverSkin: "jetGold" });
  check(c.model === "gt" && c.skin === "stripes", "a Jet skin must not be tried on the GT");
  const pj = { ...p, selected: "jet" as const };
  c = stageChoice(pj, { hoverSkin: "pearl" });
  check(c.model === "jet" && c.skin === "jetCamo", "an ordinary skin must not be tried on the Jet");
  c = stageChoice(pj, { hoverSkin: "jetGold" });
  check(c.model === "jet" && c.skin === "jetGold" && c.preview, "a Jet skin is tried on the Jet");
  c = stageChoice(NEW_PROFILE, {});
  check(c.model === "gt" && c.skin === "factory" && !c.preview, "a new profile starts on the GT");
  // The stage never asks for a (car, paint) pair that cannot exist.
  for (const model of MODEL_ORDER) for (const hoverSkin of SKIN_ORDER) {
    const r = stageChoice({ ...p, selected: model, cars: { ...p.cars, [model]: { level: 1, paliers: 0, skin: "factory" } } }, { hoverSkin });
    check(skinFits(r.model, r.skin), `stage asked for ${r.model} in ${r.skin}`);
  }
  console.log("  stage: the equipped car by default, a hover or a tap takes its place, a hovered skin is tried on the equipped car, never a paint that does not fit");
}

// ---------- (b) the turntable's camera ----------
{
  // Untouched, it turns at once at its own pace.
  const o = new Orbit(), y0 = o.yaw;
  for (let i = 0; i < 60 * 7; i++) o.update(1 / 60, true, 12);
  near("idle turn over 7 s", o.yaw - y0, Orbit.AUTO * 7, 0.15);
  // Held: it follows the finger, nothing else moves it.
  const q = new Orbit();
  q.grab();
  const yg = q.yaw;
  q.drag(100, 0, 0.1);
  near("a drag of 100 px", q.yaw - yg, 100 * 0.0085, 1e-9);
  q.update(0.5, true, 12);
  near("held: no idle turn, no inertia", q.yaw - yg, 100 * 0.0085, 1e-9);
  // Let go: a flick keeps turning (inertia) and dies out; the idle turn waits 1.5 s, then picks up again.
  q.release();
  const yr = q.yaw;
  q.update(0.1, true, 12);
  check(q.yaw > yr, "a flick keeps turning (inertia)");
  const r = new Orbit();
  r.grab();
  r.release(); // let go without a flick
  const yl = r.yaw;
  r.update(1.0, true, 12);
  near("auto-turn waits 1.5 s after release", r.yaw, yl, 1e-9);
  for (let i = 0; i < 60 * 4; i++) r.update(1 / 60, true, 12);
  check(r.yaw - yl > 0.5, "auto-turn resumes after release");
  const f = new Orbit();
  f.grab();
  f.drag(300, 0, 0.1);
  f.release();
  for (let i = 0; i < 120; i++) f.update(1 / 60, false, 12);
  const settled = f.yaw;
  for (let i = 0; i < 30; i++) f.update(1 / 60, false, 12);
  const turned = Math.abs(((f.yaw - settled + Math.PI * 3) % (Math.PI * 2)) - Math.PI); // yaw wraps at 2π: compare as angles
  near("inertia dies out", turned, 0, 0.02);
  const still = new Orbit(), ys = still.yaw;
  for (let i = 0; i < 600; i++) still.update(1 / 60, false, 12);
  near("a screen that asks for no motion: no idle turn", still.yaw, ys, 1e-9);
  // Pitch clamps, distance eases.
  q.grab();
  q.drag(0, 5000, 0.1);
  near("pitch max", q.pitch, Orbit.PITCH_MAX, 1e-9);
  q.drag(0, -50000, 0.1);
  near("pitch min", q.pitch, Orbit.PITCH_MIN, 1e-9);
  q.release();
  const d = new Orbit();
  d.dist = 10;
  for (let i = 0; i < 600; i++) d.update(1 / 60, false, 15);
  near("distance eases to the wanted one", d.dist, 15, 0.01);
  const [px, py, pz] = d.position(0.8);
  check(Number.isFinite(px + py + pz) && py > 0.8 && Math.abs(Math.hypot(py - 0.8, pz) - d.dist) < 1e-9, "camera position");
  // fit: a sphere of radius r at distance fit() is inside the narrower of the two fields of view.
  for (const aspect of [0.5, 0.8, 1.6]) {
    const dist = Orbit.fit(2.5, 30, aspect, 1);
    const half = Math.asin(2.5 / dist), v = (30 * Math.PI) / 360, h = Math.atan(Math.tan(v) * aspect);
    check(half <= Math.min(v, h) + 1e-9, `fit at aspect ${aspect}`);
  }
  check(carRadius("jet", 1) > carRadius("jet", 0) && carRadius("jet", 0) > carRadius("gt"), "the Jet's open wings need more room than a car");
  near("jet wings clamp", carRadius("jet", 9), carRadius("jet", 1), 1e-9);
  console.log("  camera: turns by itself only when let go, a drag and a flick, pitch clamped, distance eases, fit keeps the car in view");
}

// ---------- (c) the cache ----------
{
  const freed: string[] = [];
  let shown = "";
  const lru = new Lru<string>(3, (k) => freed.push(k), (v) => v === shown);
  lru.set("a", "a");
  lru.set("b", "b");
  lru.set("c", "c");
  lru.get("a");
  lru.set("d", "d");
  check(freed.join() === "b" && lru.size === 3, `evicts the least recently used: ${freed.join()}`);
  shown = "a";
  lru.set("e", "e");
  lru.set("f", "f");
  check(!freed.includes("a"), "the car on the stage must never be dropped");
  check(lru.size === 3 && freed.length === 3, `size ${lru.size}, freed ${freed.join()}`);
  lru.clear();
  check(lru.size === 0 && freed.length === 6, "clear frees everything");
  check(carKey("gt", skinOf("gt", "factory")) !== carKey("gt", SKINS.gold) && carKey("gt", SKINS.gold) === carKey("gt", SKINS.gold), "cache keys tell paints apart");
  console.log("  cache: least recently used first, never the car on the stage, everything dropped is freed");
}

// ---------- (d) the Jet's wing demo ----------
{
  near("folded at 0", stageWing(0, false), 0, 1e-9);
  near("open at 0.6 s", stageWing(0.6, false), 1, 1e-9);
  near("open at 2 s", stageWing(2, false), 1, 1e-9);
  near("folding at 3.3 s", stageWing(3.3, false), 0.5, 1e-9);
  near("folded at 4 s", stageWing(4, false), 0, 1e-9);
  near("and again at 6.6 s", stageWing(6.6, false), 1, 1e-9);
  near("no motion: always folded", stageWing(2, true), 0, 1e-9);
  console.log("  Jet wings: open 3 s, folded 3 s, folded for good when the screen asks for no motion");
}

// ---------- (e) the stage and the cars build, and are freed ----------
{
  const base = liveResources();
  const d = new Disposer();
  const stage = buildStage(d);
  let tris = 0, bad = 0;
  stage.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry, pos = g.getAttribute("position");
    for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite((pos.array as ArrayLike<number>)[i])) bad++;
    tris += g.index ? g.index.count / 3 : pos.count / 3;
  });
  check(bad === 0, `${bad} non-finite vertices in the stage`);
  check(tris > 100 && tris < 20_000, `the stage has ${tris} triangles`);
  near("turntable radius", TURNTABLE.R, 3.3, 1e-9);
  d.dispose();
  check(liveResources() === base, `${liveResources() - base} resources alive after the stage was freed`);

  // Every car in every paint it can wear, at the wing openings the lists use.
  const blank = (model: ModelId, skin: ReturnType<typeof skinOf>): CarView => ({
    id: 0, isPlayer: false, model, skin, x: 0, y: 0, heading: 0, alt: TURNTABLE.H, speed: 0, boosting: false, health: 1, wing: 0, flame: 0, finished: false, stunned: false,
  });
  let n = 0;
  for (const model of MODEL_ORDER) {
    for (const id of SKIN_ORDER) {
      if (!skinFits(model, id)) continue;
      const cd = new Disposer(), view = blank(model, skinOf(model, id)), car = new Car3D(cd, view, null);
      for (const wing of model === "jet" ? [0, 1] : [0]) {
        view.wing = wing;
        car.update(view, 1 / 60, 1);
      }
      car.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite((pos.array as ArrayLike<number>)[i])) bad++;
      });
      cd.dispose();
      n++;
    }
  }
  check(bad === 0, `${bad} non-finite vertices in the cars`);
  check(liveResources() === base, `${liveResources() - base} resources alive after the cars were freed`);
  check(n === Object.values(MODELS).length * 0 + MODEL_ORDER.reduce((k, m) => k + SKIN_ORDER.filter((s) => skinFits(m, s)).length, 0), "cars built");
  console.log(`  stage: ${Math.round(tris)} triangles, finite, freed; ${n} (car, paint) pairs build and are freed`);
}

if (failed) {
  console.error("\ncheck:garage FAILED");
  process.exit(1);
}
console.log("\ncheck:garage OK");
