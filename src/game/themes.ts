import type { PhysMods } from "./car";
import type { Fx } from "./fx";
import * as countrysideMode from "./modes/countryside";
import * as desertMode from "./modes/desert";
import * as northpoleMode from "./modes/northpole";
import * as volcanoMode from "./modes/volcano";
import type { Scene } from "./scenery";
import type { Track, TrackLayout } from "./track";

export type ThemeId = "desert" | "countryside" | "northpole" | "volcano";

/** Bot difficulty for a mode. Tuned by hand against scripts/sim-bots.ts. */
export type BotDifficulty = {
  /** Average top-speed multiplier of the 3 bots (same scale as a car's `speed` stat). */
  pace: number;
  /** Spread applied symmetrically around `pace` so the bots keep distinct rhythms. */
  spread: number;
  /** Nominal mistakes per minute (gated by a per-bot cooldown, see race.ts `aiInput`). */
  errors: number;
};

export type Theme = {
  id: ThemeId;
  name: string;
  emoji: string;
  /** This mode's own circuit (control points, width, covered sections). */
  layout: TrackLayout;
  bots: BotDifficulty;
  colors: {
    /** Beyond the world bounds. */
    ground: string;
    /** Base off-track surface inside the bounds. */
    offtrack: string;
    asphalt: string;
    kerbA: string;
    kerbB: string;
    kerbWidth: number;
    /** Optional dark outline around the kerbs (`width` per side). */
    edge?: { color: string; width: number };
    /** Barrier band: base and alternating segments. */
    barrierA: string;
    barrierB: string;
    /** Dashed centre line; null = no markings on the road. */
    dash: string | null;
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
    layout: desertMode.layout,
    bots: { pace: 0.9, spread: 0.035, errors: 9 },
    colors: {
      ground: "#c4663a", offtrack: "#c4663a", asphalt: "#e2bd84", kerbA: "#e2bd84", kerbB: "#e2bd84", kerbWidth: 0, edge: { color: "#6b2f1a", width: 4 },
      barrierA: "#7a3519", barrierB: "#a65a34", dash: null, minimap: "rgba(255,236,200,0.75)", accent: "#ffb347", skid: "90,65,40",
    },
    scene: desertMode.scene,
    fx: desertMode.fx,
    // Sand brakes harder than grass.
    phys: { ...NEUTRAL, trackGrip: 0.9, offGrip: 0.8, offDrag: 1.7, offMax: 0.8 },
  },
  countryside: {
    id: "countryside",
    name: "Campagne",
    emoji: "🌾",
    layout: countrysideMode.layout,
    bots: { pace: 0.977, spread: 0.035, errors: 6 },
    colors: {
      ground: "#2f6b3a", offtrack: "#3a7d44", asphalt: "#4a4e57", kerbA: "#f1f1f1", kerbB: "#d62828", kerbWidth: 18, barrierA: "#b8bec7", barrierB: "#6b717a",
      dash: "rgba(255,255,255,0.55)", minimap: "rgba(255,255,255,0.6)", accent: "#ffd166", skid: "20,20,20",
    },
    scene: countrysideMode.scene,
    fx: countrysideMode.fx,
    phys: NEUTRAL, // reference physics
  },
  northpole: {
    id: "northpole",
    name: "Pôle Nord",
    emoji: "🐧",
    layout: northpoleMode.layout,
    bots: { pace: 0.98, spread: 0.03, errors: 3 },
    colors: {
      ground: "#dfe9f1", offtrack: "#eef4f9", asphalt: "#9fcbe6", kerbA: "#ffffff", kerbB: "#d2e4f1", kerbWidth: 30, barrierA: "#ffffff", barrierB: "#a9c8e0",
      dash: "rgba(255,255,255,0.7)", minimap: "rgba(120,180,230,0.85)", accent: "#8fd3ff", skid: "70,110,150",
    },
    scene: northpoleMode.scene,
    fx: northpoleMode.fx,
    // Ice: almost no lateral grip on the road; snow drags moderately.
    phys: { ...NEUTRAL, trackGrip: 0.22, offGrip: 0.5, offDrag: 0.6, offMax: 1.15 },
  },
  volcano: {
    id: "volcano",
    name: "Volcan",
    emoji: "🌋",
    layout: volcanoMode.layout,
    bots: { pace: 1.045, spread: 0.025, errors: 1 },
    colors: {
      ground: "#1c1514", offtrack: "#2b2321", asphalt: "#4a4543", kerbA: "#6b635f", kerbB: "#6b635f", kerbWidth: 12, edge: { color: "#15100e", width: 3 },
      barrierA: "#1e1715", barrierB: "#5c4a42", dash: null, minimap: "rgba(255,140,90,0.75)", accent: "#ff7a3d", skid: "10,8,8",
    },
    scene: volcanoMode.scene,
    fx: volcanoMode.fx,
    // Ash behaves like grass (the crater's lava is only decoration).
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
