-- ===========================================================================
-- 0001 — Socle du hub client Comète Studio
--
-- Règle d'or : un utilisateur ne voit que les organisations dont il est membre,
-- et dans chacune que les outils qui y sont activés. Louis (is_admin) voit tout.
-- Ces règles vivent ici (RLS) ET dans l'app (requireMembership, requireToolAccess).
-- ===========================================================================

create extension if not exists "pgcrypto";

-- --------------------------------- Types ----------------------------------

create type public.membership_role as enum ('owner', 'member');
create type public.tool_kind as enum ('internal', 'external');

-- -------------------------------- Tables ----------------------------------

-- Un profil par utilisateur, créé automatiquement par trigger sur auth.users.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  avatar_url  text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Une organisation par client.
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index organizations_created_by_idx on public.organizations(created_by);

-- Qui appartient à quelle organisation.
create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            public.membership_role not null default 'member',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships(user_id);

-- Catalogue des outils. `href` ne sert qu'aux outils externes.
create table public.tools (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  kind        public.tool_kind not null default 'internal',
  href        text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- Quel outil est activé pour quelle organisation.
create table public.organization_tools (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tool_id         uuid not null references public.tools(id) on delete cascade,
  enabled         boolean not null default true,
  enabled_at      timestamptz not null default now(),
  primary key (organization_id, tool_id)
);
create index organization_tools_tool_id_idx on public.organization_tools(tool_id);

-- ---------------------- Fonctions utilitaires (RLS) ------------------------
--
-- `security definer` obligatoire : une policy sur memberships qui lirait
-- memberships boucle sur elle-même. Ces fonctions contournent la RLS pour ce
-- seul test, et s'appuient toujours sur l'identité de l'appelant (auth.uid()).

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$fn$;

create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = auth.uid());
$fn$;

create or replace function public.has_tool(org uuid, tool_slug text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.organization_tools ot
                 join public.tools t on t.id = ot.tool_id
                 where ot.organization_id = org and t.slug = tool_slug
                   and ot.enabled and t.is_active);
$fn$;

-- Vrai si l'utilisateur courant partage au moins une organisation avec `other`.
create or replace function public.shares_org_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.memberships a
                 join public.memberships b on b.organization_id = a.organization_id
                 where a.user_id = auth.uid() and b.user_id = other);
$fn$;

revoke execute on function public.is_admin() from public;
revoke execute on function public.is_member(uuid) from public;
revoke execute on function public.has_tool(uuid, text) from public;
revoke execute on function public.shares_org_with(uuid) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_tool(uuid, text) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;

-- -------------------------------- Triggers ---------------------------------

-- Un compte naît par invitation : le profil suit automatiquement.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- L'email de référence reste celui de auth.users.
create or replace function public.handle_user_email_updated() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  update public.profiles
     set email = coalesce(new.email, ''),
         updated_at = now()
   where id = new.id;
  return new;
end;
$fn$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.handle_user_email_updated();

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ------------------------ Protection de `is_admin` -------------------------
--
-- Personne ne se promeut soi-même : un utilisateur ne peut modifier que son
-- nom et son avatar. `is_admin` ne se change qu'en SQL ou avec la clé secrète.

revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- ---------------------------------- RLS ------------------------------------
--
-- Toutes les policies sont `to authenticated` : le rôle anon n'a aucun accès.
-- Les appels sans argument sont enveloppés dans un (select ...) pour n'être
-- évalués qu'une fois par requête au lieu d'une fois par ligne.

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.tools enable row level security;
alter table public.organization_tools enable row level security;

-- profiles : soi-même, les collègues d'organisation, et Louis.
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    or public.shares_org_with(id)
  );

-- Pas de policy insert (c'est le trigger) ni delete (cascade depuis auth.users).
create policy "profiles_update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- organizations
create policy "organizations_select" on public.organizations
  for select to authenticated
  using (public.is_member(id) or (select public.is_admin()));

create policy "organizations_admin_write" on public.organizations
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- memberships
create policy "memberships_select" on public.memberships
  for select to authenticated
  using (public.is_member(organization_id) or (select public.is_admin()));

create policy "memberships_admin_write" on public.memberships
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- tools : le catalogue est lisible par tout compte connecté, écrit par Louis.
create policy "tools_select" on public.tools
  for select to authenticated
  using (true);

create policy "tools_admin_write" on public.tools
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- organization_tools
create policy "organization_tools_select" on public.organization_tools
  for select to authenticated
  using (public.is_member(organization_id) or (select public.is_admin()));

create policy "organization_tools_admin_write" on public.organization_tools
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ----------------------------- Catalogue initial ---------------------------

insert into public.tools (slug, name, description, kind, sort_order) values
  ('kanban', 'Kanban', 'Tableaux, listes et cartes pour piloter un projet à plusieurs.', 'internal', 10)
on conflict (slug) do nothing;
