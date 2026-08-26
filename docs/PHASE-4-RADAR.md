# Phase 4 — Radar : rendez-vous, attribution, relevés de commission

Brief d'exécution pour Claude Code. Prérequis : phases 1 à 3 en production, migration 0007 (renommage Orbite / Capsule) appliquée. Lire `CLAUDE.md`. Un chantier à la fois, compte-rendu, « go » de Louis.

## Ce qu'on construit

Comète Studio est rémunéré à la performance : une commission sur les séances que ses canaux (Google Ads, Meta, SEO…) apportent à un client. Radar rend cette commission incontestable. Il reçoit chaque réservation prise dans le Calendly du client, lui attribue un canal, suit son statut (confirmée, honorée, annulée, non venue), en tire un relevé mensuel que le client vérifie ligne par ligne et valide, et que Louis marque payé. Le client et Louis regardent le même écran.

Le premier client est un praticien dont les séances (90 €) se réservent sur Calendly et se paient par Stripe au moment de la réservation. Radar est conçu pour tous les clients suivants du même modèle : un compte Calendly relié, des canaux, un taux, une fenêtre de récurrence, et c'est tout.

Résultat attendu : un visiteur arrive sur la landing du client par une annonce Google, réserve une séance, paie ; trente secondes plus tard la séance apparaît dans Radar avec « Google Ads », 90 €, « confirmée ». Le jour J passe, elle devient « honorée ». Trois semaines plus tard la même personne reprend une séance sans passer par une annonce : Radar la rattache à Google Ads (récurrence dans la fenêtre). Le 1er du mois suivant, Louis clôture : le relevé liste les séances honorées venues des canaux Comète, la base, le taux, la commission. Le client valide depuis son téléphone. Louis marque payé. Aucun nom, aucun email n'a jamais été stocké dans le hub.

## Ce qui n'entre pas dans Radar

- La mesure d'audience de la landing (visiteurs, rebond, scroll, rétention vidéo) : c'est un outil d'analytics posé sur la landing (Plausible, PostHog), pas le hub. Radar n'en reçoit que trois chiffres par mois et par canal, saisis par Louis.
- Les remboursements Stripe, les paliers de commission, la synchronisation Google Ads : backlog.

## Décisions de conception (actées ; Louis peut en contester une avant le chantier 1)

1. **Nom** : Radar, slug `resultats`, description « Tes rendez-vous, d'où ils viennent, et le relevé du mois. » Tables préfixées `radar_`.
2. **Source unique** : les webhooks Calendly (`invitee.created`, `invitee.canceled`). Rien n'est saisi à la main pour un rendez-vous, sauf les corrections de statut.
3. **Zéro donnée personnelle dans le hub.** Ni nom, ni email, ni téléphone, ni payload brut. Une personne est représentée par `invitee_key` = HMAC-SHA256(email en minuscules, sel propre au client). Le client recoupe avec son Calendly par date et heure, et avec son Stripe par la référence de paiement. Les lignes de rendez-vous sont purgées 13 mois après la clôture du relevé, les relevés (agrégés, sans clé) sont conservés.
4. **Canaux** propres à chaque client, avec un marqueur « canal Comète » (entre dans la commission) et des règles de reconnaissance. Défaut à la création : Google Ads, Meta, SEO (Comète) ; Direct, Bouche à oreille, Newsletter, Autre (hors Comète).
5. **Attribution automatique**, dans l'ordre : UTM présents → règle de canal ; sinon, même `invitee_key` avec un rendez-vous attribué dans la fenêtre (90 jours par défaut, comptés depuis la séance précédente) → même canal, origine « récurrence » ; sinon Direct. La réponse à « Comment m'avez-vous connu ? » est affichée à côté, jamais utilisée pour attribuer ; un badge signale la divergence. Louis peut corriger un canal avec un motif obligatoire, visible du client.
6. **Statuts** : `confirme` (à venir), `honore`, `annule`, `no_show`. Une séance passée et non contestée est honorée automatiquement (calculé, pas stocké). Annulation Calendly → `annule`. Reprogrammation → l'ancienne ligne passe `annule` (motif reprogrammation), la nouvelle hérite de l'attribution. Le client peut marquer `no_show` ou `annule` (annulation faite hors Calendly), et revenir en arrière, tant que le relevé du mois n'est pas clôturé.
7. **Base de commission** = séances honorées, paiement réussi, canal Comète, du mois de la séance (pas du mois de la réservation). Une séance gratuite (appel découverte) est suivie avec un montant 0 et n'entre pas dans la base.
8. **Relevé mensuel** : Louis clôture à partir du 1er du mois suivant (les lignes sont figées dans le relevé) ; le client valide ou conteste avec un commentaire ; Louis corrige et re-clôture, ou marque payé. Statuts : `cloture`, `conteste`, `valide`, `paye`. Export CSV. Le mois en cours s'affiche en « brouillon » calculé à la volée.
9. **Ce que le client voit** : ses rendez-vous, son tableau de bord, ses relevés, ses réglages en lecture (taux, fenêtre, canaux, état de la connexion Calendly). Ce qu'il ne voit pas : les dépenses, visiteurs et clics saisis par Louis, qui vivent dans l'administration.
10. **Connexion Calendly** faite par Louis depuis l'admin avec un jeton d'accès personnel du client (généré dans Calendly → Intégrations → API & Webhooks). Le jeton, la clé de signature du webhook et le sel de pseudonymisation sont stockés dans Supabase Vault, jamais dans une table ordinaire ni dans le code.
11. **Webhook** : une route par client, `/api/webhooks/calendly/[orgId]`, sans session, service role, spécifiée au chantier 2. Première route de ce type dans le hub : elle ajoute une règle à `CLAUDE.md` §7.
12. **Landing** : un script `radar.js` servi par cometestudio.fr, posé sur la landing du client, qui mémorise les UTM d'arrivée le temps de la visite (sessionStorage, pas de bandeau nécessaire) et les ajoute aux liens Calendly. La récurrence à 90 jours ne dépend pas de ce script : elle se calcule dans le hub par `invitee_key`.
13. Pas de temps réel : les listes se rechargent. Pas de notifications email en v1 (backlog transversal du hub).

