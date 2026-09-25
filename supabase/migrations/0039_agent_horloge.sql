-- ===========================================================================
-- 0039 — L'agent : l'horloge qui le fait tourner quand personne n'écrit
--
-- Le planning des messages se calcule (0032, décision 3) : il faut que
-- quelqu'un demande régulièrement « que faut-il envoyer maintenant ? ».
-- C'est la base qui le demande, toutes les 5 minutes, en appelant la route
-- `POST /api/agent/horloge` du hub (pg_net). Les tâches planifiées de Vercel
-- ne passent qu'une fois par jour sur le compte gratuit.
--
-- L'adresse et le secret vivent dans le Vault, rangés par Louis avec
-- `scripts/agent-horloge-secret.ps1`. Tant qu'ils n'y sont pas, la tâche
-- passe sans rien appeler : cette migration peut partir avant la route.
--
-- Couper l'horloge : `select public.agent_horloge_couper();` (efface le
-- secret ; la tâche continue de passer, sans rien appeler).
-- ===========================================================================

create extension if not exists pg_net with schema extensions;

/* Ranger l'adresse et le secret de l'horloge. Réservée à `service_role`. */
create or replace function public.agent_horloge_regler(url text, secret text)
returns void
language plpgsql security definer set search_path = public, vault as $fn$
declare
  existant uuid;
begin
  if url is null or url !~ '^https://[^\s]+/api/agent/horloge$' then
    raise exception 'Adresse inattendue : il faut https://…/api/agent/horloge';
  end if;
  if secret is null or secret !~ '^[0-9a-f]{64}$' then
    raise exception 'Secret inattendu : il faut 64 caractères hexadécimaux.';
  end if;

  select id into existant from vault.secrets where name = 'agent:horloge:url';
  if existant is null then
    perform vault.create_secret(url, 'agent:horloge:url', 'Agent — adresse de l''horloge');
  else
    perform vault.update_secret(existant, url, 'agent:horloge:url', 'Agent — adresse de l''horloge');
  end if;

  select id into existant from vault.secrets where name = 'agent:horloge:secret';
  if existant is null then
    perform vault.create_secret(secret, 'agent:horloge:secret', 'Agent — secret de l''horloge');
  else
    perform vault.update_secret(existant, secret, 'agent:horloge:secret', 'Agent — secret de l''horloge');
  end if;
end;
$fn$;

create or replace function public.agent_horloge_couper()
returns int
language plpgsql security definer set search_path = public, vault as $fn$
declare
  effaces int;
begin
  delete from vault.secrets where name in ('agent:horloge:url', 'agent:horloge:secret');
  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

/*
 * Un passage de l'horloge : un appel, sans attendre la réponse (pg_net est
 * asynchrone). Rend l'identifiant de la requête, ou null si rien n'est réglé.
 * La réponse se lit dans `net._http_response` (gardée 6 heures).
 */
create or replace function public.agent_horloge()
returns bigint
language plpgsql security definer set search_path = public, vault, extensions as $fn$
declare
  adresse text;
  secret  text;
begin
  select decrypted_secret into adresse from vault.decrypted_secrets where name = 'agent:horloge:url';
  select decrypted_secret into secret  from vault.decrypted_secrets where name = 'agent:horloge:secret';
  if adresse is null or secret is null then
    return null;
  end if;

  return net.http_post(
    url := adresse,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret,
      'User-Agent', 'comete-hub-horloge/1'
    ),
    timeout_milliseconds := 60000
  );
end;
$fn$;

revoke execute on function public.agent_horloge_regler(text, text) from public, anon, authenticated;
revoke execute on function public.agent_horloge_couper() from public, anon, authenticated;
revoke execute on function public.agent_horloge() from public, anon, authenticated;
grant execute on function public.agent_horloge_regler(text, text) to service_role;
grant execute on function public.agent_horloge_couper() to service_role;
grant execute on function public.agent_horloge() to service_role;

select cron.unschedule('agent-horloge')
  from cron.job where jobname = 'agent-horloge';

select cron.schedule(
  'agent-horloge',
  '*/5 * * * *',
  $cron$ select public.agent_horloge() $cron$
);
