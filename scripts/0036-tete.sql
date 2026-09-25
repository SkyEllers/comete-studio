-- ===========================================================================
-- 0036 — Radar : la closeuse
--
-- Une closeuse tient les rendez-vous de vente d'un client à sa place. Elle
-- voit ses rendez-vous, et rien d'autre du client : ni ses chiffres, ni ses
-- autres outils, ni les rendez-vous du client lui-même.
--
-- Écrit par `scripts/generer-0036.py` : ne pas modifier ce fichier à la main,
-- modifier `scripts/0036-tete.sql`, `scripts/0036-queue.sql` ou le script.
--
-- Les décisions de ce fichier.
--
-- 1. Une closeuse n'est pas une « membre ». `is_member()` porte toute la
--    sécurité du hub (outils, Sonde, Horizon, fichiers, Radar) : l'exclure là
--    ferme tout d'un coup, sans policy à retoucher une par une. Elle n'entre
--    que par `is_closeuse()`, qui ne sert qu'aux policies écrites ici.
--
-- 2. Un rendez-vous appartient à une closeuse par son type de séance. Le
--    client ouvre un type à part dans son Calendly, sur les créneaux de la
--    closeuse ; Louis relie ce type à elle ; le webhook pose `closeuse_id` sur
--    chaque réservation de ce type. Louis peut aussi réattribuer à la main.
--
-- 3. Les réponses au formulaire de réservation sont gardées, pour ses
--    rendez-vous seulement. Radar ne les gardait pas, exprès : ce sont des
--    données de santé. La closeuse en a besoin pour préparer l'appel et pour
--    rappeler la personne. Elles vivent dans une table à part, lisible par
--    elle et par Louis seulement, effacée 90 jours après le rendez-vous, sauf
--    rappel promis encore à venir, et au plus tard au bout de 25 mois.
--
-- 4. La commission de la closeuse ne touche pas à celle de Comète. Les ventes
--    restent celles de Radar (une par rendez-vous) ; s'y ajoutent le nombre de
--    mensualités, les taux de la closeuse, et les incidents d'encaissement
--    (impayé, remboursement) que Louis note. Le calcul se fait dans l'app.
--
-- 5. Les cinq fonctions de saisie gardent leur code : seule leur garde change,
--    `radar_peut_saisir()` au lieu de `can_access_radar()`. Pour un membre ou
--    Louis, c'est exactement la même réponse qu'avant.
-- ===========================================================================

-- ------------------------------ Les droits ---------------------------------

create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = auth.uid()
                   and m.role <> 'closeuse');
$fn$;

create or replace function public.is_closeuse(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = auth.uid()
                   and m.role = 'closeuse');
$fn$;

/*
 * Qui peut saisir sur un rendez-vous : ceux que Radar laissait déjà faire, plus
 * la closeuse à qui ce rendez-vous est attribué, et à elle seule.
 */
