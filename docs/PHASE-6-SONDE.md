# Phase 6 — Sonde : la mesure des landings, sans cookie, branchée sur Radar

Brief d'exécution pour Claude Code. Prérequis : phases 1 à 5 en production (dernière migration : 0013). Lire `CLAUDE.md`. Un chantier à la fois, compte-rendu, « go » de Louis.

## Ce qu'on construit

Radar sait ce qui se passe après le clic « réserver » ; Sonde mesure ce qui se passe avant. Un script cousin de `radar.js`, posé sur la landing du client, compte les visiteurs, les pages vues, la provenance (mêmes canaux que Radar) et les clics vers Calendly — sans cookie, sans bandeau de consentement, sans jamais stocker une adresse IP. Le client et Louis voient un tableau de bord : visiteurs, sources, clics, et le taux de conversion jusqu'à la réservation quand Radar est actif. L'entonnoir de Radar cesse d'être saisi à la main : visiteurs et clics remontent tout seuls, seule la dépense publicitaire reste à saisir.

Résultat attendu : 300 personnes visitent la landing de Jonathan en octobre, 41 cliquent « réserver », 9 réservent. Sonde affiche 300 → 41 par canal et par jour ; Radar affiche 41 → 9 → commission ; Louis n'a saisi que la dépense Google Ads. Aucun visiteur n'est identifiable, aujourd'hui ou plus tard, par qui que ce soit.

## Ce qui n'entre pas dans Sonde

Le scroll, la rétention vidéo, les cartes de chaleur, les entonnoirs multi-pages, les sessions rejouées : hors périmètre, définitivement pour certains (rejeu de session = surveillance) ou en backlog pour d'autres. Sonde compte, elle n'observe pas.

## Décisions de conception (actées)

