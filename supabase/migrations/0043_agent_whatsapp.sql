-- ===========================================================================
-- 0043 — L'agent parle par WhatsApp
--
-- Le canal WhatsApp (API Cloud de Meta) remplace la simulation le jour du
-- lancement. Trois choses changent en base :
--
--   1. Le réglage porte l'identifiant du numéro chez Meta (phone_number_id),
--      par lequel les messages partent et auquel le webhook reconnaît le
--      client. Le jeton, lui, reste dans le Vault (0033).
--   2. Un message sortant peut être « distribué » puis « lu » : Meta le dit
--      par le webhook. Un « échec » garde la raison de Meta dans `erreur`.
--   3. Un message de Meta ne se traite qu'une fois : Meta renvoie un webhook
--      tant qu'il n'a pas reçu 200, et son identifiant (wamid) est unique.
-- ===========================================================================

alter table public.agent_reglages
  add column whatsapp_numero_id text
  check (whatsapp_numero_id ~ '^[0-9]{6,20}$');

comment on column public.agent_reglages.whatsapp_numero_id is
  'Identifiant du numéro WhatsApp chez Meta (phone_number_id). Les envois partent par lui ; le webhook reconnaît le client à lui. Le jeton est dans le Vault (agent:<org>:whatsapp_token).';

create unique index agent_reglages_whatsapp_numero_idx
  on public.agent_reglages(whatsapp_numero_id) where whatsapp_numero_id is not null;

alter table public.agent_messages drop constraint agent_messages_statut_check;
alter table public.agent_messages add constraint agent_messages_statut_check
  check (statut in ('envoye', 'distribue', 'lu', 'recu', 'echec'));

create unique index agent_messages_id_externe_idx
  on public.agent_messages(id_externe) where id_externe is not null;
