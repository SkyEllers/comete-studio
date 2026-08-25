# Phase 2 — Le kanban : un Trello maison, collaboratif, par client

Brief d'exécution pour Claude Code. Prérequis : phase 1 terminée et en production. Lire `CLAUDE.md`. Un chantier à la fois, compte-rendu, « go » de Louis.

## Ce qu'on construit

Un kanban façon Trello, propre à chaque organisation, où Louis et le client travaillent au même niveau : tableaux, listes, cartes, drag & drop, étiquettes, échéances, membres assignés, checklists, commentaires, archivage, et mise à jour en direct quand plusieurs personnes ont le tableau ouvert. Le périmètre v1 est volontairement celui du Trello de base ; le backlog en fin de document liste ce qui vient après.

Résultat attendu : Louis active « Kanban » pour un client, le client crée un tableau « Idées », y note ses idées en cartes, Louis les déplace dans « À creuser » depuis son écran, le client voit la carte bouger sans recharger. Un autre client ne voit rien de tout ça.

## Décisions de conception (actées)

- Un tableau appartient à une organisation. Tous les membres de l'organisation voient et modifient tous ses tableaux (pas de droits par tableau en v1). Supprimer un tableau : rôle `owner` ou admin ; les autres peuvent l'archiver.
- Tout le monde peut créer, éditer, déplacer, archiver cartes et listes. Un commentaire ne se modifie et ne se supprime que par son auteur (ou l'admin).
- Positions en `double precision` : nouvel élément = max + 1024 ; insertion entre deux = milieu ; quand l'écart entre voisins passe sous `0.001`, une Server Action renumérote la liste (1024, 2048, …).
- Toutes les tables du kanban portent `board_id` (dénormalisé) : une seule fonction `can_access_board(board_id)` pour la RLS, et un seul filtre pour le temps réel.
- Échéance = `date` (sans heure) en v1.
- Couleurs (tableaux et étiquettes) = clés d'une palette de 8 définie dans `src/tools/kanban/palette.ts`, jamais un hex libre en base : `ember`, `sun`, `mint`, `sky`, `violet`, `rose`, `sand`, `stone`.
- Lecture initiale côté serveur (une page = un tableau complet), mutations côté navigateur via `supabase-js` (RLS), temps réel via `postgres_changes` filtré par `board_id`, interface optimiste avec retour arrière en cas d'erreur.
- Fiche carte ouverte via l'URL `?card=<id>` : une carte a une adresse partageable.

## Chantier 1 — Migration `0002_kanban`

### Tables

```sql
create table public.boards (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  description     text not null default '',
  color           text not null default 'ember',
  position        double precision not null default 0,
  is_archived     boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index boards_org_idx on public.boards(organization_id, is_archived, position);

create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  position    double precision not null default 0,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index lists_board_idx on public.lists(board_id, is_archived, position);

create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards(id) on delete cascade,
  list_id      uuid not null references public.lists(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  description  text not null default '',
  position     double precision not null default 0,
  due_date     date,
  is_completed boolean not null default false,
  cover_color  text,
  is_archived  boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index cards_list_idx on public.cards(list_id, is_archived, position);
create index cards_board_idx on public.cards(board_id);

create table public.labels (
  id       uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name     text not null default '',
  color    text not null
);

create table public.card_labels (
  card_id  uuid not null references public.cards(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, label_id)
);

create table public.card_assignees (
  card_id  uuid not null references public.cards(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, user_id)
);

create table public.checklists (
  id       uuid primary key default gen_random_uuid(),
  card_id  uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  title    text not null default 'Checklist',
  position double precision not null default 0
);

create table public.checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  board_id     uuid not null references public.boards(id) on delete cascade,
  text         text not null,
  is_done      boolean not null default false,
  position     double precision not null default 0
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_card_idx on public.comments(card_id, created_at);

create table public.card_activities (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  type       text not null,      -- card.created, card.moved, card.completed, card.due_set, card.archived, card.commented, card.assigned, card.labeled
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index card_activities_card_idx on public.card_activities(card_id, created_at desc);
```

`set_updated_at()` en `before update` sur `boards`, `lists`, `cards`, `comments`.

### Fonction d'accès

```sql
create or replace function public.can_access_board(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.boards bd
    where bd.id = b
      and (public.is_admin()
           or (public.is_member(bd.organization_id) and public.has_tool(bd.organization_id, 'kanban')))
  );
$$;
```

### RLS

| Table | select / insert / update | delete |
|---|---|---|
| `boards` | `is_admin() or (is_member(organization_id) and has_tool(organization_id, 'kanban'))` (le `with check` de l'insert force `organization_id` à une org accessible) | `is_admin() or exists (membership owner de organization_id pour auth.uid())` |
| `lists`, `cards`, `labels`, `card_labels`, `card_assignees`, `checklists`, `checklist_items`, `card_activities` | `can_access_board(board_id)` | `can_access_board(board_id)` |
| `comments` | select / insert : `can_access_board(board_id)` ; `with check` de l'insert : `user_id = auth.uid()` ; update : `user_id = auth.uid() or is_admin()` | `user_id = auth.uid() or is_admin()` |

Couper l'outil Kanban pour une organisation (`organization_tools.enabled = false`) rend donc ses tableaux invisibles instantanément, y compris via l'API. Réactiver les fait revenir intacts.

### Temps réel

```sql
alter publication supabase_realtime add table
  public.boards, public.lists, public.cards, public.labels, public.card_labels,
  public.card_assignees, public.checklists, public.checklist_items, public.comments, public.card_activities;
alter table public.cards replica identity full;
alter table public.lists replica identity full;
alter table public.card_labels replica identity full;
alter table public.card_assignees replica identity full;
alter table public.checklist_items replica identity full;
alter table public.comments replica identity full;
```

(`replica identity full` est nécessaire pour que les événements `DELETE` transportent `board_id` et passent le filtre.)

`db push`, `npm run types`, commit `db: migration 0002 kanban`.

Vérifications : avec deux comptes de deux organisations, un `select * from cards` via l'API ne renvoie que les cartes de son organisation ; un `insert` dans `boards` avec l'`organization_id` de l'autre échoue.

## Chantier 2 — Liste des tableaux

Route `/app/[orgSlug]/kanban` (remplace le placeholder de la phase 1 ; la garde `requireToolAccess` reste dans `layout.tsx`).

- Grille de tableaux : bandeau de couleur, nom, nombre de cartes actives, « modifié il y a … » (JetBrains Mono). Tri par `position` puis nom.
- Dialog « Nouveau tableau » : nom, couleur (pastilles de la palette). Crée le tableau avec trois listes par défaut : « À faire », « En cours », « Terminé » (l'utilisateur les renomme ou les supprime ensuite).
- Section repliée « Tableaux archivés » avec restauration.
- État vide : « Aucun tableau. Crée le premier pour poser tes idées. »
- Composants dans `src/tools/kanban/` : `BoardCard`, `NewBoardDialog`, `palette.ts`, `mutations.ts` (fonctions typées `createBoard`, `archiveBoard`, `restoreBoard`, `updateBoard`), `queries.ts` (chargement serveur).
- Commit `feat(kanban): liste des tableaux`.

## Chantier 3 — Vue tableau, listes, cartes, drag & drop

Route `/app/[orgSlug]/kanban/[boardId]`. Chargement serveur en une fois (`getBoardData`) : tableau, listes actives, cartes actives, étiquettes, assignations, nombre d'items de checklist faits/total par carte, nombre de commentaires par carte, membres de l'organisation. `notFound()` si le tableau n'appartient pas à l'organisation de l'URL.

Interface (`BoardView`, composant client, état via `useReducer` dans `src/tools/kanban/store.ts`) :

- En-tête : lien retour, nom du tableau (édition inline), avatars des membres, recherche texte, bouton Filtres, menu du tableau (Étiquettes, Archives, Renommer, Couleur, Archiver le tableau, Supprimer le tableau si `owner`/admin, confirmation par saisie du nom).
- Canevas : listes en colonnes de 272 px, défilement horizontal, hauteur pleine. Chaque liste : nom (édition inline), compteur, menu (Renommer, Ajouter une carte, Archiver la liste), cartes, composeur « + Ajouter une carte » en bas. À droite, composeur « + Ajouter une liste ».
- Carte dans la liste : barres d'étiquettes en haut, titre, ligne de métadonnées (échéance avec badge rouge si dépassée et vert si terminée, `3/5` checklist, nombre de commentaires, icône description, avatars assignés). Couleur de couverture si définie.
- Composeurs : Entrée valide, Maj+Entrée saute une ligne, Échap annule, le focus reste dans le composeur pour enchaîner.
- Drag & drop avec dnd-kit : `PointerSensor` (distance d'activation 6 px), `TouchSensor` (délai 200 ms, tolérance 6 px), `KeyboardSensor`. Cartes triables dans une liste et entre listes ; listes triables horizontalement. `DragOverlay` pour l'élément en mouvement. Au dépôt : calcul de la nouvelle `position` (milieu des voisins), mise à jour locale immédiate, écriture en base ; erreur → retour à l'état précédent + toast. Renumérotation via Server Action `renormalizeList(listId)` ou `renormalizeBoardLists(boardId)` quand l'écart devient trop petit.
- Déplacer une carte enregistre une activité `card.moved` (`{ from_list, to_list }`).
- Commit `feat(kanban): vue tableau, listes, cartes, drag & drop`.

Vérifications : 200 cartes sur 6 listes restent fluides ; drag au clavier fonctionne (espace, flèches, espace) ; sur mobile, appui long puis déplacement, et le défilement horizontal reste possible.

## Chantier 4 — Fiche carte

Ouverture par clic ou via `?card=<id>` (dialog sur desktop, `Sheet` plein écran sur mobile). Contenu chargé à l'ouverture : commentaires et activités (le reste vient du store).

- Titre (édition inline), « dans la liste X » (menu déroulant pour déplacer), bouton Terminé (case à cocher, active `is_completed`, activité `card.completed`).
- Étiquettes : chips ; popover pour cocher/décocher les étiquettes du tableau, en créer (nom optionnel + couleur), les renommer.
- Échéance : sélecteur de date (composant shadcn `calendar` + `popover` à ajouter), suppression possible ; activité `card.due_set`.
- Membres : sélecteur multi parmi les membres de l'organisation (avatar, nom) ; activité `card.assigned`.
- Description : zone de texte markdown, bouton « Aperçu » ; rendu via `react-markdown` + `remark-gfm`, sans HTML brut. Sauvegarde sur « Enregistrer » ou Ctrl/Cmd+Entrée.
- Checklists : plusieurs par carte ; titre éditable ; items avec case, texte éditable, suppression ; barre de progression ; ajout d'item par Entrée.
- Commentaires : liste chronologique (avatar, nom, date relative), composeur en bas, édition/suppression de ses propres commentaires ; activité `card.commented`.
- Activité : 20 dernières entrées, formulées en français (« Louis a déplacé la carte de Idées vers À creuser »).
- Actions : Couverture (couleur), Copier le lien, Archiver ; dans les archives : Restaurer, Supprimer définitivement (owner/admin).
- Échap ferme ; fermer retire `?card=` de l'URL sans recharger.
- Commit `feat(kanban): fiche carte complète`.

Vérifications : ouvrir `?card=<id>` d'une carte d'une autre organisation → 404 ; deux personnes qui commentent en même temps voient les deux commentaires.

## Chantier 5 — Temps réel et cohérence

- Hook `useBoardRealtime(boardId)` : un canal `board:<id>`, abonné aux `postgres_changes` (`INSERT`, `UPDATE`, `DELETE`) de chaque table avec `filter: board_id=eq.<id>`, qui dispatch dans le store : insertion, patch, suppression.
- Ignorer l'écho de ses propres écritures (comparer `id` + `updated_at` avec l'état local) pour éviter les sauts visuels.
- Sur `SUBSCRIBED` après une reconnexion (perte réseau, veille), refetch complet du tableau via une Server Action `getBoardData` pour resynchroniser.
- Indicateur discret « Hors ligne, reconnexion… » quand le canal est en erreur ; les écritures échouent proprement (toast) au lieu de s'empiler.
- Concurrence : deux déplacements simultanés de la même carte → la dernière écriture gagne, l'autre écran reçoit l'événement et se réaligne. Documenté, accepté en v1.
- Commit `feat(kanban): temps réel`.

Vérifications : deux navigateurs, deux comptes, même tableau : création, déplacement, renommage, archivage, commentaire, tout apparaît de l'autre côté en moins de deux secondes ; couper le wifi 30 s puis revenir → l'état se resynchronise.

## Chantier 6 — Filtres, archives, finitions

- Filtres (côté client, sur les données déjà chargées) : par étiquette, par membre, par échéance (dépassée, cette semaine, sans date), par état (terminée ou non). Recherche texte sur titre et description. Badge du nombre de filtres actifs, bouton « Effacer ».
- Vue Archives (menu du tableau) : cartes et listes archivées, restauration, suppression définitive.
- Raccourcis : `n` = nouvelle carte dans la première liste, `f` = focus recherche, Échap = ferme tout. Désactivés dans les champs de saisie.
- Accessibilité : chaque carte est un bouton, focus visible, annonces `aria-live` lors des déplacements clavier.
- Mobile : listes en `scroll-snap`, largeur 85 vw ; composeurs et menus accessibles au pouce.
- Performances : `getBoardData` en ≤ 4 requêtes ; pas de re-rendu du tableau entier quand une carte change (mémoïsation par liste).
- Commit `feat(kanban): filtres, archives, raccourcis, mobile`.

## Chantier 7 — QA et mise en production

1. Rejouer l'annexe D de la phase 1, plus : isolation des tableaux entre organisations via l'API (select, insert, update, delete sur chaque table) ; désactivation de l'outil → tableaux invisibles, réactivation → intacts.
2. Test réel à deux : Louis + un client test, un tableau, dix minutes d'utilisation croisée, noter les frictions.
3. Merge sur `main`, tag `v2.1-kanban`, activer Kanban pour le premier client.

## Backlog v1.1 (ne rien commencer sans « go »)

Pièces jointes (bucket Storage `kanban`, RLS par organisation) · notifications email (assignation, échéance J-1, commentaire) · activité au niveau du tableau · droits par tableau (privé / organisation) · templates de tableau · heure sur l'échéance · vue calendrier · thème clair · export CSV · déplacer une carte vers un autre tableau.
