# Phase 8 — Pulsar : où passe ton temps, et ce qu'il rapporte

Brief d'exécution pour Claude Code. Prérequis : phases 1 à 7 en production. Lire `CLAUDE.md`. Un chantier à la fois, compte-rendu, « go » de Louis.

## Ce qu'on construit

Un chronomètre de rentabilité, pour Louis seul, qui répond à trois questions et rien d'autre : combien d'heures prend chaque client, combien rapporte chaque heure, et quelle part du temps part dans du non facturable (prospection, admin, communication de Comète). La saisie tient en dix secondes — un bouton démarrer/arrêter, un client, un type de tâche — et la lecture en trois écrans.

Résultat attendu : Louis démarre le timer sur « Peggy · Emails », travaille, arrête ; l'entrée s'arrondit au quart d'heure et s'ajoute à sa journée. Fin du mois, l'écran Par client lui dit que Peggy a pris 9 h pour un taux horaire réel de 61 €/h, que Jonathan est passé en orange (12 h de pilotage, seuil à 10), et la vue Comète que 28 % de son mois est parti en non facturable, dont 6 h de prospection.

## Ce que Pulsar ne fait pas

Pas de facturation, pas de gestion de projet, pas de to-do, pas de catégories imbriquées, pas de rapport PDF, pas de notifications. Le jour où il en faut plus : export CSV et un autre outil. Ces refus sont une décision de conception, pas un manque.

## Décisions de conception (actées)

1. **Nom** : Pulsar, slug `temps`, description « Où passe ton temps, et ce qu'il rapporte. », icône `Timer`, `sort_order` 60. Tables `pulsar_`, migration `0018_pulsar` (vérifier le dernier numéro en place et prendre le suivant), tag final `v2.7-pulsar`.
2. **Outil personnel** : activé sur l'organisation Comète Studio, jamais destiné à un client. Les entrées portent leur auteur (`created_by`) mais les écrans agrègent tout — Louis est seul, et le jour où il ne l'est plus, le filtrage par personne est au backlog.
3. **Les clients de Pulsar ne sont pas les organisations du hub** : table `pulsar_clients` à part, avec un lien optionnel `linked_organization_id` vers une organisation (pour plus tard : croiser avec Radar), parce qu'on chronomètre aussi des prospects et des clients qui n'auront jamais d'espace. Un client système « Comète » (`is_internal = true`), créé à l'activation de l'outil, porte tout le non facturable.
4. **Huit types de tâche, figés en enum** : `site` (page/site), `ads`, `emails` (emails/newsletters), `tracking` (tracking/appli), `reunion` (réunion/point client), `seo` (contenu SEO), `prospection` (prospection/vente), `admin`. S'il en faut un neuvième, c'est que deux se recoupent : l'enum est le garde-fou.
5. **Arrondi au quart d'heure supérieur, minimum 15 minutes**, appliqué à l'arrêt du timer et imposé par la base (`check duration_minutes % 15 = 0 and duration_minutes >= 15`). La saisie manuelle se fait par pas de 15.
6. **Un seul timer en cours par personne** (index unique partiel sur `created_by where ended_at is null`) : démarrer pendant qu'un tourne arrête l'ancien proprement (arrondi, enregistré) et lance le nouveau — le geste le plus fréquent de la journée ne doit jamais afficher d'erreur. Le timer vit côté serveur : il survit à la fermeture du téléphone et s'affiche sur tous les appareils.
7. **Chaque entrée fige la phase du client au moment de la saisie** (`phase` : `setup` | `pilotage` | `interne`, copiée du statut du client) : c'est ce qui rend honnête la répartition setup/pilotage même après le passage d'un client en pilotage.
8. **L'encaissé est déclaratif, dérivé de la fiche client, jamais saisi au fil de l'eau** :
   - `recurrent` → `montant_cents` compte pour chaque mois civil entre `date_debut` et (`fin_engagement`, ou le passage en `termine`), mois de début et de fin inclus ;
   - `one_shot` → `montant_cents` compte une fois, sur le mois de `date_debut` ; son taux horaire réel n'a de sens qu'en cumulé, l'écran le dit ;
   - `commission` → 0 en v1 (la lecture des relevés Radar est le premier candidat du backlog) ;
   - `historique` → 0 : des heures grises, assumées, qui pèsent sur le taux moyen parce que c'est la vérité.
   Taux horaire réel = encaissé ÷ heures, sur le mois pour les récurrents, en cumulé pour les one-shot.
