-- ===========================================================================
-- 0026 — Sonde : le créneau choisi, seconde moitié
--
-- La colonne qui garde les créneaux dans l'agrégat quotidien, et la tâche de
-- nuit qui la remplit. Voir 0025 pour le pourquoi.
--
-- Deux choses restent vraies après ce fichier.
--
-- 1. Un créneau n'est relié à rien. Il porte la même clé du jour que les autres
--    événements, et comme eux il ne rejoint jamais une réservation de Radar
--    personne par personne : l'écran met des totaux côte à côte, rien de plus.
--    C'est la condition « pas de recoupement avec d'autres traitements » de la
--    CNIL pour la mesure d'audience.
--
-- 2. Les jours déjà agrégés gardent `slot_picks = 0`, et c'est juste : aucun
--    créneau n'a jamais été envoyé avant ce fichier.
-- ===========================================================================

alter table public.sonde_daily
  add column if not exists slot_picks int not null default 0;

/*
 * L'agrégation d'un jour, du brut vers `sonde_daily` — celle de 0014, avec les
 * créneaux en plus.
 *
 * Même contrat : `delete` puis `insert`, rejouable sur n'importe quel jour sans
 * doubler un chiffre, découpage en heure de Paris. Même réserve sur `visitors`,
 * compté par canal.
 */
create or replace function public.sonde_agreger_jour(cible date default null)
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  jour   date := coalesce(cible, (now() at time zone 'Europe/Paris')::date - 1);
  lignes integer;
begin
  delete from public.sonde_daily d where d.day = jour;

  insert into public.sonde_daily
    (site_id, organization_id, day, channel_id, channel_bucket,
     pageviews, visitors, cta_clicks, slot_picks)
  select e.site_id,
         e.organization_id,
         jour,
         e.channel_id,
         e.channel_bucket,
         count(*) filter (where e.kind = 'pageview'),
         count(distinct e.visitor_key),
         count(*) filter (where e.kind = 'cta'),
         count(*) filter (where e.kind = 'creneau')
    from public.sonde_events e
   where (e.occurred_at at time zone 'Europe/Paris')::date = jour
   group by e.site_id, e.organization_id, e.channel_id, e.channel_bucket;

  get diagnostics lignes = row_count;
  return lignes;
end;
$fn$;

-- `create or replace` garde les droits de la fonction, mais on les repose ici,
-- à côté d'elle, comme 0014 : qui relit ce fichier seul doit les voir.
revoke execute on function public.sonde_agreger_jour(date) from public, anon, authenticated;
grant execute on function public.sonde_agreger_jour(date) to service_role;
