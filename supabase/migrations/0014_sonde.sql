-- ===========================================================================
-- 0014 — Sonde (phase 6, chantier 1)
--
-- Radar sait ce qui se passe après le clic « réserver ». Sonde mesure ce qui
-- se passe avant : combien de personnes sont venues, d'où, et combien ont
-- cliqué. Sans cookie, sans bandeau, et sans qu'aucune ligne de ce fichier ne
-- puisse jamais désigner quelqu'un.
--
-- C'est ce dernier point qui commande tout le reste.
--
-- Un visiteur unique se compte avec une clé, pas avec un identifiant :
-- `HMAC(sel du jour, site + IP + user-agent)`. L'IP et le user-agent servent
-- au calcul et ne sont jamais écrits — ils n'ont pas de colonne où aller. Le
-- sel vit un jour, dans `sonde_salt`, table que même une session authentifiée
-- ne peut pas lire ; à minuit, heure de Paris, il est remplacé et l'ancien est
-- détruit. Sans le sel, la clé n'est plus inversible, même en connaissant
-- l'IP : deux visites à deux jours d'écart sont irréconciliables, et elles le
-- resteront — ce n'est pas une promesse d'usage, c'est une propriété du
-- stockage.
--
-- Deux étages, comme le demande le brief : les événements bruts, qui vivent
-- treize mois, et un agrégat par jour, site et canal, qui reste. Le jour en
-- cours se lit sur les bruts ; le reste sur l'agrégat.
-- ===========================================================================

create table public.sonde_sites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  -- Public par construction : il voyage dans la balise `<script>` de la
  -- landing. Il n'ouvre rien — il désigne un site, il n'authentifie personne.
  token           text not null unique
                    default encode(extensions.gen_random_bytes(16), 'hex')
                    check (char_length(token) between 16 and 64),
  -- Hôtes autorisés, ex. {jonathan-cuinat.com}. Sous-domaines admis, la route
  -- de collecte s'en charge.
  domains         text[] not null default '{}',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  last_event_at   timestamptz
);
create index sonde_sites_org_idx on public.sonde_sites(organization_id);

create type public.sonde_event_kind as enum ('pageview', 'cta');

