"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { type Profile, MODELS, skinOf } from "@/game/garage";
import {
  clearRoomFromUrl, getNetState, getPlayerName, getServerNetState, inviteLink, myId, netKind, netSession, roomFromUrl, setPlayerName, subscribeNet,
} from "@/game/net/client";
import { NET } from "@/game/net/protocol";
import { type ThemeId, THEMES, THEME_ORDER } from "@/game/themes";
import styles from "./Game.module.css";

type Props = {
  profile: Profile;
  /** The environment picked in the lobby (the room's mode is the host's, once in a room). */
  mode: ThemeId;
  setMode: (m: ThemeId) => void;
  debug: boolean;
  onClose: () => void;
};

function ModeChips({ value, onPick, disabled }: { value: ThemeId; onPick: (m: ThemeId) => void; disabled?: boolean }) {
  return (
    <div className={styles.modes} role="radiogroup" aria-label="Environnement">
      {THEME_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          disabled={disabled}
          className={value === id ? `${styles.mode} ${styles.modeOn}` : styles.mode}
          style={{ "--accent": THEMES[id].colors.accent } as React.CSSProperties}
          onClick={() => onPick(id)}
        >
          <span className={styles.modeEmoji}>{THEMES[id].emoji}</span>
          <span>{THEMES[id].name}</span>
        </button>
      ))}
    </div>
  );
}

