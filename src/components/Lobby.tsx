"use client";

import { useEffect, useRef, useState } from "react";
import type { ProfileActions } from "@/game/actions";
import { drawCarSprite } from "@/game/carArt";
import {
  type ModelId, type Profile, type SkinId, type StatKey, CLEAN_MAX_HITS, CLEAN_MAX_OFF, MODEL_ORDER, MODELS, PALIERS_PER_LEVEL, PAYOUTS, SKINS,
  STAT_RANGE, carStats, formatMoney, skinOf, skinsFor,
} from "@/game/garage";
import { stageChoice } from "@/game/garageView";
import { formatTime } from "@/game/render";
import { type ThemeId, THEMES, THEME_ORDER } from "@/game/themes";
import AccountPanel from "./AccountPanel";
import { ShowroomContext, Thumb, useShowroom } from "./GarageStage";
import JetCard from "./JetCard";
import SoundButton from "./SoundButton";
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
    // The Jet is 25 % longer than a car: drawn a little smaller so its nose and tail stay in the frame.
    const k = size * (model === "jet" ? 0.9 : 1);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    drawCarSprite(ctx, model, skinOf(model, skin), c.clientWidth / 2 / k, c.clientHeight / 2 / k, -Math.PI / 2);
  }, [model, skin, size]);
  return <canvas ref={ref} className={styles.preview} style={{ width: 30 * size, height: 48 * size }} />;
}

