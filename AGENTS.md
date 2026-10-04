<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# racerz

Jeu web de course 2D (canvas) sur circuit, déployé sur Vercel (projet `solidz/racerz`, prod : https://racerz-jet.vercel.app).

- `src/game/` — logique pure, sans React : `track.ts` (circuit Catmull-Rom fermé, `locate`), `car.ts` (physique arcade), `race.ts` (grille, IA, collisions, tours/classement), `render.ts` (dessin canvas + HUD + minimap).
- `src/components/Game.tsx` — boucle à pas fixe (120 Hz), clavier/tactile, écrans menu/résultats ; record du tour dans `localStorage`.
- Progression = index d'échantillon de la ligne médiane, déroulé ; un tour = `path.length` échantillons.
