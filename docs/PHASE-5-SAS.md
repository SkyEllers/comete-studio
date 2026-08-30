# Phase 5 — Sas : le vide-tête qui range tout seul

Brief d'exécution pour Claude Code. Prérequis : phases 1 à 4 en production. Lire `CLAUDE.md`. Un chantier à la fois, compte-rendu, « go » de Louis.

## Ce qu'on construit

Une zone de texte où Louis déverse tout ce qu'il a en tête, pro et perso mélangés, une idée par ligne ou en vrac. À l'envoi, une IA découpe et propose un rangement : Perso, ou Pro dans une boîte (Jonathan, Flora, Comète…). Un écran de vérification montre chaque idée avec sa destination ; quand l'IA ne sait pas, elle demande (« Créer la boîte Flora ? »). Louis corrige d'un tap, valide, tout est rangé et daté. Ensuite : un onglet Boîtes pour tout retrouver, une liste Perso sans boîtes, une recherche, et sur chaque idée : archiver ou supprimer quand c'est fait.

Résultat attendu : Louis ouvre Sas sur son téléphone, tape « finir le SEO de Jonathan / analyser résultats campagne Flora / racheter des lentilles », envoie. L'écran de vérification propose : Pro → Jonathan · Pro → « Créer la boîte Flora ? » · Perso. Il touche Oui pour Flora, valide. Quinze secondes, trois idées rangées, la tête vide. Le lendemain il ouvre la boîte Jonathan et retrouve sa ligne, datée.

## Décisions de conception (actées)

