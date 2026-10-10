"use client";

import { useContext, useEffect, useRef, useState } from "react";
import type { ProfileActions } from "@/game/actions";
import { drawJetSprite } from "@/game/jetArt";
import { ShowroomContext, Thumb } from "./GarageStage";
import { FLY_BAR, MODELS, PALIERS_PER_LEVEL, STAT_RANGE, carStats, formatMoney, skinOf, type Profile, type Skin, type StatKey } from "@/game/garage";
import styles from "./Game.module.css";

/** Showcase scale of the car on its platform, and how long the wings take to open (and to fold again). */
const SHOW_SCALE = 1.7;
const WING_LEG = 0.6;
/** Every 4 s the wings open and fold by themselves (when the screen allows motion); hovering the card does it at once. */
const DEMO_EVERY = 4000;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function paint(canvas: HTMLCanvasElement, wing: number, skin: Skin) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#1b2430";
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = Math.min(h * 0.42, 128);
  // light spot
  const spot = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55);
  spot.addColorStop(0, "#5a6f8a");
  spot.addColorStop(1, "rgba(90,111,138,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);
  // round platform: body, rim, inner ring
  const R = 96;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "#2b3646";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#5a6b80";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 14, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3f4d62";
  ctx.stroke();
  // the Jet, seen from above, at rest (wings folded unless the demo is running)
  drawJetSprite(ctx, cx, cy, -Math.PI / 2, { wing, scale: SHOW_SCALE, steady: true, skin });
}

/** Wing opening over a demo that began `t` seconds ago: 0 → 1 → 0, WING_LEG each way. */
export const demoWing = (t: number) => (t < 0 || t > 2 * WING_LEG ? 0 : t < WING_LEG ? clamp01(t / WING_LEG) : clamp01(1 - (t - WING_LEG) / WING_LEG));

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className={styles.stat} title={`${label} ${Math.round(pct)}/100`}>
      <span>{label}</span>
      <span className={styles.bar}><span style={{ width: `${Math.max(4, Math.min(100, pct))}%`, background: color }} /></span>
    </div>
  );
}

/** A stat on the garage's usual scale (see STAT_RANGE), in percent. */
const pctOf = (stat: StatKey, value: number) => {
  const { min, max } = STAT_RANGE[stat];
  return ((value - min) / (max - min)) * 100;
};

type CardProps = {
  profile: Profile;
  actions: ProfileActions;
  /** Pointer handlers that make the 3D stage look at this card's car (the lobby's), and the wrapper for the card's own buttons. */
  look?: { onPointerEnter: (e: React.PointerEvent) => void; onPointerLeave: () => void; onClick: () => void };
  act?: (f: () => void) => (e: React.MouseEvent) => void;
  seen?: boolean;
};

/**
 * The Racerz Jet's card. With the 3D garage it is a card like the others, with a 3D picture of the Jet (wings spread while the pointer is
 * over it); without WebGL it keeps its 2D showcase.
 */
export default function JetCard(props: CardProps) {
  const room = useContext(ShowroomContext);
  return room ? <JetCompact {...props} /> : <JetShowcase profile={props.profile} actions={props.actions} />;
}

function JetCompact({ profile, actions, look, act, seen }: CardProps) {
  const [open, setOpen] = useState(false);
  const m = MODELS.jet, owned = profile.cars.jet, st = carStats("jet", owned?.level ?? 1), affordable = profile.money >= m.price;
  const run = act ?? ((f: () => void) => () => f());
  return (
    <div
      className={`${styles.carCard} ${profile.selected === "jet" ? styles.carOn : ""} ${seen ? styles.carSeen : ""}`}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setOpen(true);
        look?.onPointerEnter(e);
      }}
      onPointerLeave={() => {
        setOpen(false);
        look?.onPointerLeave();
      }}
      onClick={look?.onClick}
    >
      <Thumb
        model="jet"
        skin={skinOf("jet", owned?.skin ?? "factory")}
        wing={open ? 1 : 0}
        w={132}
        h={82}
        className={styles.thumb}
        fallback={<span className={styles.thumbBox} />}
      />
      <div className={styles.carInfo}>
        <strong>
          {m.name} <span className={styles.jetNew}>NOUVEAU</span>
        </strong>
        <span className={styles.tagline}>{m.tagline}</span>
        {owned ? (
          <span>
            Niv. {owned.level} · paliers {"●".repeat(owned.paliers)}{"○".repeat(PALIERS_PER_LEVEL - owned.paliers)}
          </span>
        ) : (
          <span>{formatMoney(m.price)}</span>
        )}
        <Bar label="Vitesse" pct={pctOf("speed", st.speed)} color="#7cc0e8" />
        <Bar label="Accél." pct={pctOf("accel", st.accel)} color="#7cc0e8" />
        <Bar label="Adhérence" pct={pctOf("grip", st.grip)} color="#7cc0e8" />
        <Bar label="Vol" pct={FLY_BAR} color="#ffd45a" />
        <span className={styles.jetKeyInline}>SHIFT = vol</span>
      </div>
      {owned ? (
        <button className={styles.small} disabled={profile.selected === "jet"} onClick={run(() => actions.selectCar("jet"))}>
          {profile.selected === "jet" ? "Sélectionnée" : "Choisir"}
        </button>
      ) : (
        <button className={`${styles.small} ${styles.jetBuyBtn}`} disabled={!affordable} onClick={run(() => actions.buyCar("jet"))}>
          {affordable ? "Acheter" : `Il manque ${formatMoney(m.price - profile.money)}`}
        </button>
      )}
    </div>
  );
}

