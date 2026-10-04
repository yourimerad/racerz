"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Input, NO_INPUT } from "@/game/car";
import { type Race, createRace, stepRace, standings } from "@/game/race";
import { formatTime, render } from "@/game/render";
import styles from "./Game.module.css";

const KEYS: Record<string, keyof Input> = {
  ArrowUp: "throttle", KeyW: "throttle", KeyZ: "throttle",
  ArrowDown: "brake", KeyS: "brake",
  ArrowLeft: "left", KeyA: "left", KeyQ: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "handbrake",
};
const STEP = 1 / 120;
const BEST_KEY = "racerz:best-lap";

type Result = { name: string; color: string; time: number | null; isPlayer: boolean };

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raceRef = useRef<Race | null>(null);
  const inputRef = useRef<Input>({ ...NO_INPUT });
  const [screen, setScreen] = useState<"menu" | "race" | "results">("menu");
  const [results, setResults] = useState<Result[]>([]);
  const [record, setRecord] = useState<number | null>(null);

  useEffect(() => {
    const v = Number(localStorage.getItem(BEST_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage once
    if (v > 0) setRecord(v);
  }, []);

  const start = useCallback(() => {
    raceRef.current = createRace();
    inputRef.current = { ...NO_INPUT };
    setScreen("race");
  }, []);

  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = KEYS[e.code];
      if (!k) {
        if (down && e.code === "Enter" && screen !== "race") start();
        return;
      }
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
        const prev = Number(localStorage.getItem(BEST_KEY)) || Infinity;
        if (best !== null && best < prev) {
          localStorage.setItem(BEST_KEY, String(best));
          setRecord(best);
        }
        // Let the other cars run a bit before showing the podium.
        setTimeout(() => {
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
          <ul className={styles.help}>
            <li><kbd>↑</kbd>/<kbd>W</kbd>/<kbd>Z</kbd> accélérer · <kbd>↓</kbd>/<kbd>S</kbd> freiner</li>
            <li><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>Q</kbd><kbd>D</kbd> tourner · <kbd>Espace</kbd> frein à main (drift)</li>
            <li>Restez sur l&apos;asphalte : l&apos;herbe ralentit.</li>
          </ul>
          {record !== null && <p>Record du tour : {formatTime(record)}</p>}
          <button className={styles.cta} onClick={start}>Démarrer (Entrée)</button>
        </div>
      )}

      {screen === "results" && (
        <div className={styles.overlay}>
          <h2 className={styles.title}>Arrivée</h2>
          <ol className={styles.podium}>
            {results.map((r) => (
              <li key={r.name} className={r.isPlayer ? styles.me : undefined}>
                <span className={styles.dot} style={{ background: r.color }} />
                <span>{r.name}</span>
                <span>{r.time === null ? "en course" : formatTime(r.time)}</span>
              </li>
            ))}
          </ol>
          {record !== null && <p>Record du tour : {formatTime(record)}</p>}
          <button className={styles.cta} onClick={start}>Rejouer (Entrée)</button>
        </div>
      )}
    </div>
  );
}
