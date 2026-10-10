"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type ProfileActions, localActions } from "@/game/actions";
import {
  accountStartRace, accountSettleRace, getAccountState, getServerAccountState, initAccount, isSignedIn, remoteActions, subscribeAccount,
} from "@/game/account";
import { type Input, NO_INPUT, PHYS, slipOf, speedOf } from "@/game/car";
import {
  SECRET_WORD, advanceSecretBuffer, debugModeFromUrl, getDebugMode, getDebugPanelOpen, getServerDebugMode, getServerDebugPanelOpen,
  setDebugMode, subscribeDebugMode, subscribeDebugPanel, toggleDebugMode, toggleDebugPanel,
} from "@/game/debug";
import { type Race, createRace, stepRace, standings } from "@/game/race";
import { formatTime, render } from "@/game/render";
import { type ThemeId, THEMES, THEME_ORDER } from "@/game/themes";
import {
  type Profile, type RaceReport, DEBUG_PROFILE, formatMoney, getPlayerProfile, getServerPlayerProfile, savePlayerProfile, settleRace,
  subscribePlayerProfile,
} from "@/game/garage";
import { getServerSettings, getSettings, subscribeSettings } from "@/game/settings";
import { sound } from "@/game/sound";
import { AccountNotice } from "./AccountPanel";
import DebugPanel from "./DebugPanel";
import Fireworks from "./Fireworks";
import Lobby from "./Lobby";
import SoundButton from "./SoundButton";
import styles from "./Game.module.css";

const KEYS: Record<string, keyof Input> = {
  ArrowUp: "throttle", KeyW: "throttle", KeyZ: "throttle",
  ArrowDown: "brake", KeyS: "brake",
  ArrowLeft: "left", KeyA: "left", KeyQ: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "handbrake",
  // The Racerz Jet's flight: hold Shift (Shift was free; Space stays the handbrake).
  ShiftLeft: "fly", ShiftRight: "fly",
};
const STEP = 1 / 120;

