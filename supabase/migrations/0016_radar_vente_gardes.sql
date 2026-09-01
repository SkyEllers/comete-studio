-- ===========================================================================
-- 0016 — Radar : les deux gardes que la vente réclame
--
-- Le chantier 1 a posé la vente et `radar_set_sale`. En la portant à l'écran,
-- deux gestes du client se sont révélés impossibles à écrire depuis
-- l'application : ni l'un ni l'autre ne passe par une écriture directe, parce
-- que `radar_bookings` et `radar_booking_activities` sont fermées au membre —
-- il n'a que des fonctions.
--
-- 1. Dire « pas de vente ». Le tableau de bord, en mode `ventes`, montre les
--    séances honorées récentes qui n'ont ni vente ni décision. Il faut donc
--    pouvoir prendre la décision « non » sans inventer un montant nul, qui
--    serait une vente à zéro euro et non une absence de vente.
--
-- 2. Empêcher d'annuler une séance qui porte une vente. Sans ça, marquer
--    « non venue » une séance vendue la sortirait de la commission en
--    silence, en laissant la vente derrière — un montant facturable rattaché
--    à une séance qui n'a pas eu lieu. Le brief demande un refus, pas une
--    cascade.
-- ===========================================================================

-- --------------------------- « Pas de vente » -------------------------------

/*
 * Une décision, pas une vente.
 *
 * Elle ne touche aucune colonne : `sale_amount_cents` reste nul, et c'est le
 * point. Ce qu'on enregistre est le fait que quelqu'un a regardé cette séance
 * et répondu « non ». La trace vit dans les activités, à côté des autres
 * gestes du client, et disparaît avec le rendez-vous.
 *
 * Pas de verrou de relevé ici, contrairement à `radar_set_sale` : cette
 * fonction ne déplace pas un centime. Refuser la décision sur un mois clôturé
 * ne protégerait rien et laisserait la séance dans le bloc « À vérifier »
 * pour toujours.
 *
 * Idempotente : deux appuis sur le même bouton ne font pas deux lignes. Le
 * booléen rendu dit s'il s'est passé quelque chose — l'appelant n'a pas à
 * relire pour le savoir.
 */
create or replace function public.radar_decline_sale(booking_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  cible uuid := booking_id;
  rdv   public.radar_bookings%rowtype;
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.can_access_radar(rdv.organization_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  -- Une séance qui porte une vente n'est pas sans vente. Dire les deux serait
  -- se contredire, et l'écran ne le propose pas : la fonction le refuse quand
  -- même, parce qu'une fonction ne fait pas confiance à son écran.
  if rdv.sale_amount_cents is not null then
    raise exception 'Cette séance porte une vente. Retire-la d''abord.';
  end if;

  if exists (
    select 1
      from public.radar_booking_activities a
     where a.booking_id = cible
       and a.type = 'sale.declined'
  ) then
    return false;
  end if;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values (cible, rdv.organization_id, auth.uid(), 'sale.declined', '{}'::jsonb);

  return true;
end;
$fn$;

revoke execute on function public.radar_decline_sale(uuid) from public, anon;
grant execute on function public.radar_decline_sale(uuid) to authenticated;

-- --------------------- Une séance vendue ne s'annule pas ---------------------

/*
 * `radar_client_set_status`, reprise de la 0008 avec une garde de plus.
 *
 * Le corps est celui d'avant, à l'identique — c'est lui qui décide de la
 * commission de tous les clients en mode `encaissement`, et ce n'est pas le
 * moment de le réécrire. Seul le bloc marqué « phase 7 » est nouveau.
 *
 * Il vient après le contrôle d'accès et avant le verrou du relevé, dans
 * l'ordre où quelqu'un se poserait les questions : est-ce que ce rendez-vous
 * me regarde, est-ce que ce changement a un sens, est-ce que le mois est
 * encore ouvert.
 */
create or replace function public.radar_client_set_status(
  booking_id uuid,
  new_status public.radar_status,
  note text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  -- Copie locale : `booking_id` est aussi une colonne de la table d'activités,
  -- et l'ambiguïté ferait échouer l'insertion.
  cible  uuid := booking_id;
  rdv    public.radar_bookings%rowtype;
  propre text := nullif(btrim(coalesce(note, '')), '');
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.can_access_radar(rdv.organization_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  -- « Honoré » se calcule, il ne se pose pas : le client n'a pas à le
  -- contredire, et ne circule qu'entre ces trois-là.
  if new_status not in ('confirme', 'no_show', 'annule')
     or rdv.status not in ('confirme', 'no_show', 'annule') then
    raise exception 'Ce changement de statut n''est pas permis.';
  end if;

  -- Une annulation venue de Calendly fait foi. La rouvrir ici créerait une
  -- séance que l'agenda dit annulée — et une commission indéfendable.
  if rdv.status = 'annule' and rdv.status_origin = 'calendly' then
    raise exception 'Cette séance a été annulée dans Calendly : elle ne se rouvre pas ici.';
  end if;

  /*
   * Phase 7. Une séance qui n'a pas eu lieu ne porte pas de vente : les deux
   * ensemble donneraient un montant facturable accroché à un rendez-vous
   * annulé. On refuse plutôt que d'effacer la vente en cascade — c'est de
   * l'argent, et ça se retire à la main, en le voyant.
   */
  if new_status in ('annule', 'no_show') and rdv.sale_amount_cents is not null then
    raise exception 'Cette séance porte une vente. Retire-la d''abord.';
  end if;

  if exists (
    select 1
      from public.radar_statements s
     where s.organization_id = rdv.organization_id
       and s.month = public.radar_mois(rdv.scheduled_start)
  ) then
    raise exception 'Le relevé de ce mois est clôturé : ce rendez-vous ne change plus.';
  end if;

  update public.radar_bookings
     set status = new_status,
         status_origin = 'client',
         status_note = propre,
         updated_at = now()
   where id = cible;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (cible, rdv.organization_id, auth.uid(), 'status.changed',
     jsonb_build_object(
       'from', rdv.status,
       'to', new_status,
       'origin', 'client',
       'note', propre
     ));
end;
$fn$;

revoke execute on function public.radar_client_set_status(uuid, public.radar_status, text)
  from public, anon;
grant execute on function public.radar_client_set_status(uuid, public.radar_status, text)
  to authenticated;
