// 3D garage checks (the lobby's showroom). Run with `pnpm check:garage` (same Node + hook as check:tracks). No WebGL needed: it checks what the
// stage shows, how its camera turns, its cache, and that the stage and every car the lists can show build into finite geometry and are freed.
//
//   (a) what the stage shows: the equipped car in its paint by default; a hovered or tapped car in its place (its own paint, the factory one when it
//       is not owned); a hovered skin tried on the equipped car (the shop is for that one), owned or not; a skin that does not fit is ignored;
//   (b) the turntable's camera: it turns by itself only after the player lets go, a drag turns it and clamps the pitch, a flick keeps turning and
//       slows down, the distance eases toward the one that fits (the Jet's open wings need more), `fit` really keeps a sphere in view;
//   (c) the cache: the least recently used car goes first, never the one on the stage, everything it drops is freed;
//   (d) the Jet's wing demo (open 3 s, folded 3 s) and the no-motion setting;
//   (e) the stage's own geometry is finite, small, and `dispose` frees all of it; every car in every paint the lobby can show builds and is freed;
//   (f) the Bugatti La Voiture Noire (it replaced the Chiron): its place and price in the shop (and the SQL's, for every car), its bars, its black
//       paint, buying it, its 3D build (size, six exhausts, no wing);
//   (g) the debug profile is saved: buy a car with the million, reload, the car and the balance are still there; it starts again on request,
//       never mixes with the player's profile, and a corrupted save falls back to the million.

import {
  DEBUG_PROFILE, MODEL_ORDER, MODELS, NEW_PROFILE, SKINS, SKIN_ORDER, STAT_RANGE, buyCar, carStats, getDebugProfile, getPlayerProfile, invalidateDebugProfile, resetDebugProfile,
  saveDebugProfile, savePlayerProfile, skinFits, skinOf, skinsFor, type ModelId, type Profile,
} from "../src/game/garage";
import { readFileSync } from "node:fs";
import { Lru, Orbit, carKey, carRadius, stageChoice, stageWing } from "../src/game/garageView";
import { Car3D } from "../src/game/three/cars";
import { Disposer, THREE, liveResources } from "../src/game/three/core";
import { TURNTABLE, buildStage } from "../src/game/three/showroom";
import type { CarView } from "../src/game/adapter3d";

const blankView = (model: ModelId): CarView => ({
  id: 0, isPlayer: false, model, skin: skinOf(model, "factory"), x: 0, y: 0, heading: 0, alt: 0, speed: 0, boosting: false, health: 1, destroyed: -1, wreck: 1, wing: 0, flame: 0, finished: false, stunned: false,
});

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
    id: 0, isPlayer: false, model, skin, x: 0, y: 0, heading: 0, alt: TURNTABLE.H, speed: 0, boosting: false, health: 1, destroyed: -1, wreck: 1, wing: 0, flame: 0, finished: false, stunned: false,
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