9. **Deux alertes, en couleur, jamais en notification** : taux horaire réel du mois sous le seuil (défaut 40 €/h) → ligne orange ; client en `pilotage` au-delà du plafond d'heures mensuel (défaut 10 h) → ligne orange. Les deux seuils vivent dans `pulsar_settings`, modifiables dans l'outil.
10. **Semaine et mois en heure de Paris**, semaine du lundi, via les utilitaires de date existants du hub. Export CSV des entrées (période choisie, points-virgules, BOM, comme les autres exports).
11. Les entrées restent modifiables et supprimables sans limite de temps : c'est un carnet personnel, pas un registre contractuel — l'inverse exact de Radar, et c'est voulu.

## Chantier 0 — Préparation par Louis

Rien d'externe, aucune clé. Après le chantier 1 : activer Pulsar sur Comète Studio dans l'admin, puis créer ses premières fiches clients (Peggy, Jonathan, et les fiches `historique` s'il veut compter d'anciens clients).

## Chantier 1 — Migration `0018_pulsar`

```sql
create type public.pulsar_profil as enum ('p1', 'p2', 'p3', 'hors_cible');
create type public.pulsar_modele as enum ('recurrent', 'one_shot', 'commission', 'historique');
create type public.pulsar_statut as enum ('setup', 'pilotage', 'termine');
create type public.pulsar_task as enum ('site', 'ads', 'emails', 'tracking', 'reunion', 'seo', 'prospection', 'admin');
create type public.pulsar_phase as enum ('setup', 'pilotage', 'interne');

create table public.pulsar_clients (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  linked_organization_id  uuid references public.organizations(id) on delete set null,
  name                    text not null check (char_length(name) between 1 and 60),
  is_internal             boolean not null default false,
  profil                  public.pulsar_profil,
  modele                  public.pulsar_modele not null default 'recurrent',
  montant_cents           int not null default 0 check (montant_cents >= 0),
  date_debut              date,
  fin_engagement          date,
  statut                  public.pulsar_statut not null default 'setup',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.pulsar_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null references public.pulsar_clients(id) on delete restrict,
  task            public.pulsar_task not null,
  phase           public.pulsar_phase not null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  duration_minutes int check (duration_minutes is null or (duration_minutes % 15 = 0 and duration_minutes >= 15)),
  note            text check (note is null or char_length(note) <= 200),
  is_manual       boolean not null default false,
  created_by      uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((ended_at is null and duration_minutes is null) or (ended_at is not null and duration_minutes is not null))
);
create unique index pulsar_one_running_idx on public.pulsar_entries(created_by) where ended_at is null;
create index pulsar_entries_org_day_idx on public.pulsar_entries(organization_id, started_at desc);
create index pulsar_entries_client_idx on public.pulsar_entries(client_id, started_at desc);

create table public.pulsar_settings (
  organization_id       uuid primary key references public.organizations(id) on delete cascade,
  taux_alerte_cents     int not null default 4000,
  heures_pilotage_alerte int not null default 10,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
```

