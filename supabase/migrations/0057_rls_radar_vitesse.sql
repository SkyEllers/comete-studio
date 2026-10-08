-- 0057 — Les règles d'accès de Radar ne se recalculent plus ligne par ligne.
--
-- Le 08/10/2026, la lecture de `radar_bookings_effective` prenait 370 ms en
-- moyenne pour 374 lignes (pointes à 2,7 s), et le hub semblait lent. Cause :
-- `can_access_radar(organization_id)` et `is_closeuse(organization_id)` sont
-- des fonctions SECURITY DEFINER avec un `search_path` fixé, que Postgres ne
-- peut pas déplier dans la requête. Il les appelait donc une fois par ligne,
-- et chacune relisait `profiles`, `memberships` et `organization_tools`.
--
-- Ici, la même règle s'écrit « l'organisation est dans la liste de celles que
-- je peux voir » : la liste se calcule une seule fois par requête (sous-requête
-- sans lien avec la ligne), puis chaque ligne n'est qu'une recherche dans un
-- petit ensemble. Le sens ne change pas : mêmes tables visibles, pour les
-- mêmes personnes. `can_access_radar` et `is_closeuse` restent, d'autres
-- règles et fonctions s'en servent.

-- Les organisations dont Radar est ouvert à l'appelant : celles de
-- `can_access_radar`, en une fois.
create or replace function public.radar_orgs_visibles()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
  from public.organizations o
  where public.is_admin()
     or (public.is_member(o.id) and public.has_tool(o.id, 'resultats'));
$$;

-- Les organisations où l'appelant est closeuse : celles de `is_closeuse`.
create or replace function public.closeuse_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = auth.uid()
    and m.role = 'closeuse';
$$;

revoke all on function public.radar_orgs_visibles() from public, anon;
revoke all on function public.closeuse_orgs() from public, anon;
grant execute on function public.radar_orgs_visibles() to authenticated;
grant execute on function public.closeuse_orgs() to authenticated;

-- radar_bookings
drop policy if exists radar_bookings_select on public.radar_bookings;
create policy radar_bookings_select on public.radar_bookings
  for select to authenticated
  using (organization_id in (select public.radar_orgs_visibles()));

drop policy if exists radar_bookings_select_closeuse on public.radar_bookings;
create policy radar_bookings_select_closeuse on public.radar_bookings
  for select to authenticated
  using (
    closeuse_id = (select auth.uid())
    and organization_id in (select public.closeuse_orgs())
  );

-- radar_channels, radar_settings, radar_statements, radar_event_filters
drop policy if exists radar_channels_select on public.radar_channels;
create policy radar_channels_select on public.radar_channels
  for select to authenticated
  using (organization_id in (select public.radar_orgs_visibles()));

drop policy if exists radar_settings_select on public.radar_settings;
create policy radar_settings_select on public.radar_settings
  for select to authenticated
  using (organization_id in (select public.radar_orgs_visibles()));

drop policy if exists radar_statements_select on public.radar_statements;
create policy radar_statements_select on public.radar_statements
  for select to authenticated
  using (organization_id in (select public.radar_orgs_visibles()));

drop policy if exists radar_event_filters_select on public.radar_event_filters;
create policy radar_event_filters_select on public.radar_event_filters
  for select to authenticated
  using (organization_id in (select public.radar_orgs_visibles()));

-- radar_booking_activities
drop policy if exists radar_activities_select on public.radar_booking_activities;
create policy radar_activities_select on public.radar_booking_activities
  for select to authenticated
  using (organization_id in (select public.radar_orgs_visibles()));

drop policy if exists radar_activities_select_closeuse on public.radar_booking_activities;
create policy radar_activities_select_closeuse on public.radar_booking_activities
  for select to authenticated
  using (
    organization_id in (select public.closeuse_orgs())
    and exists (
      select 1 from public.radar_bookings b
      where b.id = radar_booking_activities.booking_id
        and b.closeuse_id = (select auth.uid())
    )
  );

-- radar_booking_answers
drop policy if exists radar_booking_answers_select on public.radar_booking_answers;
create policy radar_booking_answers_select on public.radar_booking_answers
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      organization_id in (select public.closeuse_orgs())
      and exists (
        select 1 from public.radar_bookings b
        where b.id = radar_booking_answers.booking_id
          and b.closeuse_id = (select auth.uid())
      )
    )
  );

-- radar_encaissement_incidents
drop policy if exists radar_encaissement_incidents_select on public.radar_encaissement_incidents;
create policy radar_encaissement_incidents_select on public.radar_encaissement_incidents
  for select to authenticated
  using (
    organization_id in (select public.radar_orgs_visibles())
    or (
      organization_id in (select public.closeuse_orgs())
      and exists (
        select 1 from public.radar_bookings b
        where b.id = radar_encaissement_incidents.booking_id
          and b.closeuse_id = (select auth.uid())
      )
    )
  );

-- radar_closeuses, radar_r2
drop policy if exists radar_closeuses_select on public.radar_closeuses;
create policy radar_closeuses_select on public.radar_closeuses
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (select public.radar_orgs_visibles())
  );

drop policy if exists radar_r2_select on public.radar_r2;
create policy radar_r2_select on public.radar_r2
  for select to authenticated
  using (
    closeuse_id = (select auth.uid())
    or organization_id in (select public.radar_orgs_visibles())
  );

-- closeuse_facturation, closeuse_factures
drop policy if exists closeuse_facturation_select on public.closeuse_facturation;
create policy closeuse_facturation_select on public.closeuse_facturation
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (select public.radar_orgs_visibles())
  );

drop policy if exists closeuse_factures_select on public.closeuse_factures;
create policy closeuse_factures_select on public.closeuse_factures
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (select public.radar_orgs_visibles())
  );

-- radar_analyses, radar_analyse_passages (signalées par l'Advisor : auth.uid()
-- et is_admin() relus à chaque ligne)
drop policy if exists radar_analyses_select on public.radar_analyses;
create policy radar_analyses_select on public.radar_analyses
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      closeuse_id = (select auth.uid())
      and organization_id in (select public.closeuse_orgs())
      and public.radar_analyse_ouverte(organization_id, (select auth.uid()))
    )
  );

drop policy if exists radar_analyse_passages_select on public.radar_analyse_passages;
create policy radar_analyse_passages_select on public.radar_analyse_passages
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      organization_id in (select public.closeuse_orgs())
      and public.radar_analyse_ouverte(organization_id, (select auth.uid()))
    )
  );
