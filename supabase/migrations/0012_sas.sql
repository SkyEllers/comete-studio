-- ===========================================================================
-- 0012 — Sas (phase 5, chantier 1)
--
-- Le vide-tête. Deux tables, et rien de plus : des boîtes, et des idées.
--
-- Trois choix portent le fichier.
--
-- Une note perso n'a jamais de boîte. Ce n'est pas une convention d'interface,
-- c'est une contrainte : les boîtes servent à retrouver un travail rattaché à
-- quelqu'un, et « racheter des lentilles » ne se range nulle part. Le laisser
-- au code voudrait dire qu'un jour une note perso se retrouverait dans la
-- boîte Flora, et que personne ne saurait dire par où elle est passée.
--
-- Supprimer une boîte ne supprime pas ses idées. `on delete set null` les
-- rend à « À ranger », qui n'est pas une ligne mais un état : une note pro
-- sans boîte. Une idée écrite doit survivre au rangement qu'on lui avait
-- donné — c'est tout l'intérêt de l'avoir sortie de sa tête.
--
-- La RLS est plus ouverte que celle de Radar, et c'est délibéré : ici le
-- membre écrit, corrige et efface ce qui est à lui. Ce qu'elle garde, c'est la
-- frontière entre organisations, et la signature de l'auteur à l'insertion.
-- ===========================================================================

create table public.sas_boxes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- Deux univers, et deux seulement. Un enum plutôt qu'un texte : le jour où
-- l'IA renverra « professionnel » au lieu de « pro », la base le refusera au
-- lieu de créer un troisième univers invisible dans les listes.
create type public.sas_realm as enum ('pro', 'perso');

create table public.sas_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  box_id          uuid references public.sas_boxes(id) on delete set null,   -- null = Perso ou « À ranger »
  realm           public.sas_realm not null,
  content         text not null check (char_length(content) between 1 and 2000),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  captured_at     timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (realm = 'pro' or box_id is null)      -- une note perso n'a jamais de boîte
);

-- Les deux seules questions que l'outil pose : la liste d'un univers, et le
-- contenu d'une boîte — actives d'abord, de la plus récente à la plus vieille.
create index sas_notes_org_idx on public.sas_notes(organization_id, realm, is_archived, captured_at desc);
create index sas_notes_box_idx on public.sas_notes(box_id, is_archived, captured_at desc);

-- Les colonnes de référence : sans index, la suppression d'un profil balaie
-- les deux tables entières. `sas_boxes` n'a pas besoin d'index sur
-- `organization_id`, la contrainte d'unicité en fournit un qui commence par là.
create index sas_notes_created_by_idx on public.sas_notes(created_by);
create index sas_boxes_created_by_idx on public.sas_boxes(created_by);

create trigger sas_boxes_set_updated_at
  before update on public.sas_boxes
  for each row execute function public.set_updated_at();

create trigger sas_notes_set_updated_at
  before update on public.sas_notes
  for each row execute function public.set_updated_at();

-- ------------------------------- Catalogue ---------------------------------

insert into public.tools (slug, name, description, kind, sort_order) values
  ('sas', 'Sas', 'Vide ta tête : note tout, l''IA range, tu valides.', 'internal', 40)
on conflict (slug) do nothing;

-- ---------------------------- Porte d'entrée -------------------------------

/*
 * Membre de l'organisation ET outil activé pour elle. Louis passe partout.
 * Même forme que `can_access_board`, `can_access_files` et `can_access_radar` :
 * couper Sas pour une organisation rend ses idées invisibles immédiatement, y
 * compris par l'API.
 */
create or replace function public.can_access_sas(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select org is not null
     and (public.is_admin()
          or (public.is_member(org) and public.has_tool(org, 'sas')));
$fn$;

revoke execute on function public.can_access_sas(uuid) from public, anon;
grant execute on function public.can_access_sas(uuid) to authenticated;

-- --------------------------------- RLS -------------------------------------

alter table public.sas_boxes enable row level security;
alter table public.sas_notes enable row level security;

/*
 * Un outil d'écriture personnelle : qui accède lit, écrit, corrige et efface.
 * La porte est `can_access_sas`, et elle est la même sur les quatre verbes —
 * la frontière entre organisations tient à elle seule.
 *
 * Une nuance à l'insertion : `created_by = auth.uid()`. On ne s'interdit pas
 * de toucher la note d'un autre membre de la même organisation (les notes
 * appartiennent à l'organisation, c'est acté), mais on s'interdit d'en écrire
 * une sous son nom. Une idée mal classée se corrige ; une idée signée par
 * quelqu'un qui ne l'a pas écrite, non.
 */
create policy "sas_boxes_select" on public.sas_boxes
  for select to authenticated using (public.can_access_sas(organization_id));
create policy "sas_boxes_insert" on public.sas_boxes
  for insert to authenticated
  with check (public.can_access_sas(organization_id) and created_by = (select auth.uid()));
create policy "sas_boxes_update" on public.sas_boxes
  for update to authenticated
  using (public.can_access_sas(organization_id))
  with check (public.can_access_sas(organization_id));
create policy "sas_boxes_delete" on public.sas_boxes
  for delete to authenticated using (public.can_access_sas(organization_id));

create policy "sas_notes_select" on public.sas_notes
  for select to authenticated using (public.can_access_sas(organization_id));
create policy "sas_notes_insert" on public.sas_notes
  for insert to authenticated
  with check (public.can_access_sas(organization_id) and created_by = (select auth.uid()));
create policy "sas_notes_update" on public.sas_notes
  for update to authenticated
  using (public.can_access_sas(organization_id))
  with check (public.can_access_sas(organization_id));
create policy "sas_notes_delete" on public.sas_notes
  for delete to authenticated using (public.can_access_sas(organization_id));
