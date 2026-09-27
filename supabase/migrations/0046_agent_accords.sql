-- ===========================================================================
-- 0046 — L'accord WhatsApp des clientes déjà réservées
--
-- L'agent ne suit que les réservations qui ont vu la phrase de consentement
-- de Calendly. Celles réservées avant le lancement reçoivent un mail avec un
-- lien personnel ; sur la page, un bouton « Oui » vaut accord (Meta exige un
-- accord clair avant le premier message ; il peut se recueillir par mail).
--
-- Un lien, une ligne. La base ne garde que l'empreinte SHA-256 du jeton : un
-- accès en lecture à la table ne permet pas de fabriquer un lien valable.
-- `accepte_le` est la preuve de l'accord, gardée 30 jours après le rendez-vous
-- comme la conversation (Louis, 25/09/2026), puis effacée par la purge.
--
-- Le bouton, pas l'ouverture de la page : les messageries ouvrent seules les
-- liens d'un mail pour les vérifier, une simple visite ne vaut rien.
-- ===========================================================================

create table public.agent_accords (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  jeton_sha256     text not null unique check (jeton_sha256 ~ '^[0-9a-f]{64}$'),
  invitee_uri      text not null,
  rdv_debut        timestamptz not null,
  -- Deux derniers chiffres du numéro, pour que la page dise où l'agent
  -- écrira sans afficher le numéro.
  fin_numero       text check (fin_numero ~ '^[0-9]{2}$'),
  envoye_le        timestamptz,
  accepte_le       timestamptz,
  conversation_id  uuid references public.agent_conversations(id) on delete set null,
  efface_apres     timestamptz not null,
  created_at       timestamptz not null default now(),
  unique (organization_id, invitee_uri)
);

comment on table public.agent_accords is
  'Accord WhatsApp des clientes réservées avant le lancement de l''agent : un lien par cliente (empreinte seulement), la date de l''accord comme preuve. Écrit par un script d''administration et par la page publique /accord, avec la clé de service.';

create index agent_accords_org_idx on public.agent_accords(organization_id);

alter table public.agent_accords enable row level security;

create policy "agent_accords_admin_lecture" on public.agent_accords
  for select to authenticated using ((select public.is_admin()));

-- La purge : même rythme que les conversations (0032, 3h40).
select cron.schedule(
  'agent-purge-accords',
  '45 3 * * *',
  $$delete from public.agent_accords where efface_apres < now()$$
);
