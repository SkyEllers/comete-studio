# CLAUDE.md — cometestudio.fr (hub client Comète Studio)

AGENTS.md est généré par Next ; en cas de conflit, CLAUDE.md prime.

Lu par Claude Code à chaque session. Décrit le projet, la stack, les conventions et les interdits. Les briefs détaillés par phase sont dans `docs/` : on exécute un chantier à la fois, dans l'ordre, et on ne passe au suivant qu'après le « go » de Louis.

## 1. Le projet en 5 lignes

- `cometestudio.fr` est l'espace client de Comète Studio (Louis Girault, Lyon). Ce n'est plus un site vitrine : la vitrine publique est `louisgirault.fr`.
- Un client se connecte (email + mot de passe), arrive dans son espace et n'y voit que les outils que Louis lui a activés.
- Louis administre tout depuis `/admin` : clients (organisations), membres, activation des outils.
- Premier outil : un kanban façon Trello, collaboratif (phase 2). D'autres outils suivront, tous branchés sur le même socle d'accès.
- Rien n'est indexable : header `X-Robots-Tag: noindex, nofollow` sur toutes les routes, `robots.txt` en `Disallow: /`.

## 2. Stack (décisions actées, ne pas rediscuter)

| Brique | Choix | Notes |
|---|---|---|
| Framework | Next.js, App Router, TypeScript strict, dossier `src/` | Dernière version stable au moment du scaffold. Suivre la doc de la version installée (ex. : à partir de Next 16, `proxy.ts` remplace `middleware.ts`). |
| Styles | Tailwind CSS (version posée par create-next-app) + shadcn/ui | Tokens de la charte dans `src/app/globals.css` (bloc `@theme` en Tailwind v4). |
| Backend | Supabase : Auth, Postgres + RLS, Realtime, Storage | Projet en région EU. Accès via `@supabase/ssr` (client serveur + client navigateur). |
| Auth | Email + mot de passe. Pas d'inscription publique : invitation par Louis uniquement | Réinitialisation par email. Flux serveur : route `/auth/confirm` + `verifyOtp` (doc Supabase « server-side auth »). |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Kanban, phase 2. |
| Envois de fichiers | `tus-js-client` | Fichiers, phase 3 : envois reprenables du navigateur vers Storage, morceaux de 6 Mo imposés par Supabase. |
| Validation | `zod` | Toute Server Action valide ses entrées avant de toucher la base. |
| Icônes / toasts / markdown | `lucide-react` / `sonner` / `react-markdown` + `remark-gfm` | Markdown uniquement pour les descriptions de cartes (pas de HTML brut). |
| Hébergement | Vercel, projet existant, domaine déjà lié | Variables d'env dans Vercel, jamais dans le repo. |

## 3. Commandes

```bash
npm run dev          # http://localhost:3000
npm run build        # doit passer sans erreur avant tout commit
npm run lint
npm run types        # = supabase gen types typescript --linked > src/lib/supabase/database.types.ts
npx supabase migration new <nom>   # nouvelle migration dans supabase/migrations/
npx supabase db push               # applique les migrations au projet lié

npm run qa:isolation # bancs de QA : isolation entre organisations, via l'API REST
npm run qa:routes    # gardes de routes ; demande un serveur (npx next start -p 3100)
npm run qa:fichiers  # isolation de l'outil Fichiers : tables et Storage
```

Les deux bancs de `scripts/` écrivent dans le projet Supabase lié : ils créent
des comptes et des organisations préfixés `zz-qa-`, puis les suppriment et
vérifient qu'il n'en reste rien. À rejouer avant chaque mise en production.

## 4. Structure du repo

```
src/
├── app/
│   ├── (auth)/                       # "/" = page de connexion ; mot-de-passe-oublie/ ; reinitialiser/ ; invitation/
│   ├── auth/confirm/route.ts         # échange token_hash → session, puis redirige vers ?next=
│   ├── app/
│   │   ├── page.tsx                  # dispatch : 0 organisation → message ; 1 → redirect ; n → liste
│   │   ├── profil/
│   │   └── [orgSlug]/
│   │       ├── layout.tsx            # requireMembership(orgSlug)
│   │       ├── page.tsx              # grille des outils activés
│   │       └── (tools)/
│   │           └── kanban/           # layout.tsx = requireToolAccess(orgSlug, 'kanban') ; pages de l'outil
│   ├── admin/                        # layout.tsx = requireAdmin() ; clients/ ; clients/[id]/ ; outils/
│   ├── mentions-legales/  confidentialite/
│   ├── layout.tsx  globals.css  not-found.tsx
├── components/
│   ├── ui/                           # shadcn/ui (généré ; on ne le retouche que pour le thème)
│   ├── auth/  app/  admin/           # composants métier par zone
├── lib/
│   ├── supabase/                     # client.ts (navigateur), server.ts (serveur), admin.ts (service role, serveur uniquement), proxy.ts, database.types.ts
│   ├── auth.ts                       # getUser(), requireUser(), requireAdmin()
│   ├── access.ts                     # getOrgBySlug(), requireMembership(), requireToolAccess()
│   ├── validations/                  # schémas zod
│   └── utils.ts
├── tools/
│   ├── registry.ts                   # catalogue des outils internes : slug → nom, description, icône, href
│   └── kanban/                       # phase 2 : composants, mutations, hooks, palette
public/
├── fonts/  brand/  favicon.svg  favicon-16.png  favicon-32.png  apple-touch-icon.png  robots.txt
supabase/
├── config.toml
└── migrations/                       # 0001_socle.sql, 0002_kanban.sql, ...
docs/                                 # briefs par phase + docs/legacy/ (textes légaux v1)
```

