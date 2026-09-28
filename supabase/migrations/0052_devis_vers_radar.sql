-- ===========================================================================
-- 0052 — Le devis vers Radar : le paramètre change de nom
--
-- Dans 0050, le paramètre de `devis_vers_radar` s'appelait `devis`, comme la
-- table : Postgres refusait la requête (« column reference "devis" is
-- ambiguous ») et aucune vente ne s'inscrivait. Vu par le banc `qa:devis` le
-- 28/09/2026, avant toute mise en ligne.
-- ===========================================================================

drop function if exists public.devis_vers_radar(uuid);

create function public.devis_vers_radar(devis_cible uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  d        public.devis%rowtype;
  rdv      public.radar_bookings%rowtype;
  le_jour  date := (now() at time zone 'Europe/Paris')::date;
  fois     int;
  premier  int;
begin
  select * into d from public.devis where id = devis_cible;
  if not found or d.statut <> 'signe' or d.booking_id is null then
    return false;
  end if;

  select * into rdv from public.radar_bookings where id = d.booking_id;
  if not found or rdv.status in ('annule', 'no_show') then
    return false;
  end if;

  if exists (
    select 1 from public.radar_statements s
     where s.organization_id = rdv.organization_id
       and s.month in (date_trunc('month', rdv.sale_date)::date, date_trunc('month', le_jour)::date)
  ) then
    return false;
  end if;

  /*
   * En plusieurs fois : autant de paiements que de mois ; le premier porte
   * l'investigation et la première mensualité (Stripe ne sait pas les
   * séparer dans une même page de paiement, 28/09/2026).
   */
  fois := case when d.paiement = 'plusieurs' then d.duree_mois else 1 end;
  premier := case when fois > 1 then d.investigation_cents + d.mensualite_cents else null end;

  update public.radar_bookings
     set sale_amount_cents  = d.total_cents,
         sale_date          = greatest(le_jour, (rdv.scheduled_start at time zone 'Europe/Paris')::date),
         sale_note          = 'Devis signé en ligne',
         sale_recorded_by   = coalesce(d.closeuse_id, d.cree_par),
         sale_recorded_at   = now(),
         sale_fois          = fois,
         sale_premier_cents = premier,
         updated_at         = now()
   where id = rdv.id;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (rdv.id, rdv.organization_id, coalesce(d.closeuse_id, d.cree_par),
     case when rdv.sale_amount_cents is null then 'sale.recorded' else 'sale.updated' end,
     jsonb_build_object('montant_cents', d.total_cents, 'date', le_jour, 'note_presente', true,
                        'montant_precedent', rdv.sale_amount_cents, 'date_precedente', rdv.sale_date,
                        'source', 'devis', 'devis', d.id, 'fois', fois, 'premier_cents', premier));

  return true;
end;
$fn$;

revoke execute on function public.devis_vers_radar(uuid) from public, anon, authenticated;
grant execute on function public.devis_vers_radar(uuid) to service_role;
