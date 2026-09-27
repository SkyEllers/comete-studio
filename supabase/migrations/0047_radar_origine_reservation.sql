-- ===========================================================================
-- 0047 — Radar : les rendez-vous de l'outil de réservation maison
--
-- Jusqu'ici, tout rendez-vous de Radar venait du webhook Calendly. L'outil de
-- réservation du hub (0042) écrit désormais lui-même les siens dans Radar,
-- avec la bonne personne (`closeuse_id`), sans passer par Calendly.
--
-- 1. Une origine de statut de plus, `reservation` : « annulé par la cliente,
--    depuis son lien personnel ». Les libellés de Radar peuvent ainsi dire
--    d'où vient un statut sans parler de Calendly.
-- 2. La garde de `radar_client_set_status` (dernière version : 0036) :
--    une annulation venue de l'outil fait foi, comme une annulation Calendly.
--    Seule la garde change, le reste est recopié tel quel.
--
-- Les lignes de l'outil se reconnaissent à leur `invitee_uri` et leur
-- `event_uri` : `reservation:<id du rendez-vous>`. `event_type_uri` vaut
-- `reservation:diagnostic` : le filtre des types de séance les voit comme un
-- type à part, suivi.
-- ===========================================================================

alter type public.radar_status_origin add value if not exists 'reservation';

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

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
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

  -- 0047 : même règle pour l'outil de réservation maison.
  if rdv.status = 'annule' and rdv.status_origin = 'reservation' then
    raise exception 'Cette séance a été annulée par la cliente : elle ne se rouvre pas ici.';
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