1. **Nom** : Sas, slug `sas`, description « Vide ta tête : note tout, l'IA range, tu valides. », icône `Inbox`, `sort_order` 40. Tables préfixées `sas_`.
2. **Un outil du hub comme les autres**, activé pour une organisation « Comète Studio » dont Louis est membre. Les notes appartiennent à l'organisation : si un jour l'outil est activé pour un client, ses membres partagent leurs notes (la confidentialité par personne est au backlog). Les boîtes sont libres, sans lien avec les clients du hub.
3. **L'IA propose, Louis dispose.** Rien n'entre en base sans passer par l'écran de vérification. Et si l'IA est en panne, lente (> 15 s) ou répond n'importe quoi, la capture bascule en classement manuel : l'outil ne dépend jamais d'elle pour fonctionner.
4. **API Anthropic** appelée côté serveur uniquement (Server Action, `ANTHROPIC_API_KEY` dans l'environnement, jamais `NEXT_PUBLIC_`), en `fetch` natif, sans SDK. Modèle : le Haiku le plus récent (vérifier le nom exact dans la doc au moment du chantier), température 0, réponse en JSON strict validée par zod. Seuls partent à l'API : le texte saisi et la liste des noms de boîtes existantes. Rien d'autre du hub, jamais.
5. **Deux univers** : `pro` (avec boîte, ou « À ranger » si aucune) et `perso` (jamais de boîte). Une note est datée de son envoi (`captured_at`), puis archivable (elle reste consultable) ou supprimable (définitif, avec confirmation seulement si le geste vient d'une liste — pas de dialog depuis la fiche).
6. **Capture d'abord, téléphone d'abord** : la page racine de l'outil est la zone de texte, plein écran, avec l'envoi en un geste. Un brouillon non envoyé déclenche l'avertissement `beforeunload`.
7. Limite de 10 000 caractères par envoi (au-delà, message clair) ; coût attendu : quelques centimes par mois, noté pour mémoire.
8. `CLAUDE.md` : §2 (API Anthropic, fetch natif, modèle Haiku), §8 (la clé ne sort jamais du serveur ; toute panne IA doit laisser le mode manuel utilisable).

## Chantier 0 — Préparation par Louis

1. Créer une clé API sur console.anthropic.com (Settings → API Keys), avec une limite de dépense mensuelle basse (5 $ suffit largement).
2. Ajouter `ANTHROPIC_API_KEY` dans `.env.local` et dans Vercel (Production et Preview), redéployer. La ligne, sans valeur, va aussi dans `.env.example`.
3. Dans /admin : créer le client « Comète Studio » avec ton compte comme membre `owner` (s'il n'existe pas déjà), et activer Sas dessus une fois le chantier 1 en production.

## Chantier 1 — Migration `0012_sas`

```sql
create table public.sas_boxes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create type public.sas_realm as enum ('pro', 'perso');

create table public.sas_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  box_id          uuid references public.sas_boxes(id) on delete set null,   -- null = Perso ou « À ranger »
  realm           public.sas_realm not null,
  content         text not null check (char_length(content) between 1 and 2000),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  captured_at     timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (realm = 'pro' or box_id is null)      -- une note perso n'a jamais de boîte
);
create index sas_notes_org_idx on public.sas_notes(organization_id, realm, is_archived, captured_at desc);
create index sas_notes_box_idx on public.sas_notes(box_id, is_archived, captured_at desc);
```

`set_updated_at()` sur les deux tables. Catalogue : `('sas', 'Sas', 'Vide ta tête : note tout, l''IA range, tu valides.', 'internal', 40)`.

Fonction `can_access_sas(org)` = `is_admin() or (is_member(org) and has_tool(org, 'sas'))`, avec le `revoke`/`grant` de rigueur (CLAUDE.md §7).

RLS, plus ouverte que Radar parce que c'est un outil d'écriture personnelle : select / insert / update / delete = `can_access_sas(organization_id)` sur les deux tables ; `with check` de l'insert : `created_by = auth.uid()`. La suppression d'une boîte remet ses notes en « À ranger » (`on delete set null`), elle ne supprime aucune note.

`db push`, `npm run types`, extension de `qa:isolation` ou banc `qa-sas.mjs` : deux organisations, un membre de B ne lit ni n'écrit rien chez A ; outil coupé → notes et boîtes invisibles ; une note perso avec boîte est refusée par la contrainte.

## Chantier 2 — Capture, classement, vérification

Le cœur. Routes sous `/app/[orgSlug]/(tools)/sas`, garde `requireToolAccess(orgSlug, 'sas')`.

### Capture (page racine)

Zone de texte plein écran, placeholder « Vide ta tête. Une idée par ligne, ou en vrac. », compteur discret à l'approche des 10 000 caractères, bouton « Ranger » (le seul). Envoi → état de chargement (« Je trie… ») → écran de vérification. Échec ou délai dépassé → toast « L'IA n'a pas répondu, classe à la main » et écran de vérification en mode manuel (une idée par ligne du texte, destination vide).

### Server Action `classifier(texte)`

1. `requireToolAccess`, zod (1 à 10 000 caractères), charge les noms des boîtes de l'organisation.
2. Appel Anthropic (`POST /v1/messages`, fetch natif, timeout 15 s, `max_tokens` 2000, température 0). Prompt système, en français, qui impose :
   - découper le texte en idées distinctes (les sauts de ligne d'abord ; « et », « + », « / » seulement quand ce sont manifestement deux idées) ;
   - recopier chaque idée telle quelle, sans reformuler, sans corriger l'orthographe ;
   - pour chacune : `univers` (`pro` | `perso`) ; `boite` = un nom **exactement présent** dans la liste fournie si l'idée s'y rattache clairement (prénom, nom de client, sujet récurrent) ; sinon `nouvelle_boite` = un nom court proposé quand un nom propre inconnu apparaît ; sinon rien ;
   - `certitude` (`haute` | `basse`) ; dans le doute sur l'univers, `pro` + `basse` ;
   - répondre uniquement le JSON `{ "idees": [ { "texte", "univers", "boite", "nouvelle_boite", "certitude" } ] }`, sans un mot autour.
3. Validation zod stricte de la réponse ; une `boite` absente de la liste réelle est traitée comme `nouvelle_boite` ; toute incohérence → mode manuel. La réponse de l'IA n'est jamais écrite en base telle quelle : elle ne fait que préremplir l'écran.

### Écran de vérification

Une carte par idée : le texte (éditable en place), la destination en puces (Perso · chaque boîte existante · « + Nouvelle boîte »), la proposition de l'IA présélectionnée. Une idée en `certitude` basse ou en `nouvelle_boite` ressort en ambre avec la question en toutes lettres : « Créer la boîte Flora ? » et trois gestes : Oui · Renommer (champ) · Choisir une boîte existante. Une idée peut être retirée (croix) avant l'enregistrement. En bas : « Enregistrer N idées ». L'action d'enregistrement crée les boîtes acceptées puis insère les notes (une transaction logique : si une insertion échoue, rien n'est enregistré et l'écran reste), `revalidatePath` sur les boîtes, retour à la capture vidée, toast « N idées rangées ».

Vérifications : le scénario du brief mot pour mot (Jonathan existant, Flora inconnue, lentilles perso) ; un texte de 30 lignes mélangées ; l'IA coupée (clé invalide en local) → mode manuel utilisable de bout en bout ; aucune requête vers Anthropic ne part du navigateur (onglet réseau).

## Chantier 3 — Boîtes, Perso, recherche, cycle de vie

- `/boites` : tuiles des boîtes (nom, nombre de notes actives, dernière note « il y a… »), section Perso au même niveau (compteur), champ de recherche en haut. Créer et renommer une boîte ici aussi ; supprimer (confirmation : « Ses notes iront dans À ranger »).
- `/boites/[boxId]` et `/perso` : liste des notes par date décroissante, groupées par jour ; chaque note : texte, heure, menu (Modifier · Archiver · Supprimer · Déplacer vers une autre boîte ou vers Perso). « Voir les archivées » en pied de liste (section repliée, avec Restaurer).
- « À ranger » apparaît comme une boîte système quand elle contient au moins une note pro sans boîte.
- Recherche : `ilike` sur le contenu, univers et boîtes confondus, archivées comprises (signalées), 50 résultats max, chaque résultat mène à sa boîte.
- Navigation basse de l'outil sur mobile : Capture · Boîtes. La capture reste l'écran d'arrivée.

## Chantier 4 — Recette et mise en ligne

1. Banc complété : cycle archiver / restaurer / supprimer, déplacement entre boîtes, suppression de boîte → notes en « À ranger », recherche qui ne sort jamais de l'organisation.
2. `npm run test`, `npm run build`, `npm run lint`, tous les bancs. Tag `v2.4-sas`.
3. Recette de Louis, sur téléphone, en réel : trois vraies captures dans la journée, dont une avec une boîte inconnue et une en panne d'IA simulée est inutile — juger la vitesse du vrai flux, la qualité du découpage et du classement, et me remonter les textes mal classés pour ajuster le prompt.

## Backlog (ne rien commencer sans « go »)

Dictée vocale · capture par partage depuis le téléphone (PWA share target) · rappels et échéances sur une note · lien boîte ↔ client du hub · envoyer une note vers Orbite en carte · confidentialité par personne dans une organisation · fusion de boîtes · export.