create or replace function public.radar_peut_saisir(org uuid, closeuse uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.can_access_radar(org)
      or (closeuse is not null
          and closeuse = auth.uid()
          and public.is_closeuse(org));
$fn$;

revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_closeuse(uuid) from public, anon;
revoke execute on function public.radar_peut_saisir(uuid, uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_closeuse(uuid) to authenticated;
grant execute on function public.radar_peut_saisir(uuid, uuid) to authenticated;

-- Elle lit le nom de l'organisation (la barre du haut), et sa propre adhésion
-- (« Mes espaces »). Rien d'autre des tables du socle.
drop policy "organizations_select" on public.organizations;
create policy "organizations_select" on public.organizations
  for select to authenticated
  using (public.is_member(id) or public.is_closeuse(id) or (select public.is_admin()));

create policy "memberships_select_self" on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------ Les tables ---------------------------------

/*
 * Une closeuse chez un client, et sa grille. Les taux sont ceux validés par
 * Peggy le 23/09/2026 : 15 %, puis 18 % sur les ventes au-delà de la 5e du
 * mois (celles-là seulement).
 */
create table public.radar_closeuses (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  taux            numeric(5,2) not null default 15 check (taux >= 0 and taux <= 100),
  taux_palier     numeric(5,2) not null default 18 check (taux_palier >= 0 and taux_palier <= 100),
  palier_apres    smallint not null default 5 check (palier_apres >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.radar_closeuses enable row level security;

create policy "radar_closeuses_select" on public.radar_closeuses
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_access_radar(organization_id));
create policy "radar_closeuses_admin_write" on public.radar_closeuses
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create trigger radar_closeuses_updated_at before update on public.radar_closeuses
  for each row execute function public.set_updated_at();

alter table public.radar_event_filters
  add column closeuse_id uuid references public.profiles(id) on delete set null;

comment on column public.radar_event_filters.closeuse_id is
  'Les réservations de ce type sont attribuées à cette closeuse par le webhook.';

alter table public.radar_bookings
  add column closeuse_id uuid references public.profiles(id) on delete set null,
  add column sale_fois smallint not null default 1 check (sale_fois between 1 and 24);

comment on column public.radar_bookings.closeuse_id is
  'La closeuse qui tient ce rendez-vous, ou null quand c''est le client.';
comment on column public.radar_bookings.sale_fois is
  'Nombre de paiements de la vente : 1 en une fois, sinon le premier puis une mensualité par mois.';

create index radar_bookings_closeuse_idx
  on public.radar_bookings(closeuse_id, scheduled_start)
  where closeuse_id is not null;

create policy "radar_bookings_select_closeuse" on public.radar_bookings
  for select to authenticated
  using (closeuse_id = (select auth.uid()) and public.is_closeuse(organization_id));

create policy "radar_activities_select_closeuse" on public.radar_booking_activities
  for select to authenticated
  using (
    public.is_closeuse(organization_id)
    and exists (select 1 from public.radar_bookings b
                 where b.id = booking_id and b.closeuse_id = (select auth.uid()))
  );

/*
 * Les réponses au formulaire de réservation, pour les rendez-vous d'une
 * closeuse seulement. Écrites par le webhook (service role), lues par elle et
 * par Louis. Le client ne les lit pas ici : il les a déjà dans son Calendly.
 */
create table public.radar_booking_answers (
  booking_id      uuid primary key references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  answers         jsonb not null check (jsonb_typeof(answers) = 'array'),
  received_at     timestamptz not null default now()
);

alter table public.radar_booking_answers enable row level security;

create policy "radar_booking_answers_select" on public.radar_booking_answers
  for select to authenticated
  using (
    (select public.is_admin())
    or (public.is_closeuse(organization_id)
        and exists (select 1 from public.radar_bookings b
                     where b.id = booking_id and b.closeuse_id = (select auth.uid())))
  );
create policy "radar_booking_answers_admin_delete" on public.radar_booking_answers
  for delete to authenticated using ((select public.is_admin()));

/*
 * Ce que Louis note quand l'argent ne suit pas l'échéancier : une mensualité
 * impayée (pas de commission dessus), ou remboursée (sa commission se retire
 * du mois suivant). Sans ligne ici, une mensualité échue compte comme payée.
 */
create table public.radar_encaissement_incidents (
  booking_id      uuid not null references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  numero          smallint not null check (numero between 1 and 24),
  type            text not null check (type in ('impaye', 'rembourse')),
  note            text check (char_length(note) <= 200),
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  primary key (booking_id, numero)
);

alter table public.radar_encaissement_incidents enable row level security;

create policy "radar_encaissement_incidents_select" on public.radar_encaissement_incidents
  for select to authenticated
  using (
    public.can_access_radar(organization_id)
    or (public.is_closeuse(organization_id)
        and exists (select 1 from public.radar_bookings b
                     where b.id = booking_id and b.closeuse_id = (select auth.uid())))
  );
create policy "radar_encaissement_incidents_admin_write" on public.radar_encaissement_incidents
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------- La vue ------------------------------------

-- @@VUE@@
-- ------------------------ Les fonctions de saisie --------------------------

