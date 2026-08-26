# Phase 3 — Fichiers : la médiathèque de chaque client

Brief d'exécution pour Claude Code. Prérequis : phases 1 et 2 en production. Lire `CLAUDE.md`. Un chantier à la fois, compte-rendu, « go » de Louis.

## Ce qu'on construit

Un deuxième outil du hub, « Fichiers » : chaque client dispose d'un espace où déposer photos, vidéos et documents, rangés par dossier, conservés tels quels (aucune compression, aucune conversion), que Louis récupère à l'unité ou par dossier entier. Les envois sont reprenables (une coupure à 80 % ne fait pas repartir de zéro) et fonctionnent depuis la pellicule d'un téléphone. Louis reçoit un email quand un client a déposé quelque chose.

Résultat attendu : Louis active « Fichiers » pour Peggy ; Peggy crée le dossier « Photos octobre », y glisse 30 photos et 3 vidéos depuis son téléphone, voit la progression, ferme l'app avant la fin, revient, l'envoi reprend ; Louis reçoit « Peggy a déposé 33 fichiers dans Photos octobre (1,8 Go) », ouvre le dossier, regarde les aperçus, lit une vidéo, télécharge tout le dossier en zip. Un autre client ne voit rien de tout ça, même via l'API.

## Décisions de conception (actées)

- Supabase Storage, bucket privé `fichiers`, un seul pour tous les clients. Chemin d'un objet : `<organization_id>/<file_id>` (jamais le nom d'origine dans le chemin ; il vit en base). Le premier segment du chemin porte l'organisation : c'est sur lui que reposent les règles d'accès Storage.
- Les métadonnées vivent dans `files` (nom d'origine, taille, type, dossier, auteur, dimensions ou durée quand on les connaît). Une ligne est créée avant l'envoi (`status = 'uploading'`) et passe à `ready` à la fin ; les lignes `uploading` de plus de 24 h sont nettoyées à l'ouverture de l'outil.
- Envoi direct du navigateur vers Storage avec la session de l'utilisateur, en protocole TUS (reprenable), sans passer par Vercel. Bibliothèque `tus-js-client`, taille de morceau imposée par Supabase : 6 Mo. Trois envois en parallèle au maximum.
- Aucune transformation du fichier stocké. Les aperçus d'images sont des rendus à la volée (transformations d'image Supabase, plan Pro) via URL signée ; les vidéos se lisent dans un `<video>` sur URL signée (Storage gère les requêtes partielles, donc la lecture et l'avance rapide marchent) ; les PDF s'ouvrent dans le navigateur ; le reste a une icône.
- Téléchargement : URL signée d'une heure avec le nom d'origine. Dossier entier : zip construit en flux dans le navigateur (`client-zip`), écrit directement sur le disque via `showSaveFilePicker` quand le navigateur le permet (Chrome, Edge) ; sinon, au-delà de 500 Mo cumulés, téléchargements fichier par fichier.
- Dossiers sur un seul niveau en v1 (pas de sous-dossiers). Un fichier est à la racine ou dans un dossier.
- Suppression définitive (pas de corbeille), réservée à l'auteur du fichier, aux `owner` du client et à Louis, avec confirmation. Supprimer un dossier supprime ses fichiers, confirmation par saisie du nom.
- Notification : une seule par lot d'envoi, envoyée par une Server Action via l'API Resend quand le lot se termine, uniquement si l'auteur n'est pas Louis. Jamais d'email pour les dépôts de Louis.
- Deux dépendances ajoutées au projet, à inscrire dans `CLAUDE.md` §2 : `tus-js-client` (envois reprenables) et `client-zip` (zip en flux). Ce ne sont pas des bibliothèques d'interface.

## Chantier 0 — Préparation par Louis (hors Claude Code)

1. Supabase → Project Settings → Storage : passer la limite globale de taille de fichier (« Global file size limit », 50 Mo par défaut) à 5 Go. Sans ça, toute vidéo est refusée.
2. Resend → API Keys → créer une clé `hub-notifications` (Sending access, domaine cometestudio.fr).
3. Ajouter `RESEND_API_KEY` dans `.env.local` et dans Vercel (Production et Preview), puis redéployer. Ajouter la ligne, sans valeur, à `.env.example`.
4. Vérifier que les transformations d'image sont disponibles sur le projet (plan Pro : Storage → Settings → Image transformations).

## Chantier 1 — Migration `0005_fichiers`

### Tables

```sql
create type public.file_status as enum ('uploading', 'ready');

create table public.folders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.files (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  folder_id        uuid references public.folders(id) on delete cascade,   -- null = racine
  name             text not null check (char_length(name) between 1 and 255),
  size_bytes       bigint not null check (size_bytes >= 0),
  mime_type        text not null default 'application/octet-stream',
  status           public.file_status not null default 'uploading',
  width            int,
  height           int,
  duration_seconds numeric,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index files_org_folder_idx on public.files(organization_id, folder_id, created_at desc);
create index files_status_idx on public.files(status, created_at) where status = 'uploading';
```

`set_updated_at()` sur les deux tables. Catalogue : `insert into public.tools (slug, name, description, kind, sort_order) values ('fichiers', 'Fichiers', 'Dépose photos, vidéos et documents, en qualité d''origine.', 'internal', 20) on conflict do nothing;`

### Fonctions

```sql
-- accès à l'outil Fichiers pour une organisation
create or replace function public.can_access_files(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin()
      or (public.is_member(org) and public.has_tool(org, 'fichiers'));
$fn$;

-- même test à partir d'un chemin Storage "<org_id>/<file_id>"
create or replace function public.can_access_files_path(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare org uuid;
begin
  begin
    org := (storage.foldername(object_name))[1]::uuid;
  exception when others then
    return false;
  end;
  return public.can_access_files(org);
end;
$fn$;
```

Les deux : `revoke execute … from public, anon; grant execute … to authenticated;` (règle CLAUDE.md §7).

### RLS sur les tables

| Table | select / insert / update | delete |
|---|---|---|
| `folders` | `can_access_files(organization_id)` | `is_admin() or is_org_owner(organization_id) or created_by = auth.uid()` (et `can_access_files`) |
| `files` | `can_access_files(organization_id)` ; `with check` de l'insert : `uploaded_by = auth.uid()` | `is_admin() or is_org_owner(organization_id) or uploaded_by = auth.uid()` (et `can_access_files`) |

### Bucket et RLS Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('fichiers', 'fichiers', false, 5368709120)   -- 5 Go
on conflict (id) do nothing;

create policy "fichiers_select" on storage.objects for select to authenticated
  using (bucket_id = 'fichiers' and public.can_access_files_path(name));
create policy "fichiers_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'fichiers' and public.can_access_files_path(name));
create policy "fichiers_update" on storage.objects for update to authenticated
  using (bucket_id = 'fichiers' and public.can_access_files_path(name) and owner = auth.uid());
create policy "fichiers_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'fichiers' and public.can_access_files_path(name)
         and (owner = auth.uid() or public.is_admin()
              or public.is_org_owner((storage.foldername(name))[1]::uuid)));
