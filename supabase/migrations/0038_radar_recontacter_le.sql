-- ===========================================================================
-- 0038 — Radar : recontacter à une date, pas seulement à un mois
--
-- La closeuse rappelle une personne le jour dit (« rappelez-moi le 12 »), pas
-- « en octobre ». `radar_note_non_vente` prend donc une date exacte en option,
-- `recontacter_le`. Le mois reste écrit comme avant dans `recontacter` : c'est
-- lui que lisent l'écran de Peggy et la purge des réponses (0036). La date
-- exacte s'ajoute à côté, dans `recontacter_le`.
--
-- Le corps est celui de la 0036 (lui-même la 0031 avec la garde de la
-- closeuse), avec trois changements : le paramètre, le mois tiré de la date
-- quand elle est donnée, et la date dans le payload.
-- ===========================================================================

drop function if exists public.radar_note_non_vente(uuid, text, date);

create or replace function public.radar_note_non_vente(
  booking_id     uuid,
  motif          text,
  recontacter    date default null,
  recontacter_le date default null
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  cible    uuid := booking_id;
  rdv      public.radar_bookings%rowtype;
  aujourd  date := (now() at time zone 'Europe/Paris')::date;
  ce_mois  date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  mois     date := date_trunc('month', coalesce(recontacter_le, recontacter))::date;
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

  if recontacter_le is not null and recontacter_le < aujourd then
    raise exception 'La date à recontacter est passée.';
  end if;

  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
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
  if recontacter_le is not null then
    voulu := voulu || jsonb_build_object('recontacter_le', recontacter_le);
  end if;

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

revoke execute on function public.radar_note_non_vente(uuid, text, date, date) from public, anon;
grant execute on function public.radar_note_non_vente(uuid, text, date, date) to authenticated;
