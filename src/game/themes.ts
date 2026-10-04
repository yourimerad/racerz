import type { PhysMods } from "./car";
import { type Fx, countrysideFx, desertFx, northPoleFx, volcanoFx } from "./fx";
import { type Scene, SCENES } from "./scenery";
import type { Track } from "./track";

export type ThemeId = "desert" | "countryside" | "northpole" | "volcano";

export type Theme = {
  id: ThemeId;
  name: string;
  emoji: string;
  colors: {
    /** Beyond the world bounds. */
    ground: string;
    /** Base off-track surface inside the bounds. */
    offtrack: string;
    asphalt: string;
    kerbA: string;
    kerbB: string;
    kerbWidth: number;
    dash: string;
    minimap: string;
    accent: string;
    /** "r,g,b" of skid marks. */
    skid: string;
  };
  scene: (track: Track) => Scene;
  fx: Fx;
  phys: PhysMods;
};

const NEUTRAL: PhysMods = { trackGrip: 1, offGrip: 1, offDrag: 1, offMax: 1, lavaDrag: 1, lavaMax: 1 };

export const THEMES: Record<ThemeId, Theme> = {
  desert: {
    id: "desert",
    name: "Désert",
    emoji: "🏜️",
    colors: {
      ground: "#c9a466", offtrack: "#dcbc7f", asphalt: "#8c8175", kerbA: "#ece0c8", kerbB: "#b8754e", kerbWidth: 18,
      dash: "rgba(255,245,225,0.35)", minimap: "rgba(255,236,200,0.75)", accent: "#ffb347", skid: "90,65,40",
    },
    scene: SCENES.desert,
    fx: desertFx,
    // Sand brakes harder than grass.
    phys: { ...NEUTRAL, trackGrip: 0.9, offGrip: 0.8, offDrag: 1.7, offMax: 0.8 },
  },
  countryside: {
    id: "countryside",
    name: "Campagne",
    emoji: "🌾",
    colors: {
      ground: "#2f6b3a", offtrack: "#3a7d44", asphalt: "#4a4e57", kerbA: "#f1f1f1", kerbB: "#d62828", kerbWidth: 18,
      dash: "rgba(255,255,255,0.55)", minimap: "rgba(255,255,255,0.6)", accent: "#ffd166", skid: "20,20,20",
    },
    scene: SCENES.countryside,
    fx: countrysideFx,
    phys: NEUTRAL, // reference physics
  },
  northpole: {
    id: "northpole",
    name: "Pôle Nord",
    emoji: "🐧",
    colors: {
      ground: "#dfe9f1", offtrack: "#eef4f9", asphalt: "#9fcbe6", kerbA: "#ffffff", kerbB: "#d2e4f1", kerbWidth: 30,
      dash: "rgba(255,255,255,0.7)", minimap: "rgba(120,180,230,0.85)", accent: "#8fd3ff", skid: "70,110,150",
    },
    scene: SCENES.northpole,
    fx: northPoleFx,
    // Ice: almost no lateral grip on the road; snow drags moderately.
    phys: { ...NEUTRAL, trackGrip: 0.22, offGrip: 0.5, offDrag: 0.6, offMax: 1.15 },
  },
  volcano: {
    id: "volcano",
    name: "Volcan",
    emoji: "🌋",
    colors: {
      ground: "#1c1514", offtrack: "#2b2321", asphalt: "#3b3534", kerbA: "#26201f", kerbB: "#ff5a1f", kerbWidth: 18,
      dash: "rgba(255,170,120,0.55)", minimap: "rgba(255,140,90,0.75)", accent: "#ff7a3d", skid: "10,8,8",
    },
    scene: SCENES.volcano,
    fx: volcanoFx,
    // Ash behaves like grass; lava pools nearly stop the car.
    phys: { ...NEUTRAL, lavaDrag: 3.2, lavaMax: 0.3 },
  },
};

export const THEME_ORDER: ThemeId[] = ["desert", "countryside", "northpole", "volcano"];

const scenes = new Map<ThemeId, Scene>();
/** Scenery is deterministic, so it is generated once per mode. */
export function sceneFor(theme: Theme, track: Track): Scene {
  let s = scenes.get(theme.id);
  if (!s) scenes.set(theme.id, (s = theme.scene(track)));
  return s;
}