// ---------- (f) the Bugatti La Voiture Noire ----------
{
  const c = MODELS.voiturenoire;
  check(c.id === "voiturenoire" && c.name === "Bugatti La Voiture Noire" && c.price === 300_000, "La Voiture Noire's id / name / price");
  check(!("chiron" in MODELS) && !MODEL_ORDER.some((id) => (id as string) === "chiron"), "the Chiron is gone: La Voiture Noire replaced it");
  const at = MODEL_ORDER.indexOf("voiturenoire");
  check(at === MODEL_ORDER.indexOf("f8") + 1 && at === MODEL_ORDER.indexOf("jet") - 1, "La Voiture Noire comes right after the F8 and right before the Jet in the shop");
  check(c.price > MODELS.f8.price && c.price < MODELS.jet.price, "La Voiture Noire's price sits between the F8's and the Jet's");
  // Faster and quicker than the F8 and planted where the F8 slides; out of the scale, so no other car's bars moved.
  const f8 = carStats("f8", 1), vn = carStats("voiturenoire", 1);
  check(vn.speed > f8.speed && vn.accel > f8.accel && vn.grip > f8.grip, "La Voiture Noire is not above the F8 on every stat");
  check(!!c.hypercar && !c.flying, "La Voiture Noire is a hypercar that does not fly");
  const old = { speed: { min: 0.944416, max: 1.4632 }, accel: { min: 0.92188, max: 1.651 }, grip: { min: 0.74, max: 1.3 } };
  for (const k of ["speed", "accel", "grip"] as const) {
    near(`STAT_RANGE.${k}.min`, STAT_RANGE[k].min, old[k].min, 1e-6);
    near(`STAT_RANGE.${k}.max`, STAT_RANGE[k].max, old[k].max, 1e-6);
  }
  const bar = (k: "speed" | "accel" | "grip", v: number) => ((v - STAT_RANGE[k].min) / (STAT_RANGE[k].max - STAT_RANGE[k].min)) * 100;
  near("Voiture Noire bar: speed", bar("speed", vn.speed), 80, 1);
  near("Voiture Noire bar: accel", bar("accel", vn.accel), 72, 1);
  near("Voiture Noire bar: grip", bar("grip", vn.grip), 46, 1);
  // Buying it, with and without the money; the paints it can wear (a profile that still holds the old Chiron simply loses that entry).
  const poor: Profile = { ...NEW_PROFILE, money: 299_999 }, rich: Profile = { ...NEW_PROFILE, money: 300_000 };
  check(buyCar(poor, "voiturenoire") === poor, "bought La Voiture Noire with 299 999 €");
  const bought = buyCar(rich, "voiturenoire");
  check(bought.money === 0 && bought.selected === "voiturenoire" && !!bought.cars.voiturenoire && bought.cars.voiturenoire.skin === "factory", "buying La Voiture Noire");
  const paint = skinOf("voiturenoire", "factory");
  check(paint.name === "Noir carbone" && paint.body === "#08080a" && paint.accent === "#2d3036", "La Voiture Noire's factory paint is black");
  check(skinsFor("voiturenoire").length === 8 && skinsFor("voiturenoire").every((id) => id === "factory" || !SKINS[id].jet), "La Voiture Noire wears the shared skins and none of the Jet's");
  check(!skinFits("voiturenoire", "jetGold") && skinFits("voiturenoire", "gold") && !skinFits("jet", "gold"), "skin fit around La Voiture Noire");
  // The SQL prices every car like the game does (a drift here would let the server refuse a purchase, or sell it for less).
  const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const fn = sql.slice(sql.indexOf("function public.racerz_car_price"), sql.indexOf("function public.racerz_skin_price"));
  const prices = new Map([...fn.matchAll(/when '(\w+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  for (const id of MODEL_ORDER) check(prices.get(id) === MODELS[id].price, `SQL price of ${id}: ${prices.get(id)} (game ${MODELS[id].price})`);
  check(prices.size === MODEL_ORDER.length && !prices.has("chiron"), `the SQL prices ${prices.size} cars, the game has ${MODEL_ORDER.length}`);
  // The model builds into finite geometry of a sensible size, in its factory paint and in the shop's.
  const base = liveResources(), d = new Disposer(), view = { ...blankView("voiturenoire") }, car = new Car3D(d, view, null);
  car.update(view, 1 / 60, 1); // (hides the turbo flame, which is not part of the car's size)
  let tris = 0, badV = 0;
  car.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute("position");
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
    for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite((pos.array as ArrayLike<number>)[i])) badV++;
  });
  check(badV === 0, `${badV} non-finite vertices in La Voiture Noire`);
  check(tris > 3000 && tris < 120_000, `La Voiture Noire has ${Math.round(tris)} triangles`);
  // (Only what is visible: the hidden turbo flame is not part of the car's size.) No wing: nothing stands above the roof but the dorsal fin.
  const box = new THREE.Box3();
  car.group.updateMatrixWorld(true);
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if ((o as THREE.Mesh).isMesh) {
      const g = (o as THREE.Mesh).geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox!.clone().applyMatrix4(o.matrixWorld));
    }
    o.children.forEach(visit);
  };
  visit(car.group);
  const size = box.getSize(new THREE.Vector3());
  check(size.x > 4.4 && size.x < 5.1 && size.z > 1.9 && size.z < 2.3 && size.y > 1.1 && size.y < 1.35, `La Voiture Noire measures ${size.x.toFixed(2)} × ${size.z.toFixed(2)} × ${size.y.toFixed(2)} m (about 4.5 × 2.04 × 1.2)`);
  // Six exhaust tips in two rows of three, centred; a dorsal fin along the middle (a thin mesh on the centre line); no wing blade across the tail.
  const tips = new Set<string>();
  const tipPositions: THREE.Vector3[] = [];
  car.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.geometry instanceof THREE.CylinderGeometry)) return;
    const p = m.position;
    if (p.x < -2.3 && p.y > 0.4 && p.y < 0.7 && !tips.has(`${p.y.toFixed(2)}/${p.z.toFixed(2)}`)) {
      tips.add(`${p.y.toFixed(2)}/${p.z.toFixed(2)}`);
      tipPositions.push(p.clone());
    }
  });
  check(tips.size === 6, `${tips.size} exhaust tips at the tail (expected 6)`);
  check(new Set(tipPositions.map((p) => p.y.toFixed(2))).size === 2 && tipPositions.every((p) => Math.abs(p.z) <= 0.21), "the six exhaust tips are two centred rows");
  let wide = 0;
  car.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const bb = new THREE.Box3().setFromObject(m), s = bb.getSize(new THREE.Vector3());
    if (bb.min.y > 0.95 && bb.max.x < -1.9 && s.z > 1.2) wide++; // a blade over the tail
  });
  check(wide === 0, "something wide stands over the tail: a wing, which La Voiture Noire does not have");
  d.dispose();
  check(liveResources() === base, `${liveResources() - base} resources alive after La Voiture Noire was freed`);
  console.log(`  La Voiture Noire: 300 000 €, black, bars 80 / 72 / 46, SQL prices match for all ${MODEL_ORDER.length} cars, six exhausts, no wing, ${Math.round(tris)} triangles, ${size.x.toFixed(2)} × ${size.z.toFixed(2)} × ${size.y.toFixed(2)} m`);
}

