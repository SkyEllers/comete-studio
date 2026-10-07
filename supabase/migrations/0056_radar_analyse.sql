-- ===========================================================================
-- 0056 — L'analyse des diagnostics (Louis, 07/10/2026)
--
-- Chaque diagnostic enregistré et transcrit (0049) est lu par Claude : douze
-- repères sur la façon de mener l'appel, les alertes (les règles qu'on ne
-- discute pas), ce que la closeuse ne savait pas, et pourquoi la cliente a
-- dit oui ou non. Une synthèse compare régulièrement les ventes et les
-- non-ventes : elle tient un carnet de leçons, qui revient dans les consignes
-- de l'analyse suivante, et le portrait de la cliente.
--
-- Les décisions de ce fichier.
--
-- 1. Repères sans chiffre : acquis, en progrès, à travailler (Louis : A).
--
-- 2. Ce que voit qui :
--    - la closeuse : l'analyse de ses appels, une fois qu'elle a tenu dix
--      rendez-vous (absentes non comptées). Avant, l'onglet dit combien il
--      en reste (Louis, 07/10). Plus la comparaison avec l'équipe, sans nom,
--      et les meilleurs passages des autres, réécrits sans prénom ni santé ;
--    - Louis : tout, appel par appel, même avant l'ouverture ;
--    - Peggy (le client) : rien de cet outil, pas même ses propres appels
--      (Louis : A). Ses appels sont analysés comme ceux des closeuses, et
--      leurs meilleurs passages servent d'exemples.
--    La fiche de la cliente (le portrait, données de santé) vit dans sa
--    propre table, lisible par Louis seul.
--
-- 3. Les leçons : une leçon soutenue par dix appels ou plus entre seule dans
--    le carnet ; en dessous, elle attend le oui de Louis (Louis : C). Les
--    appuis sont des rendez-vous, comptés par le hub, pas par l'IA. Une
--    correction de Louis devient une leçon active tout de suite.
--
-- 4. Tout s'écrit par le serveur (service role), après contrôle de la session
--    dans l'app : pas de politique d'écriture.
--
-- 5. L'analyse et la fiche suivent l'enregistrement : effacées avec lui, six
--    mois après le rendez-vous (`entretenirEnregistrements`). Les leçons et
--    les synthèses ne portent aucun nom et restent.
--
-- 6. Une horloge à part, toutes les dix minutes : une analyse prend une à
--    trois minutes, plus que la minute de l'horloge de l'agent. Elle reprend
--    l'adresse et le secret de l'horloge de l'agent (0039), sur la route
--    `/api/analyse/horloge`.
-- ===========================================================================

-- ------------------------------ L'ouverture --------------------------------

/*
 * L'outil est-il ouvert pour cette closeuse ? Dix rendez-vous tenus chez ce
 * client : honorés, ou confirmés et passés (comme `radar_bookings_effective`).
 * Une absente ne compte pas (Louis, 07/10/2026).
 */
create or replace function public.radar_analyse_tenus(org uuid, closeuse uuid)
returns int
language sql stable security definer set search_path = public as $fn$
  select count(*)::int
    from public.radar_bookings b
   where b.organization_id = org
     and b.closeuse_id = closeuse
     and (b.status = 'honore'
          or (b.status = 'confirme' and b.scheduled_end < now()));
$fn$;

