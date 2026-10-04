"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Input, NO_INPUT } from "@/game/car";
import { type Race, createRace, stepRace, standings } from "@/game/race";
import { formatTime, render } from "@/game/render";
import { type ThemeId, THEMES, THEME_ORDER } from "@/game/themes";
import DebugPanel from "./DebugPanel";
import styles from "./Game.module.css";

const KEYS: Record<string, keyof Input> = {
  ArrowUp: "throttle", KeyW: "throttle", KeyZ: "throttle",
  ArrowDown: "brake", KeyS: "brake",
  ArrowLeft: "left", KeyA: "left", KeyQ: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "handbrake",
};
const STEP = 1 / 120;

type Result = { name: string; color: string; time: number | null; isPlayer: boolean };

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raceRef = useRef<Race | null>(null);
  const inputRef = useRef<Input>({ ...NO_INPUT });
  const [screen, setScreen] = useState<"menu" | "race" | "results">("menu");
  const [results, setResults] = useState<Result[]>([]);
  const [mode, setMode] = useState<ThemeId>("countryside");
  // Best lap per mode, kept for the session only.
  const [records, setRecords] = useState<Partial<Record<ThemeId, number>>>({});
  const record = records[mode] ?? null;
  const [debug, setDebug] = useState(false);

  const start = useCallback(() => {
    raceRef.current = createRace(mode);
    inputRef.current = { ...NO_INPUT };
    setScreen("race");
  }, [mode]);

  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      if (down && !e.repeat) {
        // Enter/Space start from the menu or results (Space is the handbrake while racing).
        if ((e.code === "Enter" || e.code === "Space") && screen !== "race") {
          e.preventDefault();
          start();
          return;
        }
        if (e.code === "KeyR" && screen !== "menu") return start();
        if (e.code === "KeyH") return setDebug((d) => !d);
        const digit = /^(Digit|Numpad)([1-4])$/.exec(e.code);
        if (digit && screen === "menu") return setMode(THEME_ORDER[Number(digit[2]) - 1]);
      }
      const k = KEYS[e.code];
      if (!k) return;
      e.preventDefault();
      inputRef.current = { ...inputRef.current, [k]: down };
    };
    const kd = (e: KeyboardEvent) => set(e, true);
    const ku = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [screen, start]);

  useEffect(() => {
    if (screen !== "race") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0, last = performance.now(), acc = 0, resultsShown = false;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now: number) => {
      const race = raceRef.current;
      if (!race) return;
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        stepRace(race, inputRef.current, STEP);
        acc -= STEP;
      }
      render(ctx, race, canvas.clientWidth, canvas.clientHeight);

      if (race.phase === "finished" && !resultsShown) {
        resultsShown = true;
        const best = race.cars[0].bestLap;
        const id = race.theme.id;
        if (best !== null) setRecords((r) => (best < (r[id] ?? Infinity) ? { ...r, [id]: best } : r));
        // Let the other cars run a bit before showing the podium.
        setTimeout(() => {
          if (raceRef.current !== race) return; // restarted with R meanwhile
          setResults(standings(race).map((c) => ({ name: c.name, color: c.color, time: c.finishTime, isPlayer: c.isPlayer })));
          setScreen("results");
        }, 2500);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [screen]);

  const touch = (k: keyof Input) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      inputRef.current = { ...inputRef.current, [k]: true };
    },
    onPointerUp: () => (inputRef.current = { ...inputRef.current, [k]: false }),
    onPointerCancel: () => (inputRef.current = { ...inputRef.current, [k]: false }),
  });

  return (
    <div className={styles.root}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {debug && <DebugPanel raceRef={raceRef} mode={mode} />}

      {screen === "race" && (
        <div className={styles.touch}>
          <div className={styles.pad}>
            <button {...touch("left")} aria-label="Gauche">◀</button>
            <button {...touch("right")} aria-label="Droite">▶</button>
          </div>
          <div className={styles.pad}>
            <button {...touch("brake")} aria-label="Frein">▼</button>
            <button {...touch("throttle")} aria-label="Accélérer">▲</button>
          </div>
        </div>
      )}

      {screen === "menu" && (
        <div className={styles.overlay}>
          <h1 className={styles.title}>RACERZ</h1>
          <p>Course 2D — 3 tours contre 3 pilotes.</p>
          <div className={styles.modes} role="radiogroup" aria-label="Environnement">
            {THEME_ORDER.map((id, i) => (
              <button
                key={id}
                role="radio"
                aria-checked={mode === id}
                className={mode === id ? `${styles.mode} ${styles.modeOn}` : styles.mode}
                style={{ "--accent": THEMES[id].colors.accent } as React.CSSProperties}
                onClick={() => setMode(id)}
              >
                <span className={styles.modeEmoji}>{THEMES[id].emoji}</span>
                <span>{THEMES[id].name}</span>
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
          <ul className={styles.help}>
            <li><kbd>↑</kbd>/<kbd>W</kbd>/<kbd>Z</kbd> accélérer · <kbd>↓</kbd>/<kbd>S</kbd> freiner</li>
            <li><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>Q</kbd><kbd>D</kbd> tourner · <kbd>Espace</kbd> frein à main (drift)</li>
            <li>Restez sur l&apos;asphalte : le hors-piste ralentit (et la lave encore plus).</li>
            <li><kbd>1</kbd>–<kbd>4</kbd> choisir le mode · <kbd>R</kbd> recommencer · <kbd>H</kbd> panneau debug</li>
          </ul>
          {record !== null && <p>Record du tour ({THEMES[mode].name}) : {formatTime(record)}</p>}
          <button className={styles.cta} onClick={start}>Démarrer (Entrée / Espace)</button>
        </div>
      )}

      {screen === "results" && (
        <div className={styles.overlay}>
          <h2 className={styles.title}>Arrivée</h2>
          <p>{THEMES[mode].emoji} {THEMES[mode].name}</p>
          <ol className={styles.podium}>
            {results.map((r) => (
              <li key={r.name} className={r.isPlayer ? styles.me : undefined}>
                <span className={styles.dot} style={{ background: r.color }} />
                <span>{r.name}</span>
                <span>{r.time === null ? "en course" : formatTime(r.time)}</span>
              </li>
            ))}
          </ol>
          {record !== null && <p>Record du tour ({THEMES[mode].name}) : {formatTime(record)}</p>}
          <div className={styles.actions}>
            <button className={styles.cta} onClick={start}>Rejouer (Entrée)</button>
            <button className={`${styles.cta} ${styles.ghost}`} onClick={() => setScreen("menu")}>Changer de mode</button>
          </div>
        </div>
      )}
    </div>
  );
}
