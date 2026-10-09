# Racerz

Jeu web de course 2D (canvas), voir `AGENTS.md` pour l'architecture. Prod : https://racerz-jet.vercel.app

## Comptes joueurs (optionnel, Supabase)

Sans configuration, le jeu fonctionne comme avant : progression sauvegardée dans le navigateur (`localStorage`).
Pour activer les comptes (inscription / connexion, progression sauvegardée par compte) :

1. Créez un projet sur [supabase.com](https://supabase.com) (Authentication → Providers → Email activé).
2. Dans **SQL Editor**, exécutez le contenu de [`supabase/schema.sql`](supabase/schema.sql) (rejouable sans risque).
3. Renseignez les deux variables suivantes (Project Settings → API), en local dans `.env.local` et sur Vercel
   (Project → Settings → Environment Variables), puis redéployez :

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # clé « anon » publique, jamais la clé service_role
   ```

Sécurité : les mots de passe ne sont jamais gérés par le jeu (Supabase Auth). La table `profiles` est protégée par
Row Level Security : chaque joueur ne lit que sa ligne et **aucun client ne peut l'écrire**. Achats, gains, paliers
et niveaux passent par des fonctions SQL (`buy_car`, `buy_skin`, `settle_race`…) qui recalculent l'argent côté
serveur (prix, solde, gains par place). Limite connue : le résultat d'une course est rapporté par le navigateur
(pas de simulation serveur) ; il est borné par un ticket `start_race` à usage unique et une durée minimale de 20 s.
Si vous changez des prix ou des gains dans `src/game/garage.ts`, reportez-les dans `supabase/schema.sql`.

À la première connexion, une progression locale existante peut être reprise sur le compte (une seule fois, vérifiée
et plafonnée à 500 000 € côté serveur).

## Développement

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm lint
pnpm check:tracks # contrôle des tracés (Node 22.18+ / 25)
pnpm sim          # courses simulées pour régler les bots
```

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
