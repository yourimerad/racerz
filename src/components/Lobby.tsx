"use client";

import { useEffect, useRef } from "react";
import { drawCarSprite } from "@/game/carArt";
import {
  type ModelId, type Profile, type SkinId, CLEAN_MAX_HITS, CLEAN_MAX_OFF, MODEL_ORDER, MODELS, PALIERS_PER_LEVEL, PAYOUTS, SKINS, SKIN_ORDER,
  buyCar, buySkin, carStats, equipSkin, formatMoney, selectCar, skinOf,
} from "@/game/garage";
import { formatTime } from "@/game/render";
import { type ThemeId, THEMES, THEME_ORDER } from "@/game/themes";
import styles from "./Game.module.css";

function CarPreview({ model, skin, size = 3 }: { model: ModelId; skin: SkinId; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    ctx.setTransform(dpr * size, 0, 0, dpr * size, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    drawCarSprite(ctx, model, skinOf(model, skin), c.clientWidth / 2 / size, c.clientHeight / 2 / size, -Math.PI / 2);
  }, [model, skin, size]);
  return <canvas ref={ref} className={styles.preview} style={{ width: 30 * size, height: 48 * size }} />;
}

function StatBar({ label, value }: { label: string; value: number }) {
  // 1.0 = base GT; bars span 0.9 → 1.5.
  const pct = Math.max(4, Math.min(100, ((value - 0.9) / 0.6) * 100));
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <span className={styles.bar}><span style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

type Props = {
  profile: Profile;
  setProfile: (p: Profile) => void;
  mode: ThemeId;
  setMode: (m: ThemeId) => void;
  record: number | null;
  onStart: () => void;
};

export default function Lobby({ profile, setProfile, mode, setMode, record, onStart }: Props) {
  const selected = profile.cars[profile.selected];

  return (
    <div className={`${styles.overlay} ${styles.lobby}`}>
      <header className={styles.lobbyHead}>
        <h1 className={styles.logo}>RACERZ</h1>
        <div className={styles.money}>💰 {formatMoney(profile.money)}</div>
      </header>

      <div className={styles.lobbyGrid}>
        <section className={styles.panel}>
          <h2>Garage</h2>
          <div className={styles.cars}>
            {MODEL_ORDER.map((id) => {
              const owned = profile.cars[id];
              const m = MODELS[id];
              const st = carStats(id, owned?.level ?? 1);
              const affordable = profile.money >= m.price;
              return (
                <div key={id} className={`${styles.carCard} ${profile.selected === id ? styles.carOn : ""}`}>
                  <CarPreview model={id} skin={owned?.skin ?? "factory"} size={2} />
                  <div className={styles.carInfo}>
                    <strong>{m.name}</strong>
                    {owned ? (
                      <span>
                        Niv. {owned.level} · paliers {"●".repeat(owned.paliers)}{"○".repeat(PALIERS_PER_LEVEL - owned.paliers)}
                      </span>
                    ) : (
                      <span>{formatMoney(m.price)}</span>
                    )}
                    <StatBar label="Vitesse" value={st.speed} />
                    <StatBar label="Accél." value={st.accel} />
                    <StatBar label="Adhérence" value={st.grip} />
                  </div>
                  {owned ? (
                    <button className={styles.small} disabled={profile.selected === id} onClick={() => setProfile(selectCar(profile, id))}>
                      {profile.selected === id ? "Sélectionnée" : "Choisir"}
                    </button>
                  ) : (
                    <button className={styles.small} disabled={!affordable} onClick={() => setProfile(buyCar(profile, id))}>
                      {affordable ? "Acheter" : `Il manque ${formatMoney(m.price - profile.money)}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.panel}>
          <h2>Boutique de skins</h2>
          <p className={styles.sub}>Pour : {MODELS[profile.selected].name}. Un skin acheté sert sur toutes vos voitures.</p>
          <div className={styles.skins}>
            {SKIN_ORDER.map((id) => {
              const owned = profile.skins.includes(id);
              const equipped = selected?.skin === id;
              const price = id === "factory" ? 0 : SKINS[id].price;
              const skin = skinOf(profile.selected, id);
              return (
                <button
                  key={id}
                  className={`${styles.skin} ${equipped ? styles.skinOn : ""}`}
                  disabled={!owned && profile.money < price}
                  onClick={() => setProfile(owned ? equipSkin(profile, id) : buySkin(profile, id))}
                >
                  <CarPreview model={profile.selected} skin={id} size={1.4} />
                  <span>{skin.name}</span>
                  <small>{equipped ? "Équipé" : owned ? "Équiper" : formatMoney(price)}</small>
                </button>
              );
            })}
          </div>

          <h2>Course</h2>
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
          <p className={styles.sub}>
            Gains : {PAYOUTS.map((g, i) => `${i + 1}${i ? "e" : "er"} ${formatMoney(g)}`).join(" · ")}. Une victoire propre (≤ {CLEAN_MAX_OFF * 100} % hors-piste,
            ≤ {CLEAN_MAX_HITS} contacts barrière) rapporte 1 palier ; {PALIERS_PER_LEVEL} paliers = 1 niveau.
          </p>
          {record !== null && <p className={styles.sub}>Record du tour ({THEMES[mode].name}) : {formatTime(record)}</p>}
          <button className={styles.cta} onClick={onStart}>Démarrer (Entrée / Espace)</button>
          <ul className={styles.help}>
            <li><kbd>↑</kbd>/<kbd>W</kbd>/<kbd>Z</kbd> accélérer · <kbd>↓</kbd>/<kbd>S</kbd> freiner · <kbd>←</kbd><kbd>→</kbd>/<kbd>A</kbd><kbd>Q</kbd><kbd>D</kbd> tourner · <kbd>Espace</kbd> frein à main</li>
            <li><kbd>1</kbd>–<kbd>4</kbd> mode · <kbd>R</kbd> recommencer · <kbd>H</kbd> panneau debug</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
