-- ===========================================================================
-- 0019 — Pulsar (phase 8, chantier 1)
--
-- Le brief numérote cette migration 0018 et demande de vérifier : 0018 porte
-- le relevé des ventes de Radar, on prend donc le suivant.
--
-- Pulsar chronomètre le temps de Louis et le rapproche de ce qu'il encaisse.
-- Trois questions, pas une de plus : combien d'heures prend chaque client,
-- combien rapporte chaque heure, et quelle part du mois part en non
-- facturable.
--
-- Deux choses le distinguent du reste du hub, et elles expliquent tout ce
-- fichier :
--
-- 1. Ses clients ne sont pas les organisations du hub. On chronomètre aussi
--    des prospects, et d'anciens clients qui n'auront jamais d'espace :
--    `pulsar_clients` est une table à part, avec un lien facultatif vers une
--    organisation pour le jour où l'on croisera ces heures avec Radar. Un
--    client système « Comète » porte tout le non facturable.
--
-- 2. C'est un carnet personnel, pas un registre contractuel. Une entrée se
--    corrige et s'efface sans limite de temps — l'inverse exact de Radar, et
--    c'est voulu. La base ne défend donc qu'un petit nombre de vérités : un
--    seul chronomètre en marche par personne, des durées au quart d'heure, et
--    l'impossibilité d'effacer un client dont on a déjà compté les heures.
-- ===========================================================================

-- --------------------------------- Types -----------------------------------

create type public.pulsar_profil as enum ('p1', 'p2', 'p3', 'hors_cible');
create type public.pulsar_modele as enum ('recurrent', 'one_shot', 'commission', 'historique');
create type public.pulsar_statut as enum ('setup', 'pilotage', 'termine');

/*
 * Huit types de tâche, et un enum plutôt qu'une table : c'est le garde-fou.
 * S'il en faut un neuvième, c'est probablement que deux se recoupent — et
 * ajouter une valeur demandera une migration, donc une phrase pour dire
 * pourquoi. Une table de catégories libres aurait fini en trente lignes dont
 * quinze mortes, et la répartition par type n'aurait plus rien voulu dire.
 */
create type public.pulsar_task as enum (
  'site', 'ads', 'emails', 'tracking', 'reunion', 'seo', 'prospection', 'admin'
);

/*
 * La phase d'une entrée, figée à la saisie. Elle vaut `interne` pour le client
 * « Comète », sinon elle recopie le statut du client au moment où l'on compte.
 * C'est ce qui rend honnête la répartition setup/pilotage : un client passé en
 * pilotage le 12 garde ses heures de setup du 1er au 11.
 */
create type public.pulsar_phase as enum ('setup', 'pilotage', 'interne');

-- -------------------------------- Tables -----------------------------------

create table public.pulsar_clients (
  id                     uuid primary key default gen_random_uuid(),
  -- L'organisation qui tient le carnet (Comète Studio), pas celle qu'on
  -- chronomètre : c'est elle qui porte l'outil, et c'est elle que lit la RLS.
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  -- Le pont vers le hub, facultatif et sans conséquence en v1 : il attend le
  -- jour où l'encaissé des commissions se lira dans les relevés de Radar. Un
  -- client du carnet peut n'avoir aucun espace, et c'est le cas courant.
  linked_organization_id uuid references public.organizations(id) on delete set null,
  name                   text not null check (char_length(name) between 1 and 60),
  is_internal            boolean not null default false,
  profil                 public.pulsar_profil,
  modele                 public.pulsar_modele not null default 'recurrent',
  montant_cents          int not null default 0 check (montant_cents >= 0),
  date_debut             date,
  fin_engagement         date,
  statut                 public.pulsar_statut not null default 'setup',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organization_id, name),
  -- Redondante en apparence — `id` est déjà seul unique — mais c'est la cible
  -- que réclame la clé étrangère composite des entrées, plus bas : sans elle,
  -- une entrée pourrait se ranger sous le client d'une autre organisation.
  unique (id, organization_id),
  -- Un engagement qui finirait avant de commencer ne lèverait aucune erreur au
  -- moment du calcul : il rendrait zéro euro, en silence, pendant des mois.
  constraint pulsar_clients_engagement_coherent
    check (fin_engagement is null or date_debut is null or fin_engagement >= date_debut)
);

/*
 * Un seul « Comète » par organisation.
 *
 * C'est lui qui porte tout le non facturable, et la vue Comète se lit en
 * opposant ses heures à celles des autres. Deux clients internes couperaient
 * ce total en deux sans que rien ne le signale — l'amorçage est idempotent,
 * cet index dit pourquoi il doit l'être.
 */
create unique index pulsar_clients_un_interne_idx
  on public.pulsar_clients(organization_id) where is_internal;

-- Colonne de référence : sans index, la suppression d'une organisation balaie
-- la table entière pour aller y poser ses `null`.
create index pulsar_clients_lien_idx on public.pulsar_clients(linked_organization_id);