/** Online mode: a quick match against real players, or a room with a code to race friends. Same game, same four environments. */
export default function Multiplayer({ profile, mode, setMode, debug, onClose }: Props) {
  const net = useSyncExternalStore(subscribeNet, getNetState, getServerNetState);
  const session = netSession();
  const kind = netKind();
  const [name, setName] = useState(() => getPlayerName());
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const car = profile.cars[profile.selected];

  /** Tells the session who is playing (name, car, paint); returns the name as the others will see it. */
  const identifyAs = (typed: string) => {
    const clean = setPlayerName(typed);
    session.setIdentity({ id: myId(), name: clean, model: profile.selected, skin: car?.skin ?? "factory", level: car?.level ?? 1 });
    return clean;
  };
  const identify = () => setName(identifyAs(name));

  // A friend's invitation link (?room=ABCD) joins the room as soon as the panel opens.
  useEffect(() => {
    const c = roomFromUrl();
    if (!c || debug || !kind || session.getState().phase !== "idle") return;
    clearRoomFromUrl();
    identifyAs(name);
    session.joinRoom(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = (what: "code" | "link", text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1800);
      },
      () => undefined,
    );
  };

  /** Closing the panel ends a search or leaves a room: nothing keeps running out of sight. */
  const close = () => {
    if (net.phase !== "idle" && net.phase !== "starting") session.leave();
    onClose();
  };
  const inRoom = net.phase === "room" || (net.phase === "starting" && net.kind === "friends");
  const shownMode = net.phase === "idle" ? mode : net.mode;

  let body: React.ReactNode;
  if (debug) {
    body = <p className={styles.sub}>Le mode en ligne est désactivé en mode debug (le profil de test ne se mélange pas aux vrais joueurs). Retape « debug » pour quitter ce mode.</p>;
  } else if (!kind) {
    body = <p className={styles.sub}>Le mode en ligne n&apos;est pas activé sur ce site pour l&apos;instant : le serveur de jeu n&apos;est pas configuré.</p>;
  } else if (net.phase === "idle") {
    body = (
      <>
        <label className={styles.mpField}>
          <span>Ton pseudo</span>
          <input value={name} maxLength={NET.NAME_MAX} onChange={(e) => setName(e.target.value)} onBlur={() => setName(setPlayerName(name))} autoComplete="off" />
        </label>
        <ModeChips value={mode} onPick={setMode} />
        <button type="button" className={styles.cta} onClick={() => { identify(); session.quickMatch(mode); }}>
          ⚡ Partie rapide
        </button>
        <p className={styles.sub}>Tu cours contre de vrais joueurs qui cherchent une partie dans le même environnement (2 à {NET.MAX_PLAYERS} pilotes, pas de bots).</p>
        <h3 className={styles.mpSub}>Entre potes</h3>
        <button type="button" className={`${styles.cta} ${styles.ghost}`} onClick={() => { identify(); session.createRoom(mode); }}>
          Créer une salle
        </button>
        <form
          className={styles.mpJoin}
          onSubmit={(e) => {
            e.preventDefault();
            identify();
            session.joinRoom(code);
          }}
        >
          <input value={code} maxLength={6} placeholder="Code (4 lettres)" aria-label="Code de la salle" onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" />
          <button type="submit" className={styles.small} disabled={code.trim().length < 4}>Rejoindre</button>
        </form>
      </>
    );
  } else if (net.phase === "connecting") {
    body = (
      <>
        <p>Connexion au serveur de jeu…</p>
        <button type="button" className={`${styles.small} ${styles.ghostSmall}`} onClick={() => session.leave()}>Annuler</button>
      </>
    );
  } else if (net.phase === "searching") {
    body = (
      <>
        <p>
          {THEMES[net.mode].emoji} Recherche de pilotes en <strong>{THEMES[net.mode].name}</strong>…
        </p>
        <ul className={styles.mpList}>
          {net.members.map((m) => (
            <li key={m.id}>
              <span className={styles.dot} style={{ background: skinOf(m.model, m.skin).body }} />
              <span>{m.name}{m.id === myId() ? " (toi)" : ""}</span>
              <span className={styles.sub}>{MODELS[m.model].name}</span>
            </li>
          ))}
        </ul>
        <p className={styles.sub}>
          {net.members.length < NET.MIN_PLAYERS
            ? "Tu es seul pour l'instant. Garde cet écran ouvert : la course démarre dès qu'un autre pilote arrive."
            : `${net.members.length} pilotes. La course démarre à ${NET.MAX_PLAYERS}, ou dans quelques secondes avec ceux qui sont là.`}
        </p>
        <button type="button" className={`${styles.small} ${styles.ghostSmall}`} onClick={() => session.leave()}>Annuler</button>
      </>
    );
  } else if (inRoom) {
    const roomCode = net.code ?? "";
    body = (
      <>
        <div className={styles.mpCode} aria-label="Code de la salle">{roomCode}</div>
        <div className={styles.mpCopy}>
          <button type="button" className={styles.small} onClick={() => copy("code", roomCode)}>{copied === "code" ? "Copié !" : "Copier le code"}</button>
          <button type="button" className={styles.small} onClick={() => copy("link", inviteLink(roomCode))}>{copied === "link" ? "Lien copié !" : "Copier le lien"}</button>
        </div>
        <p className={styles.sub}>Envoie le code (ou le lien) à tes potes : jusqu&apos;à {NET.MAX_PLAYERS} pilotes par salle.</p>
        <ul className={styles.mpList}>
          {net.members.map((m, i) => (
            <li key={m.id}>
              <span className={styles.dot} style={{ background: skinOf(m.model, m.skin).body }} />
              <span>{m.name}{m.id === myId() ? " (toi)" : ""}{i === 0 ? " 👑" : ""}</span>
              <span className={styles.sub}>{MODELS[m.model].name} · niv. {m.level}</span>
            </li>
          ))}
        </ul>
        {net.isHost ? (
          <>
            <ModeChips value={net.mode} onPick={(m) => { setMode(m); session.setMode(m); }} />
            <button type="button" className={styles.cta} disabled={net.members.length < NET.MIN_PLAYERS || net.phase !== "room"} onClick={() => session.startRoom()}>
              {net.members.length < NET.MIN_PLAYERS ? "En attente d'un autre pilote…" : "Lancer la course"}
            </button>
          </>
        ) : (
          <p>
            {THEMES[net.mode].emoji} {THEMES[net.mode].name} — en attente du lancement par l&apos;hôte (👑)…
          </p>
        )}
        <button type="button" className={`${styles.small} ${styles.ghostSmall}`} onClick={() => session.leave()}>Quitter la salle</button>
      </>
    );
  } else {
    body = <p>La course va démarrer…</p>;
  }

  return (
    <div className={styles.mpBack} data-mp onClick={(e) => e.target === e.currentTarget && net.phase === "idle" && close()}>
      <div className={styles.mpPanel} role="dialog" aria-label="Multijoueur">
        <header className={styles.mpHead}>
          <h2>🌐 Multijoueur {net.phase !== "idle" && <small>· {THEMES[shownMode].name}</small>}</h2>
          <button type="button" className={styles.mpClose} onClick={close} aria-label="Fermer">✕</button>
        </header>
        {net.error && net.phase === "idle" && <p className={styles.mpError} role="alert">{net.error}</p>}
        {body}
      </div>
    </div>
  );
}
