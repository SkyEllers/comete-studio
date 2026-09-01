-- ===========================================================================
-- 0017 — Les jetons d'export de Radar
--
-- Un rapport externe — aujourd'hui le projet Google Ads de peggygirault.fr,
-- demain un autre — a besoin de lire les rendez-vous d'un client. Pas de
-- session, pas de compte : une machine qui appelle une route avec un jeton.
--
-- Trois décisions tiennent dans cette table.
--
-- 1. Le jeton n'est jamais stocké. On garde son SHA-256, comme un mot de
--    passe. Une fuite de la base ne donne donc pas de quoi appeler la route,
--    et personne — pas même Louis — ne peut relire un jeton après l'avoir vu
--    à sa création. C'est la contrepartie assumée : perdre un jeton oblige à
--    en créer un autre, ce qui prend dix secondes.
--
-- 2. Un jeton désigne une organisation, et c'est tout son périmètre. Il n'y a
--    pas de jeton « global », pas de portée à composer, rien à mal configurer :
--    la route lit `organization_id` sur la ligne du jeton et n'accepte aucun
--    paramètre qui pourrait la contredire. Le cloisonnement entre clients ne
--    dépend donc pas d'un filtre que quelqu'un pourrait oublier d'écrire.
--
-- 3. Révoquer, c'est dater, pas supprimer. `revoked_at` garde la trace qu'un
--    jeton a existé et quand il a cessé de servir — utile le jour où l'on se
--    demande qui lisait quoi. La ligne, elle, part avec l'organisation.
-- ===========================================================================

create table public.radar_export_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- SHA-256 en hexadécimal, et jamais le jeton. La contrainte le dit plutôt
  -- que de l'espérer : une insertion qui rangerait un jeton en clair par
  -- erreur n'aurait pas la bonne forme et serait refusée.
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- « Rapport Google Ads », pour savoir lequel on révoque.
  label           text not null check (char_length(btrim(label)) between 1 and 60),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

create index radar_export_tokens_org_idx on public.radar_export_tokens(organization_id);

comment on table public.radar_export_tokens is
  'Jetons de lecture de /api/export/radar/rendez-vous. Un jeton = une organisation.';
comment on column public.radar_export_tokens.token_hash is
  'SHA-256 du jeton. Le jeton lui-même n''existe qu''une fois, à l''écran de sa création.';

-- --------------------------------- RLS -------------------------------------

/*
 * Louis seul, et encore : par l'API REST uniquement. La route d'export, elle,
 * lit avec la clé de service et ne passe donc pas par ces politiques — c'est
 * volontaire, elle n'a pas de session à présenter.
 *
 * Aucune politique pour le membre, pas même en lecture. Un client n'a rien à
 * faire avec la liste des jetons qui lisent ses données : c'est un réglage de
 * Louis, comme la dépense publicitaire, et la ligne porte de quoi tenter une
 * comparaison de hash hors ligne.
 */
alter table public.radar_export_tokens enable row level security;

create policy "radar_export_tokens_all" on public.radar_export_tokens
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