- `set_updated_at()` sur les trois tables. Catalogue : `('temps', 'Pulsar', 'Où passe ton temps, et ce qu''il rapporte.', 'internal', 60)`.
- `can_access_temps(org)` sur le modèle des autres, `revoke`/`grant` de rigueur.
- RLS : select / insert / update / delete = `can_access_temps(organization_id)` sur les trois tables ; `with check` de l'insert des entrées : `created_by = auth.uid()`. La suppression d'un client est bloquée s'il a des entrées (`restrict`) : on passe en `termine`, on ne réécrit pas l'histoire.
- À l'activation de l'outil pour une organisation : création du client interne « Comète » et de la ligne `pulsar_settings` (même mécanique d'amorçage que les canaux Radar).
- La `phase` d'une entrée est posée par l'app à la création (statut du client, ou `interne`), jamais recalculée ensuite.
- Banc `qa:pulsar` : isolation entre deux organisations, outil coupé → tout disparaît, l'index du timer unique refuse un second timer, la contrainte d'arrondi refuse 20 minutes, `restrict` refuse la suppression d'un client avec entrées.

## Chantier 2 — Le timer et l'écran Aujourd'hui

L'écran d'arrivée de l'outil, pensé téléphone d'abord, sous `/app/[orgSlug]/(tools)/temps`.

- **Timer** : un grand bouton. Au démarrage : choix du client (l'interne « Comète » en tête, puis les actifs par dernière utilisation) et du type en puces — deux taps, c'est parti. Pendant la course : client, type, durée qui défile, champ note repliable, bouton Arrêter. À l'arrêt : arrondi au quart d'heure supérieur (minimum 15), entrée enregistrée, toast avec la durée retenue. Démarrer pendant qu'un timer court : l'ancien s'arrête proprement, le nouveau part — une confirmation discrète, jamais un blocage.
- **Saisie manuelle** : client, type, durée (pas de 15, défaut 30), date (défaut aujourd'hui, jamais le futur), note. Trois champs obligatoires, dix secondes.
- **La journée** : les entrées du jour en liste (heure, client, type, durée, note), modifiables et supprimables en place. En tête : total du jour, total de la semaine (lundi–dimanche, Paris).
- Le timer en cours s'affiche aussi en pastille dans l'en-tête de l'outil sur les autres écrans, avec l'arrêt en un tap.
- Server Actions pour démarrer/arrêter/saisir (zod, `revalidatePath`) — pas de temps réel, l'outil est mono-utilisateur : la durée qui défile est un simple compteur local calé sur `started_at`.

Vérifications : démarrer sur le téléphone, arrêter sur l'ordinateur ; 7 minutes → 15 retenues ; 16 minutes → 30 ; un second démarrage bascule sans erreur ; une entrée modifiée garde sa phase d'origine.

## Chantier 3 — Les fiches clients et l'écran Par client

- **Fiches** (`/temps/clients`) : liste des clients (nom, profil, modèle, statut, montant), création et édition en dialog — tous les champs de la décision du modèle, avec les règles : `recurrent` exige `date_debut`, `one_shot` exige `date_debut` et un montant, `historique` grise le montant. Le client interne « Comète » n'est ni renommable ni supprimable. Passage en `termine` = archivage (sort des listes du timer, reste dans les chiffres).
- **Par client** (`/temps/clients` est la même page, chaque ligne se déplie ou mène au détail) : pour le mois affiché (sélecteur comme Radar) — heures du mois, heures cumulées, encaissé (règles de la décision 8, calculées dans un module `revenus.ts` pur et testé unitairement : c'est le cœur chiffré de l'outil), taux horaire réel avec la mention « cumulé » pour les one-shot, répartition setup/pilotage (sur les phases figées), répartition par type de tâche (barres). Lignes orange selon les deux alertes.
- Détail d'un client : les mêmes chiffres plus la liste de ses entrées du mois.

Vérifications : un récurrent à 550 €/mois et 9 h → 61 €/h ; le même passé en pilotage le 12 → ses heures d'avant restent en setup ; un one-shot affiche son taux en cumulé seulement ; un historique affiche 0 € sans casser les moyennes.

## Chantier 4 — La vue Comète, les alertes, le CSV

- **Vue Comète** (`/temps/comete`) : pour le mois affiché — heures facturables (clients non internes) contre non facturables (client Comète), en heures et en pourcentage ; taux horaire moyen de l'activité (encaissé total ÷ heures facturables) ; heures par profil (p1, p2, p3, hors cible, non renseigné) ; ligne prospection (heures du type `prospection`, tous clients confondus — une approche envoyée reste au backlog). Comparaison discrète avec le mois précédent sous chaque bloc.
- **Réglages** (dans l'outil, une section sobre) : les deux seuils d'alerte, modifiables, avec l'explication d'une ligne chacun.
- **Export CSV** : les entrées d'une période choisie (date, client, type, phase, durée, note), format des autres exports du hub.

## Chantier 5 — Recette et mise en ligne

1. `npm run test` (dont `revenus.test.ts`), build, lint, tous les bancs, `qa:pulsar` au complet. Tag `v2.7-pulsar`.
2. Recette de Louis, une vraie journée de travail : timer du matin au soir sur ses tâches réelles, une saisie manuelle oubliée, la lecture du soir sur Aujourd'hui, et en fin de semaine le premier regard Par client et vue Comète. Ce qu'on juge : la friction du geste (dix secondes, vraiment ?) et la justesse des chiffres face à son intuition.
3. Créer les fiches réelles (Peggy, Jonathan, historiques éventuels) avec leurs montants et dates.

## Backlog (ne rien commencer sans « go »)

Lecture de l'encaissé commission depuis les relevés Radar (le pont `linked_organization_id` est prêt) · compteur d'approches de prospection · seuils d'alerte par client · filtrage par personne si l'équipe grandit · objectif d'heures facturables par mois · saisie à la voix depuis Sas (« 2 h site Peggy » rangé en entrée) · rappel discret « timer oublié depuis 4 h » · export comptable annuel.
