-- ===========================================================================
-- 0004 — Kanban (phase 2, chantier 1)
--
-- Un tableau appartient à une organisation. Toutes les tables du kanban
-- portent `board_id`, même quand la clé étrangère directe est ailleurs : une
-- seule fonction décide de l'accès (can_access_board), et le temps réel n'a
-- qu'un filtre à poser.
--
-- Conséquence voulue : couper l'outil Kanban pour une organisation rend ses
-- tableaux invisibles immédiatement, y compris par l'API. Les réactiver les
-- fait revenir intacts.
--
-- Numéro 0004 et non 0002 : les migrations 0002 et 0003 ont déjà servi aux
-- correctifs de sécurité du socle.
-- ===========================================================================

-- ------------------------------- Tables ------------------------------------

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
create index boards_created_by_idx on public.boards(created_by);

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
create index cards_created_by_idx on public.cards(created_by);

create table public.labels (
  id       uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name     text not null default '',
  color    text not null
);
create index labels_board_idx on public.labels(board_id);

create table public.card_labels (
  card_id  uuid not null references public.cards(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, label_id)
);
create index card_labels_label_idx on public.card_labels(label_id);
create index card_labels_board_idx on public.card_labels(board_id);

create table public.card_assignees (
  card_id  uuid not null references public.cards(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  primary key (card_id, user_id)
);
create index card_assignees_user_idx on public.card_assignees(user_id);
create index card_assignees_board_idx on public.card_assignees(board_id);

create table public.checklists (
  id       uuid primary key default gen_random_uuid(),
  card_id  uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  title    text not null default 'Checklist',
  position double precision not null default 0
);
create index checklists_card_idx on public.checklists(card_id, position);
create index checklists_board_idx on public.checklists(board_id);

create table public.checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  board_id     uuid not null references public.boards(id) on delete cascade,
  text         text not null,
  is_done      boolean not null default false,
  position     double precision not null default 0
);
create index checklist_items_checklist_idx on public.checklist_items(checklist_id, position);
create index checklist_items_board_idx on public.checklist_items(board_id);

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
create index comments_board_idx on public.comments(board_id);
create index comments_user_idx on public.comments(user_id);

create table public.card_activities (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  -- card.created, card.moved, card.completed, card.due_set, card.archived,
  -- card.commented, card.assigned, card.labeled
  type       text not null,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index card_activities_card_idx on public.card_activities(card_id, created_at desc);
create index card_activities_board_idx on public.card_activities(board_id);
create index card_activities_user_idx on public.card_activities(user_id);

-- ------------------------------ Triggers -----------------------------------

create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function public.set_updated_at();

create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- -------------------------- Fonctions d'accès ------------------------------

/*
 * Seul le rôle `owner` (ou Louis) supprime un tableau ; les autres membres
 * l'archivent. Fonction dédiée plutôt qu'un `exists` dans la policy : la
 * sous-requête serait elle-même filtrée par la RLS de memberships.
 */
create or replace function public.is_org_owner(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org
                   and m.user_id = auth.uid()
                   and m.role = 'owner');
$fn$;

/*
 * Porte d'entrée unique du kanban : membre de l'organisation du tableau ET
 * outil activé pour elle. Louis passe partout — mais le tableau doit exister.
 */
create or replace function public.can_access_board(b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.boards bd
    where bd.id = b
      and (public.is_admin()
           or (public.is_member(bd.organization_id)
               and public.has_tool(bd.organization_id, 'kanban')))
  );
$fn$;

-- Règle CLAUDE.md §7 : sans ce revoke, anon peut appeler la fonction.
revoke execute on function public.is_org_owner(uuid) from public;
revoke execute on function public.is_org_owner(uuid) from anon;
grant execute on function public.is_org_owner(uuid) to authenticated;

revoke execute on function public.can_access_board(uuid) from public;
revoke execute on function public.can_access_board(uuid) from anon;
grant execute on function public.can_access_board(uuid) to authenticated;

-- --------------------------------- RLS -------------------------------------

alter table public.boards enable row level security;
alter table public.lists enable row level security;
alter table public.cards enable row level security;
alter table public.labels enable row level security;
alter table public.card_labels enable row level security;
alter table public.card_assignees enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
alter table public.comments enable row level security;
alter table public.card_activities enable row level security;

-- boards : lecture et écriture pour les membres, suppression réservée
create policy "boards_select" on public.boards
  for select to authenticated
  using (
    (select public.is_admin())
    or (public.is_member(organization_id)
        and public.has_tool(organization_id, 'kanban'))
  );

create policy "boards_insert" on public.boards
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (public.is_member(organization_id)
        and public.has_tool(organization_id, 'kanban'))
  );

create policy "boards_update" on public.boards
  for update to authenticated
  using (
    (select public.is_admin())
    or (public.is_member(organization_id)
        and public.has_tool(organization_id, 'kanban'))
  )
  with check (
    (select public.is_admin())
    or (public.is_member(organization_id)
        and public.has_tool(organization_id, 'kanban'))
  );

create policy "boards_delete" on public.boards
  for delete to authenticated
  using ((select public.is_admin()) or public.is_org_owner(organization_id));

-- Tout le reste du tableau suit la même porte.
create policy "lists_all" on public.lists
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

create policy "cards_all" on public.cards
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

create policy "labels_all" on public.labels
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

create policy "card_labels_all" on public.card_labels
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

create policy "card_assignees_all" on public.card_assignees
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

create policy "checklists_all" on public.checklists
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

create policy "checklist_items_all" on public.checklist_items
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

create policy "card_activities_all" on public.card_activities
  for all to authenticated
  using (public.can_access_board(board_id))
  with check (public.can_access_board(board_id));

-- comments : on lit ceux du tableau, on n'écrit que les siens.
create policy "comments_select" on public.comments
  for select to authenticated
  using (public.can_access_board(board_id));

create policy "comments_insert" on public.comments
  for insert to authenticated
  with check (
    public.can_access_board(board_id) and user_id = (select auth.uid())
  );

create policy "comments_update" on public.comments
  for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "comments_delete" on public.comments
  for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------ Temps réel ---------------------------------

alter publication supabase_realtime add table
  public.boards, public.lists, public.cards, public.labels, public.card_labels,
  public.card_assignees, public.checklists, public.checklist_items,
  public.comments, public.card_activities;

/*
 * Sans `replica identity full`, un événement DELETE ne transporte que la clé
 * primaire : le filtre `board_id=eq.<id>` du temps réel ne le verrait jamais.
 * `boards` est épargnée, son filtre porte sur `id`, qui est la clé primaire.
 * `card_activities` aussi : rien n'y est supprimé à la main.
 */
alter table public.lists replica identity full;
alter table public.cards replica identity full;
alter table public.labels replica identity full;
alter table public.card_labels replica identity full;
alter table public.card_assignees replica identity full;
alter table public.checklists replica identity full;
alter table public.checklist_items replica identity full;
alter table public.comments replica identity full;
