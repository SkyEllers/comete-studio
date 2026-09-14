-- ===========================================================================
-- 0021 — Radar : les types de séance qu'on suit, et ceux qu'on ignore
--
-- Un Calendly ne sert pas qu'à prendre des premiers rendez-vous. Chez Peggy,
-- « RDV individuel pour les clientes Programme Etincelle » est le suivi de
-- clientes déjà acquises : ces séances ne viennent d'aucun canal, ne doivent
-- rien à Comète, et n'ont rien à faire dans Radar. Elles y entraient pourtant
-- toutes, parce que le webhook ne distinguait pas un type d'un autre — et
-- elles gonflaient les réservations, les « directes » et l'entonnoir.
--
-- Trois décisions tiennent dans ce fichier.
--
-- 1. Le filtre porte sur l'URI du type, pas sur son nom. Peggy peut renommer
--    sa séance demain ; l'URI, elle, ne bouge pas. Le nom est gardé à côté
--    pour que Louis sache de quoi il parle, et le webhook le tient à jour.
--
-- 2. Un type inconnu est suivi. Le webhook crée sa ligne à la première
--    réservation et continue : un nouveau type de diagnostic offert qui
--    tomberait dehors par défaut, ce serait de la commission perdue en
--    silence. Couper est un geste, jamais un défaut.
--
-- 3. Couper un type n'efface rien. Ses lignes existantes restent jusqu'à ce
--    que Louis demande à les supprimer — et celles qu'un relevé a figées
--    restent quoi qu'il demande : un relevé signé ne perd pas ses lignes.
-- ===========================================================================

create table public.radar_event_filters (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- La clé du filtre : https://api.calendly.com/event_types/<uuid>.
  event_type_uri   text not null check (char_length(event_type_uri) between 1 and 500),
  -- Pour l'affichage seulement. Mis à jour au fil des webhooks : c'est le nom
  -- de la dernière réservation reçue qui fait foi.
  event_type_name  text not null check (char_length(event_type_name) <= 200),
  tracked          boolean not null default true,
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, event_type_uri)
);

comment on table public.radar_event_filters is
  'Les types de séance Calendly vus par Radar, et ceux que Louis a coupés. Un type inconnu est suivi.';
comment on column public.radar_event_filters.event_type_uri is
  'La clé du filtre : stable même quand le client renomme sa séance.';
comment on column public.radar_event_filters.tracked is
  'Faux : le webhook n''insère plus rien de ce type (outcome filtered). Les lignes existantes restent.';

create trigger radar_event_filters_set_updated_at
  before update on public.radar_event_filters
  for each row execute function public.set_updated_at();

/*
 * Ce que l'écran « Types de séance » compte, et ce que la suppression balaie :
 * les lignes d'un client pour un type. Sans index, chaque compte et chaque
 * suppression parcourent tout l'historique du client.
 */
create index radar_bookings_event_type_idx
  on public.radar_bookings(organization_id, event_type_uri);

-- ------------------------------ L'existant ----------------------------------

/*
 * Les types déjà en base, suivis — c'est-à-dire exactement le comportement
 * d'hier. Sans cette reprise, un type n'apparaîtrait dans l'administration
 * qu'à sa prochaine réservation, et Louis ne pourrait pas couper aujourd'hui
 * les dix-sept séances de suivi que Radar a déjà reçues.
 *
 * Le nom retenu est celui de la réservation la plus récente, comme le fera le
 * webhook ; la première apparition, celle de la plus ancienne. Les lignes sans
 * URI de type — Calendly ne l'a jamais omise jusqu'ici, mais le champ est
 * facultatif — n'ont pas de clé à filtrer et restent hors de cette table.
 */
insert into public.radar_event_filters
  (organization_id, event_type_uri, event_type_name, first_seen_at)
select distinct on (b.organization_id, b.event_type_uri)
       b.organization_id,
       b.event_type_uri,
       left(b.event_type_name, 200),
       min(b.created_at) over (partition by b.organization_id, b.event_type_uri)
  from public.radar_bookings b
 where b.event_type_uri is not null
 order by b.organization_id, b.event_type_uri, b.created_at desc
on conflict (organization_id, event_type_uri) do nothing;

-- --------------------------------- RLS -------------------------------------

/*
 * Le client lit, Louis écrit — la forme de `radar_channels`. Voir quels types
 * Radar suit est une information que le client a le droit d'avoir : c'est ce
 * qui explique qu'une séance n'apparaisse pas dans ses rendez-vous. Décider de
 * ce qui compte, en revanche, reste à Louis.
 *
 * Le webhook écrit avec la clé de service et ne passe pas par ces politiques.
 */
alter table public.radar_event_filters enable row level security;

create policy "radar_event_filters_select" on public.radar_event_filters
  for select to authenticated using (public.can_access_radar(organization_id));
create policy "radar_event_filters_insert" on public.radar_event_filters
  for insert to authenticated with check ((select public.is_admin()));
create policy "radar_event_filters_update" on public.radar_event_filters
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "radar_event_filters_delete" on public.radar_event_filters
  for delete to authenticated using ((select public.is_admin()));

-- ------------------------ Supprimer les lignes d'un type --------------------

/*
 * Les lignes existantes d'un type coupé, sauf celles qu'un relevé a figées.
 *
 * Une fonction plutôt que deux requêtes de l'application, pour deux raisons.
 * La première est l'ordre : la suppression et le compte de ce qui reste se
 * font dans la même transaction, si bien qu'une clôture qui passerait entre
 * les deux ne fausse ni l'un ni l'autre. La seconde est la règle elle-même —
 * « on ne supprime pas d'un type qu'on suit, on ne touche pas à une ligne
 * rattachée à un relevé » — qui vit ici, sous les yeux du banc, et non dans
 * une action que seul un navigateur connecté peut appeler.
 *
 * « Figée » veut dire `statement_id` posé : la clôture accroche à son relevé
 * les lignes qu'elle a recopiées, et ce sont celles-là dont le relevé signé
 * dépend. Elles sont refusées une à une par le `where`, et comptées.
 *
 * Réservée à la clé de service, comme les purges de la 0011 : l'administration
 * l'appelle après `requireAdmin()`, et un membre n'a aucune raison de
 * l'approcher. Supprimer un rendez-vous emporte ses activités (cascade) et
 * délie, sans les effacer, les reports et récurrences qui pointaient dessus.
 */
create or replace function public.radar_supprimer_lignes_du_type(filtre uuid)
returns table (supprimees integer, figees integer)
language plpgsql security definer set search_path = public as $fn$
declare
  cible public.radar_event_filters%rowtype;
begin
  select * into cible from public.radar_event_filters where id = filtre;
  if not found then
    raise exception 'Ce type de séance n''existe plus.';
  end if;

  if cible.tracked then
    raise exception 'Ce type de séance est suivi : coupe-le avant d''en supprimer les lignes.';
  end if;

  delete from public.radar_bookings b
   where b.organization_id = cible.organization_id
     and b.event_type_uri = cible.event_type_uri
     and b.statement_id is null;

  get diagnostics supprimees = row_count;

  select count(*)::integer into figees
    from public.radar_bookings b
   where b.organization_id = cible.organization_id
     and b.event_type_uri = cible.event_type_uri
     and b.statement_id is not null;

  return next;
end;
$fn$;

revoke execute on function public.radar_supprimer_lignes_du_type(uuid)
  from public, anon, authenticated;
grant execute on function public.radar_supprimer_lignes_du_type(uuid) to service_role;
