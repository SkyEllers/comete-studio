-- ===========================================================================
-- 0041 — L'agent laisse sa trace dans Radar
--
-- Radar ne garde toujours ni téléphone, ni message, ni réponse (0032,
-- décision 1). Il reçoit une marque, une seule par rendez-vous : où en est
-- la cliente avec l'assistante.
--
--   en_cours             l'assistante lui écrit, pas encore de confirmation
--   confirme             elle a confirmé à l'assistante (ou choisi un
--                        nouveau créneau, qui vaut confirmation)
--   sans_reponse_veille  rien répondu à la veille : le rendez-vous tient,
--                        le lien Zoom part le matin (P12)
--   stop                 elle a demandé à ne plus recevoir de messages
--
-- La marque s'écrit par un déclencheur sur `agent_conversations` : quel que
-- soit le chemin (webhook, horloge, réponse, report), elle suit la
-- conversation sans qu'aucun code n'ait à y penser. Elle survit à la purge
-- des conversations à 30 jours : c'est la trace qui reste dans Radar.
--
-- Qui la voit (Louis, 25/09/2026) : Louis dans l'admin Radar, et la closeuse
-- sur ses rendez-vous. Pas le client : il a le mail du matin.
-- Les simulations n'y touchent jamais (elles n'ont pas de rendez-vous Radar).
-- ===========================================================================

alter table public.radar_bookings
  add column agent_suivi text
  check (agent_suivi in ('en_cours', 'confirme', 'sans_reponse_veille', 'stop'));

comment on column public.radar_bookings.agent_suivi is
  'Où en est la cliente avec l''assistante (agent WhatsApp) : en_cours, confirme, sans_reponse_veille, stop. Écrite par le déclencheur de agent_conversations ; null quand l''agent ne suit pas ce rendez-vous.';

create or replace function public.agent_vers_radar()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  marque text;
begin
  if new.simulation or new.booking_id is null then
    return new;
  end if;

  -- Annulé ou passé : la dernière marque reste telle quelle. Trop proche :
  -- l'agent n'écrit pas, rien à marquer.
  if new.etat = 'stop' then
    marque := 'stop';
  elsif new.etat = 'active' then
    marque := case
      when new.confirme_le is not null then 'confirme'
      when new.sans_reponse_veille then 'sans_reponse_veille'
      else 'en_cours'
    end;
  else
    return new;
  end if;

  update public.radar_bookings
     set agent_suivi = marque
   where id = new.booking_id
     and organization_id = new.organization_id
     and agent_suivi is distinct from marque;

  return new;
end;
$fn$;

revoke execute on function public.agent_vers_radar() from public, anon, authenticated;

create trigger agent_conversations_vers_radar
  after insert or update of booking_id, etat, confirme_le, sans_reponse_veille
  on public.agent_conversations
  for each row execute function public.agent_vers_radar();