type Result = { name: string; color: string; time: number | null; isPlayer: boolean };

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raceRef = useRef<Race | null>(null);
  const inputRef = useRef<Input>({ ...NO_INPUT });
  const [screen, setScreen] = useState<"menu" | "race" | "results">("menu");
  // The current race's car can fly (Racerz Jet): shows the touch "Vol" button.
  const [canFly, setCanFly] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [mode, setMode] = useState<ThemeId>("countryside");
  // Best lap per mode, kept for the session only.
  const [records, setRecords] = useState<Partial<Record<ThemeId, number>>>({});
  const record = records[mode] ?? null;
  // Debug mode: locked by default, unlocked for the session via ?debug=1 or the
  // "debug" secret sequence (see below). External store to read it without any
  // hydration mismatch on this statically prerendered page.
  const debugMode = useSyncExternalStore(subscribeDebugMode, getDebugMode, getServerDebugMode);
  // Lives in the debug store itself (not local state) so turning debug mode
  // off always closes the panel too, instead of leaving it open for next time.
  const debugPanelOpen = useSyncExternalStore(subscribeDebugPanel, getDebugPanelOpen, getServerDebugPanelOpen);
  const secretBufferRef = useRef("");
  useEffect(() => {
    if (debugModeFromUrl()) setDebugMode(true);
  }, []);
  // Money, cars and skins. The player profile is persisted to localStorage
  // (external store, read without hydration mismatch); debug mode plays with
  // its own in-memory profile so purchases/earnings there never leak into the
  // player's, and vice versa.
  const playerProfile = useSyncExternalStore(subscribePlayerProfile, getPlayerProfile, getServerPlayerProfile);
  const [debugProfile, setDebugProfile] = useState<Profile>(DEBUG_PROFILE);
  const debugProfileRef = useRef(debugProfile);
  const profile = debugMode ? debugProfile : playerProfile;
  // Accounts (Supabase, optional): a signed-in player's purchases and winnings go through the server.
  const account = useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
  const actions: ProfileActions = debugMode
    ? localActions(() => debugProfile, setDebugProfile)
    : account.status === "signedIn"
      ? remoteActions
      : localActions(getPlayerProfile, savePlayerProfile);
  const { muted } = useSyncExternalStore(subscribeSettings, getSettings, getServerSettings);
  useEffect(() => {
    void initAccount();
  }, []);
  useEffect(() => {
    sound.setMuted(muted);
  }, [muted]);
  // Browsers only allow audio after a user gesture: the first key press or click creates it.
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);
  // Which profile was active when the current race started (toggling mid-race must not matter).
  const raceIsDebugRef = useRef(false);
  const [report, setReport] = useState<RaceReport | null>(null);
  // Balance right after settlement, so the results screen keeps showing it
  // even if the player toggles debug mode (and so switches `profile`) afterwards.
  const [settledBalance, setSettledBalance] = useState<number | null>(null);
  useEffect(() => {
    debugProfileRef.current = debugProfile;
  }, [debugProfile]);

  const start = useCallback(() => {
    const isDebugRace = getDebugMode();
    raceIsDebugRef.current = isDebugRace;
    const p = isDebugRace ? debugProfileRef.current : getPlayerProfile();
    const car = p.cars[p.selected] ?? { level: 1, skin: "factory" as const };
    if (!isDebugRace && isSignedIn()) accountStartRace();
    raceRef.current = createRace(mode, { model: p.selected, skin: car.skin, level: car.level });
    setCanFly(raceRef.current.flight !== null);
    inputRef.current = { ...NO_INPUT };
    setScreen("race");
  }, [mode]);

  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      // Typing in a form field (sign-in) must not drive the car or start a race.
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (down && !e.repeat) {
        // Enter/Space start from the menu or results (Space is the handbrake while racing).
        if ((e.code === "Enter" || e.code === "Space") && screen !== "race") {
          e.preventDefault();
          start();
          return;
        }
        if (e.code === "KeyR" && screen !== "menu") return start();
        if (debugMode && e.code === "KeyH") return toggleDebugPanel();
        const digit = /^(Digit|Numpad)([1-4])$/.exec(e.code);
        if (digit && screen === "menu") return setMode(THEME_ORDER[Number(digit[2]) - 1]);
        // Hidden unlock: typing "debug" toggles debug mode for the session, on any screen.
        secretBufferRef.current = advanceSecretBuffer(secretBufferRef.current, e.key);
        if (secretBufferRef.current === SECRET_WORD) {
          secretBufferRef.current = "";
          toggleDebugMode();
        }
      }
      const k = KEYS[e.code];
      if (!k) return;
      e.preventDefault();
      inputRef.current = { ...inputRef.current, [k]: down };
    };
    const kd = (e: KeyboardEvent) => set(e, true);
    const ku = (e: KeyboardEvent) => set(e, false);
    // Losing the focus (or the tab) swallows the key-up events: let go of everything, Shift included.
    const release = () => {
      inputRef.current = { ...NO_INPUT };
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, [screen, start, debugMode]);

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
    sound.startEngine();

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

      const me = race.cars[0];
      for (const power of race.crashes.splice(0)) sound.crash(power);
      for (const cue of race.cues.splice(0)) sound.cue(cue.kind, cue.power);
      if (race.phase === "finished") sound.stopEngine();
      else {
        sound.drive({
          speedRatio: Math.abs(speedOf(me)) / (PHYS.maxSpeed * me.skill), throttle: inputRef.current.throttle && me.stun <= 0,
          slip: slipOf(me), onRoad: me.surface === "track",
        });
      }

      if (race.phase === "finished" && !resultsShown) {
        resultsShown = true;
        const best = race.cars[0].bestLap;
        const id = race.theme.id;
        if (best !== null) setRecords((r) => (best < (r[id] ?? Infinity) ? { ...r, [id]: best } : r));
        const player = race.cars[0];
        const place = standings(race).indexOf(player) + 1;
        // Settle the profile that was active at race start, not whatever is active now.
        const isDebugRace = raceIsDebugRef.current;
        const current = isDebugRace ? debugProfileRef.current : getPlayerProfile();
        const settled = settleRace(current, place, player.offTime / Math.max(1, player.finishTime ?? race.time), player.hits);
        const onAccount = !isDebugRace && isSignedIn();
        if (isDebugRace) {
          debugProfileRef.current = settled.profile;
          setDebugProfile(settled.profile);
        } else {
          savePlayerProfile(settled.profile); // signed in: shown right away, the server then has the last word
        }
        setReport(settled.report);
        setSettledBalance(settled.profile.money);
        if (onAccount) {
          void accountSettleRace(place, player.offTime / Math.max(1, player.finishTime ?? race.time), player.hits).then((srv) => {
            if (srv) setReport((r) => r && { ...r, earned: srv.earned, palier: srv.palier, levelUp: srv.levelUp });
            setSettledBalance(getPlayerProfile().money);
          });
        }
        if (place === 1) sound.victory();
        else sound.finish();
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
      sound.stopEngine();
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
    <div
      className={styles.root}
      onClickCapture={(e) => {
        // Menu click sound for every button, except the ones that opt out (touch pad, mute).
        const b = (e.target as HTMLElement).closest("button");
        if (b && !b.closest("[data-nosound]")) sound.click();
      }}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
      <AccountNotice />
      {screen !== "menu" && <SoundButton floating />}
      {debugMode && debugPanelOpen && <DebugPanel raceRef={raceRef} mode={mode} />}

      {screen === "race" && (
        <div className={styles.touch} data-nosound>
          <div className={styles.pad}>
            <button {...touch("left")} aria-label="Gauche">◀</button>
            <button {...touch("right")} aria-label="Droite">▶</button>
          </div>
          {canFly && (
            <div className={styles.pad}>
              <button {...touch("fly")} aria-label="Vol (maintenu)" className={styles.flyBtn}>Vol</button>
            </div>
          )}
          <div className={styles.pad}>
            <button {...touch("brake")} aria-label="Frein">▼</button>
            <button {...touch("throttle")} aria-label="Accélérer">▲</button>
          </div>
        </div>
      )}

      {screen === "menu" && (
        <Lobby profile={profile} actions={actions} mode={mode} setMode={setMode} record={record} onStart={start} debug={debugMode} />
      )}

      {screen === "results" && report?.place === 1 && <Fireworks />}

      {screen === "results" && (
        <div className={styles.overlay}>
          <h2 className={styles.title}>{report?.place === 1 ? "Victoire !" : "Arrivée"}</h2>
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
          {report && (
            <div className={styles.report}>
              <div className={styles.earned}>+{formatMoney(report.earned)}</div>
              <ul>
                {report.checks.map((c) => (
                  <li key={c.label} className={c.ok ? styles.ok : styles.ko}>{c.ok ? "✔" : "✘"} {c.label}</li>
                ))}
              </ul>
              <p>
                {report.levelUp !== null
                  ? `🎉 Niveau ${report.levelUp} atteint !`
                  : report.palier
                    ? "Palier gagné !"
                    : "Pas de palier cette fois."}{" "}
                Solde : {formatMoney(settledBalance ?? profile.money)}
              </p>
            </div>
          )}
          {record !== null && <p>Record du tour ({THEMES[mode].name}) : {formatTime(record)}</p>}
          <div className={styles.actions}>
            <button className={styles.cta} onClick={start}>Rejouer (Entrée)</button>
            <button className={`${styles.cta} ${styles.ghost}`} onClick={() => setScreen("menu")}>Lobby / changer de mode</button>
          </div>
        </div>
      )}
    </div>
  );
}