## 5. Charte (héritée de la v1, à respecter)

- Couleurs : `void #0A0A0A` (fond), `bone #F2F2F0` (texte), `ember #FF6B35` (accent : actions principales et état actif, rien d'autre). Surfaces intermédiaires : `#121212` (cartes), `#1A1A1A` (survol), bordures `#262626`, texte secondaire `#9A9A96`. Sémantique : succès `#4ADE80`, alerte `#FBBF24`, erreur `#F87171`.
- Typos auto-hébergées via `next/font/local` depuis `public/fonts/` : Space Grotesk (titres, variable `--font-display`), Inter (texte, `--font-body`), JetBrains Mono (labels techniques, dates, identifiants, `--font-mono`). Jamais de Google Fonts CDN.
- Thème sombre par défaut (c'est la marque). Tous les tokens sont des variables CSS pour pouvoir ajouter un thème clair plus tard sans réécrire les composants.
- UI sobre et dense : pas de blob curseur, pas de GSAP, pas d'animation décorative. Transitions ≤ 150 ms, respect de `prefers-reduced-motion`.
- Textes de l'interface en français, tutoiement (cohérent avec la marque), sentence case, aucun jargon technique face au client (« Ton espace », pas « Dashboard »).
- Logos : `public/brand/logo-slash.svg` (icône) et `public/brand/wordmark.svg` (texte).

## 6. Modèle d'accès (résumé, détail dans docs/PHASE-1-SOCLE.md)

- `profiles` (1 par utilisateur, `is_admin` pour Louis) · `organizations` (1 par client) · `memberships` (utilisateur ↔ organisation, rôle `owner` | `member`) · `tools` (catalogue) · `organization_tools` (outil activé ou non pour une organisation).
- Règle d'or : un utilisateur ne voit que les organisations dont il est membre, et dans chacune uniquement les outils activés. Louis (`is_admin`) voit tout, mais dans un espace client il voit exactement ce que le client voit.
- Ces règles vivent dans la base (RLS + fonctions `is_admin()`, `is_member(org)`, `has_tool(org, slug)`) ET dans l'app (`requireMembership`, `requireToolAccess`). Les deux couches sont obligatoires.
- Ajouter un outil = un dossier dans `src/app/app/[orgSlug]/(tools)/<slug>/` avec sa garde d'accès, une entrée dans `src/tools/registry.ts`, une ligne dans la table `tools`, et Louis coche la case dans `/admin`.

## 7. Conventions de code

- Server Components par défaut ; `'use client'` seulement quand il y a de l'interactivité.
- Mutations : Server Actions (`actions.ts` à côté de la page) validées par zod, qui renvoient `{ ok: true, data } | { ok: false, error: string }` avec un message en français. Jamais d'exception non gérée côté client.
- Exception : quand le navigateur doit parler à Supabase directement — les outils temps réel (kanban), et les envois de fichiers qui partent en TUS sans traverser Vercel — il lit et écrit via `supabase-js`, la RLS protège. Dans ces cas-là, une Server Action reste nécessaire pour `revalidatePath` : c'est le seul mécanisme qui traverse la frontière. Toute opération d'administration (créer un client, inviter, activer un outil) passe par une Server Action avec le client `admin.ts`, après `requireAdmin()`.
- Toute nouvelle table : RLS activée + policies + index + test manuel avec deux comptes (membre / non-membre). Sans ça, le chantier n'est pas terminé.
- Toute nouvelle fonction SQL : `revoke execute … from public, anon` puis `grant execute … to authenticated`, sinon elle est appelable sans session.
- `has_tool()` renvoie `false` avec la clé service role : les Server Actions d'administration lisent `organization_tools` directement.
- Pas de `any`. Types de la base régénérés (`npm run types`) après chaque migration.
- Nommage : fichiers en kebab-case, composants en PascalCase, tables et colonnes en snake_case, routes en français (`/mot-de-passe-oublie`, `/admin/clients`).
- Commits conventionnels (`feat:`, `fix:`, `chore:`, `db:`), au moins un commit par chantier.

## 8. Interdits

- Exposer `SUPABASE_SERVICE_ROLE_KEY` (ou la clé secrète) côté navigateur ou dans un composant client. Elle ne vit que dans `src/lib/supabase/admin.ts` (qui commence par `import 'server-only'`) et dans les variables d'env Vercel.
- Désactiver la RLS, même « temporairement ».
- Commiter `.env*`, `.claude/settings.local.json`, des clés ou des dumps.
- Ajouter une bibliothèque UI en plus de shadcn/ui, ou une lib d'animation.
- Ouvrir l'inscription publique dans Supabase.
- Retirer le `noindex`.

## 9. Définition de « terminé » pour un chantier

1. `npm run build` et `npm run lint` passent.
2. Les vérifications listées dans le brief du chantier ont été faites et sont notées dans le compte-rendu.
3. Migration appliquée et types régénérés (si le chantier touche la base).
4. Commit poussé sur la branche de travail (`v2-hub` jusqu'à la mise en production de la phase 1, puis `main`).
5. Compte-rendu court à Louis : ce qui a été fait, ce qui reste, les décisions prises en son absence.