## Chantier 0 — Préparation par Louis

1. Supabase → Database → Extensions : activer `supabase_vault` (Vault) et `pg_cron`.
2. Côté premier client : Calendly en plan payant (les webhooks et l'encaissement l'exigent, à vérifier sur le plan du moment), Stripe relié, séance payante avec son prix, et une question obligatoire à choix unique « Comment m'avez-vous connu ? » dont les réponses reprennent mot pour mot les libellés des canaux (Google, Instagram ou Facebook, Recherche Google, Bouche à oreille, Newsletter, Autre).
3. Le client génère un jeton d'accès personnel dans Calendly et le transmet à Louis (canal sûr, pas un SMS).
4. Contrat : le taux, la fenêtre de récurrence, la règle « séance honorée et payée », et une clause de sous-traitance des données (le hub traite des données de réservation pour le compte du client). Louis n'est pas juriste, ni Claude : à faire relire.
5. Landing du client : prévoir l'ajout d'une ligne `<script src="https://cometestudio.fr/radar.js" defer></script>` (livré au chantier 6).

## Chantier 1 — Migration `0008_radar`

### Tables

```sql
create type public.radar_attribution as enum ('utm', 'recurrence', 'direct', 'manuel');
create type public.radar_status as enum ('confirme', 'honore', 'annule', 'no_show');
create type public.radar_status_origin as enum ('calendly', 'auto', 'client', 'admin');
create type public.radar_statement_status as enum ('cloture', 'conteste', 'valide', 'paye');

create table public.radar_settings (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  commission_rate     numeric(5,2) not null default 20.00 check (commission_rate between 0 and 100),
  window_days         int not null default 90 check (window_days between 0 and 365),
  currency            text not null default 'EUR',
  calendly_user_uri   text,
  calendly_org_uri    text,
  calendly_webhook_uri text,
  connected_at        timestamptz,
  last_webhook_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.radar_channels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,                      -- google_ads, meta, seo, direct, bouche_a_oreille, newsletter, autre
  label           text not null,
  is_comete       boolean not null default false,
  rules           jsonb not null default '{}',        -- { "sources": ["google"], "mediums": ["cpc","ppc"], "click_ids": ["gclid"], "declared": ["Google"] }
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  unique (organization_id, key)
);

create table public.radar_bookings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  invitee_uri         text not null unique,           -- idempotence
  event_uri           text not null,
  invitee_key         text not null,                  -- HMAC, jamais l'email
  scheduled_start     timestamptz not null,
  scheduled_end       timestamptz not null,
  event_type_name     text not null,
  event_type_uri      text,
  utm                 jsonb not null default '{}',    -- uniquement utm_* et identifiants de clic
  declared_source     text,
  channel_id          uuid references public.radar_channels(id) on delete set null,
  attribution         public.radar_attribution not null default 'direct',
  attribution_note    text,
  status              public.radar_status not null default 'confirme',
  status_origin       public.radar_status_origin not null default 'calendly',
  status_note         text,
  amount_cents        int not null default 0 check (amount_cents >= 0),
  currency            text not null default 'EUR',
  payment_ok          boolean not null default false,
  payment_ref         text,                           -- identifiant Stripe, pas une donnée personnelle
  rescheduled_from    uuid references public.radar_bookings(id) on delete set null,
  canceled_at         timestamptz,
  statement_id        uuid,                           -- posé à la clôture
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index radar_bookings_org_month_idx on public.radar_bookings(organization_id, scheduled_start);
create index radar_bookings_key_idx on public.radar_bookings(organization_id, invitee_key, scheduled_start desc);

create table public.radar_booking_activities (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,   -- null = système
  type            text not null,   -- booking.created, booking.canceled, booking.rescheduled, status.changed, channel.changed
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create table public.radar_statements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month           date not null,                      -- premier jour du mois
  status          public.radar_statement_status not null default 'cloture',
  commission_rate numeric(5,2) not null,
  window_days     int not null,
  base_cents      int not null default 0,
  commission_cents int not null default 0,
  lines           jsonb not null default '[]',        -- instantané, sans invitee_key
  closed_at       timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  review_comment  text,
  paid_at         timestamptz,
  unique (organization_id, month)
);

create table public.radar_channel_entries (         -- admin seul
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month           date not null,
  channel_id      uuid not null references public.radar_channels(id) on delete cascade,
  spend_cents     int not null default 0,
  visitors        int not null default 0,
  clicks          int not null default 0,
  note            text,
  unique (organization_id, month, channel_id)
);

create table public.radar_webhook_log (              -- admin seul, purgé à 90 jours
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  received_at     timestamptz not null default now(),
  event_kind      text,
  invitee_key     text,
  outcome         text not null,                      -- accepted, duplicate, ignored, invalid_signature, invalid_payload, error
  message         text
);
```