create table public.pulsar_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null,
  task             public.pulsar_task not null,
  -- Posée par l'application à la création, jamais recalculée ensuite.
  phase            public.pulsar_phase not null,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  /*
   * Le quart d'heure supérieur, minimum quinze minutes, imposé ici et pas
   * seulement à l'arrêt du chronomètre : la saisie manuelle, le rattrapage
   * d'un oubli et la correction d'une entrée passent tous par cette colonne.
   *
   * La durée ne se déduit pas de `ended_at - started_at`, et c'est voulu :
   * sept minutes de travail valent quinze minutes comptées.
   */
  duration_minutes int check (duration_minutes is null
                              or (duration_minutes % 15 = 0 and duration_minutes >= 15)),
  note             text check (note is null or char_length(note) <= 200),
  is_manual        boolean not null default false,
  created_by       uuid not null references public.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- En marche, ou terminée. Pas d'état intermédiaire : une entrée finie sans
  -- durée ne se compterait nulle part et ne se verrait nulle part.
  constraint pulsar_entries_course_ou_finie
    check ((ended_at is null and duration_minutes is null)
        or (ended_at is not null and duration_minutes is not null)),
  constraint pulsar_entries_fin_apres_debut
    check (ended_at is null or ended_at >= started_at),
  /*
   * Le client, et l'organisation avec lui.
   *
   * La RLS vérifie l'organisation de l'entrée, jamais celle de son client :
   * une entrée pourrait donc se ranger, chez soi, sous le client d'un autre —
   * il faudrait en connaître l'identifiant, que la RLS cache, mais une clé
   * étrangère qui décrit exactement ce qu'on veut coûte moins cher que le
   * pari qu'un uuid ne fuitera jamais. La règle d'or du hub se dit ici en
   * deux colonnes.
   *
   * `no action` là où le brief écrit `restrict`, pour exactement la même
   * promesse : on ne supprime pas un client dont on a compté les heures, on le
   * passe en `termine`.
   *
   * La différence ne se voit que dans un cas, mais il est décisif. Supprimer
   * une organisation efface en cascade ses clients *et* ses entrées ; avec
   * `restrict`, la vérification n'attend pas la fin de l'ordre et refuse la
   * suppression du client, donc celle de l'organisation entière — un geste qui
   * existe, qui est offert dans l'administration, et qui emporte aussi le
   * Storage. `no action` vérifie une fois l'ordre terminé, quand les entrées
   * sont déjà parties : le refus direct reste, la cascade passe.
   */
  constraint pulsar_entries_client_fk
    foreign key (client_id, organization_id)
      references public.pulsar_clients(id, organization_id) on delete no action
);

/*
 * Un seul chronomètre en marche par personne.
 *
 * L'index ne porte que sur `created_by`, sans l'organisation : Louis n'a pas
 * une journée par client, il en a une. Démarrer pendant qu'un autre tourne
 * n'est pas une erreur à afficher — c'est le geste le plus fréquent de la
 * journée : l'application arrête le premier proprement, puis lance le second.
 * Cet index est là pour le cas où elle oublierait.
 */
create unique index pulsar_one_running_idx
  on public.pulsar_entries(created_by) where ended_at is null;

-- La question que pose l'écran Aujourd'hui, puis celle de l'écran Par client.
create index pulsar_entries_org_day_idx on public.pulsar_entries(organization_id, started_at desc);
create index pulsar_entries_client_idx on public.pulsar_entries(client_id, started_at desc);
-- L'index partiel ci-dessus ne couvre que les entrées en cours : la cascade
-- depuis un profil supprimé, elle, les balaie toutes.
create index pulsar_entries_created_by_idx on public.pulsar_entries(created_by);

