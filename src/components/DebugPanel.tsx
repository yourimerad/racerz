"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { PHYS, PHYS_DEFAULTS, speedOf } from "@/game/car";
import type { Race } from "@/game/race";
import { type ThemeId, THEMES } from "@/game/themes";
import styles from "./Game.module.css";

type PhysKey = keyof typeof PHYS;
const SLIDERS: { key: PhysKey; label: string; min: number; max: number; step: number }[] = [
  { key: "maxSpeed", label: "vitesse max", min: 200, max: 900, step: 10 },
  { key: "accel", label: "accélération", min: 100, max: 1200, step: 10 },
  { key: "brake", label: "freinage", min: 200, max: 2000, step: 10 },
  { key: "reverseAccel", label: "marche arrière", min: 50, max: 800, step: 10 },
  { key: "maxReverse", label: "vmax arrière", min: 50, max: 400, step: 10 },
  { key: "turnRate", label: "braquage", min: 1, max: 5, step: 0.1 },
  { key: "grip", label: "adhérence", min: 0.5, max: 20, step: 0.5 },
  { key: "driftGrip", label: "adh. frein à main", min: 0, max: 6, step: 0.1 },
  { key: "drag", label: "traînée piste", min: 0, max: 2, step: 0.05 },
  { key: "grassDrag", label: "traînée hors-piste", min: 0, max: 6, step: 0.1 },
  { key: "grassMax", label: "vmax hors-piste", min: 0.1, max: 1, step: 0.05 },
];
const SURFACE_LABEL = { track: "piste", offtrack: "hors-piste", lava: "lave" } as const;

/** Base physics sliders (H). Mode multipliers apply on top of these values. */
export default function DebugPanel({ raceRef, mode }: { raceRef: RefObject<Race | null>; mode: ThemeId }) {
  const [, redraw] = useState(0);
  const liveRef = useRef<HTMLSpanElement>(null);
  const theme = THEMES[mode];
  const m = theme.phys;

  // Live readout without re-rendering React every frame.
  useEffect(() => {
    const id = setInterval(() => {
      const car = raceRef.current?.cars[0];
      if (liveRef.current) liveRef.current.textContent = car ? `${SURFACE_LABEL[car.surface]} · ${Math.round(Math.abs(speedOf(car)))} u/s` : "—";
    }, 100);
    return () => clearInterval(id);
  }, [raceRef]);

  return (
    <div className={styles.debug}>
      <strong>Debug (H)</strong>
      <div>mode : {theme.emoji} {theme.name}</div>
      <div>piste : adhérence ×{m.trackGrip}</div>
      <div>hors-piste : adh ×{m.offGrip} · traînée ×{m.offDrag} · vmax ×{m.offMax}</div>
      <div>lave : traînée ×{m.lavaDrag} · vmax ×{m.lavaMax}</div>
      <div>surface : <span ref={liveRef}>—</span></div>
      <hr />
      {SLIDERS.map((s) => (
        <label key={s.key}>
          <span>{s.label}</span>
          <input
            type="range" min={s.min} max={s.max} step={s.step} value={PHYS[s.key]}
            onChange={(e) => {
              PHYS[s.key] = Number(e.target.value);
              redraw((n) => n + 1);
            }}
            onPointerUp={(e) => e.currentTarget.blur()}
          />
          <output>{PHYS[s.key]}</output>
        </label>
      ))}
      <button
        onClick={(e) => {
          Object.assign(PHYS, PHYS_DEFAULTS);
          redraw((n) => n + 1);
          e.currentTarget.blur();
        }}
      >
        Réinitialiser
      </button>
    </div>
  );
}