1. **Nom** : Sonde, slug `sonde`, description « Qui visite tes pages, d'où, et qui clique pour réserver. », icône `Activity`, `sort_order` 50. Tables `sonde_`, migration `0014_sonde`, tag final `v2.5-sonde`.
2. **Zéro cookie, zéro empreinte durable.** Le visiteur unique est compté par une clé calculée côté serveur : `HMAC(sel du jour, site + IP + user-agent)`. L'IP et le user-agent ne sont jamais écrits ; le sel change chaque nuit (heure de Paris) et l'ancien est détruit : deux visites à deux jours d'écart sont mathématiquement impossibles à relier. C'est la méthode des outils d'audience exemptés de consentement ; la politique de confidentialité du client doit mentionner la mesure d'audience anonymisée (à faire relire, ni Louis ni Claude ne sont juristes).
3. **Événements v1** : `pageview` (au chargement) et `cta` (clic vers calendly.com, fenêtre Calendly comprise, ou tout élément portant `data-sonde="cta"`). Rien d'autre.
4. **Ce qui est collecté, en tout et pour tout** : jeton du site, chemin de la page (sans query string), hôte du référent (jamais l'URL complète), les seuls paramètres `utm_*` / `gclid` / `fbclid` / `ttclid` de l'URL, l'événement. Tout champ supplémentaire est ignoré.
5. **Canaux partagés avec Radar** : la résolution réutilise les règles des canaux de l'organisation (même logique « au moins un accord, aucun désaccord »), étendue au référent quand il n'y a pas d'UTM : hôte de moteur de recherche → le canal dont les règles portent `organic` ; hôte de réseau social → le canal dont les sources correspondent ; aucun référent → Direct ; le reste → « Référent » avec l'hôte affiché. Fonction pure, testée, à côté de `attribution.ts`.
6. **Un site = une landing déclarée** : nom, jeton public aléatoire, liste des domaines autorisés. Une organisation peut avoir plusieurs sites. Le script s'installe avec `<script src="https://cometestudio.fr/sonde.js" data-site="JETON" defer></script>`.
7. **Stockage en deux étages** : les événements bruts (déjà anonymes) vivent 13 mois puis sont purgés ; un agrégat par jour, site et canal (`pageviews`, `visiteurs`, `cta`) est calculé chaque nuit et conservé sans limite. Le jour en cours se calcule à la volée sur les bruts.
8. **Le point d'entrée de collecte est public** (deuxième route sans session du hub, après le webhook Calendly) : il suit la règle de `CLAUDE.md` §7 et ajoute ses propres défenses — origine vérifiée contre les domaines du site, corps ≤ 1 Ko en `text/plain` (pas de prévol CORS), filtrage des robots par user-agent, limitation de débit par IP, réponse 204 systématique en moins de 100 ms, et jamais un octet de plus en base que le point 4.
9. **Dans Radar** : quand Sonde est active pour l'organisation, l'entonnoir lit visiteurs et clics dans les agrégats de Sonde ; les champs de saisie manuelle correspondants disparaissent (la dépense reste). Sans Sonde, rien ne change.
10. Le tableau de bord est visible du client comme de Louis : ses visiteurs ne sont pas un secret pour lui. La dépense, elle, reste dans l'admin de Radar.

## Chantier 0 — Préparation par Louis

Rien à créer : pas de service externe, pas de clé. Une seule chose, pour la fin de phase : pouvoir modifier le code personnalisé de la landing de Jonathan (même endroit que radar.js) pour y ajouter la ligne de Sonde.

## Chantier 1 — Migration `0014_sonde`

```sql
create table public.sonde_sites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  token           text not null unique,               -- 16 octets aléatoires en hex, public
  domains         text[] not null default '{}',       -- hôtes autorisés, ex. {jonathan-cuinat.com}
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  last_event_at   timestamptz
);

create type public.sonde_event_kind as enum ('pageview', 'cta');

create table public.sonde_events (
  id              bigint generated always as identity primary key,
  site_id         uuid not null references public.sonde_sites(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  kind            public.sonde_event_kind not null,
  path            text not null default '/',
  referrer_host   text,
  channel_id      uuid references public.radar_channels(id) on delete set null,
  channel_bucket  text not null default 'direct',     -- direct | canal | referent
  visitor_key     text not null,
  utm             jsonb not null default '{}'
);
create index sonde_events_site_day_idx on public.sonde_events(site_id, occurred_at);

create table public.sonde_daily (
  site_id         uuid not null references public.sonde_sites(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day             date not null,
  channel_id      uuid references public.radar_channels(id) on delete set null,
  channel_bucket  text not null,
  pageviews       int not null default 0,
  visitors        int not null default 0,
  cta_clicks      int not null default 0,
  primary key (site_id, day, channel_bucket, channel_id)
);

create table public.sonde_salt (                      -- service role seul
  day  date primary key,
  salt text not null
);
```

- `can_access_sonde(org)` sur le modèle des autres, `revoke`/`grant` de rigueur.
- RLS : `sonde_sites` et `sonde_daily` en lecture pour `can_access_sonde`, écriture admin ; `sonde_events` en lecture pour `can_access_sonde` (le jour en cours s'affiche), aucune écriture par `authenticated` (seul le service role du point de collecte écrit) ; `sonde_salt` : rien pour `authenticated`, même la lecture.
- Trois tâches `pg_cron`, via des fonctions appelables réservées au service role (leçon de la phase 4) : rotation du sel à minuit heure de Paris (créer celui du jour, détruire les précédents), agrégation de la veille dans `sonde_daily` (recalcul idempotent : `delete` puis `insert`), purge des événements de plus de 13 mois.
- Catalogue : `('sonde', 'Sonde', 'Qui visite tes pages, d''où, et qui clique pour réserver.', 'internal', 50)`.
- Banc `qa:sonde` : isolation entre organisations, outil coupé, `sonde_salt` illisible pour un membre, insertion directe dans `sonde_events` refusée à un membre.

## Chantier 2 — Le point de collecte

Route `src/app/api/sonde/[token]/route.ts`, `POST` uniquement.

1. Jeton inconnu ou site inactif → 204 quand même (on ne confirme jamais l'existence d'un site à un inconnu), rien d'écrit.
2. En-tête `Origin` (ou à défaut `Referer`) présent → son hôte doit figurer dans `domains` du site, sous-domaines admis ; sinon 204 sans écriture. Absent (sendBeacon peut l'omettre) → accepté.
3. Corps `text/plain` ≤ 1 024 octets, JSON `{ e: 'pageview' | 'cta', p: '/chemin', r: 'hote-referent' | null, u: { utm_* , gclid, fbclid, ttclid } }`, validé par zod strict ; tout autre champ → événement ignoré, 204.
4. Robots : user-agent absent, ou contenant `bot`, `crawler`, `spider`, `preview`, `headless`, `lighthouse`, `pingdom`, `monitor` → 204 sans écriture. Filtre imparfait et assumé : les agrégats mesurent des ordres de grandeur, pas une comptabilité.
5. Limitation de débit en mémoire par IP (fenêtre glissante, 60 événements/minute) → au-delà, 204 sans écriture. Par instance Vercel, donc approximative : c'est un amortisseur, pas un rempart, et c'est documenté dans le code.
6. `visitor_key` = HMAC-SHA256(sel du jour, `site_id + IP + user-agent`) ; le sel du jour est lu en base et gardé en mémoire d'instance avec sa date ; s'il manque (cron pas encore passé), il est créé à la volée de façon idempotente.
7. Résolution du canal par la fonction partagée (règles des canaux de l'organisation, puis référent, puis Direct). Insertion, `last_event_at` du site mis à jour au plus une fois par minute.
8. Réponse : toujours `204 No Content`. Jamais de message d'erreur vers l'extérieur.

Tests : unitaires sur la résolution de canal étendue au référent (moteurs, réseaux, inconnu, aucun) ; banc `qa:sonde` complété — jeton inconnu, origine étrangère, corps trop gros, champ en trop, user-agent robot, rejeu massif au-delà de la limite, et la vérification de fond : après cent événements, aucune IP ni user-agent nulle part en base (grep sur toutes les colonnes), et deux visites du même « navigateur » à deux jours de sel différents donnent deux `visitor_key` distincts.

## Chantier 3 — Le script `sonde.js`

`public/sonde.js`, ≤ 3 Ko livré, aucun cookie, aucun stockage, aucune dépendance.

- Lit `data-site` sur sa propre balise ; sans jeton, ne fait rien.
- `pageview` au chargement (une fois, y compris au retour du cache arrière/avant via `pageshow` si `persisted`).
- `cta` : clic sur tout lien vers `calendly.com`, ouverture d'une fenêtre Calendly (mêmes enveloppes que `radar.js` : `initPopupWidget` et voisines, plus le `MutationObserver` pour les blocs montés après coup), et tout élément `[data-sonde="cta"]`. Un seul `cta` par chargement de page même si l'on clique deux fois.
- Envoi par `navigator.sendBeacon` en `text/plain`, repli `fetch keepalive`. Échec silencieux : le script ne doit jamais faire apparaître une erreur sur le site du client.
- Ne collecte du `location` que le `pathname` et les paramètres du point 4 des décisions ; le référent est réduit à son hôte avant l'envoi.
- Coexistence vérifiée avec `radar.js` sur la même page, dans les deux ordres de chargement.
- Éprouvé comme `radar.js` dans un faux DOM (`node:vm`) : douze cas, dont sendBeacon refusé → fetch, double clic → un seul `cta`, page sans jeton → aucun envoi.

## Chantier 4 — Tableau de bord et administration des sites

- **Client et Louis**, `/app/[orgSlug]/(tools)/sonde` : sélecteur de période (ce mois, mois précédents, 7 derniers jours) ; quatre tuiles : visiteurs, pages vues, clics réserver, taux de clic ; graphique par jour (barres en SVG maison, pas de bibliothèque) ; répartitions : par canal (mêmes noms et couleurs que Radar), par page, par référent ; si Radar est actif, la ligne descend jusqu'aux réservations du mois (« 300 visiteurs → 41 clics → 9 réservations ») avec les taux. État vide clair tant qu'aucun événement n'est reçu, avec le script à copier si l'on est admin.
- **Admin**, sur la fiche client, onglet Sonde : créer un site (nom, domaines), jeton et balise `<script>` à copier en un clic, « dernier événement reçu il y a… », désactiver un site, régénérer le jeton (l'ancien meurt aussitôt, avertissement).
- Le jour en cours est calculé sur `sonde_events`, l'historique sur `sonde_daily` ; la couture entre les deux est invisible à l'écran.

## Chantier 5 — La jonction avec Radar

- Quand Sonde est active et qu'au moins un site existe : l'entonnoir de Radar (admin) lit visiteurs et clics dans `sonde_daily` agrégé par mois et par canal Comète ; les champs de saisie correspondants disparaissent du formulaire, la dépense reste. Les mois antérieurs à la mise en route gardent leurs valeurs saisies (le formulaire l'indique).
- `/admin/radar` : l'alerte existante s'enrichit d'une ligne Sonde — « aucun événement depuis 7 jours » sur un site actif (script tombé, refonte de la landing…).
- Vérifications : un mois mixte (15 jours saisis, 15 jours mesurés) affiche ce qu'il doit ; désactiver Sonde fait réapparaître la saisie sans perdre les agrégats.

## Chantier 6 — Recette et mise en ligne

1. Tous les bancs, `npm run test`, build, lint. Tag `v2.5-sonde`.
2. Recette réelle : Louis ajoute la balise sur la landing de Jonathan (à côté de `radar.js`), visite la page depuis son téléphone en 4G et depuis son ordinateur, clique « réserver », et vérifie : deux visiteurs, deux pages vues, un clic, le bon canal, et rien dans la console du site. Puis une visite avec `?utm_source=google&utm_medium=cpc` → canal Google Ads.
3. Activation de l'outil pour Jonathan et pour Comète Studio.

## Backlog (ne rien commencer sans « go »)

Sessions et durée de visite · objectifs personnalisés au-delà du CTA · pages vues des applications à navigation interne (pushState) · comparaison de deux périodes · export CSV · alerte hebdomadaire par email · plusieurs CTA nommés · agrégats par ville (jamais en dessous) · rapport public partageable.