create table public.pulsar_settings (
  organization_id        uuid primary key references public.organizations(id) on delete cascade,
  -- Sous ce taux horaire réel, la ligne du mois passe en orange. 40 €/h.
  taux_alerte_cents      int not null default 4000 check (taux_alerte_cents >= 0),
  -- Au-delà de ces heures dans le mois, un client en pilotage passe en orange.
  heures_pilotage_alerte int not null default 10 check (heures_pilotage_alerte > 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger pulsar_clients_set_updated_at
  before update on public.pulsar_clients
  for each row execute function public.set_updated_at();

create trigger pulsar_entries_set_updated_at
  before update on public.pulsar_entries
  for each row execute function public.set_updated_at();

create trigger pulsar_settings_set_updated_at
  before update on public.pulsar_settings
  for each row execute function public.set_updated_at();

-- --------------------------- Garde du client interne ------------------------

/*
 * « Comète » ne se renomme pas, et personne n'entre ni ne sort de ce statut.
 *
 * Le nom sert de repère à Louis, mais le drapeau, lui, commande un chiffre :
 * un client bascule en interne et ses heures quittent le facturable ; le
 * client interne en sort et le non facturable du mois tombe à zéro. Ce sont
 * des écritures d'une ligne, invisibles dans une interface, et qui déplacent
 * la réponse à la question que l'outil est censé poser.
 *
 * Une garde sur `update` seulement : la suppression est traitée par la RLS,
 * plus bas, parce qu'un trigger `before delete` se déclencherait aussi quand
 * l'organisation entière s'en va en cascade — et refuserait alors de la
 * laisser partir.
 */
create or replace function public.pulsar_garder_client_interne() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.is_internal is distinct from old.is_internal then
    raise exception 'Un client ne devient pas interne, et n''en sort pas.';
  end if;

  if old.is_internal and new.name is distinct from old.name then
    raise exception 'Le client « Comète » porte ton non facturable : il ne se renomme pas.';
  end if;

  return new;
end;
$fn$;

create trigger pulsar_clients_garde_interne
  before update on public.pulsar_clients
  for each row execute function public.pulsar_garder_client_interne();

-- ------------------------------- Catalogue ---------------------------------

insert into public.tools (slug, name, description, kind, sort_order) values
  ('temps', 'Pulsar', 'Où passe ton temps, et ce qu''il rapporte.', 'internal', 60)
on conflict (slug) do nothing;

-- ---------------------------- Porte d'entrée -------------------------------

/*
 * Membre de l'organisation ET outil activé pour elle. Louis passe partout.
 * Même forme que `can_access_board`, `can_access_files`, `can_access_radar`,
 * `can_access_sas` et `can_access_sonde`.
 *
 * Pulsar n'est destiné qu'à Comète Studio, mais rien ici ne le suppose : c'est
 * l'activation qui décide, comme pour les autres. Un outil qui se croirait
 * seul finirait par l'être vraiment, et le jour où il faudrait le partager il
 * faudrait le réécrire.
 */
create or replace function public.can_access_temps(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select org is not null
     and (public.is_admin()
          or (public.is_member(org) and public.has_tool(org, 'temps')));
$fn$;

revoke execute on function public.can_access_temps(uuid) from public, anon;
grant execute on function public.can_access_temps(uuid) to authenticated;

-- --------------------------------- RLS -------------------------------------

alter table public.pulsar_clients enable row level security;
alter table public.pulsar_entries enable row level security;
alter table public.pulsar_settings enable row level security;

/*
 * Un carnet personnel : qui accède lit, écrit, corrige et efface. La porte est
 * `can_access_temps`, la même sur les quatre verbes — la frontière entre
 * organisations tient à elle seule.
 *
 * Deux nuances, et deux seulement :
 *
 * - `created_by = auth.uid()` à l'insertion d'une entrée. Les écrans agrègent
 *   tout, mais une heure signée par quelqu'un qui ne l'a pas travaillée n'est
 *   pas une erreur d'affichage, c'est un faux dans le carnet.
 * - le client interne ne s'efface pas. Tant qu'il porte des heures, la clé
 *   étrangère y suffirait ; vide, il partirait sans bruit, et l'amorçage le
 *   recréerait à la prochaine activation — avec une nouvelle identité, sous
 *   laquelle les anciennes heures ne seraient plus rangées.
 */
create policy "pulsar_clients_select" on public.pulsar_clients
  for select to authenticated using (public.can_access_temps(organization_id));
create policy "pulsar_clients_insert" on public.pulsar_clients
  for insert to authenticated with check (public.can_access_temps(organization_id));
create policy "pulsar_clients_update" on public.pulsar_clients
  for update to authenticated
  using (public.can_access_temps(organization_id))
  with check (public.can_access_temps(organization_id));
create policy "pulsar_clients_delete" on public.pulsar_clients
  for delete to authenticated
  using (public.can_access_temps(organization_id) and not is_internal);

create policy "pulsar_entries_select" on public.pulsar_entries
  for select to authenticated using (public.can_access_temps(organization_id));
create policy "pulsar_entries_insert" on public.pulsar_entries
  for insert to authenticated
  with check (public.can_access_temps(organization_id)
              and created_by = (select auth.uid()));
create policy "pulsar_entries_update" on public.pulsar_entries
  for update to authenticated
  using (public.can_access_temps(organization_id))
  with check (public.can_access_temps(organization_id));
create policy "pulsar_entries_delete" on public.pulsar_entries
  for delete to authenticated using (public.can_access_temps(organization_id));

create policy "pulsar_settings_select" on public.pulsar_settings
  for select to authenticated using (public.can_access_temps(organization_id));
create policy "pulsar_settings_insert" on public.pulsar_settings
  for insert to authenticated with check (public.can_access_temps(organization_id));
create policy "pulsar_settings_update" on public.pulsar_settings
  for update to authenticated
  using (public.can_access_temps(organization_id))
  with check (public.can_access_temps(organization_id));
create policy "pulsar_settings_delete" on public.pulsar_settings
  for delete to authenticated using (public.can_access_temps(organization_id));
