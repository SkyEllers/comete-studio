-- ===========================================================================
-- 0028 — Prospection : les prospects contactés, leur relance, leur vidéo
--
-- Louis contacte 40 praticiens par semaine et les relance dix jours plus tard :
-- les 20 meilleures notes en vidéo de 5 à 10 minutes, les 20 autres par un
-- mail court. Cette page lui donne d'un coup d'œil qui il doit relancer, ce
-- qu'il leur a déjà écrit, et ce qu'il dit dans la vidéo.
--
-- Trois choix expliquent ce fichier :
--
-- 1. Le vault reste la source. Les fiches de `20-prospects/` sont la mémoire
--    de Comète ; cette base n'en est qu'une copie de lecture, poussée par le
--    script `prospects-vers-hub.mjs` du vault. D'où la clé primaire en `slug`
--    (le nom du dossier du prospect) plutôt qu'un uuid : deux imports de suite
--    ne créent pas deux lignes, et un prospect renommé dans le vault est un
--    prospect différent, ce qui se voit.
--
-- 2. Ce que Louis coche vit à part. `prospection_suivi` porte ce qui naît
--    dans l'app — vidéo filmée, relance envoyée, réponse reçue — et le script
--    d'import n'y touche jamais. Sans cette séparation, un import écraserait
--    une coche faite dix minutes plus tôt depuis le téléphone.
--
-- 3. Du markdown, pas des colonnes. Le message d'approche, le détail de la
--    note et le texte de la vidéo sont des morceaux de fiche rendus tels
--    quels. Les découper en colonnes obligerait à une migration à chaque
--    changement de forme d'une fiche, pour un écran qui ne fait que lire.
--    Ce qui se trie ou se filtre, lui, est bien une colonne : la date de
--    relance, la note, le canal.
--
-- Tout est réservé à l'administration : ces données sont celles de Comète, pas
-- celles d'un client. Aucun client n'a de raison de voir cette table, donc
-- aucune politique ne la lui ouvre.
-- ===========================================================================

create table public.prospection_prospects (
  slug          text primary key,
  nom           text not null,
  metier        text,
  ville         text,
  cible         text not null default 'bien-etre',
  statut        text not null default 'approche',
  source        text,
  canal         text,
  contact       text,
  contacte_le   date,
  relance_le    date,
  question      text,
  note          smallint check (note between 0 and 5),
  avis_google   integer,
  message_titre text,
  message       text,
  note_detail   text,
  video         text,
  tri_rapide    text,
  historique    jsonb not null default '[]'::jsonb
                check (jsonb_typeof(historique) = 'array'),
  liens         jsonb not null default '[]'::jsonb
                check (jsonb_typeof(liens) = 'array'),
  maj_vault     date,
  importe_le    timestamptz not null default now()
);

comment on table public.prospection_prospects is
  'Copie de lecture des fiches de 20-prospects/ du vault. Écrite par le script prospects-vers-hub.mjs (clé service), jamais par l''app.';

/* La page s'ouvre sur « qui je relance » : c'est cet index qui la sert. */
create index prospection_prospects_relance_idx
  on public.prospection_prospects(relance_le nulls last, note desc nulls last);


create table public.prospection_suivi (
  slug                text primary key
                      references public.prospection_prospects(slug) on delete cascade,
  video_filmee_le     date,
  relance_envoyee_le  date,
  relance_type        text check (relance_type in ('video', 'mail')),
  reponse_le          date,
  reponse             text,
  classe              boolean not null default false,
  updated_at          timestamptz not null default now()
);

comment on table public.prospection_suivi is
  'Ce que Louis coche dans l''app : vidéo filmée, relance envoyée, réponse. L''import du vault n''y touche jamais ; une session le recopie dans les historiques des fiches.';

create trigger prospection_suivi_set_updated_at
  before update on public.prospection_suivi
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS — l'administration, et personne d'autre
-- ---------------------------------------------------------------------------

alter table public.prospection_prospects enable row level security;
alter table public.prospection_suivi     enable row level security;

/*
 * Lecture réservée à Louis. L'écriture de cette table est le fait du script
 * d'import, qui passe par la clé de service et n'est donc pas soumis à la RLS :
 * aucune politique d'écriture n'existe ici, et c'est voulu — une session
 * authentifiée ne doit pas pouvoir réécrire ce que dit le vault.
 */
create policy "prospection_prospects_admin_lecture" on public.prospection_prospects
  for select to authenticated
  using ((select public.is_admin()));

create policy "prospection_suivi_admin_lecture" on public.prospection_suivi
  for select to authenticated
  using ((select public.is_admin()));

create policy "prospection_suivi_admin_insert" on public.prospection_suivi
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "prospection_suivi_admin_update" on public.prospection_suivi
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "prospection_suivi_admin_delete" on public.prospection_suivi
  for delete to authenticated
  using ((select public.is_admin()));