create table public.sonde_events (
  id              bigint generated always as identity primary key,
  site_id         uuid not null references public.sonde_sites(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  kind            public.sonde_event_kind not null,
  -- Le chemin, jamais la query string : elle porte parfois un prénom, un
  -- courriel de désinscription, un identifiant de commande.
  path            text not null default '/',
  -- L'hôte du référent, jamais l'URL entière : « google.com », pas la
  -- recherche qui a mené là.
  referrer_host   text,
  channel_id      uuid references public.radar_channels(id) on delete set null,
  channel_bucket  text not null default 'direct'
                    check (channel_bucket in ('direct', 'canal', 'referent')),
  -- La clé du jour. Aucune colonne ne porte d'IP ni de user-agent, ici ni
  -- ailleurs : ils n'entrent pas dans la base, ils entrent dans le HMAC.
  visitor_key     text not null,
  utm             jsonb not null default '{}'
);

-- La question que pose l'écran : « ce site, ce jour-là ».
create index sonde_events_site_day_idx on public.sonde_events(site_id, occurred_at);
-- Le ménage de nuit balaie par date seule : l'index composite ne lui sert à
-- rien, il commence par le site.
create index sonde_events_occurred_idx on public.sonde_events(occurred_at);
-- Les colonnes de référence : sans index, la suppression d'une organisation ou
-- d'un canal balaie la table entière.
create index sonde_events_org_idx on public.sonde_events(organization_id);
create index sonde_events_channel_idx on public.sonde_events(channel_id);

create table public.sonde_daily (
  site_id         uuid not null references public.sonde_sites(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day             date not null,
  channel_id      uuid references public.radar_channels(id) on delete set null,
  channel_bucket  text not null
                    check (channel_bucket in ('direct', 'canal', 'referent')),
  pageviews       int not null default 0,
  visitors        int not null default 0,
  cta_clicks      int not null default 0
);

/*
 * Le brief demandait `primary key (site_id, day, channel_bucket, channel_id)`.
 * Impossible tel quel : une clé primaire interdit les valeurs nulles, et
 * `channel_id` est nul par construction pour les seaux « direct » et
 * « referent » — la contrainte aurait rendu `on delete set null` intenable au
 * premier canal supprimé.
 *
 * Un index unique `nulls not distinct` dit exactement ce qu'on voulait dire :
 * une seule ligne par site, jour, seau et canal, le « sans canal » comptant
 * comme une valeur à part entière. C'est ce qui rend l'agrégation rejouable
 * sans doubler les chiffres.
 */
create unique index sonde_daily_cle_idx
  on public.sonde_daily(site_id, day, channel_bucket, channel_id) nulls not distinct;

create index sonde_daily_org_idx on public.sonde_daily(organization_id);
create index sonde_daily_channel_idx on public.sonde_daily(channel_id);

/*
 * Le sel du jour. Une ligne, jamais deux.
 *
 * Aucune politique n'est posée sur cette table, et c'est le cœur du dispositif
 * plutôt qu'un oubli : elle n'est lisible que par la clé de service, c'est-à-
 * dire par la route de collecte et par personne d'autre. Un membre qui
 * pourrait la lire pourrait, en devinant une IP et un user-agent, retrouver
 * quel visiteur se cache derrière une `visitor_key` — c'est précisément ce que
 * la rotation nocturne rend impossible le lendemain, et il n'y a aucune raison
 * de laisser une porte ouverte le jour même.
 */
create table public.sonde_salt (
  day  date primary key,
  salt text not null
);

-- ------------------------------- Catalogue ---------------------------------

insert into public.tools (slug, name, description, kind, sort_order) values
  ('sonde', 'Sonde', 'Qui visite tes pages, d''où, et qui clique pour réserver.', 'internal', 50)
on conflict (slug) do nothing;

-- ---------------------------- Porte d'entrée -------------------------------

/*
 * Membre de l'organisation ET outil activé pour elle. Louis passe partout.
 * Même forme que `can_access_board`, `can_access_files`, `can_access_radar` et
 * `can_access_sas` : couper Sonde pour une organisation rend ses mesures
 * invisibles immédiatement, y compris par l'API.
 */
create or replace function public.can_access_sonde(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select org is not null
     and (public.is_admin()
          or (public.is_member(org) and public.has_tool(org, 'sonde')));
$fn$;

revoke execute on function public.can_access_sonde(uuid) from public, anon;
grant execute on function public.can_access_sonde(uuid) to authenticated;

-- ------------------------------ Les trois nuits ------------------------------

/*
 * Les tâches de nuit vivent dans des fonctions nommées, et `cron` ne fait que
 * les appeler — la leçon de la phase 4, où la logique était inlinée dans le
 * corps des tâches et ne pouvait ni se déclencher à la main, ni se vérifier.
 *
 * Elles rendent toutes un compte : une rotation, une agrégation ou un ménage
 * silencieux qui n'aurait jamais rien fait ressemble exactement à un qui
 * marche.
 *
 * Réservées à `service_role`. `cron` les appelle sous le propriétaire de la
 * base, ce qui suffit ; le `revoke` vise `authenticated`, c'est-à-dire l'API
 * REST, où elles n'ont rien à faire.
 */

/*
 * Le sel du jour, et la destruction de tous les autres.
 *
 * La fonction calcule elle-même le jour parisien : elle est donc juste quel
 * que soit le fuseau de `cron` (GMT sur ce projet) et quel que soit le moment
 * de l'année. C'est pourquoi elle est planifiée deux fois, à 22 h 02 et 23 h 02
 * UTC — l'une des deux tombe deux minutes après minuit à Paris, en heure d'été
 * comme en heure d'hiver, et l'autre ne fait rien.
 *
 * Idempotente : la route de collecte crée le sel du jour si le cron n'est pas
 * encore passé, et cette fonction ne l'écrase pas.
 */
create or replace function public.sonde_tourner_sel() returns date
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  jour date := (now() at time zone 'Europe/Paris')::date;
begin
  insert into public.sonde_salt (day, salt)
  values (jour, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (day) do nothing;

  delete from public.sonde_salt where day <> jour;

  return jour;
end;
$fn$;

/*
 * L'agrégation d'un jour, du brut vers `sonde_daily`.
 *
 * `delete` puis `insert` : rejouable autant de fois qu'on veut, sur n'importe
 * quel jour, sans jamais doubler un chiffre. C'est ce qui permet de rattraper
 * une nuit ratée, et c'est ce qu'exerce le banc.
 *
 * Le découpage du jour se fait en heure de Paris, comme partout ailleurs dans
 * le hub : une visite à 00 h 30 appartient au jour où elle a eu lieu, pas à
 * celui d'UTC.
 *
 * Une réserve, pour l'écran qui lira ces lignes : `visitors` est compté par
 * canal. Quelqu'un qui revient dans la même journée par deux canaux compte une
 * fois dans chacun, si bien que la somme des colonnes majore légèrement le
 * nombre de visiteurs du jour. C'est la contrepartie assumée d'un agrégat qui
 * ne garde aucune clé — recompter juste demanderait de conserver les
 * `visitor_key`, donc de garder treize mois ce qu'on cherche à oublier.
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
     pageviews, visitors, cta_clicks)
  select e.site_id,
         e.organization_id,
         jour,
         e.channel_id,
         e.channel_bucket,
         count(*) filter (where e.kind = 'pageview'),
         count(distinct e.visitor_key),
         count(*) filter (where e.kind = 'cta')
    from public.sonde_events e
   where (e.occurred_at at time zone 'Europe/Paris')::date = jour
   group by e.site_id, e.organization_id, e.channel_id, e.channel_bucket;

  get diagnostics lignes = row_count;
  return lignes;
end;
$fn$;

/*
 * Les événements bruts, au-delà de treize mois.
 *
 * L'agrégat, lui, reste : il ne porte aucune clé, pas même pseudonymisée, et
 * c'est la seule mémoire longue de l'audience. Ce sont les lignes qui portent
 * une `visitor_key` qui s'en vont.
 */
create or replace function public.sonde_purger_evenements(
  anciennete interval default interval '13 months'
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  effaces integer;
begin
  delete from public.sonde_events where occurred_at < now() - anciennete;
  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.sonde_tourner_sel() from public, anon, authenticated;
revoke execute on function public.sonde_agreger_jour(date) from public, anon, authenticated;
revoke execute on function public.sonde_purger_evenements(interval) from public, anon, authenticated;
grant execute on function public.sonde_tourner_sel() to service_role;
grant execute on function public.sonde_agreger_jour(date) to service_role;
grant execute on function public.sonde_purger_evenements(interval) to service_role;

-- --------------------------------- RLS -------------------------------------

alter table public.sonde_sites enable row level security;
alter table public.sonde_events enable row level security;
alter table public.sonde_daily enable row level security;
alter table public.sonde_salt enable row level security;

/*
 * Ce que le client voit de sa propre audience : tout. Ses visiteurs ne sont
 * pas un secret pour lui — c'est la dépense publicitaire qui reste chez Louis,
 * et elle vit dans Radar.
 *
 * Ce qu'il n'écrit jamais : rien. Les sites sont déclarés par Louis, et les
 * événements n'ont qu'un seul auteur légitime, la route de collecte, qui écrit
 * avec la clé de service. `sonde_events` n'a donc aucune politique d'écriture,
 * pas même pour Louis : un membre capable d'y insérer pourrait gonfler ses
 * propres chiffres, et Louis n'a aucune raison de fabriquer une visite.
 */
create policy "sonde_sites_select" on public.sonde_sites
  for select to authenticated using (public.can_access_sonde(organization_id));
create policy "sonde_sites_insert" on public.sonde_sites
  for insert to authenticated with check ((select public.is_admin()));
create policy "sonde_sites_update" on public.sonde_sites
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "sonde_sites_delete" on public.sonde_sites
  for delete to authenticated using ((select public.is_admin()));

create policy "sonde_events_select" on public.sonde_events
  for select to authenticated using (public.can_access_sonde(organization_id));

create policy "sonde_daily_select" on public.sonde_daily
  for select to authenticated using (public.can_access_sonde(organization_id));
create policy "sonde_daily_insert" on public.sonde_daily
  for insert to authenticated with check ((select public.is_admin()));
create policy "sonde_daily_update" on public.sonde_daily
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "sonde_daily_delete" on public.sonde_daily
  for delete to authenticated using ((select public.is_admin()));

-- `sonde_salt` : RLS activée, aucune politique. Voir plus haut.

-- ------------------------------- Les tâches ---------------------------------

select cron.unschedule('sonde-sel-ete')
  from cron.job where jobname = 'sonde-sel-ete';
select cron.unschedule('sonde-sel-hiver')
  from cron.job where jobname = 'sonde-sel-hiver';
select cron.unschedule('sonde-agregation')
  from cron.job where jobname = 'sonde-agregation';
select cron.unschedule('sonde-purge')
  from cron.job where jobname = 'sonde-purge';

-- Minuit à Paris tombe à 22 h UTC en été et à 23 h UTC en hiver. Les deux
-- tâches sont posées, la fonction décide laquelle a du travail.
select cron.schedule('sonde-sel-ete', '2 22 * * *',
  $cron$ select public.sonde_tourner_sel() $cron$);
select cron.schedule('sonde-sel-hiver', '2 23 * * *',
  $cron$ select public.sonde_tourner_sel() $cron$);

-- 01 h 20 UTC : 02 h 20 ou 03 h 20 à Paris, toujours le lendemain du jour
-- qu'on agrège, et bien après que le dernier visiteur du soir soit parti.
select cron.schedule('sonde-agregation', '20 1 * * *',
  $cron$ select public.sonde_agreger_jour() $cron$);

select cron.schedule('sonde-purge', '40 3 * * *',
  $cron$ select public.sonde_purger_evenements() $cron$);