`set_updated_at()` sur `radar_settings` et `radar_bookings`. Catalogue : `('resultats', 'Radar', 'Tes rendez-vous, d''où ils viennent, et le relevé du mois.', 'internal', 30)`.

Vue `radar_bookings_effective` : mêmes colonnes plus `effective_status` = `honore` si `status = 'confirme'` et `scheduled_end < now()`, sinon `status` ; et `counts_for_commission` = `effective_status = 'honore' and payment_ok and amount_cents > 0 and` canal `is_comete`. Toute lecture côté app passe par la vue.

### Secrets (Vault)

Trois secrets par client, nommés `radar:<organization_id>:token`, `radar:<organization_id>:signing_key`, `radar:<organization_id>:salt`. Fonctions `radar_set_secret(org, kind, value)` et `radar_get_secret(org, kind)` en `security definer`, exécutables **uniquement par `service_role`** (`revoke … from public, anon, authenticated`). L'app n'y touche que depuis `admin.ts`.

### Fonctions d'accès et d'action

- `can_access_radar(org)` = `is_admin() or (is_member(org) and has_tool(org, 'resultats'))`.
- `radar_client_set_status(booking_id, new_status, note)` : `security definer`, pour les membres ; vérifie l'accès, refuse si un relevé couvre le mois de la séance, n'autorise que `confirme ↔ no_show ↔ annule`, écrit `status_origin = 'client'` et une activité.
- `radar_review_statement(statement_id, decision, comment)` : membres ; `decision` ∈ `valide` | `conteste`, uniquement depuis `cloture` ; commentaire obligatoire pour contester.
- Les actions admin (correction de canal, clôture, re-clôture, paiement, saisies) passent par Server Actions avec `admin.ts` après `requireAdmin()`, comme dans le reste du hub.

### RLS

