<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# racerz

Jeu web de course 2D (canvas) sur circuit, déployé sur Vercel (projet `solidz/racerz`, prod : https://racerz-jet.vercel.app).

- `src/game/` — logique pure, sans React : `track.ts` (circuit Catmull-Rom fermé, `locate`), `car.ts` (`PHYS` de base + `PhysMods` par surface `track|offtrack|lava`), `race.ts` (grille, IA adaptée à l'adhérence, collisions, surface, tours/classement), `render.ts` (caméra, HUD, minimap, panneau debug).
- 4 modes d'environnement (désert, campagne, pôle Nord, volcan) : `themes.ts` (table `THEMES` : couleurs, multiplicateurs de physique par-dessus `PHYS`, décor, effets), `scenery.ts` (décor déterministe mulberry32, toujours à `dist > width/2 + 30 + r` de la piste ; mares de lave du volcan), `layer.ts` (couche fixe sol+piste+décor peinte une fois par mode sur un canvas hors écran), `fx.ts` (animé par frame : lave, braises, fumée, flocons, poussière, nuages).
- `src/components/Game.tsx` — boucle à pas fixe (120 Hz), clavier/tactile, menu (choix du mode, touches 1–4), résultats (rejouer / changer de mode), H = debug ; record du tour par mode dans `localStorage`.
- Progression = index d'échantillon de la ligne médiane, déroulé ; un tour = `path.length` échantillons.
