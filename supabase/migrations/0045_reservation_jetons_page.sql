-- ===========================================================================
-- 0045 — Les jetons de la page de réservation
--
-- La page de réservation vit sur le site du client (peggygirault.fr), le
-- moteur ici. Le serveur du site appelle deux routes du hub sans session,
-- `api/reservation/page/creneaux` et `api/reservation/page/reserver`, avec un
-- jeton porteur. Même forme que les jetons d'export de Radar (0017) :
--
-- 1. Le jeton n'est jamais stocké, seulement son SHA-256. Il ne se voit qu'une
--    fois, à sa création dans l'onglet Réservation de l'admin.
-- 2. Un jeton désigne une organisation, et c'est tout son périmètre : la route
--    ne lit aucun paramètre qui pourrait la contredire. Le jeton de l'espace
--    d'essai de Louis ne peut donc jamais réserver chez Peggy.
-- 3. Révoquer, c'est dater.
--
-- Une table à part plutôt qu'une colonne de `reservation_reglages` : les
-- réglages se lisent par les membres du client (0042), les jetons par Louis
-- seul.
-- ===========================================================================

create table public.reservation_jetons (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- « Site de Peggy », « Essai local ».
  label           text not null check (char_length(btrim(label)) between 1 and 60),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

create index reservation_jetons_org_idx on public.reservation_jetons(organization_id);

comment on table public.reservation_jetons is
  'Jetons des routes api/reservation/page/*. Un jeton = une organisation. SHA-256 seulement.';

alter table public.reservation_jetons enable row level security;

-- Louis seul. Les routes lisent avec la clé de service.
create policy "reservation_jetons_all" on public.reservation_jetons
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
