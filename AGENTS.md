<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# racerz

Jeu web de course 2D (canvas) sur circuit, déployé sur Vercel (projet `solidz/racerz`, prod : https://racerz-jet.vercel.app).

- `src/game/` — logique pure, sans React : `track.ts` (circuit Catmull-Rom fermé, `locate`, barrières à `track.barrier` de la ligne médiane), `car.ts` (`PHYS` de base + `PhysMods` par surface `track|offtrack|lava`), `race.ts` (grille, voiture du joueur, IA adaptée à l'adhérence, collisions voitures/barrières, surface, tours/classement, temps hors-piste et contacts), `render.ts` (caméra, HUD, minimap), `carArt.ts` (sprites GT / Aventador SVJ / F8 Spider + motifs de skin), `garage.ts` (voitures, prix, skins, gains par place, paliers/niveaux, profil de session).
- 4 modes d'environnement (désert, campagne, pôle Nord, volcan) : `themes.ts` (table `THEMES` : couleurs, multiplicateurs de physique par-dessus `PHYS`, décor, effets), `scenery.ts` (décor déterministe mulberry32 ; décor au-delà des barrières, lave jusqu'aux vibreurs), `layer.ts` (couche fixe sol+piste+barrières+décor peinte une fois par mode sur un canvas hors écran), `fx.ts` (animé par frame : lave, braises, fumée, flocons, poussière, nuages).
- `src/components/Game.tsx` — boucle à pas fixe (120 Hz), clavier/tactile, Entrée/Espace démarrent, R recommence ; résultats (gains, palier, rejouer / lobby) ; profil (argent, voitures, skins) et records en mémoire (session uniquement, pas de `localStorage`).
- `src/components/Lobby.tsx` — garage (choix de la voiture, achat), boutique de skins, choix du mode (1–4).
- `src/components/DebugPanel.tsx` — H : curseurs sur `PHYS` (valeurs de base, les multiplicateurs du mode s'appliquent par-dessus), « Réinitialiser » → `PHYS_DEFAULTS`, mode actif, multiplicateurs et surface sous la voiture.
- Progression = index d'échantillon de la ligne médiane, déroulé ; un tour = `path.length` échantillons.
