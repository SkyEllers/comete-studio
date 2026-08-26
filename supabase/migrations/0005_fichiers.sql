-- ===========================================================================
-- 0005 — Fichiers (phase 3, chantier 1)
--
-- Une médiathèque par client : des dossiers sur un seul niveau, des fichiers
-- conservés tels quels dans un bucket privé unique.
--
-- Le chemin d'un objet est `<organization_id>/<file_id>` : le premier segment
-- porte l'organisation, et c'est sur lui que reposent les règles d'accès
-- Storage. Le nom d'origine ne voyage jamais dans le chemin — il vit en base,
-- ce qui évite les collisions, les accents et les caractères interdits.
--
-- Conséquence voulue, la même que pour le kanban : couper l'outil Fichiers
-- pour une organisation rend ses fichiers invisibles immédiatement, y compris
-- par l'API et par le Storage. Les réactiver les fait revenir intacts.
-- ===========================================================================

create type public.file_status as enum ('uploading', 'ready');

-- ------------------------------- Tables ------------------------------------

create table public.folders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create index folders_created_by_idx on public.folders(created_by);

create table public.files (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- `null` = à la racine de la médiathèque.
  folder_id        uuid references public.folders(id) on delete cascade,
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
-- La suppression d'un dossier cascade sur ses fichiers : l'index composite
-- ci-dessus commence par l'organisation et ne sert pas à cette recherche.
create index files_folder_idx on public.files(folder_id);
create index files_uploaded_by_idx on public.files(uploaded_by);
-- Ménage des envois abandonnés : on ne balaie que ceux-là.
create index files_status_idx on public.files(status, created_at) where status = 'uploading';

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

create trigger files_set_updated_at
  before update on public.files
  for each row execute function public.set_updated_at();

-- ------------------------------- Catalogue ---------------------------------

insert into public.tools (slug, name, description, kind, sort_order) values
  ('fichiers', 'Fichiers', 'Dépose photos, vidéos et documents, en qualité d''origine.', 'internal', 20)
on conflict (slug) do nothing;

-- -------------------------- Fonctions d'accès ------------------------------

/*
 * Porte d'entrée unique de l'outil : membre de l'organisation ET outil activé
 * pour elle. Louis passe partout. Même forme que `can_access_board`.
 */
create or replace function public.can_access_files(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select org is not null
     and (public.is_admin()
          or (public.is_member(org) and public.has_tool(org, 'fichiers')));
$fn$;

/*
 * L'organisation portée par un chemin Storage `<org_id>/<file_id>`.
 *
 * Renvoie `null` sur tout chemin qui n'a pas cette forme : un objet mal nommé
 * n'appartient à personne, donc personne n'y touche.
 */
create or replace function public.org_du_chemin(object_name text) returns uuid
language plpgsql immutable set search_path = public as $fn$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$fn$;

create or replace function public.can_access_files_path(object_name text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.can_access_files(public.org_du_chemin(object_name));
$fn$;

/*
 * L'auteur d'un objet Storage.
 *
 * `storage.objects` porte deux colonnes d'auteur : `owner` (uuid, héritée) et
 * `owner_id` (texte, celle que storage-api renseigne aujourd'hui). Laquelle
 * est remplie dépend de la version en place, et une politique qui parie sur
 * la mauvaise casse les envois. On lit donc les deux, avec un cast qui ne
 * lève jamais.
 */
create or replace function public.est_auteur_objet(owner uuid, owner_id text)
returns boolean
language plpgsql stable set search_path = public as $fn$
declare auteur uuid;
begin
  auteur := owner;

  if auteur is null and owner_id is not null then
    begin
      auteur := owner_id::uuid;
    exception when others then
      auteur := null;
    end;
  end if;

  return auteur is not null and auteur = auth.uid();
end;
$fn$;

-- Règle CLAUDE.md §7 : sans ce revoke, anon peut appeler la fonction.
revoke execute on function public.can_access_files(uuid) from public, anon;
grant execute on function public.can_access_files(uuid) to authenticated;

revoke execute on function public.org_du_chemin(text) from public, anon;
grant execute on function public.org_du_chemin(text) to authenticated;

revoke execute on function public.can_access_files_path(text) from public, anon;
grant execute on function public.can_access_files_path(text) to authenticated;

revoke execute on function public.est_auteur_objet(uuid, text) from public, anon;
grant execute on function public.est_auteur_objet(uuid, text) to authenticated;

-- --------------------------------- RLS -------------------------------------

alter table public.folders enable row level security;
alter table public.files enable row level security;

-- dossiers : lecture et écriture pour qui a l'outil ; suppression réservée
create policy "folders_select" on public.folders
  for select to authenticated
  using (public.can_access_files(organization_id));

create policy "folders_insert" on public.folders
  for insert to authenticated
  with check (public.can_access_files(organization_id));

create policy "folders_update" on public.folders
  for update to authenticated
  using (public.can_access_files(organization_id))
  with check (public.can_access_files(organization_id));

create policy "folders_delete" on public.folders
  for delete to authenticated
  using (
    public.can_access_files(organization_id)
    and ((select public.is_admin())
         or public.is_org_owner(organization_id)
         or created_by = (select auth.uid()))
  );

-- fichiers : on n'inscrit que les siens, on ne supprime que les siens
create policy "files_select" on public.files
  for select to authenticated
  using (public.can_access_files(organization_id));

create policy "files_insert" on public.files
  for insert to authenticated
  with check (
    public.can_access_files(organization_id)
    and uploaded_by = (select auth.uid())
  );

create policy "files_update" on public.files
  for update to authenticated
  using (public.can_access_files(organization_id))
  with check (public.can_access_files(organization_id));

create policy "files_delete" on public.files
  for delete to authenticated
  using (
    public.can_access_files(organization_id)
    and ((select public.is_admin())
         or public.is_org_owner(organization_id)
         or uploaded_by = (select auth.uid()))
  );

-- ------------------------------ Bucket privé -------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('fichiers', 'fichiers', false, 5368709120)   -- 5 Go
on conflict (id) do nothing;

/*
 * Les envois TUS créent l'objet puis le complètent morceau par morceau : le
 * droit `update` leur est indispensable, sans quoi tout envoi de plus d'un
 * morceau échoue en cours de route.
 */
create policy "fichiers_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'fichiers' and public.can_access_files_path(name));

create policy "fichiers_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fichiers' and public.can_access_files_path(name));

create policy "fichiers_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fichiers'
    and public.can_access_files_path(name)
    and public.est_auteur_objet(owner, owner_id)
  )
  with check (
    bucket_id = 'fichiers'
    and public.can_access_files_path(name)
    and public.est_auteur_objet(owner, owner_id)
  );

create policy "fichiers_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fichiers'
    and public.can_access_files_path(name)
    and (public.est_auteur_objet(owner, owner_id)
         or (select public.is_admin())
         or public.is_org_owner(public.org_du_chemin(name)))
  );
