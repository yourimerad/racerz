"use client";

import { useEffect, useRef } from "react";
import { createFireworks, drawFireworks, stepFireworks, type FireworksState } from "@/game/fireworks";
import styles from "./Fireworks.module.css";

/**
 * Full-screen, click-through firework display for the victory screen. Rendered behind the
 * results panel (see Game.tsx) so the podium and buttons stay fully readable and clickable,
 * while the bursts still fill the rest of the screen at full brightness.
 */
export default function Fireworks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const state: FireworksState = createFireworks(reducedMotion);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, canvas.clientWidth) * dpr;
      canvas.height = Math.max(1, canvas.clientHeight) * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      stepFireworks(state, dt, w, h);
      drawFireworks(ctx, state, w, h, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