```

Vérifier que la colonne d'auteur de `storage.objects` s'appelle bien `owner` sur la version en place (sinon `owner_id`), et que les envois TUS ont besoin d'un droit `update` (oui : l'objet est créé puis complété morceau par morceau).

`db push`, `npm run types`, commit `db: migration 0005 fichiers`.

Vérifications : avec deux comptes de deux organisations et l'outil activé pour A seulement, un membre de B ne peut ni lister, ni lire, ni créer un objet sous `<A>/…` ; un membre de A sans l'outil activé non plus ; un membre de A avec l'outil crée, lit, supprime le sien et pas celui d'un autre membre.

## Chantier 2 — Dossiers et liste des fichiers

Route `/app/[orgSlug]/(tools)/fichiers` : `layout.tsx` avec `requireToolAccess(orgSlug, 'fichiers')`, entrée `fichiers` dans `src/tools/registry.ts` (icône `FolderOpen`), composants dans `src/tools/fichiers/`.

- Page racine : dossiers en tuiles (nom, nombre de fichiers, taille cumulée, modifié il y a…), puis les fichiers à la racine. Bouton « Nouveau dossier » (dialog, nom unique par client). Renommer et supprimer depuis un menu `…`.
- Route `/app/[orgSlug]/(tools)/fichiers/[folderId]` : fil d'Ariane, liste des fichiers du dossier.
- Liste de fichiers : grille de vignettes pour images et vidéos (vignette générée au chantier 4, icône en attendant), lignes pour le reste ; nom, taille lisible (« 1,8 Go »), date, auteur. Tri par date décroissante. Sélection multiple (case à cocher) pour supprimer ou télécharger en lot.
- En-tête de l'outil : espace utilisé par le client (somme des `size_bytes` des fichiers `ready`).
- Mutations dossiers (créer, renommer, supprimer) et suppression de fichiers en Server Actions avec `revalidatePath` (leçon du kanban : c'est le seul mécanisme qui traverse la frontière). La suppression d'un fichier retire l'objet Storage puis la ligne ; celle d'un dossier boucle sur ses fichiers avant de retirer le dossier.
- États vides : « Aucun fichier pour le moment. Glisse tes photos et vidéos ici, ou appuie sur Déposer. »
- Commit `feat(fichiers): dossiers et liste`.

## Chantier 3 — Dépôt de fichiers

Le cœur de l'outil. Composant `Uploader` présent sur la racine et dans chaque dossier.

- Deux entrées : une zone de glisser-déposer qui couvre toute la page (bandeau « Dépose ici » à l'apparition d'un fichier au-dessus de la fenêtre), et un bouton « Déposer » qui ouvre le sélecteur (`multiple`, sans restriction de type). Sur mobile, le bouton propose la pellicule ; pas d'`accept` restrictif, pour que la pellicule et l'app Fichiers soient toutes deux utilisables.
- File d'attente visible dans un panneau en bas à droite (repliable) : chaque fichier avec nom, taille, barre de progression, vitesse, état (en attente, en cours, terminé, échoué, annulé), bouton annuler. Ligne de total. Le panneau survit à la navigation entre dossiers de l'outil.
- Pour chaque fichier : insertion de la ligne `files` (`status = 'uploading'`, `uploaded_by`, dossier courant, dimensions lues côté navigateur pour les images et durée pour les vidéos quand c'est possible) → envoi TUS vers `<org_id>/<file_id>` avec `chunkSize` 6 Mo, `retryDelays` progressifs, `storeFingerprintForResuming` activé, `removeFingerprintOnSuccess` activé → à la fin, `status = 'ready'`. Échec définitif ou annulation → suppression de la ligne et de l'objet partiel.
- Reprise : à l'ouverture de l'outil, les envois interrompus (empreintes TUS en mémoire locale) sont proposés à la reprise depuis la file, sans resélectionner les fichiers quand le navigateur le permet ; sinon, message clair « Resélectionne le fichier pour reprendre où il s'était arrêté ».
- Garde-fous : fichier vide refusé, plus de 5 Go refusé avant l'envoi avec un message explicite, doublon de nom dans le même dossier accepté (le fichier a son propre identifiant).
- Avertissement avant de quitter la page pendant un envoi en cours (`beforeunload`).
- Après un lot : `revalidatePath` du dossier, la liste se met à jour sans rechargement.
- Commit `feat(fichiers): dépôt reprenable`.

Vérifications : 40 fichiers d'un coup ; une vidéo de 1,5 Go avec coupure réseau à mi-chemin puis reprise ; annulation d'un fichier au milieu d'un lot sans toucher aux autres ; dépôt depuis un téléphone ; état de la base propre après chaque scénario (aucune ligne `uploading` orpheline).

## Chantier 4 — Aperçus et téléchargement

- Vignettes : images via URL signée avec transformation (largeur 480, qualité 75), vidéos via une image extraite côté navigateur au moment du dépôt et stockée sous `<org_id>/<file_id>.poster.jpg` (petite, c'est le seul dérivé jamais stocké), le reste par icône selon le type.
- Fiche fichier par `?file=<id>` (dialog, plein écran sur mobile) : aperçu grand format (image transformée à 1600 de large, vidéo dans un lecteur natif avec URL signée, PDF dans un `<iframe>`), nom, taille, type, dimensions ou durée, dossier, auteur, date, boutons Télécharger l'original, Renommer, Déplacer vers un dossier, Supprimer.
- Téléchargement à l'unité : URL signée d'une heure, option `download` avec le nom d'origine, ouverture immédiate.
- Téléchargement de dossier ou de sélection : « Tout télécharger » → zip en flux (`client-zip`) alimenté par les URL signées, écrit via `showSaveFilePicker` ; navigateur sans cette API : si le total dépasse 500 Mo, téléchargements successifs avec un compteur, sinon zip en mémoire. Progression affichée.
- URL signées générées côté serveur (Server Action, session de l'utilisateur, jamais la clé service role) et jamais réutilisées au-delà de leur durée.
- Commit `feat(fichiers): aperçus et téléchargement`.

## Chantier 5 — Notification et compteurs

- Server Action `notifyBatch(organizationId, fileIds)` appelée par la file quand un lot se termine (au moins un fichier `ready`). Elle vérifie la session, ignore les lots de Louis, agrège (nombre, taille totale, dossier ou « à la racine ») et envoie via l'API Resend (`RESEND_API_KEY`, expéditeur `Comète Studio <louis@cometestudio.fr>`, destinataire `louis@cometestudio.fr`) : objet « Peggy a déposé 33 fichiers dans Photos octobre », corps court avec la liste des dix premiers noms et un lien direct vers le dossier.
- Deux lots à moins de cinq minutes d'intervalle par la même personne dans le même dossier ne font qu'un email (retenue simple en base : `notification_batches` avec `organization_id`, `folder_id`, `user_id`, `sent_at`).
- Administration : sur la fiche client, espace utilisé et nombre de fichiers ; sur `/admin`, total pour tous les clients.
- Commit `feat(fichiers): notification et compteurs`.

## Chantier 6 — Recette et mise en ligne

1. Banc `scripts/qa-fichiers.mjs` (même socle que les bancs existants) : isolation des tables et du Storage entre deux organisations, outil coupé → objets invisibles et envoi refusé, membre sans droit de suppression refusé, URL signée d'un autre client impossible à obtenir.
2. Recette réelle par Louis : dépôt depuis son téléphone et depuis un ordinateur, coupure réseau, reprise, zip d'un dossier, réception de l'email.
3. `npm run build`, `npm run lint`, `qa:isolation`, `qa:routes`, `qa:fichiers`. Tag `v2.2-fichiers`. Activation de l'outil pour Peggy par Louis.

## Backlog (ne rien commencer sans « go »)

Sous-dossiers · corbeille avec restauration 30 jours · lien de partage temporaire vers l'extérieur · commentaires sur un fichier · joindre un fichier de la médiathèque à une carte du kanban · quota par client réglable dans l'admin · lecture des métadonnées (EXIF, date de prise de vue) · tri et recherche · aperçu des documents Office.
