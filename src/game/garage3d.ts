import type { Showroom } from "./three/showroom";

// The lobby's 3D garage, loaded on demand: Three.js and the showroom are a separate chunk, so the lobby paints first (with its 2D pictures)
// and the 3D arrives when the chunk has. null = no WebGL (or the context was lost): the lobby keeps its 2D pictures.

export type { Showroom };

export async function openShowroom(host: HTMLElement, onLost?: () => void): Promise<Showroom | null> {
  const { createShowroom } = await import("./three/showroom");
  return createShowroom(host, onLost);
}