function StatBar({ label, stat, value }: { label: string; stat: StatKey; value: number }) {
  // Range derived from MODELS (see STAT_RANGE), so each car's bars reflect its real place in the lineup.
  const { min, max } = STAT_RANGE[stat];
  const pct = Math.max(4, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <span className={styles.bar}><span style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

type Props = {
  profile: Profile;
  actions: ProfileActions;
  mode: ThemeId;
  setMode: (m: ThemeId) => void;
  record: number | null;
  onStart: () => void;
  debug: boolean;
};

export default function Lobby({ profile, actions, mode, setMode, record, onStart, debug }: Props) {
  const selected = profile.cars[profile.selected];
  const stageRef = useRef<HTMLDivElement>(null);
  const { room, failed } = useShowroom(stageRef);
  // What the stage shows: the equipped car, or the car being looked at (hovered / tapped in the list), or the skin being tried on.
  const [hoverCar, setHoverCar] = useState<ModelId | null>(null);
  const [focusCar, setFocusCar] = useState<ModelId | null>(null);
  const [hoverSkin, setHoverSkin] = useState<SkinId | null>(null);
  const choice = stageChoice(profile, { hoverCar, focusCar, hoverSkin });
  const shownSkin = skinOf(choice.model, choice.skin);
  useEffect(() => {
    room?.show(choice.model, skinOf(choice.model, choice.skin));
  }, [room, choice.model, choice.skin]);
  const shownModel = MODELS[choice.model], shownOwned = profile.cars[choice.model];
  const look = (id: ModelId) => ({
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && setHoverCar(id),
    onPointerLeave: () => setHoverCar(null),
    onClick: () => setFocusCar(id),
  });
  /** A button inside a card acts on its own: it must not also "look at" the card. */
  const act = (f: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setFocusCar(null);
    f();
  };

  return (
    <ShowroomContext.Provider value={room}>
    <div className={`${styles.overlay} ${styles.lobby}`}>
      <header className={styles.lobbyHead}>
        <div>
          <h1 className={styles.logo}>RACERZ</h1>
          <p className={styles.credit}>créé par Andrea Tranchant</p>
        </div>
        <div className={styles.headRight}>
          <AccountPanel />
          <SoundButton />
          <div className={styles.money}>
            💰 {formatMoney(profile.money)}
            {debug && <span className={styles.debugBadge}>DEBUG</span>}
          </div>
        </div>
      </header>

      <div className={styles.lobbyGrid}>
        <section className={styles.panel}>
          <h2>Garage</h2>
          <div className={styles.cars}>
            {MODEL_ORDER.map((id) => {
              if (id === "jet") return <JetCard key={id} profile={profile} actions={actions} look={look(id)} act={act} seen={choice.model === id} />;
              const owned = profile.cars[id];
              const m = MODELS[id];
              const st = carStats(id, owned?.level ?? 1);
              const affordable = profile.money >= m.price;
              return (
                <div key={id} className={`${styles.carCard} ${profile.selected === id ? styles.carOn : ""} ${choice.model === id ? styles.carSeen : ""}`} {...look(id)}>
                  <Thumb
                    model={id}
                    skin={skinOf(id, owned?.skin ?? "factory")}
                    w={132}
                    h={82}
                    className={styles.thumb}
                    fallback={<span className={styles.thumbBox}><CarPreview model={id} skin={owned?.skin ?? "factory"} size={1.6} /></span>}
                  />
                  <div className={styles.carInfo}>
                    <strong>{m.name}</strong>
                    <span className={styles.tagline}>{m.tagline}</span>
                    {owned ? (
                      <span>
                        Niv. {owned.level} · paliers {"●".repeat(owned.paliers)}{"○".repeat(PALIERS_PER_LEVEL - owned.paliers)}
                      </span>
                    ) : (
                      <span>{formatMoney(m.price)}</span>
                    )}
                    <StatBar label="Vitesse" stat="speed" value={st.speed} />
                    <StatBar label="Accél." stat="accel" value={st.accel} />
                    <StatBar label="Adhérence" stat="grip" value={st.grip} />
                  </div>
                  {owned ? (
                    <button className={styles.small} disabled={profile.selected === id} onClick={act(() => actions.selectCar(id))}>
                      {profile.selected === id ? "Sélectionnée" : "Choisir"}
                    </button>
                  ) : (
                    <button className={styles.small} disabled={!affordable} onClick={act(() => actions.buyCar(id))}>
                      {affordable ? "Acheter" : `Il manque ${formatMoney(m.price - profile.money)}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.stagePanel} aria-label="Aperçu de la voiture">
          <div ref={stageRef} className={styles.stageHost} />
          {!room && (
            <div className={styles.stageFallback}>
              <CarPreview model={choice.model} skin={choice.skin} size={4} />
              <span>{failed ? "3D indisponible sur cet appareil" : "Chargement du garage 3D…"}</span>
            </div>
          )}
          <div className={styles.stageCaption}>
            <span className={`${styles.stageTag} ${choice.preview ? styles.stageTagTry : ""}`}>{choice.preview ? "Aperçu" : "Ta voiture"}</span>
            <strong>{shownModel.name}</strong>
            <span>
              {shownSkin.name} · {shownOwned ? `Niv. ${shownOwned.level}` : formatMoney(shownModel.price)}
            </span>
          </div>
          {room && <span className={styles.stageHint}>Glisse pour tourner la voiture</span>}
        </section>

        <section className={styles.panel}>
          <h2>Boutique de skins</h2>
          <p className={styles.sub}>
            Pour : {MODELS[profile.selected].name}.{" "}
            {profile.selected === "jet"
              ? "Les skins de la Jet ne vont que sur elle."
              : "Un skin acheté sert sur toutes vos voitures, sauf la Racerz Jet qui a les siens."}
          </p>
          <div className={styles.skins}>
            {skinsFor(profile.selected).map((id) => {
              const owned = profile.skins.includes(id);
              const equipped = (selected?.skin ?? "factory") === id;
              const price = id === "factory" ? 0 : SKINS[id].price;
              const skin = skinOf(profile.selected, id);
              return (
                <button
                  key={id}
                  className={`${styles.skin} ${equipped ? styles.skinOn : ""}`}
                  disabled={!owned && profile.money < price}
                  onClick={() => {
                    setHoverSkin(null);
                    if (owned) actions.equipSkin(id);
                    else actions.buySkin(id);
                  }}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setHoverSkin(id)}
                  onPointerLeave={() => setHoverSkin(null)}
                  onFocus={() => setHoverSkin(id)}
                  onBlur={() => setHoverSkin(null)}
                >
                  <Thumb
                    model={profile.selected}
                    skin={skin}
                    w={120}
                    h={75}
                    className={styles.skinThumb}
                    fallback={<CarPreview model={profile.selected} skin={id} size={1.2} />}
                  />
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
            <li><kbd>Shift</kbd> (maintenu) voler, avec la Racerz Jet</li>
            <li>
              <kbd>1</kbd>–<kbd>4</kbd> mode · <kbd>R</kbd> recommencer{debug && <> · <kbd>H</kbd> panneau debug</>}
            </li>
          </ul>
        </section>
      </div>
    </div>
    </ShowroomContext.Provider>
  );
}
