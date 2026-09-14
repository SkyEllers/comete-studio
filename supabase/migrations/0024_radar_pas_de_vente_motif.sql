-- ===========================================================================
-- 0024 — Radar : pourquoi pas de vente, et quand en reparler
--
-- Chez Peggy, les notes de juin-juillet disaient pourquoi une personne venue
-- n'avait pas acheté : l'argent cinq fois sur dix, un conjoint qui refuse, pas
-- prête. Trois ont même donné une date (« je reviens fin novembre »). « Pas de
-- vente » ne gardait rien de tout ça, et aucune de ces personnes n'est revenue
-- d'elle-même.
--
-- Trois décisions tiennent dans ce fichier.
--
-- 1. Le motif et le mois vivent dans les activités, comme « pas de vente »
--    (0016) et l'appel de la veille (0022) : une réponse qui peut changer,
--    dont on garde la trace, et que la dernière activité suffit à lire. Pas de
--    colonne, donc pas de vue `radar_bookings_effective` à reconstruire.
--
-- 2. Rien de nominatif n'y entre : un mot-clé de motif et un mois. Le nom reste
--    sur `radar_bookings` et part avec la ligne (0015). Radar rappelle au
--    client qui recontacter ; il ne contacte personne.
--
-- 3. Pas de réglage par client. La question ne se pose qu'en mode `ventes`,
--    sur une séance honorée sans vente : un client en `encaissement` ne la
--    voit jamais.
-- ===========================================================================

/*
 * Dire pourquoi une séance n'a pas vendu, et quand en reparler.
 *
 * Le motif suppose « pas de vente » : s'il n'est pas encore dit, la fonction le
 * dit aussi, en une seule réponse du client. Rend `true` si quelque chose
 * change, `false` si c'était déjà exactement cette réponse.
 */
create or replace function public.radar_note_non_vente(
  booking_id uuid,
  motif text,
  recontacter date default null
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  -- Copie locale : `booking_id` est aussi une colonne de la table d'activités.
  cible    uuid := booking_id;
  rdv      public.radar_bookings%rowtype;
  ce_mois  date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  mois     date := date_trunc('month', recontacter)::date;
  voulu    jsonb;
  derniere jsonb;
  declaree boolean := false;
begin
  if motif is null
     or motif not in ('argent', 'moment', 'conjoint', 'pas_convaincue', 'autre') then
    raise exception 'Motif inconnu : l''argent, pas le bon moment, le conjoint, pas convaincue ou autre.';
  end if;

  -- Un mois passé ne rappellerait rien ; au-delà de deux ans, on ne s'en
  -- souviendra plus de part et d'autre.
  if mois is not null and (mois < ce_mois or mois > (ce_mois + interval '24 months')::date) then
    raise exception 'Le mois à recontacter tombe entre ce mois-ci et dans deux ans.';
  end if;

  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.can_access_radar(rdv.organization_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  if rdv.sale_amount_cents is not null then
    raise exception 'Cette séance porte une vente. Retire-la d''abord.';
  end if;

  if rdv.status in ('annule', 'no_show') then
    raise exception 'Cette séance n''a pas eu lieu : il n''y a pas de vente à expliquer.';
  end if;

  if rdv.scheduled_start > now() then
    raise exception 'Cette séance n''a pas encore eu lieu.';
  end if;

  if not exists (
    select 1
      from public.radar_booking_activities a
     where a.booking_id = cible
       and a.type = 'sale.declined'
  ) then
    insert into public.radar_booking_activities
      (booking_id, organization_id, user_id, type, payload)
    values (cible, rdv.organization_id, auth.uid(), 'sale.declined', '{}'::jsonb);
    declaree := true;
  end if;

  voulu := jsonb_build_object('motif', motif, 'recontacter', mois);

  select a.payload into derniere
    from public.radar_booking_activities a
   where a.booking_id = cible
     and a.type = 'sale.reason'
   order by a.created_at desc
   limit 1;

  if derniere = voulu then
    return declaree;
  end if;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values (cible, rdv.organization_id, auth.uid(), 'sale.reason', voulu);

  return true;
end;
$fn$;

revoke execute on function public.radar_note_non_vente(uuid, text, date) from public, anon;
grant execute on function public.radar_note_non_vente(uuid, text, date) to authenticated;

/*
 * « C'est fait » : la personne a été recontactée.
 *
 * Porte sur le dernier motif noté. Si le client note ensuite un nouveau mois,
 * la personne revient dans la liste à ce mois-là : le « fait » d'avant ne
 * couvre pas la date d'après.
 */
create or replace function public.radar_recontact_fait(booking_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  cible  uuid := booking_id;
  rdv    public.radar_bookings%rowtype;
  raison jsonb;
  notee  timestamptz;
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.can_access_radar(rdv.organization_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  select a.payload, a.created_at into raison, notee
    from public.radar_booking_activities a
   where a.booking_id = cible
     and a.type = 'sale.reason'
   order by a.created_at desc
   limit 1;

  if raison is null or raison->>'recontacter' is null then
    raise exception 'Personne n''est à recontacter sur ce rendez-vous.';
  end if;

  if exists (
    select 1
      from public.radar_booking_activities a
     where a.booking_id = cible
       and a.type = 'recontact.done'
       and a.created_at >= notee
  ) then
    return false;
  end if;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values (
    cible, rdv.organization_id, auth.uid(), 'recontact.done',
    jsonb_build_object('recontacter', raison->'recontacter')
  );

  return true;
end;
$fn$;

revoke execute on function public.radar_recontact_fait(uuid) from public, anon;
grant execute on function public.radar_recontact_fait(uuid) to authenticated;

-- La liste « À recontacter » d'un client : la question que pose son tableau
-- de bord à chaque visite.
create index if not exists radar_activities_non_vente_idx
  on public.radar_booking_activities(organization_id, created_at desc)
  where type in ('sale.reason', 'recontact.done');