| Table | select | écriture |
|---|---|---|
| `radar_settings`, `radar_channels`, `radar_bookings`, `radar_booking_activities`, `radar_statements` | `can_access_radar(organization_id)` | admin seul (`is_admin()`), les membres passent par les deux fonctions d'action |
| `radar_channel_entries`, `radar_webhook_log` | `is_admin()` | `is_admin()` |

Toutes les fonctions : `revoke execute from public, anon` puis `grant to authenticated` (ou `service_role` seul pour les secrets).

### Purge

Deux tâches `pg_cron` : le 2 de chaque mois, suppression des `radar_bookings` dont le relevé est `paye` ou `valide` depuis plus de 13 mois ; chaque nuit, suppression des lignes de `radar_webhook_log` de plus de 90 jours.

Vérifications : deux organisations, deux comptes ; un membre de B ne lit rien de A ; un membre de A ne peut ni écrire dans `radar_bookings` ni lire `radar_channel_entries` ; `radar_client_set_status` refuse un rendez-vous d'un mois clôturé ; `radar_get_secret` renvoie `permission denied` pour `authenticated`.

## Chantier 2 — Webhook Calendly et moteur d'attribution

### Route `src/app/api/webhooks/calendly/[orgId]/route.ts`

Règle nouvelle pour `CLAUDE.md` §7 : *une route sans session vérifie une signature avant toute lecture du corps interprété, est idempotente, valide son entrée par zod en rejetant tout champ inattendu, ne journalise aucune donnée personnelle, répond en moins de 2 s, et utilise le service role uniquement pour les tables qu'elle a à écrire.*

1. `POST` uniquement. `orgId` inconnu ou client sans connexion Calendly → 404 sans corps.
2. Lire le corps brut. En-tête `Calendly-Webhook-Signature` au format `t=<timestamp>,v1=<hex>`. Signature attendue = HMAC-SHA256(clé de signature du client, `${t}.${corps brut}`). Comparaison en temps constant. Horodatage à plus de 3 minutes de l'heure serveur → rejet (anti-rejeu). Toute anomalie → 401 sans corps, ligne `invalid_signature` dans le journal.
3. Parser le JSON, valider avec un schéma zod **strict** limité aux champs utilisés (`event`, `created_at`, `payload.uri`, `payload.email`, `payload.status`, `payload.rescheduled`, `payload.old_invitee`, `payload.tracking`, `payload.questions_and_answers`, `payload.payment`, `payload.scheduled_event.{uri,name,start_time,end_time,event_type,status}`, `payload.cancellation`). Un événement d'un autre type ou un payload invalide → 200 avec `ignored` ou `invalid_payload` au journal (pas de 4xx : Calendly réessaierait un message qui ne passera jamais).
4. `invitee_key` = HMAC-SHA256(sel du client, email en minuscules et sans espaces). L'email est oublié aussitôt.
5. `invitee.created` : si `invitee_uri` existe déjà → `duplicate`, 200. Sinon : attribution (ci-dessous), montant et paiement depuis `payment` (`amount` en unités → centimes, `successful`, `external_id`), insertion, activité `booking.created`. Si `rescheduled` et `old_invitee` connu : `rescheduled_from`, attribution héritée, activité `booking.rescheduled`.
6. `invitee.canceled` : ligne connue → `status = 'annule'`, `status_origin = 'calendly'`, `canceled_at`, motif dans `status_note` (reprogrammation ou annulation), activité `booking.canceled`. Inconnue → `ignored`.
7. Erreur base ou secret introuvable → 500 sans corps (Calendly réessaie), ligne `error` sans détail sensible.
8. `radar_settings.last_webhook_at` mis à jour à chaque appel accepté.

### Moteur d'attribution `src/tools/resultats/attribution.ts`

Fonction pure `attribute({ utm, invitee_key, scheduled_start, channels, previous })` → `{ channel_id, attribution }` :

1. `utm` non vide (ou identifiant de clic `gclid`, `fbclid`, `ttclid`) : parcourir les canaux actifs par `sort_order` ; premier dont `rules.sources` contient `utm_source` (insensible à la casse) ou `rules.mediums` contient `utm_medium` ou `rules.click_ids` contient un identifiant présent → `utm`. Aucun canal ne correspond → canal `autre`, `utm` conservé pour lecture.
2. Sinon, `previous` = dernier rendez-vous de la même `invitee_key` non annulé, dont la séance est antérieure de moins de `window_days` → même canal, `recurrence`.
3. Sinon → canal `direct`, `direct`.

