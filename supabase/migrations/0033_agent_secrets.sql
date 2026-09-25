-- ===========================================================================
-- 0033 — L'agent : ses propres secrets, dans le Vault
--
-- L'agent lit les créneaux libres et réserve à la place de la cliente. Il
-- lui faut un jeton Calendly avec deux droits que celui de Radar n'a pas :
-- `event_types:read` et `scheduled_events:write` (constaté le 25/09/2026 :
-- « Insufficient scope » sur `GET /event_types`).
--
-- Un jeton à part plutôt qu'élargir celui de Radar : chacun garde le
-- minimum de droits, et couper l'agent ne touche pas à Radar. Même mécanique
-- que `radar_set_secret` (0008) : nom `agent:<org>:<type>`, fonctions
-- réservées à `service_role`. Le jeton WhatsApp de l'agent viendra ici aussi.
-- ===========================================================================

create or replace function public.agent_set_secret(org uuid, kind text, value text)
returns void
language plpgsql security definer set search_path = public, vault as $fn$
declare
  nom      text;
  existant uuid;
begin
  if kind is null or kind not in ('calendly_token', 'whatsapp_token') then
    raise exception 'Type de secret inconnu : %', kind;
  end if;

  if org is null or value is null or length(value) = 0 then
    raise exception 'Organisation ou valeur manquante.';
  end if;

  nom := 'agent:' || org::text || ':' || kind;

  select id into existant from vault.secrets where name = nom;

  if existant is null then
    perform vault.create_secret(value, nom, 'Agent — ' || kind);
  else
    perform vault.update_secret(existant, value, nom, 'Agent — ' || kind);
  end if;
end;
$fn$;

create or replace function public.agent_get_secret(org uuid, kind text)
returns text
language plpgsql security definer set search_path = public, vault as $fn$
declare
  valeur text;
begin
  if kind is null or kind not in ('calendly_token', 'whatsapp_token') then
    raise exception 'Type de secret inconnu : %', kind;
  end if;

  select decrypted_secret into valeur
    from vault.decrypted_secrets
   where name = 'agent:' || org::text || ':' || kind;

  return valeur;
end;
$fn$;

/* Couper l'agent d'un client, c'est aussi effacer ses jetons. */
create or replace function public.agent_clear_secrets(org uuid)
returns int
language plpgsql security definer set search_path = public, vault as $fn$
declare
  effaces int;
begin
  delete from vault.secrets
   where name in (
     'agent:' || org::text || ':calendly_token',
     'agent:' || org::text || ':whatsapp_token'
   );
  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.agent_set_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.agent_get_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.agent_clear_secrets(uuid) from public, anon, authenticated;
grant execute on function public.agent_set_secret(uuid, text, text) to service_role;
grant execute on function public.agent_get_secret(uuid, text) to service_role;
grant execute on function public.agent_clear_secrets(uuid) to service_role;
