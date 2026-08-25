# Phase 1 — Le socle : reset du repo, base, auth, espace client, admin

Brief d'exécution pour Claude Code. Lire `CLAUDE.md` d'abord. Exécuter les chantiers dans l'ordre, un à la fois ; à la fin de chaque chantier, faire le compte-rendu et attendre le « go » de Louis avant le suivant. Quand une décision manque, choisir l'option la plus simple, la noter dans le compte-rendu, ne pas bloquer.

## Résultat attendu à la fin de la phase

- `cometestudio.fr` affiche une page de connexion sobre à la charte Comète Studio. Rien d'autre n'est public, à part les mentions légales et la politique de confidentialité.
- Louis se connecte, ouvre `/admin`, crée un client « Le Petit Palais 69 », invite une personne par email, active l'outil « Kanban » pour ce client.
- La personne reçoit un email en français, choisit son mot de passe, arrive dans `/app/le-petit-palais-69` et voit une seule tuile : Kanban (placeholder « bientôt disponible », l'outil réel arrive en phase 2).
- Un deuxième client créé en parallèle ne voit rien du premier : ni via l'interface, ni en tapant les URLs à la main, ni en interrogeant l'API Supabase directement avec sa clé de session.
- Le tout tourne en production sur Vercel, avec `noindex` partout.

## Chantier 0 — Préparation par Louis (hors Claude Code)

Claude Code ne peut pas faire ces étapes. Les faire avant de lancer le chantier 1.

1. Supabase : créer un projet `cometestudio-hub`, région EU (Francfort ou Paris). Noter l'URL du projet, la clé publique (nommée « anon » ou « publishable » selon le dashboard) et la clé secrète (« service role » ou « secret »).
2. Supabase → Authentication → Providers → Email : activé. Désactiver « Allow new users to sign up » (personne ne s'inscrit seul). La confirmation d'email n'est pas nécessaire : les comptes naissent par invitation.
3. Supabase → Authentication → URL Configuration : Site URL `https://cometestudio.fr`. Redirect URLs : `https://cometestudio.fr/**`, `http://localhost:3000/**`, et le motif des previews Vercel (`https://*-<ton-scope-vercel>.vercel.app/**`).
4. Supabase → Authentication → Settings : longueur minimale du mot de passe 8 ; activer la protection contre les mots de passe compromis si l'option est disponible.
5. Supabase CLI : `npx supabase login`. Le `link` se fera au chantier 2, une fois le repo scaffoldé. En secours, chaque migration peut être collée dans l'éditeur SQL du dashboard.
6. Vercel → projet existant → Settings → Environment Variables, pour Production ET Preview : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (`https://cometestudio.fr` en production). Settings → General → Framework Preset : Next.js (à vérifier après le premier déploiement).
7. En local : créer `.env.local` avec les mêmes variables et `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
8. Git : `git tag v1-site-vitrine && git push origin v1-site-vitrine`, puis `git checkout -b v2-hub`. Toute la phase 1 se fait sur `v2-hub` ; `main` (donc cometestudio.fr) ne bouge qu'au chantier 8.
9. Emails : le SMTP par défaut de Supabase est limité et réservé aux tests. Avant le premier vrai client, brancher un SMTP custom (Resend ou Brevo) dans Supabase → Authentication → SMTP Settings, expéditeur `louis@cometestudio.fr`.

## Chantier 1 — Reset du repo et scaffold Next.js

Objectif : repartir d'un projet Next.js propre dans ce même repo, en ne gardant de la v1 que les actifs de marque et les textes légaux.

1. Vérifier que le tag `v1-site-vitrine` existe et que la branche courante est `v2-hub`. Sinon, s'arrêter et le dire.
2. Créer un dossier temporaire `_keep/` et y déplacer : `assets/fonts/*.woff2`, `assets/images/comete-studio-logo-slash.svg`, `assets/images/wordmark-comete-studio.svg`, `favicon.svg`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`, `mentions-legales/index.html`, `confidentialite/index.html`.
3. Supprimer tout le reste sauf `.git/`, `.gitignore`, `_keep/`, `CLAUDE.md` et `docs/`. Ça inclut `index.html`, `style.css`, `main.js`, `404.html`, `scripts/`, ce qui reste d'`assets/`, `package.json`, `package-lock.json`, `vercel.json`, `sitemap.xml`, `robots.txt`, `site.webmanifest`, `README.md`, `.claude/`.
4. Scaffold : `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`. Si create-next-app refuse le dossier non vide, scaffolder dans `../tmp-scaffold` puis rapatrier les fichiers et supprimer le dossier temporaire.
5. Réinjecter : les `.woff2` → `public/fonts/` (noms clairs : `space-grotesk.woff2`, `space-grotesk-latin-ext.woff2`, `inter.woff2`, `inter-latin-ext.woff2`, `jetbrains-mono.woff2`, `jetbrains-mono-latin-ext.woff2`) ; les deux SVG → `public/brand/logo-slash.svg` et `public/brand/wordmark.svg` ; favicons et apple-touch-icon → `public/` ; les deux HTML légaux → `docs/legacy/` (source du chantier 4). Supprimer `_keep/`.
6. `.gitignore` : ajouter `.env`, `.env*.local`, `.claude/settings.local.json`, `supabase/.temp/`.
7. `public/robots.txt` : `User-agent: *` puis `Disallow: /`.
8. `next.config.ts` : headers sur `/(.*)` : `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`. Pas de `vercel.json`.
9. Installer `@supabase/supabase-js @supabase/ssr zod lucide-react sonner` et, en dev, `supabase`. Initialiser shadcn/ui (`npx shadcn@latest init`, base color neutral, variables CSS activées) et ajouter les composants : button, input, label, card, dialog, dropdown-menu, switch, avatar, badge, skeleton, table, textarea, separator, sheet, tooltip, form.
10. `package.json` : script `types` = `supabase gen types typescript --linked > src/lib/supabase/database.types.ts`.
11. `README.md` neuf (10 lignes : ce qu'est le projet, commandes, renvoi vers `CLAUDE.md` et `docs/`).
12. `npm run build` vert → commit `chore: reset repo, scaffold next.js pour le hub client v2`.

Vérifications : `git status` propre ; `npm run dev` affiche la page par défaut de Next sans erreur ; `curl -I http://localhost:3000` renvoie `x-robots-tag: noindex, nofollow`.

## Chantier 2 — Base de données : migration `0001_socle`

Objectif : le modèle d'accès complet, verrouillé par RLS, avec les fonctions utilitaires et le catalogue d'outils initial.

1. `npx supabase init` (crée `supabase/config.toml`), puis `npx supabase link --project-ref <ref>` (Louis fournit le ref ; s'il n'est pas disponible, écrire la migration quand même et la lui remettre à coller dans l'éditeur SQL).
2. `npx supabase migration new socle` et y écrire le SQL ci-dessous, complété des policies de l'annexe A.

### Tables

```sql
create extension if not exists "pgcrypto";

create type public.membership_role as enum ('owner', 'member');
create type public.tool_kind as enum ('internal', 'external');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  avatar_url  text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            public.membership_role not null default 'member',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships(user_id);

create table public.tools (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  kind        public.tool_kind not null default 'internal',
  href        text,                      -- URL, outils externes uniquement
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.organization_tools (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tool_id         uuid not null references public.tools(id) on delete cascade,
  enabled         boolean not null default true,
  enabled_at      timestamptz not null default now(),
  primary key (organization_id, tool_id)
);
```

### Fonctions utilitaires (toutes `security definer`, `stable`, `set search_path = public`)

```sql
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = auth.uid());
$$;

create or replace function public.has_tool(org uuid, tool_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_tools ot
                 join public.tools t on t.id = ot.tool_id
                 where ot.organization_id = org and t.slug = tool_slug
                   and ot.enabled and t.is_active);
$$;

-- vrai si l'utilisateur courant partage au moins une organisation avec `other`
create or replace function public.shares_org_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships a
                 join public.memberships b on b.organization_id = a.organization_id
                 where a.user_id = auth.uid() and b.user_id = other);
$$;
```

Pourquoi `security definer` : une policy sur `memberships` qui lirait `memberships` boucle sur elle-même. Les fonctions contournent la RLS pour ce seul test. Restreindre l'exécution : `revoke execute on function ... from public; grant execute on function ... to authenticated;` pour chacune.

### Triggers

- `handle_new_user()` : après insertion dans `auth.users`, crée la ligne `profiles` (`email`, `full_name` depuis `raw_user_meta_data->>'full_name'`). `security definer`.
- `handle_user_email_updated()` : après mise à jour de l'email dans `auth.users`, synchronise `profiles.email`.
- `set_updated_at()` : `before update` sur `profiles` et `organizations`.

### Protection de `is_admin`

Un utilisateur ne doit jamais pouvoir se promouvoir : `revoke update on public.profiles from authenticated; grant update (full_name, avatar_url) on public.profiles to authenticated;`. La colonne `is_admin` ne se modifie qu'en SQL ou avec la clé service role.

### Catalogue initial

```sql
insert into public.tools (slug, name, description, kind, sort_order) values
  ('kanban', 'Kanban', 'Tableaux, listes et cartes pour piloter un projet à plusieurs.', 'internal', 10);
```

3. Activer la RLS sur les 5 tables et écrire les policies de l'annexe A.
4. `npx supabase db push`, puis `npm run types`.
5. Commit `db: migration 0001 socle (profils, organisations, membres, outils, rls)`.

Vérifications : dans l'éditeur SQL, `select public.is_admin();` renvoie `false` hors session ; la table `tools` contient `kanban` ; `database.types.ts` expose bien les 5 tables et les enums.

## Chantier 3 — Clients Supabase, proxy et garde-fous

1. `src/lib/supabase/client.ts` : `createBrowserClient` typé `Database`, instance unique.
2. `src/lib/supabase/server.ts` : `createServerClient` avec les cookies de Next (API asynchrone), en suivant à la lettre la doc Supabase « Setting up Server-Side Auth for Next.js » de la version installée.
3. `src/lib/supabase/admin.ts` : première ligne `import 'server-only'`. `createClient(url, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })`.
4. `src/lib/supabase/proxy.ts` + fichier racine `src/proxy.ts` (ou `middleware.ts` selon la version de Next) : rafraîchit la session à chaque requête, puis :
   - non connecté sur `/app/*`, `/admin/*`, `/reinitialiser`, `/invitation`, `/app/profil` → redirection vers `/?next=<chemin>` ;
   - connecté sur `/` → redirection vers `/app` ;
   - matcher : tout sauf `_next/static`, `_next/image`, favicons, fichiers de `public/`.
5. `src/lib/auth.ts` :
   - `getUser()` → `{ user, profile } | null` (une seule requête `profiles`).
   - `requireUser()` → redirige vers `/` si absent.
   - `requireAdmin()` → `notFound()` si `!profile.is_admin` (404, pas 403 : un non-admin n'a pas à savoir que `/admin` existe).
6. `src/lib/access.ts` :
   - `getOrgBySlug(slug)`.
   - `requireMembership(slug)` → `{ org, role: 'owner' | 'member' | 'admin' }`, `notFound()` sinon (admin passe toujours).
   - `requireToolAccess(slug, toolSlug)` → `notFound()` si l'outil est inactif ou non activé pour l'organisation. L'admin est soumis à la même règle : dans un espace client, il voit ce que le client voit.
7. `src/lib/validations/` : schémas zod partagés (`email`, `password` ≥ 8, `slug`, `orgName` 2–60 caractères, `fullName` 1–80).
8. Commit `feat: clients supabase, proxy de session et garde-fous d'accès`.

Vérifications : `/app` et `/admin` redirigent vers `/` sans session ; le build ne contient aucune référence à `SUPABASE_SERVICE_ROLE_KEY` dans les bundles client (`grep -r SERVICE_ROLE .next/static` vide).

## Chantier 4 — Design system, layout et pages légales

1. `globals.css` : déclarer les tokens de la charte (CLAUDE.md §5) en variables CSS, les exposer à Tailwind (`@theme` en v4 : `--color-void`, `--color-bone`, `--color-ember`, `--color-surface-1`, `--color-surface-2`, `--color-line`, `--color-muted`), et mapper les variables shadcn (`--background`, `--foreground`, `--primary`, `--card`, `--border`, `--ring`, etc.) sur ces tokens. Thème sombre par défaut, classe `dark` sur `<html>`.
2. Fonts via `next/font/local` dans `src/app/layout.tsx` (les 6 fichiers de `public/fonts/`, avec `display: 'swap'`), variables `--font-display`, `--font-body`, `--font-mono`. Titres en Space Grotesk 600, texte en Inter 400/500, labels techniques en JetBrains Mono 400.
3. Métadonnées globales : `title` « Comète Studio — Espace client », `robots: { index: false, follow: false }`, favicons et apple-touch-icon depuis `public/`, `themeColor #0A0A0A`, `lang="fr"`.
4. Composants de base dans `src/components/app/` : `Logo` (slash + wordmark, variante icône seule), `AppShell` (barre haute : logo, nom de l'organisation, menu utilisateur ; contenu ; pas de sidebar en phase 1), `PageHeader`, `EmptyState`, `UserMenu` (nom, lien Profil, lien Admin si admin, Déconnexion).
5. `not-found.tsx` à la charte : « Cette page n'existe pas ou tu n'y as pas accès. » avec un lien vers `/app`.
6. Pages légales, dans un layout public minimal (logo + lien retour) :
   - `/mentions-legales` : reprendre le contenu de `docs/legacy/mentions-legales/index.html` (SIRET, adresse, hébergeur Vercel), y ajouter Supabase (hébergement des données, région EU) comme sous-traitant.
   - `/confidentialite` : rédiger une nouvelle politique pour un espace client (données traitées : identité, email, contenus des outils ; base légale : contrat ; durée : durée de la relation + 3 ans ; sous-traitants : Vercel, Supabase, prestataire SMTP ; droits RGPD et contact `louis@cometestudio.fr`). Marquer `[À VALIDER PAR LOUIS]` chaque passage incertain.
7. `sonner` monté dans le layout racine (`<Toaster />`), position bas-droite.
8. Commit `feat: design system, layout et pages légales`.

Vérifications : contraste texte/fond ≥ 4.5:1 sur bone/void et ember/void ; `prefers-reduced-motion` coupe les transitions ; les polices se chargent depuis `/fonts/` (onglet réseau, aucun appel externe).

## Chantier 5 — Authentification

Toutes les pages d'auth partagent un layout centré : logo, titre, formulaire dans une carte, pied de page « Espace client Comète Studio · louisgirault.fr · Mentions légales · Confidentialité ». Chaque formulaire : composant client, Server Action, états de chargement, erreurs affichées sous le champ, messages en français.

1. `/` (connexion) : email + mot de passe, lien « Mot de passe oublié ? ». Server Action `signIn` → `signInWithPassword` → redirection vers `?next` si présent et interne, sinon `/app`. Message d'erreur unique « Email ou mot de passe incorrect » (jamais « cet email n'existe pas »).
2. `/mot-de-passe-oublie` : email → `resetPasswordForEmail(email)`. Toujours la même réponse : « Si un compte existe pour cette adresse, un email vient de partir. »
3. `/auth/confirm/route.ts` : lit `token_hash`, `type`, `next` ; `verifyOtp({ type, token_hash })` avec le client serveur ; succès → `redirect(next)` (seulement si `next` commence par `/`) ; échec → `redirect('/?erreur=lien-invalide')`, et la page de connexion affiche « Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau. »
4. `/reinitialiser` : session requise (elle vient du lien de récupération) ; nouveau mot de passe + confirmation → `updateUser({ password })` → toast « Mot de passe mis à jour » → `/app`.
5. `/invitation` : même mécanique que `/reinitialiser`, formulé « Bienvenue, choisis ton mot de passe », avec le champ prénom/nom prérempli depuis `profile.full_name` et modifiable → `updateUser({ password })` + mise à jour de `profiles.full_name` → `/app`.
6. `/app/profil` : modifier son nom ; changer son mot de passe (ancien non requis : la session suffit, comme Supabase le permet) ; bouton Déconnexion (`signOut` en Server Action, redirection `/`).
7. Templates d'emails Supabase (dashboard → Authentication → Email Templates), textes en annexe B. Les liens utilisent `token_hash` :
   - Invite : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/invitation`
   - Reset password : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reinitialiser`
   Claude Code ne peut pas les saisir : les fournir à Louis dans le compte-rendu, prêts à coller.
8. Commit `feat: connexion, invitation, mot de passe oublié, profil`.

Vérifications : mauvais mot de passe → message générique ; lien de reset utilisé deux fois → message « lien expiré » ; après déconnexion, `/app` redirige vers `/` ; un `?next=https://evil.com` est ignoré.

## Chantier 6 — Espace client et catalogue d'outils

1. `src/tools/registry.ts` : `Record<string, ToolMeta>` avec `ToolMeta = { slug, name, description, icon: LucideIcon, href: (orgSlug) => string }`. Entrée `kanban` (icône `SquareKanban`, href `/app/${orgSlug}/kanban`). Le registre décrit les outils internes ; la table `tools` dit lesquels existent et lesquels sont activés. Un slug présent en base mais absent du registre s'affiche en admin avec un avertissement et n'apparaît jamais côté client.
2. `/app/page.tsx` (dispatch) : charge les organisations de l'utilisateur (toutes pour l'admin, avec un lien vers `/admin`). 0 → `EmptyState` « Aucun espace ne t'est encore attribué. Contacte Louis. » ; 1 → `redirect('/app/<slug>')` ; plusieurs → liste de cartes.
3. `/app/[orgSlug]/layout.tsx` : `requireMembership` ; `AppShell` avec le nom de l'organisation.
4. `/app/[orgSlug]/page.tsx` : grille des outils activés (`organization_tools` joint à `tools`, filtré `enabled && is_active`, trié `sort_order`, enrichi du registre pour l'icône). Outil externe (`kind = 'external'`) : tuile avec icône `ExternalLink`, ouverture dans un nouvel onglet. Aucun outil → `EmptyState` « Aucun outil activé pour le moment. »
5. `/app/[orgSlug]/(tools)/kanban/layout.tsx` : `requireToolAccess(orgSlug, 'kanban')`. `page.tsx` : placeholder « Le kanban arrive bientôt » (remplacé en phase 2). Le but est de prouver la chaîne complète : accès activé → tuile → route protégée.
6. Commit `feat: espace client et catalogue d'outils`.

Vérifications : désactiver l'outil en base pour l'organisation → la tuile disparaît ET `/app/<slug>/kanban` renvoie 404 ; un membre d'une autre organisation qui tape l'URL obtient 404.

## Chantier 7 — Administration

Tout `/admin` est derrière `requireAdmin()` dans `layout.tsx`. Navigation : Clients, Outils. Toutes les mutations sont des Server Actions utilisant `admin.ts`, précédées de `requireAdmin()` et validées par zod.

1. `/admin` : compteurs (clients, membres, outils actifs) et raccourci « Nouveau client ».
2. `/admin/clients` : tableau (nom, slug, membres, outils activés, créé le). Dialog « Nouveau client » : nom → slug généré (accents retirés, minuscules, tirets), modifiable, unicité vérifiée. Action `createOrganization`.
3. `/admin/clients/[id]` :
   - En-tête : nom (édition inline), slug (lecture seule après création), lien « Ouvrir l'espace » vers `/app/<slug>`.
   - Section Membres : liste (nom, email, rôle, ajouté le). Dialog « Inviter » : email, prénom/nom, rôle (`member` par défaut). Action `inviteMember` :
     a. cherche `profiles` par email ;
     b. absent → `auth.admin.inviteUserByEmail(email, { data: { full_name } })` (l'email part avec le template Invite) ;
     c. présent → pas d'email d'invitation, on ajoute juste l'appartenance (et on le dit dans le toast : « Cette personne a déjà un compte, elle a été ajoutée à ce client ») ;
     d. insert `memberships`. Doublon → « Déjà membre ».
     Bouton « Retirer » avec confirmation (supprime l'appartenance, pas le compte). Bouton « Renvoyer l'invitation » si le compte n'a jamais été confirmé (`last_sign_in_at` null).
   - Section Outils : un `Switch` par outil actif du catalogue ; bascule `organization_tools.enabled` (upsert). Effet immédiat côté client.
   - Zone dangereuse : supprimer le client (confirmation par saisie du slug), cascade sur appartenances et données d'outils.
4. `/admin/outils` : liste du catalogue avec `is_active`, nom, description, `sort_order` éditables. Dialog « Outil externe » : nom, slug, URL, description. Les outils internes ne se créent pas ici (ils viennent du registre + migration).
5. Commit `feat: administration des clients, membres et outils`.

Vérifications : un compte non-admin obtient 404 sur `/admin` ; inviter une adresse déjà membre renvoie l'erreur attendue ; retirer le dernier membre d'un client ne casse rien ; désactiver un outil dans `/admin/outils` le retire de tous les espaces clients.

## Chantier 8 — Mise en production

1. Louis crée son propre compte : Supabase → Authentication → Users → Add user (email `louis@cometestudio.fr`, mot de passe, « auto confirm »). Puis, éditeur SQL : `update public.profiles set is_admin = true where email = 'louis@cometestudio.fr';`.
2. Annexe D (QA à deux comptes) exécutée sur un preview Vercel de `v2-hub`.
3. Merge `v2-hub` → `main`, push. Vérifier sur Vercel : Framework Preset Next.js, variables présentes, build vert, domaine `cometestudio.fr` toujours attaché.
4. `curl -I https://cometestudio.fr` : `x-robots-tag: noindex, nofollow` présent, HSTS présent. `https://cometestudio.fr/robots.txt` : `Disallow: /`.
5. Google Search Console : demander la suppression des anciennes URLs de cometestudio.fr si elles étaient indexées.
6. Créer le premier vrai client dans `/admin`, inviter, vérifier la réception de l'email (SMTP custom branché, chantier 0.9).
7. Commit et tag `v2.0-socle`.

## Annexe A — Matrice RLS (à traduire en policies `to authenticated`)

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `profiles` | `id = auth.uid() or is_admin() or shares_org_with(id)` | aucune (trigger) | `id = auth.uid() or is_admin()` (colonnes limitées par le grant) | aucune |
| `organizations` | `is_member(id) or is_admin()` | `is_admin()` | `is_admin()` | `is_admin()` |
| `memberships` | `is_member(organization_id) or is_admin()` | `is_admin()` | `is_admin()` | `is_admin()` |
| `tools` | `true` | `is_admin()` | `is_admin()` | `is_admin()` |
| `organization_tools` | `is_member(organization_id) or is_admin()` | `is_admin()` | `is_admin()` | `is_admin()` |

Pattern d'écriture :

```sql
alter table public.organizations enable row level security;
create policy "organizations_select" on public.organizations
  for select to authenticated using (public.is_member(id) or public.is_admin());
create policy "organizations_admin_write" on public.organizations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

Les clés service role contournent la RLS : c'est voulu, elles ne servent qu'aux Server Actions d'administration.

## Annexe B — Textes des emails (à coller dans Supabase par Louis)

Invite, objet « Ton accès à l'espace client Comète Studio » :

> Bonjour {{ .Data.full_name }},
>
> Louis t'a ouvert un accès à l'espace client de Comète Studio. Clique ici pour choisir ton mot de passe et entrer dans ton espace : [lien]
>
> Ce lien est valable 24 heures. Si tu n'attendais pas cet email, ignore-le.
>
> Comète Studio · louis@cometestudio.fr

Reset password, objet « Réinitialiser ton mot de passe » :

> Bonjour,
>
> Tu as demandé à changer ton mot de passe pour l'espace client Comète Studio. Clique ici pour en choisir un nouveau : [lien]
>
> Ce lien expire dans une heure. Si tu n'es pas à l'origine de cette demande, ignore cet email : ton mot de passe reste inchangé.

## Annexe C — `.env.example` (à commiter, sans valeurs)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # clé "anon" ou "publishable" selon le dashboard
SUPABASE_SERVICE_ROLE_KEY=            # clé "service role" ou "secret" : serveur uniquement, jamais NEXT_PUBLIC_
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## Annexe D — QA finale à deux comptes

Préparer : clients A et B ; compte `a@test` membre de A ; compte `b@test` membre de B ; Kanban activé pour A seulement.

1. `a@test` voit A, sa tuile Kanban, et `/app/a/kanban` répond. `/app/b` et `/app/b/kanban` → 404. `/admin` → 404.
2. `b@test` voit B sans aucune tuile ; `/app/a/kanban` → 404.
3. Avec la clé publique et le jeton de session de `b@test` (onglet réseau ou `supabase.auth.getSession()`), un `select * from organizations` via l'API REST ne renvoie que B ; `select * from memberships` ne renvoie que ses lignes ; un `update organizations` échoue.
4. Louis voit A et B dans `/app`, l'ensemble dans `/admin`, et dans `/app/b` aucune tuile (il voit ce que B voit).
5. Désactiver Kanban pour A → tuile disparue et 404 immédiats pour `a@test`, sans reconnexion.
6. Retirer `a@test` de A → `/app` lui affiche « Aucun espace ».
7. Reset de mot de passe complet depuis un vrai email ; invitation complète depuis un vrai email.
