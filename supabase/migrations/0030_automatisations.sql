-- ===========================================================================
-- 0030 — Automatisations : ce qui doit arriver dans la boîte de Louis
--
-- Quatorze automatisations tournent seules chez les clients et écrivent à
-- Louis : le rapport ads du mardi, la publication du lundi, le rapport SEO du
-- 1er, les newsletters… Elles vont s'accumuler à mesure que des clients
-- signent, et personne ne peut retenir laquelle doit arriver quand. Quand l'une
-- saute, rien ne le dit : il faut s'apercevoir d'une absence.
--
-- Cette page répond à une question et une seule : **est-ce que chacune est bien
-- arrivée ?** Une carte par client, une ligne par automatisation, la prochaine
-- attendue et les dix dernières occurrences en pastilles.
--
-- Trois choix expliquent ce fichier :
--
-- 1. Le vault reste la source. `00-studio/automatisations.md` dit quand chaque
--    automatisation doit écrire et à quoi son mail ressemble ; le script
--    `automatisations-vers-hub.py` relève et pousse ici. D'où la clé primaire
--    en `slug` (`<client>/<workflow>`) plutôt qu'un uuid, et l'absence de
--    politique d'écriture : l'app ne fait que lire.
--
-- 2. La preuve, c'est le mail — pas le run. Un workflow vert dont le mail
--    s'est perdu (mauvais expéditeur, domaine changé, objet modifié) est une
--    panne invisible : c'est arrivé le 15/09/2026, où le rapport ads a lu
--    « Radar injoignable » sur une adresse partie à la vitrine deux jours plus
--    tôt. D'où `recu_le` et `recu_objet` à côté de `run_statut` : le premier
--    dit si Louis l'a eu, le second dit de quel côté chercher quand il ne l'a
--    pas.
--
-- 3. L'historique tient en dix lignes par automatisation. Ce qu'on veut voir,
--    c'est « il en a sauté une la semaine dernière », pas un journal complet.
--    Le script garde les dix dernières occurrences et purge le reste ; la
--    table ne grossit pas avec le temps.
--
-- Tout est réservé à l'administration : ce sont les automatisations de Comète,
-- pas les données d'un client. Aucune politique ne les ouvre à personne
-- d'autre que Louis.
-- ===========================================================================

create table public.automatisations (
  slug          text primary key,
  client        text not null,
  nom           text not null,
  cadence       text not null,
  depot         text not null,
  workflow      text not null,
  mail_attendu  text not null default 'toujours'
                check (mail_attendu in ('toujours', 'au-besoin')),
  actif         boolean not null default true,
  ordre         smallint not null default 0,

  -- L'état du dernier passage échu, et la prochaine échéance. Recalculés à
  -- chaque relevé : la page n'a aucun calcul de date à faire.
  prochaine_le  timestamptz,
  attendue_le   timestamptz,
  recu_le       timestamptz,
  recu_objet    text,
  run_statut    text,
  run_le        timestamptz,
  run_url       text,
  etat          text not null default 'inconnu'
                check (etat in ('ok', 'tardif', 'attente', 'silence',
                                'panne', 'mail-perdu', 'manque', 'pause', 'inconnu')),
  releve_le     timestamptz not null default now()
);

comment on table public.automatisations is
  'Copie de lecture de 00-studio/automatisations.md du vault, avec l''état relevé dans la boîte Gmail de Louis et sur GitHub. Écrite par automatisations-vers-hub.py (clé service), jamais par l''app.';

comment on column public.automatisations.etat is
  'ok : le mail est arrivé dans les temps. tardif : arrivé après la limite. attente : l''heure est passée mais la limite court encore. silence : rien reçu, et c''est normal (mail_attendu = au-besoin). panne : le run a échoué. mail-perdu : le run est vert mais aucun mail ne porte l''objet attendu. manque : ni mail ni run. pause : automatisation arrêtée. inconnu : jamais relevée.';

comment on column public.automatisations.releve_le is
  'Instant du relevé qui a écrit cette ligne. Toutes les lignes d''un même relevé le partagent : c''est ce qui permet de supprimer celles qui ont disparu du vault.';

create table public.automatisations_passages (
  slug          text not null
                references public.automatisations(slug) on delete cascade,
  attendue_le   timestamptz not null,
  recu_le       timestamptz,
  recu_objet    text,
  run_statut    text,
  run_url       text,
  etat          text not null
                check (etat in ('ok', 'tardif', 'attente', 'silence',
                                'panne', 'mail-perdu', 'manque', 'pause', 'inconnu')),
  primary key (slug, attendue_le)
);

comment on table public.automatisations_passages is
  'Les dix dernières occurrences attendues de chaque automatisation : c''est la suite de pastilles qui montre qu''une semaine a sauté.';

/* La page se lit client par client, dans l'ordre du fichier du vault. */
create index automatisations_client_idx
  on public.automatisations(client, ordre);

/* Les pastilles se lisent de la plus ancienne à la plus récente. */
create index automatisations_passages_suite_idx
  on public.automatisations_passages(slug, attendue_le desc);


-- ---------------------------------------------------------------------------
-- RLS — l'administration, et personne d'autre
-- ---------------------------------------------------------------------------

alter table public.automatisations          enable row level security;
alter table public.automatisations_passages enable row level security;

/*
 * Lecture réservée à Louis. L'écriture est le fait du script de relevé, qui
 * passe par la clé de service et n'est donc pas soumis à la RLS : aucune
 * politique d'écriture n'existe ici, et c'est voulu — une session authentifiée
 * ne doit pas pouvoir réécrire ce que le relevé a constaté.
 */
create policy "automatisations_admin_lecture" on public.automatisations
  for select to authenticated
  using ((select public.is_admin()));

create policy "automatisations_passages_admin_lecture" on public.automatisations_passages
  for select to authenticated
  using ((select public.is_admin()));