/** The 2D showcase (no WebGL): a dark stage with a spot light and a platform, the car on it, its bars (with its own "Vol"), and the buy button. */
function JetShowcase({ profile, actions }: { profile: Profile; actions: ProfileActions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const demoStart = useRef<number | null>(null);
  const raf = useRef(0);
  /** Starts the wing demo (set by the effect below, called on hover). */
  const demoRef = useRef<(() => void) | null>(null);
  const m = MODELS.jet;
  const owned = profile.cars.jet;
  const st = carStats("jet", owned?.level ?? 1);
  const affordable = profile.money >= m.price;
  // The Jet on the stage wears the skin it has on in the garage; the effect below reads it through a ref so it keeps its timers.
  const skin = skinOf("jet", owned?.skin ?? "factory");
  const skinRef = useRef(skin);
  const repaint = useRef<(() => void) | null>(null);
  useEffect(() => {
    skinRef.current = skin;
    repaint.current?.();
  }, [skin]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const draw = (now: number) => {
      const t = demoStart.current === null ? -1 : (now - demoStart.current) / 1000;
      paint(canvas, demoWing(t), skinRef.current);
      if (demoStart.current !== null && t <= 2 * WING_LEG) raf.current = requestAnimationFrame(draw);
      else {
        demoStart.current = null;
        raf.current = 0;
      }
    };
    const demo = () => {
      if (raf.current || document.hidden) return;
      demoStart.current = performance.now();
      raf.current = requestAnimationFrame(draw);
    };
    demoRef.current = demo;
    repaint.current = () => !raf.current && paint(canvas, 0, skinRef.current);
    repaint.current();
    const onResize = () => repaint.current?.();
    window.addEventListener("resize", onResize);
    const timer = still ? 0 : window.setInterval(demo, DEMO_EVERY);
    return () => {
      repaint.current = null;
      window.removeEventListener("resize", onResize);
      if (timer) window.clearInterval(timer);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  return (
    <div
      className={`${styles.jetCard} ${profile.selected === "jet" ? styles.carOn : ""}`}
      onPointerEnter={() => demoRef.current?.()}
    >
      <canvas ref={ref} className={styles.jetArt} aria-hidden="true" />
      <div className={styles.jetTop}>
        <div>
          <span className={styles.jetName}>{m.name}</span>
          <span className={styles.jetNew}>NOUVEAU</span>
          <div className={styles.jetTag}>{owned ? `Niv. ${owned.level} · paliers ${"●".repeat(owned.paliers)}${"○".repeat(PALIERS_PER_LEVEL - owned.paliers)}` : m.tagline}</div>
        </div>
        {!owned && <span className={styles.jetPrice}>{formatMoney(m.price)}</span>}
      </div>
      <div className={styles.jetBottom}>
        <div className={styles.jetStats}>
          <Bar label="Vitesse" pct={pctOf("speed", st.speed)} color="#7cc0e8" />
          <Bar label="Accél." pct={pctOf("accel", st.accel)} color="#7cc0e8" />
          <Bar label="Adhérence" pct={pctOf("grip", st.grip)} color="#7cc0e8" />
          <Bar label="Vol" pct={FLY_BAR} color="#ffd45a" />
        </div>
        <div className={styles.jetBuy}>
          {owned ? (
            <button className={styles.small} disabled={profile.selected === "jet"} onClick={() => actions.selectCar("jet")}>
              {profile.selected === "jet" ? "Sélectionnée" : "Choisir"}
            </button>
          ) : (
            <button className={`${styles.small} ${styles.jetBuyBtn}`} disabled={!affordable} onClick={() => actions.buyCar("jet")}>
              {affordable ? "Acheter" : `Il manque ${formatMoney(m.price - profile.money)}`}
            </button>
          )}
          <span className={styles.jetKey}>SHIFT = vol</span>
        </div>
      </div>
    </div>
  );
}

