-- ===========================================================================
-- 0037 — Radar : le premier paiement d'une vente en plusieurs fois
--
-- Chez Peggy, une vente en plusieurs fois n'est pas découpée en parts égales :
-- 500 € au départ, puis 170 € par mois. La commission de la closeuse suit
-- chaque paiement encaissé : sans le montant du premier, le mois de la vente
-- serait faux. Null : parts égales.
-- ===========================================================================

alter table public.radar_bookings
  add column sale_premier_cents int check (sale_premier_cents is null or sale_premier_cents > 0);

comment on column public.radar_bookings.sale_premier_cents is
  'Montant du premier paiement d''une vente en plusieurs fois ; le reste se répartit à parts égales. Null : tout à parts égales.';

drop function if exists public.radar_set_sale_fois(uuid, int);

create or replace function public.radar_set_sale_fois(
  booking_id    uuid,
  fois          int,
  premier_cents int default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  cible   uuid := booking_id;
  premier int  := case when fois > 1 then premier_cents else null end;
  rdv     public.radar_bookings%rowtype;
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  if rdv.sale_amount_cents is null then
    raise exception 'Il n''y a pas de vente sur ce rendez-vous.';
  end if;

  if fois is null or fois < 1 or fois > 24 then
    raise exception 'Une vente se paie en 1 à 24 fois.';
  end if;

  if premier is not null and (premier <= 0 or premier >= rdv.sale_amount_cents) then
    raise exception 'Le premier paiement est plus petit que le total de la vente.';
  end if;

  if rdv.sale_fois = fois and rdv.sale_premier_cents is not distinct from premier then
    return;
  end if;

  update public.radar_bookings
     set sale_fois = fois, sale_premier_cents = premier, updated_at = now()
   where id = cible;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (cible, rdv.organization_id, auth.uid(), 'sale.instalments',
     jsonb_build_object('fois', fois, 'premier_cents', premier,
                        'fois_precedent', rdv.sale_fois,
                        'premier_precedent', rdv.sale_premier_cents));
end;
$fn$;

revoke execute on function public.radar_set_sale_fois(uuid, int, int) from public, anon;
grant execute on function public.radar_set_sale_fois(uuid, int, int) to authenticated;
