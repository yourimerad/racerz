"use client";

import { useSyncExternalStore } from "react";
import { getServerSettings, getSettings, setMuted, subscribeSettings } from "@/game/settings";
import styles from "./Game.module.css";

/** Sound on/off; the choice is saved (localStorage, and the account when signed in). */
export default function SoundButton({ floating = false }: { floating?: boolean }) {
  const { muted } = useSyncExternalStore(subscribeSettings, getSettings, getServerSettings);
  return (
    <button
      type="button"
      data-nosound
      className={`${styles.soundBtn} ${floating ? styles.soundFloat : ""}`}
      aria-pressed={muted}
      aria-label={muted ? "Activer le son" : "Couper le son"}
      title={muted ? "Activer le son" : "Couper le son"}
      onClick={(e) => {
        setMuted(!muted);
        e.currentTarget.blur(); // keep Space/Enter for the game, not for this button
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
