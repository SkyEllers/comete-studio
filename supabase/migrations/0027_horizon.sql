-- ===========================================================================
-- 0027 — Horizon : la page du mois de l'argent d'un client
--
-- Horizon montre à un client, mois par mois, ce qui est entré, ce que son
-- entreprise a coûté, ce qui est mis de côté et où en sont ses poches. Né du
-- chantier finances de Peggy (septembre 2026) : Louis renseigne les chiffres,
-- le client les regarde quand il veut.
--
-- Deux choix expliquent tout ce fichier :
--
-- 1. Un relevé par mois, et son contenu en un seul document. Le relevé se
--    compose de listes de lignes dont le nombre change d'un mois à l'autre
--    (une charge apparaît, une autre disparaît) : une table par section
--    obligerait à une migration à chaque nouvelle rubrique, pour un écran qui
--    ne fait que lire. La forme du document est tenue par zod, côté serveur,
--    avant toute écriture ; la base, elle, tient ce qui ne doit jamais casser :
--    un seul relevé par mois et par client, et un mois qui est un premier du
--    mois.
--
-- 2. Louis écrit, le client lit. Un relevé en brouillon n'existe pas aux yeux
--    du client : il ne le voit qu'une fois publié. L'écriture est réservée à
--    l'administration, par la RLS et par les Server Actions.
-- ===========================================================================

create table public.horizon_releves (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mois            date not null check (extract(day from mois) = 1),
  publie          boolean not null default false,
  contenu         jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(contenu) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, mois)
);

create index horizon_releves_org_mois_idx
  on public.horizon_releves(organization_id, mois desc);

create trigger horizon_releves_set_updated_at
  before update on public.horizon_releves
  for each row execute function public.set_updated_at();


insert into public.tools (slug, name, description, kind, sort_order) values
  ('finances', 'Horizon', 'Ton argent, mois par mois : ce qui entre, ce qui sort, ce qui est mis de côté.', 'internal', 70)
on conflict (slug) do nothing;


/*
 * Membre de l'organisation ET outil activé pour elle. Louis passe partout.
 * Même forme que `can_access_temps` et les autres.
 */
create or replace function public.can_access_finances(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select org is not null
     and (public.is_admin()
          or (public.is_member(org) and public.has_tool(org, 'finances')));
$fn$;

revoke execute on function public.can_access_finances(uuid) from public, anon;
grant execute on function public.can_access_finances(uuid) to authenticated;


alter table public.horizon_releves enable row level security;

/*
 * Lecture : qui accède voit les relevés publiés ; Louis voit aussi les
 * brouillons. Un brouillon n'a pas à fuiter par l'API, même à un membre.
 */
create policy "horizon_releves_lecture" on public.horizon_releves
  for select to authenticated
  using (
    (select public.is_admin())
    or (public.can_access_finances(organization_id) and publie)
  );

/* Écriture : l'administration seulement, sur les trois verbes. */
create policy "horizon_releves_admin_insert" on public.horizon_releves
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "horizon_releves_admin_update" on public.horizon_releves
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "horizon_releves_admin_delete" on public.horizon_releves
  for delete to authenticated
  using ((select public.is_admin()));
