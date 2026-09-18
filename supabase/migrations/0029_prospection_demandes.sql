-- ===========================================================================
-- 0029 — Prospection : le bouton « Trouver des prospects »
--
-- Louis tape un nombre dans la page Prospection ; son PC trouve autant de
-- praticiens à 4 ou 5 étoiles, rédige chaque message et le vérifie contre ses
-- sources. Les messages prêts reviennent ici ; Louis les lit et clique
-- « Envoyer » : c'est ce clic, et lui seul, qui autorise le PC à les envoyer.
-- Cette table est la boîte aux lettres entre les deux.
--
-- Quatre choix expliquent ce fichier :
--
-- 1. Le hub ne cherche rien lui-même. La recherche lit la bibliothèque
--    publicitaire Meta et les fiches Google depuis la connexion de la maison,
--    avec des outils qui vivent dans le vault ; un serveur serait bloqué plus
--    souvent, et le vault n'existe que sur le PC. Le hub écrit une demande, le
--    PC la lit avec la clé de service : d'où l'absence de politique
--    d'écriture pour le suivi de la recherche.
--
-- 2. Une seule demande vivante à la fois. Deux recherches en parallèle
--    feraient couper Meta (relevés trop rapprochés) et se disputeraient les
--    mêmes annonceurs. L'index unique partiel le garantit dans la base, pas
--    seulement dans l'interface.
--
-- 3. Le compte rendu est du texte, pas des colonnes. « 7 trouvés sur 10 :
--    plus de 4 ou 5 étoiles sur les mots-clés faits », « 1 message bloqué :
--    la phrase citée n'est plus sur la page » : c'est ce que Louis doit lire,
--    et sa forme changera. Ce qui se compte (trouvés, envoyés, bloqués) est
--    en colonnes, pour l'afficher sans analyser de texte.
--
-- 4. Rien ne part sans Louis. Le PC écrit les messages prêts dans `messages`
--    (texte complet et sources, une affirmation par ligne, règle 16) ; il
--    n'envoie une file que si `envoi_valide_le` est posé, et jamais les
--    messages que Louis a retirés (`envoi_exclus`). Décidé par Louis le
--    18/09/2026 : le contrôle de sécurité de Claude Code refuse un envoi
--    que personne n'a vu.
-- ===========================================================================

create table public.prospection_demandes (
  id            uuid primary key default gen_random_uuid(),
  nombre        smallint not null check (nombre between 1 and 40),
  statut        text not null default 'en_attente'
                check (statut in ('en_attente', 'en_cours', 'faite', 'erreur', 'annulee')),
  demandee_le   timestamptz not null default now(),
  commencee_le  timestamptz,
  finie_le      timestamptz,
  etape         text,
  trouves       smallint check (trouves >= 0),
  bloques       smallint check (bloques >= 0),
  en_file       smallint check (en_file >= 0),
  envoyes       smallint check (envoyes >= 0),
  compte_rendu  text check (char_length(compte_rendu) <= 8000),
  messages      jsonb not null default '[]'::jsonb
                check (jsonb_typeof(messages) = 'array'),
  envoi_valide_le timestamptz,
  envoi_exclus  text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

comment on table public.prospection_demandes is
  'Demandes du bouton « Trouver des prospects ». Écrites par l''app (administration), prises et tenues à jour par le PC de Louis avec la clé de service. Le PC n''envoie une file que si envoi_valide_le est posé par Louis.';

/* « Une seule demande vivante » : en attente ou en cours, jamais deux. */
create unique index prospection_demandes_une_vivante_idx
  on public.prospection_demandes ((statut in ('en_attente', 'en_cours')))
  where statut in ('en_attente', 'en_cours');

/* La page montre les dernières demandes, le PC prend la plus ancienne en attente. */
create index prospection_demandes_demandee_le_idx
  on public.prospection_demandes(demandee_le desc);

create trigger prospection_demandes_set_updated_at
  before update on public.prospection_demandes
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS — l'administration, et personne d'autre
-- ---------------------------------------------------------------------------

alter table public.prospection_demandes enable row level security;

/*
 * Louis lit, dépose une demande, et peut annuler celle qui attend encore.
 * Valider l'envoi et retirer un message passent par des Server Actions
 * d'administration (clé de service, après requireAdmin). Le PC écrit
 * l'avancement avec la clé de service, hors RLS. Aucune politique de
 * suppression : l'historique des demandes est la trace de ce qui est parti.
 */
create policy "prospection_demandes_admin_lecture" on public.prospection_demandes
  for select to authenticated
  using ((select public.is_admin()));

create policy "prospection_demandes_admin_insert" on public.prospection_demandes
  for insert to authenticated
  with check ((select public.is_admin()) and statut = 'en_attente');

create policy "prospection_demandes_admin_annulation" on public.prospection_demandes
  for update to authenticated
  using ((select public.is_admin()) and statut = 'en_attente')
  with check ((select public.is_admin()) and statut = 'annulee');