// ---------- (g) the debug profile is saved ----------
{
  // A browser's storage, in memory (the checks run in Node).
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    addEventListener: () => undefined,
  };
  invalidateDebugProfile(); // "a fresh page": nothing read yet
  check(getDebugProfile().money === 1_000_000 && Object.keys(getDebugProfile().cars).join() === "gt", "a fresh debug profile is not the million and the factory car");
  // The million, the Bugatti at 300 000 €: 700 000 € left, the car owned.
  const bought = buyCar(getDebugProfile(), "voiturenoire");
  check(bought.money === 700_000 && !!bought.cars.voiturenoire, `buying the Bugatti in debug left ${bought.money} € (expected 700 000)`);
  saveDebugProfile(bought);
  // Reload: the cache is gone, the profile comes back from the storage.
  invalidateDebugProfile();
  const back = getDebugProfile();
  check(back.money === 700_000 && !!back.cars.voiturenoire, `after a reload the debug profile has ${back.money} € and ${Object.keys(back.cars).join()}`);
  check(store.has("racerz.debug-profile.v1") && !store.has("racerz.profile.v1"), "the debug profile was saved under the player's key, or not saved");
  // It never mixes with the player's profile.
  check(JSON.stringify(getPlayerProfile()) === JSON.stringify(NEW_PROFILE), "the player's profile changed with the debug one");
  const player = buyCar({ ...NEW_PROFILE, money: 10_000 }, "mx5");
  savePlayerProfile(player);
  invalidateDebugProfile();
  check(getDebugProfile().money === 700_000 && !getDebugProfile().cars.mx5, "a player's purchase leaked into the debug profile");
  check(store.has("racerz.profile.v1") && getPlayerProfile().money === player.money, "the player's profile was not saved on its own");
  // Starting over.
  resetDebugProfile();
  check(!store.has("racerz.debug-profile.v1") && getDebugProfile().money === DEBUG_PROFILE.money && Object.keys(getDebugProfile().cars).join() === "gt", "the reset did not bring back the million and the factory car");
  invalidateDebugProfile();
  check(getDebugProfile().money === 1_000_000, "the reset did not stick after a reload");
  // A corrupted or hostile save: the million, never a crash, never a prototype hole.
  for (const junk of ["{not json", "null", "42", '"hello"', '{"money":-5,"cars":{"__proto__":{"level":99},"constructor":{}},"selected":"nope","skins":["__proto__"]}']) {
    store.set("racerz.debug-profile.v1", junk);
    invalidateDebugProfile();
    const p = getDebugProfile();
    check(Number.isInteger(p.money) && p.money >= 0 && !!p.cars.gt && Object.keys(p.cars).every((id) => id in MODELS), `a corrupted debug save (${junk.slice(0, 20)}) gave ${JSON.stringify(p).slice(0, 80)}`);
  }
  store.set("racerz.debug-profile.v1", "{not json");
  invalidateDebugProfile();
  check(getDebugProfile().money === 1_000_000, "a corrupted debug save did not fall back to the million");
  delete (globalThis as unknown as { window?: unknown }).window;
  console.log("  debug profile: saved under its own key (1 000 000 € − 300 000 € = 700 000 € and the Bugatti survive a reload), separate from the player's, reset on request, corrupted saves fall back to the million");
}

if (failed) {
  console.error("\ncheck:garage FAILED");
  process.exit(1);
}
console.log("\ncheck:garage OK");