create or replace function public.radar_analyse_ouverte(org uuid, closeuse uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.radar_analyse_tenus(org, closeuse) >= 10;
$fn$;

revoke execute on function public.radar_analyse_tenus(uuid, uuid) from public, anon;
revoke execute on function public.radar_analyse_ouverte(uuid, uuid) from public, anon;
grant execute on function public.radar_analyse_tenus(uuid, uuid) to authenticated, service_role;
grant execute on function public.radar_analyse_ouverte(uuid, uuid) to authenticated, service_role;

-- ------------------------------ L'analyse d'un appel ------------------------

create table public.radar_analyses (
  booking_id      uuid primary key references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- La closeuse du rendez-vous au moment de l'analyse ; null : la titulaire.
  closeuse_id     uuid references public.profiles(id) on delete set null,
  etat            text not null default 'a_faire'
                  check (etat in ('a_faire', 'en_cours', 'faite', 'echec')),
  -- L'issue lue au moment de l'analyse ; une issue qui change relance l'analyse.
  issue           text check (issue in ('vente', 'r2', 'en_attente', 'non', 'inconnue')),
  issue_cle       text check (char_length(issue_cle) <= 200),
  /*
   * Ce que voit la closeuse : { repères, alertes, pas_su, pourquoi, à retenir }
   * (src/tools/analyse/schema.ts). Sans la fiche de la cliente.
   */
  -- `lecture` et non `analyse` : ANALYSE est un mot réservé de Postgres.
  lecture         jsonb check (lecture is null or jsonb_typeof(lecture) = 'object'),
  tentatives      int not null default 0,
  erreur          text check (char_length(erreur) <= 500),
  commencee_le    timestamptz,
  faite_le        timestamptz,
  modele          text check (char_length(modele) <= 60),
  -- { input_tokens, output_tokens, … } de l'appel à Claude, pour suivre le coût.
  usage           jsonb,
  -- Combien de leçons actives du carnet l'analyse avait sous les yeux.
  lecons_actives  int,
  updated_at      timestamptz not null default now()
);

comment on table public.radar_analyses is
  'L''analyse d''un diagnostic par Claude (repères, alertes, pourquoi la vente s''est faite ou non). Sans la fiche de la cliente.';

create index radar_analyses_org_idx on public.radar_analyses(organization_id);
create index radar_analyses_closeuse_idx on public.radar_analyses(organization_id, closeuse_id);
create index radar_analyses_etat_idx on public.radar_analyses(etat) where etat <> 'faite';

alter table public.radar_analyses enable row level security;

/*
 * Une closeuse lit les analyses de ses rendez-vous une fois l'outil ouvert ;
 * Louis lit tout. Le client (Peggy) ne lit rien : `is_admin()` et non
 * `can_access_radar()`.
 */
create policy "radar_analyses_select" on public.radar_analyses
  for select to authenticated
  using (
    public.is_admin()
    or (closeuse_id = auth.uid()
        and public.is_closeuse(organization_id)
        and public.radar_analyse_ouverte(organization_id, auth.uid()))
  );

create trigger radar_analyses_updated_at
  before update on public.radar_analyses
  for each row execute function public.set_updated_at();

-- ------------------------------ La fiche de la cliente ----------------------

/*
 * Ce que l'appel dit de la cliente (âge, déclencheur, essais, freins, ses
 * mots…), en cases à compter. Données de santé : Louis seul, effacée avec
 * l'analyse.
 */
create table public.radar_analyse_fiches (
  booking_id      uuid primary key references public.radar_analyses(booking_id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fiche           jsonb not null check (jsonb_typeof(fiche) = 'object'),
  updated_at      timestamptz not null default now()
);

comment on table public.radar_analyse_fiches is
  'Le portrait de la cliente tiré d''un diagnostic. Données de santé : lisible par l''administration seule.';

create index radar_analyse_fiches_org_idx on public.radar_analyse_fiches(organization_id);

alter table public.radar_analyse_fiches enable row level security;

create policy "radar_analyse_fiches_select" on public.radar_analyse_fiches
  for select to authenticated
  using (public.is_admin());

create trigger radar_analyse_fiches_updated_at
  before update on public.radar_analyse_fiches
  for each row execute function public.set_updated_at();

-- ------------------------------ Les passages exemplaires --------------------

/*
 * Les meilleurs passages d'un appel, réécrits sans prénom ni détail de santé,
 * pour les autres closeuses (« Comment les autres s'y prennent », Louis : B).
 * Lisibles par les closeuses du client dont l'outil est ouvert, et par Louis.
 */
create table public.radar_analyse_passages (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.radar_analyses(booking_id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- La titulaire (Peggy) est nommée ; une closeuse reste « une collègue ».
  par_titulaire   boolean not null default false,
  moment          text not null check (char_length(moment) <= 40),
  texte           text not null check (char_length(texte) between 1 and 1500),
  pourquoi        text check (char_length(pourquoi) <= 600),
  vente           boolean not null default false,
  created_at      timestamptz not null default now()
);

create index radar_analyse_passages_org_idx on public.radar_analyse_passages(organization_id, moment);
create index radar_analyse_passages_booking_idx on public.radar_analyse_passages(booking_id);

alter table public.radar_analyse_passages enable row level security;

create policy "radar_analyse_passages_select" on public.radar_analyse_passages
  for select to authenticated
  using (
    public.is_admin()
    or (public.is_closeuse(organization_id)
        and public.radar_analyse_ouverte(organization_id, auth.uid()))
  );

-- ------------------------------ Le carnet de leçons -------------------------

create table public.radar_analyse_lecons (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  texte           text not null check (char_length(texte) between 1 and 1000),
  -- Le repère concerné (src/tools/analyse/grille.ts), ou « general ».
  point           text not null default 'general' check (char_length(point) <= 40),
  -- Ce qui fait vendre, ce qui fait perdre, ou une consigne de lecture.
  sens            text not null default 'conseil' check (sens in ('vend', 'perd', 'conseil')),
  -- Les rendez-vous qui la soutiennent, vérifiés par le hub.
  appuis          uuid[] not null default '{}',
  nb_appuis       int not null default 0,
  statut          text not null default 'proposee'
                  check (statut in ('proposee', 'active', 'refusee', 'retiree')),
  origine         text not null default 'synthese' check (origine in ('synthese', 'correction')),
  -- Pour une correction : l'appel corrigé.
  booking_id      uuid references public.radar_bookings(id) on delete set null,
  -- Pourquoi la synthèse l'a retirée, ou ce que Louis a noté.
  note            text check (char_length(note) <= 600),
  creee_le        timestamptz not null default now(),
  decidee_le      timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.radar_analyse_lecons is
  'Le carnet de leçons de l''analyse des diagnostics : ce que les appels ont appris, relu à chaque nouvelle analyse.';

create index radar_analyse_lecons_org_idx on public.radar_analyse_lecons(organization_id, statut);

alter table public.radar_analyse_lecons enable row level security;

create policy "radar_analyse_lecons_select" on public.radar_analyse_lecons
  for select to authenticated
  using (public.is_admin());

create trigger radar_analyse_lecons_updated_at
  before update on public.radar_analyse_lecons
  for each row execute function public.set_updated_at();

-- ------------------------------ Les synthèses -------------------------------

create table public.radar_analyse_syntheses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  faite_le        timestamptz not null default now(),
  nb_appels       int not null default 0,
  /*
   * { portrait, recrutement, equipe } : du texte et des chiffres d'ensemble,
   * sans nom ni prénom (src/tools/analyse/schema.ts).
   */
  contenu         jsonb not null check (jsonb_typeof(contenu) = 'object'),
  modele          text check (char_length(modele) <= 60),
  usage           jsonb
);

create index radar_analyse_syntheses_org_idx on public.radar_analyse_syntheses(organization_id, faite_le desc);

alter table public.radar_analyse_syntheses enable row level security;

create policy "radar_analyse_syntheses_select" on public.radar_analyse_syntheses
  for select to authenticated
  using (public.is_admin());

-- ------------------------------ L'horloge ----------------------------------

/*
 * Un passage de l'horloge de l'analyse : le même appel que celui de l'agent
 * (0039), sur la route de l'analyse. Sans réglage, rien ne part.
 */
create or replace function public.analyse_horloge()
returns bigint
language plpgsql security definer set search_path = public, vault, extensions as $fn$
declare
  adresse text;
  secret  text;
begin
  select decrypted_secret into adresse from vault.decrypted_secrets where name = 'agent:horloge:url';
  select decrypted_secret into secret  from vault.decrypted_secrets where name = 'agent:horloge:secret';
  if adresse is null or secret is null or position('/api/agent/horloge' in adresse) = 0 then
    return null;
  end if;

  return net.http_post(
    url := replace(adresse, '/api/agent/horloge', '/api/analyse/horloge'),
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret,
      'User-Agent', 'comete-hub-horloge/1'
    ),
    timeout_milliseconds := 300000
  );
end;
$fn$;

revoke execute on function public.analyse_horloge() from public, anon, authenticated;
grant execute on function public.analyse_horloge() to service_role;

select cron.unschedule('analyse-horloge')
  from cron.job where jobname = 'analyse-horloge';

select cron.schedule(
  'analyse-horloge',
  '*/10 * * * *',
  $cron$ select public.analyse_horloge() $cron$
);
