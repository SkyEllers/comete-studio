-- ===========================================================================
-- 0034 — L'agent : où en est un déplacement de rendez-vous
--
-- Un report se fait en trois temps (P12, « Les règles de conduite ») :
--   1. elle a un empêchement : l'agent demande si c'est juste l'heure ou
--      toute la journée (`report_demande_le`) ;
--   2. il lui propose trois créneaux libres, lus dans Calendly à l'instant
--      (`creneaux_proposes`) ;
--   3. elle en choisit un : il le réserve à sa place, puis annule l'ancien.
--
-- Ces deux colonnes gardent le fil entre deux messages. Elles se vident dès
-- que le nouveau rendez-vous est pris.
-- ===========================================================================

alter table public.agent_conversations
  add column report_demande_le timestamptz,
  add column creneaux_proposes timestamptz[] not null default '{}';

comment on column public.agent_conversations.report_demande_le is
  'Elle a dit avoir un empêchement : à partir de là, chaque réponse de l''agent reçoit les créneaux libres du moment.';
comment on column public.agent_conversations.creneaux_proposes is
  'Les créneaux que l''agent vient de lui proposer. Seul l''un d''eux peut être réservé à sa place.';