Source déclarée : réponse à la question dont le libellé contient « connu » ; canal déclaré = canal dont `rules.declared` contient la réponse ; affiché, jamais attribué.

Règles par défaut des canaux : Google Ads `{sources: [google], mediums: [cpc, ppc, paid], click_ids: [gclid], declared: [Google]}` ; Meta `{sources: [facebook, instagram, meta, ig, fb], click_ids: [fbclid], declared: [Instagram, Facebook, Instagram ou Facebook]}` ; SEO `{sources: [google], mediums: [organic], declared: [Recherche Google]}` ; Newsletter `{mediums: [email, newsletter], declared: [Newsletter]}` ; Bouche à oreille `{declared: [Bouche à oreille]}` ; Direct, Autre sans règle. L'ordre compte : Google Ads avant SEO, pour que `google/cpc` tombe dans les annonces.

### Tests

- Premiers tests unitaires du repo, `node --test`, script `npm run test` : l'attribution sur douze cas (UTM Google Ads, gclid seul, Meta, organique, récurrence à 89 et 91 jours, récurrence après annulation, canal inconnu, déclaré ≠ attribué, reprogrammation).
- Fixtures de payloads Calendly dans `src/tools/resultats/fixtures/` (créé avec paiement, créé sans paiement, annulé, reprogrammé, paiement échoué), signés avec une clé de test ; `scripts/qa-radar.mjs` les poste sur la route d'une organisation jetable et vérifie la base après chaque cas, plus : signature invalide → 401, horodatage vieux → 401, doublon → une seule ligne, champ inattendu → `invalid_payload`, aucun email nulle part (grep sur les tables et le journal).
- Vérifier la structure exacte de `payload.payment` et de `payload.tracking` sur un payload réel du premier client avant de figer le schéma zod.

## Chantier 3 — Administration : connexion, réglages, canaux

Sous `/admin/clients/[id]/radar` (onglet Radar sur la fiche client) :

- **Connexion Calendly** : champ jeton → Server Action qui appelle `GET https://api.calendly.com/users/me` (vérifie le jeton, récupère `uri` et `current_organization`), génère une clé de signature et un sel (32 octets aléatoires chacun), les range dans Vault, crée l'abonnement `POST /webhook_subscriptions` (`url` = route du client, `events` = les deux, `scope` = `organization`, `organization` = l'URI, `signing_key` = la clé), enregistre `calendly_webhook_uri` et `connected_at`. Boutons Tester (liste les abonnements et vérifie que le nôtre existe) et Déconnecter (supprime l'abonnement chez Calendly, puis les secrets). État affiché : connecté depuis, dernier webhook reçu.
- **Réglages** : taux, fenêtre, devise.
- **Canaux** : liste ordonnée, libellé, Comète ou non, règles éditables (sources, mediums, identifiants de clic, réponses déclarées), actif ou non ; créés par défaut à l'activation de l'outil pour le client.
- **Journal des webhooks** : 200 derniers appels, filtrables par résultat.
- **Rendez-vous** : la même liste que le client (chantier 4) avec en plus la correction de canal (motif obligatoire → `attribution = 'manuel'`, activité `channel.changed`) et la correction de statut (`status_origin = 'admin'`).

`CLAUDE.md` §2 : dépendance nouvelle, aucune (fetch natif pour Calendly). §7 : la règle des routes sans session.

## Chantier 4 — Espace client : tableau de bord et rendez-vous

Mobile d'abord. Sous `/app/[orgSlug]/(tools)/resultats`, garde `requireToolAccess(orgSlug, 'resultats')`, entrée `resultats` au registre (icône `Radar`).

- **Tableau de bord** (page racine) : sélecteur de mois (puces, mois courant par défaut) ; quatre tuiles : rendez-vous, honorés, annulés + non venus, chiffre d'affaires attribué Comète ; commission estimée du mois (brouillon) ou état du relevé s'il existe ; répartition par canal (barres horizontales, nombre et montant) ; comparaison avec le mois précédent en petit sous chaque tuile ; bloc « À vérifier » : séances passées des sept derniers jours, avec bouton « Non venu » direct.
- **Rendez-vous** (`/rendez-vous`) : liste par jour, filtres mois, canal, statut ; ligne = heure, séance, badge canal (+ pastille « déclaré : X » si divergence), montant, statut. Tap → fiche en `Sheet` : tous les champs, référence de paiement, origine de l'attribution en clair (« Google Ads, via récurrence : séance du 12 mars »), journal des activités, actions Marquer non venu / Marquer annulé / Rétablir (masquées si le mois est clôturé, avec l'explication).
- **Réglages** (`/reglages`, lecture seule) : taux, fenêtre, canaux Comète et hors Comète, connexion Calendly (état, dernier rendez-vous reçu), texte court expliquant la règle de commission en français simple.
- Formats : montants « 90 € », dates en français, mois « octobre 2026 ».

