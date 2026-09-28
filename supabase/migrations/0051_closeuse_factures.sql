-- ===========================================================================
-- 0051 — Les factures des closeuses, faites par l'app (autofacturation, P16)
--
-- Décidé par Louis le 28/09/2026. Aujourd'hui la closeuse recopie les lignes
-- de « Préparer ma facture » dans son propre outil. Désormais :
--
-- 1. À son arrivée, une fois, elle donne son identité de facturation (nom avec
--    « EI », SIREN, adresse) et accepte le mandat d'autofacturation : le
--    client (l'EURL de Peggy) établit ses factures en son nom et pour son
--    compte (BOFiP BOI-TVA-DECLA-30-20-10, § 360 à 480). Mandat daté, avec
--    adresse IP et navigateur, avant toute facture.
-- 2. Le 1er de chaque mois, l'app prépare la facture du mois écoulé, à son
--    nom : ses paiements encaissés, sa part, les mentions obligatoires,
--    « Autofacturation ». Numérotation continue propre à chaque closeuse.
-- 3. Elle clique « J'accepte » (acceptation expresse). Tant qu'elle n'a pas
--    accepté, elle n'est pas payée, et l'app lui envoie un rappel (Louis,
--    option B du 28/09 : pas d'acceptation d'office).
-- 4. Le client voit ce qu'il doit à chaque closeuse, et marque « payée »
--    après son virement.
--
-- Toutes les écritures passent par le serveur (service role), après contrôle
-- de la session dans l'app. Le PDF vit dans le bucket privé `factures`.
-- Conservation : 10 ans (Code de commerce L123-22) ; aucune purge ici.
-- ===========================================================================

create table public.closeuse_facturation (
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  nom_legal         text not null check (char_length(nom_legal) between 3 and 150),
  siren             text not null check (siren ~ '^[0-9]{9}$'),
  adresse           text not null check (char_length(adresse) between 8 and 400),
  mention_tva       text not null default 'TVA non applicable, art. 293 B du CGI'
                    check (char_length(mention_tva) <= 200),
  mandat_version    text not null check (char_length(mandat_version) <= 40),
  mandat_accepte_le timestamptz not null default now(),
  mandat_ip         text check (char_length(mandat_ip) <= 64),
  mandat_agent      text check (char_length(mandat_agent) <= 400),
  updated_at        timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.closeuse_facturation is
  'L''identité de facturation d''une closeuse et son mandat d''autofacturation (P16, 28/09/2026).';

alter table public.closeuse_facturation enable row level security;

create policy "closeuse_facturation_select" on public.closeuse_facturation
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_access_radar(organization_id));

create trigger closeuse_facturation_updated_at
  before update on public.closeuse_facturation
  for each row execute function public.set_updated_at();

create table public.closeuse_factures (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete restrict,
  mois             date not null check (extract(day from mois) = 1),
  rang             int not null check (rang >= 1),
  numero           text not null check (char_length(numero) <= 40),
  total_cents      int not null,
  /* { paiements: [...], reprises: [...] } tels que calculés à la création. */
  lignes           jsonb not null check (jsonb_typeof(lignes) = 'object'),
  /* Qui vend (la closeuse) et qui achète (le client), figés à la création. */
  vendeur          jsonb not null check (jsonb_typeof(vendeur) = 'object'),
  acheteur         jsonb not null check (jsonb_typeof(acheteur) = 'object'),
  statut           text not null default 'a_accepter'
                   check (statut in ('a_accepter', 'acceptee', 'payee', 'annulee')),
  creee_le         timestamptz not null default now(),
  acceptee_le      timestamptz,
  acceptee_ip      text check (char_length(acceptee_ip) <= 64),
  acceptee_agent   text check (char_length(acceptee_agent) <= 400),
  relance_le       timestamptz,
  relances         smallint not null default 0,
  payee_le         timestamptz,
  pdf_chemin       text check (char_length(pdf_chemin) <= 300),
  empreinte_pdf    text check (empreinte_pdf ~ '^[0-9a-f]{64}$'),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id, mois),
  unique (organization_id, user_id, rang)
);

comment on table public.closeuse_factures is
  'Les factures de commission des closeuses, établies par le client en autofacturation (P16, 28/09/2026).';

create index closeuse_factures_org_idx on public.closeuse_factures(organization_id, mois desc);
create index closeuse_factures_a_accepter_idx on public.closeuse_factures(statut) where statut = 'a_accepter';

alter table public.closeuse_factures enable row level security;

create policy "closeuse_factures_select" on public.closeuse_factures
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_access_radar(organization_id));

create trigger closeuse_factures_updated_at
  before update on public.closeuse_factures
  for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('factures', 'factures', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Aucune politique sur storage.objects pour ce bucket : seul le serveur y lit
-- et y écrit ; le PDF se télécharge par une route qui vérifie les droits.
