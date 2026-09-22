-- ===========================================================================
-- 0031 — Radar : « elle n'a pas encore répondu »
--
-- « Pas de vente » demandait pourquoi, et n'offrait que des réponses fermes :
-- l'argent, pas le bon moment, le conjoint, pas convaincue, autre. Or beaucoup
-- de personnes ne disent ni oui ni non en sortant du rendez-vous, et décident
-- des semaines plus tard. Le client devait donc cocher un motif faux, ou ne
-- rien cocher. Il ne cochait rien : chez Peggy, 60 « pas de vente » enregistrés
-- pour 2 raisons notées (relevé du 22/09/2026).
--
-- `pas_encore` est ce sixième motif. Il ne change rien au relevé du mois, une
-- vente non répondue n'étant pas une vente ; ce qu'il change, c'est que la
-- personne revient dans « À recontacter » au mois dit, au lieu de disparaître.
--
-- Seule la liste des motifs bouge. Le reste de la fonction est celui de 0024,
-- recopié parce que `create or replace` remplace le corps entier.
-- ===========================================================================

create or replace function public.radar_note_non_vente(
  booking_id uuid,
  motif text,
  recontacter date default null
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  cible    uuid := booking_id;
  rdv      public.radar_bookings%rowtype;
  ce_mois  date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  mois     date := date_trunc('month', recontacter)::date;
  voulu    jsonb;
  derniere jsonb;
  declaree boolean := false;
begin
  if motif is null
     or motif not in ('pas_encore', 'argent', 'moment', 'conjoint', 'pas_convaincue', 'autre') then
    raise exception 'Motif inconnu : pas encore répondu, l''argent, pas le bon moment, le conjoint, pas convaincue ou autre.';
  end if;

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