## Chantier 5 — Relevés et saisies mensuelles

- **Clôture** (admin, fiche client → Radar → Relevés) : pour un mois révolu sans relevé ou avec un relevé `conteste` ; calcule depuis la vue les lignes du mois (`counts_for_commission` vrai ou faux, chaque ligne dans le relevé avec sa raison d'exclusion : hors Comète, annulée, non venue, gratuite, paiement manquant), base, commission ; stocke l'instantané sans `invitee_key` ; pose `statement_id` sur les lignes ; activité par ligne inutile, une seule entrée dans un journal de relevé suffit (`review_comment` et dates).
- **Relevés côté client** (`/releves`, `/releves/[id]`) : liste avec statut ; détail : tableau des lignes (date, séance, canal, statut, montant, comptée ou raison), base, taux, commission, boutons Valider / Contester (commentaire obligatoire) ; badge « payé » avec la date. Export CSV du relevé.
- **Paiement** (admin) : marquer payé sur un relevé `valide` (ou `cloture` après accord hors outil, avec une note).
- **Saisies mensuelles** (admin) : formulaire par mois et par canal Comète : dépense, visiteurs, clics ; en dessous, l'entonnoir calculé : visiteurs → clics → réservations → honorées, coût par réservation et par séance honorée, commission perçue, marge. Jamais visible du client.
- `/admin/radar` : vue transversale de tous les clients Radar : mois courant, commission en brouillon, relevés en attente de validation ou de paiement, dernier webhook reçu (alerte si plus de 14 jours).

## Chantier 6 — Script de landing et purge

- `public/radar.js` (moins de 3 Ko, sans dépendance) : à l'arrivée, lit `utm_*`, `gclid`, `fbclid`, `ttclid` dans l'URL ; s'ils existent et qu'aucune valeur n'est déjà en `sessionStorage`, les mémorise (premier contact de la visite) ; à chaque clic sur un lien vers `calendly.com` et au chargement d'un embed Calendly, ajoute ces paramètres à l'URL. Aucun cookie, aucune requête sortante, rien après la fermeture de l'onglet. Commentaire d'en-tête expliquant ce que fait le script, en français.
- Page d'aide interne `docs/RADAR-INSTALLATION.md` : la checklist complète pour brancher un nouveau client (Calendly, question, Stripe, jeton, script, contrat), à suivre pour chaque client.
- Tâches `pg_cron` du chantier 1 vérifiées en conditions réelles (une exécution manuelle sur des lignes fictives datées).

## Chantier 7 — Recette et mise en ligne

1. `scripts/qa-radar.mjs` complet : isolation entre deux clients, droits du membre (statut oui, canal non, entrées non), fonctions d'action, relevé (clôture, contestation, re-clôture, validation, paiement), absence de données personnelles, purge.
2. Premier client réel : connexion de son Calendly par Louis, une réservation de test à 0 € ou remboursée depuis sa landing avec un lien UTM, vérification bout en bout (ligne, canal, montant, statut, puis annulation depuis Calendly).
3. `npm run test`, `npm run build`, `npm run lint`, `qa:isolation`, `qa:routes`, `qa:radar`. Tag `v2.3-radar`. Activation pour le premier client.

## Backlog (ne rien commencer sans « go »)

Remboursements Stripe (statut `rembourse`) · dépenses Google Ads et Meta par API · import des visiteurs depuis l'analytics de la landing · relevé en PDF signé · paliers et taux par canal · notifications email (relevé clôturé, contestation, canal en baisse) · autres outils de réservation (Cal.com, Doctolib n'a pas de webhooks) · plusieurs landings par client · saisie manuelle d'une séance hors Calendly · tableau de bord multi-clients pour Louis avec marge globale.
