"use client";

import { type FormEvent, useState, useSyncExternalStore } from "react";
import {
  dismissAccountMessage, getAccountState, getServerAccountState, importLocalProgress, signIn, signOut, signUp, skipImport, subscribeAccount,
} from "@/game/account";
import { formatMoney, getLocalProfile } from "@/game/garage";
import styles from "./Game.module.css";

/** Sign-in / sign-up / sign-out, and the one-time offer to move the guest save onto the account. */
export default function AccountPanel() {
  const account = useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (account.status === "off") return null; // no Supabase configured: guests only
  if (account.status === "loading") return <span className={styles.account}>Compte…</span>;

  if (account.status === "signedIn") {
    const local = getLocalProfile();
    return (
      <div className={styles.accountWrap}>
        <span className={styles.account}>
          👤 {account.email}
          <button type="button" className={styles.linkBtn} onClick={() => void signOut()}>Déconnexion</button>
        </span>
        {account.importOffer && (
          <div className={styles.accountCard} role="dialog" aria-label="Reprendre la progression locale">
            <p>
              Une progression existe sur cet appareil ({formatMoney(local.money)}, {Object.keys(local.cars).length} voiture
              {Object.keys(local.cars).length > 1 ? "s" : ""}). La reprendre sur ce compte ?
            </p>
            <p className={styles.sub}>Elle est vérifiée par le serveur (argent plafonné à 500 000 €) et ne peut être reprise qu&apos;une fois.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.small} disabled={account.busy} onClick={() => void importLocalProgress()}>Reprendre</button>
              <button type="button" className={`${styles.small} ${styles.ghostSmall}`} disabled={account.busy} onClick={() => void skipImport()}>
                Non merci
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const submit = (e: FormEvent, mode: "in" | "up") => {
    e.preventDefault();
    if (!email || password.length < 8) return;
    void (mode === "in" ? signIn(email, password) : signUp(email, password));
  };

  return (
    <div className={styles.accountWrap}>
      <button type="button" className={styles.account} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        👤 Se connecter
      </button>
      {open && (
        <form className={styles.accountCard} onSubmit={(e) => submit(e, "in")}>
          <label>
            E-mail
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Mot de passe (8 caractères min.)
            <input
              type="password" autoComplete="current-password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.small} disabled={account.busy}>Connexion</button>
            <button type="button" className={`${styles.small} ${styles.ghostSmall}`} disabled={account.busy} onClick={(e) => submit(e, "up")}>
              Créer un compte
            </button>
          </div>
          <p className={styles.sub}>Sans compte, ta progression reste sur cet appareil. Le mot de passe est géré par Supabase, jamais par le jeu.</p>
        </form>
      )}
    </div>
  );
}

/** Errors and notices from the account (refused purchase, race not validated…), dismissible. */
export function AccountNotice() {
  const account = useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
  const msg = account.error ?? account.notice;
  if (!msg) return null;
  return (
    <div className={`${styles.notice} ${account.error ? styles.noticeErr : ""}`} role="status">
      <span>{msg}</span>
      <button type="button" data-nosound onClick={dismissAccountMessage} aria-label="Fermer">✕</button>
    </div>
  );
}
