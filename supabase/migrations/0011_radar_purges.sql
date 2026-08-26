-- ===========================================================================
-- 0011 — Les purges de Radar deviennent appelables
--
-- La migration 0008 posait les deux ménages directement dans le corps des
-- tâches `pg_cron`. Ça marche, mais ça ne se vérifie pas : on ne peut ni les
-- déclencher à la main, ni savoir combien de lignes elles ont emportées, ni
-- s'assurer qu'elles n'emportent que celles-là.
--
-- Le brief du chantier 6 demande justement de les éprouver « en conditions
-- réelles, sur des lignes fictives datées ». D'où ces deux fonctions : la
-- logique vit à un seul endroit, `cron` les appelle, et un banc de QA peut les
-- appeler aussi.
--
-- Elles rendent le nombre de lignes supprimées. Un ménage silencieux qui
-- n'aurait jamais rien effacé ressemblerait exactement à un ménage qui marche.
-- ===========================================================================

/*
 * Les rendez-vous d'un relevé réglé depuis plus de treize mois.
 *
 * Le relevé, lui, reste : il est agrégé, il ne porte aucune clé d'invité, et
 * c'est la seule trace comptable de ce qui a été facturé. Ce sont les lignes
 * nominatives — au sens de la pseudonymisation — qui s'en vont.
 *
 * Un relevé encore clôturé ou contesté ne purge rien : tant que le client n'a
 * pas répondu, ses séances doivent rester consultables.
 */
create or replace function public.radar_purger_rendezvous(
  anciennete interval default interval '13 months'
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  effaces integer;
begin
  delete from public.radar_bookings b
   using public.radar_statements s
   where b.statement_id = s.id
     and s.status in ('paye', 'valide')
     and s.closed_at < now() - anciennete;

  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

/*
 * Le journal des webhooks, au-delà de quatre-vingt-dix jours.
 *
 * Il sert à comprendre pourquoi un rendez-vous n'est pas arrivé. Passé trois
 * mois, plus personne ne remonte aussi loin, et il porte des `invitee_key`
 * qu'il n'y a aucune raison de garder.
 */
create or replace function public.radar_purger_journal(
  anciennete interval default interval '90 days'
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  effaces integer;
begin
  delete from public.radar_webhook_log
   where received_at < now() - anciennete;

  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.radar_purger_rendezvous(interval) from public, anon, authenticated;
revoke execute on function public.radar_purger_journal(interval) from public, anon, authenticated;
grant execute on function public.radar_purger_rendezvous(interval) to service_role;
grant execute on function public.radar_purger_journal(interval) to service_role;

-- ------------------------------- Les tâches ---------------------------------

select cron.unschedule('radar-purge-bookings')
  from cron.job where jobname = 'radar-purge-bookings';

select cron.unschedule('radar-purge-webhook-log')
  from cron.job where jobname = 'radar-purge-webhook-log';

select cron.schedule(
  'radar-purge-bookings',
  '0 3 2 * *',
  $cron$ select public.radar_purger_rendezvous() $cron$
);

select cron.schedule(
  'radar-purge-webhook-log',
  '30 3 * * *',
  $cron$ select public.radar_purger_journal() $cron$
);
