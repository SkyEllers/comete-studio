# Rapport d'entonnoir GA4 — landing « sommeil » de Jonathan

À relancer chaque semaine. Lecture seule : le script interroge l'API Data de GA4 et n'écrit rien, ni chez Google ni dans la base du hub.

## Ce qui est mesuré

Propriété GA4 « Site Hypnose Jonathan » (`536224481`, flux `G-22G5VB8LHV`). La landing pousse sept événements dans le `dataLayer`. Depuis la version 10 du conteneur `GTM-NZCNQF9R`, publiée le 11/09/2026, la balise « GA4 - Entonnoir landing » les relaie à GA4 sous leur propre nom, sur le déclencheur « CE - entonnoir landing ».

| Événement | Moment |
|---|---|
| `lp_view` | la landing s'affiche |
| `video_start` | la VSL démarre |
| `video_progress` | la VSL franchit 25, 50, 75 puis 95 % (paramètre `video_percent`) |
| `lp_cta_click` | clic sur un bouton de réservation |
| `calendly_event_type_viewed` | le calendrier Calendly s'affiche (la landing ignore le widget préchargé hors écran) |
| `calendly_date_and_time_selected` | une date et une heure sont choisies |
| `calendly_event_scheduled` | le rendez-vous est réservé |

Trois limites, à rappeler en même temps que les chiffres :

- **Rien avant le 11/09/2026.** Avant la version 10, ces événements ne quittaient pas le `dataLayer` : les jours antérieurs sont vides, pas nuls.
- **Les paliers de la VSL demandent la dimension personnalisée `video_percent`** (portée Événement, paramètre `video_percent`), qui se crée avec le rôle Éditeur sur la propriété. GA4 ne la remplit pas après coup : les `video_progress` reçus avant sa création restent dans le total, sans palier. Le rapport les compte à part.
- **GA4 ne voit que les visiteurs qui le laissent charger** (bloqueurs, consentement). Pour le volume de visites, la référence est Sonde ; GA4 sert à lire les taux de passage.

## Lancer le rapport

```bash
# période par défaut : du 05/09 au 12/09/2026
GA4_ACCESS_TOKEN="…" npm run rapport:entonnoir

# une autre semaine
GA4_ACCESS_TOKEN="…" npm run rapport:entonnoir -- --du=2026-09-12 --au=2026-09-18
```

```powershell
$env:GA4_ACCESS_TOKEN = "…"; npm run rapport:entonnoir -- --du=2026-09-12 --au=2026-09-18
```

Le jeton peut aussi vivre dans `.env.local` (`GA4_ACCESS_TOKEN=…`), jamais dans le repo. `--propriete=` vise une autre propriété.

Sortie, en tableaux :

1. **Entonnoir** : vue de la landing → VSL lancée → clic réserver → calendrier affiché → date et heure choisies → rendez-vous réservé. Pour chaque étape : total, part google / cpc, autres, personnes, taux rapporté aux vues de la landing (total et cpc).
2. **Rétention VSL** : 25 / 50 / 75 / 95 %, taux rapporté aux lancements. Absente tant que la dimension `video_percent` n'existe pas ; le rapport le dit et donne le total de `video_progress`.
3. **Par source / support de session** : les dix plus gros apporteurs de vues.

Le calcul est couvert par `npm run test` (`scripts/rapports/entonnoir-ga4.test.mjs`).

Si la colonne google / cpc reste à zéro alors que Sonde voit du trafic Google Ads, vérifier dans GA4 (Administration → Associations à Google Ads) que le compte Ads est bien associé à la propriété.

## Obtenir un jeton

Le script attend un jeton d'accès OAuth 2.0 de portée `https://www.googleapis.com/auth/analytics.readonly`, émis pour un compte qui a au moins le rôle Lecteur sur la propriété. Il n'en fabrique pas et n'en garde aucun.

**Aucune voie n'est en place à ce jour**, et chacune demande une décision :

1. **Google Cloud CLI** : `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform`, puis `gcloud auth application-default print-access-token`. Demande d'installer l'outil et un projet Google Cloud (projet de quota) où l'API Data de GA4 est activée.
2. **Compte de service** ajouté en Lecteur sur la propriété : le plus stable pour un rapport hebdomadaire, mais c'est un compte à créer et une clé à garder hors du repo.

## Sans API : la même lecture dans GA4

Accessible avec le rôle Lecteur.

1. Rapports → Engagement → Événements, sur la période voulue.
2. Relever « Nombre d'événements » et « Nombre total d'utilisateurs » pour chacun des sept événements.
3. Ajouter une comparaison « Source/support de la session » = `google / cpc` pour isoler la campagne.
4. Ouvrir `video_progress` : la carte `video_percent` donne les paliers, une fois la dimension créée.
