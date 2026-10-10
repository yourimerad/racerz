"use client";

import { type ReactNode, type RefObject, createContext, useContext, useEffect, useState } from "react";
import { type ModelId, type Skin } from "@/game/garage";
import { type Showroom, openShowroom } from "@/game/garage3d";

/** The lobby's showroom, once it is ready (null while it loads, and for good when there is no WebGL). */
export const ShowroomContext = createContext<Showroom | null>(null);

/**
 * Owns the showroom: opens it in `host` when the lobby is shown and frees it (geometries, textures, the GL context) when the lobby goes away,
 * so the race that follows starts from a clean slate. `failed` = no WebGL, or the context was lost: the 2D pictures stay.
 */
export function useShowroom(host: RefObject<HTMLElement | null>): { room: Showroom | null; failed: boolean } {
  const [room, setRoom] = useState<Showroom | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false, mine: Showroom | null = null;
    openShowroom(el, () => {
      if (dead) return;
      setRoom(null);
      setFailed(true);
    })
      .then((r) => {
        if (dead) return r?.dispose();
        if (!r) return setFailed(true);
        mine = r;
        setRoom(r);
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      mine?.dispose();
    };
  }, [host]);
  return { room, failed };
}

/** A car's picture in a paint: the 3D one when the showroom is ready, `fallback` (the 2D sprite) until then and when there is no WebGL. */
export function Thumb({ model, skin, wing = 0, w, h, className, fallback }: { model: ModelId; skin: Skin; wing?: number; w: number; h: number; className?: string; fallback: ReactNode }) {
  const room = useContext(ShowroomContext);
  const key = `${model}|${skin.name}|${skin.body}|${wing}|${w}x${h}`;
  const [got, setGot] = useState<{ key: string; url: string | null }>({ key: "", url: null });
  useEffect(() => {
    if (!room) return;
    let live = true;
    room.thumb(model, skin, { wing, w, h }).then((url) => live && setGot({ key, url }));
    return () => {
      live = false;
    };
  }, [room, model, skin, wing, w, h, key]);
  const url = room && got.key === key ? got.url : null;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} width={w} height={h} alt="" className={className} draggable={false} /> : <>{fallback}</>;
}
