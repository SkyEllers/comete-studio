# Phase 7 — Radar : le nom des invités et les ventes déclarées

Brief d'exécution pour Claude Code. Prérequis : phases 1 à 6 en production (dernière migration : 0014). Lire `CLAUDE.md`. Un chantier à la fois, compte-rendu, « go » de Louis.

## Ce qu'on construit

Deux évolutions de Radar nées du premier client réel (Peggy), qui vend en deux temps : un diagnostic offert réservé sur Calendly, puis un accompagnement vendu pendant ou après le rendez-vous, dont Calendly ne sait rien.

1. **Chaque rendez-vous porte le prénom et le nom de l'invité.** Trente rendez-vous par semaine sans nom, l'outil est inutilisable : impossible de retrouver qui est qui, de marquer la bonne personne « non venue », de rattacher une vente. Le nom entre, l'email et le téléphone restent dehors pour toujours.
2. **Une vente peut être déclarée sur un rendez-vous.** « Vente conclue, 1 200 €, le 4 septembre. » Et chaque client a désormais un mode de commission : `encaissement` (le paiement Calendly/Stripe fait foi — Jonathan) ou `ventes` (les ventes déclarées font foi — Peggy). Le relevé mensuel, le tableau de bord et l'entonnoir suivent le mode.

Résultat attendu : Peggy ouvre Radar, voit « Camille D. — jeudi 10:30 — Meta — Confirmé », clique après le rendez-vous sur « Vente conclue », saisit 1 200 €. Fin du mois, le relevé liste ses ventes, chacune reliée à son rendez-vous et à son canal d'origine, la commission se calcule dessus, elle valide ligne par ligne comme aujourd'hui.

## Décisions de conception (actées)

1. **Identité minimale, systématique** : `first_name` et `last_name` de Calendly, tronqués à 80 caractères, stockés sur le rendez-vous. Jamais l'email (la clé pseudonyme HMAC reste le seul lien entre rendez-vous d'une même personne), jamais le téléphone, jamais les réponses aux questions autres que « comment m'avez-vous connu ». Le nom n'apparaît **jamais** dans : les relevés (conservés sans limite), `radar_booking_activities`, `radar_webhook_log`, les emails, les exports CSV de relevé. Il vit sur `radar_bookings` et meurt avec la ligne.
2. **Purge raccourcie pour l'identité** : les colonnes de nom sont vidées (pas la ligne) 6 mois après la séance pour les rendez-vous sans vente, et 13 mois après pour les autres — la purge complète des lignes à 13 mois après clôture reste inchangée. Une tâche `pg_cron` de plus, sur le modèle des existantes.
3. **Cadre légal, une fois pour toutes** : le hub traite désormais des données nominatives de prospects/patients pour le compte du client. Le DPA (accord de sous-traitance) devient un prérequis d'activation de Radar, listé au chantier 0 et dans `RADAR-INSTALLATION.md`. Ni Louis ni Claude ne sont juristes : le modèle de DPA est à faire relire.
4. **La vente est déclarative et vit sur un rendez-vous** : montant (centimes), date de vente (défaut : aujourd'hui), note libre courte optionnelle (« pack 5 séances »). Une vente par rendez-vous en v1 (un deuxième achat = le rendez-vous suivant de la même personne, que la clé pseudonyme relie déjà). Déclarée, modifiée ou retirée par un membre ou par Louis, chaque geste signé au journal (`sale.recorded`, `sale.updated`, `sale.removed`). Verrouillée dès que le relevé couvrant sa **date de vente** est clôturé.
5. **Le mois d'une vente est celui de sa date de vente**, pas celui du rendez-vous d'origine : un diagnostic du 28 août vendu le 3 septembre compte dans le relevé de septembre. Le canal, lui, vient toujours du rendez-vous d'origine.
6. **Deux modes de commission par client**, `radar_settings.commission_basis` : `encaissement` (comportement actuel, inchangé au centime près) ou `ventes` (base = ventes déclarées du mois dont le rendez-vous d'origine est sur un canal Comète et n'est ni annulé ni non venu). Le mode se choisit dans l'admin, et le texte des réglages côté client explique la règle en français simple dans les deux cas.
7. **La recherche par nom** existe côté liste (client et admin) : champ « Chercher un nom », `ilike`, dans l'organisation seulement. C'est la raison d'être du nom ; sans elle, il ne servirait à rien.
8. Le webhook reste strict : seuls `first_name` et `last_name` s'ajoutent aux champs lus ; s'ils manquent, repli sur le `name` complet de Calendly découpé au premier espace ; s'il manque aussi, « Invité·e » et la vie continue.

## Chantier 0 — Préparation par Louis

1. Le modèle de DPA Comète Studio ↔ client (celui déjà annoncé sur le site de Peggy) : à établir et faire relire, puis signer avec Peggy avant la mise en production de cette phase. C'est le seul point bloquant qui ne soit pas du code.
2. Décider du taux de commission de Peggy et le poser dans l'admin (il est à 0 %).
3. Rien d'autre : pas de service externe, pas de clé.

## Chantier 1 — Migration `0015_radar_identite_ventes`

```sql
alter table public.radar_bookings
  add column invitee_first_name text not null default '' check (char_length(invitee_first_name) <= 80),
  add column invitee_last_name  text not null default '' check (char_length(invitee_last_name)  <= 80),
  add column sale_amount_cents  int  check (sale_amount_cents is null or sale_amount_cents >= 0),
  add column sale_date          date,
  add column sale_note          text check (sale_note is null or char_length(sale_note) <= 200),
  add column sale_recorded_by   uuid references public.profiles(id) on delete set null,
  add column sale_recorded_at   timestamptz,
  add constraint radar_sale_coherente check (
    (sale_amount_cents is null and sale_date is null)
    or (sale_amount_cents is not null and sale_date is not null)
  );

create type public.radar_commission_basis as enum ('encaissement', 'ventes');
alter table public.radar_settings
  add column commission_basis public.radar_commission_basis not null default 'encaissement';
```

- La vue `radar_bookings_effective` est reconstruite (leçon de la 0010 : `drop view` + `create`, `security_invoker`) : elle expose les nouvelles colonnes, `invitee_display` (« Camille D. » — prénom + initiale, le nom complet reste disponible en colonne pour la fiche et la recherche), `has_sale`, et `counts_for_commission` devient dépendant du mode : en `encaissement`, règle actuelle inchangée ; en `ventes`, `has_sale and` canal Comète `and effective_status <> 'annule' and effective_status <> 'no_show'` — rattaché au **mois de `sale_date`** (nouvelle colonne calculée `commission_month`).
- Fonction membre `radar_set_sale(booking_id, amount_cents, sale_date, note)` (et retrait avec `amount_cents` nul) : `security definer`, mêmes gardes que `radar_client_set_status` — accès, refus si un relevé couvre le mois de la date de vente (l'ancienne comme la nouvelle en cas de changement de date), refus sur un rendez-vous annulé ou non venu, activité signée. `revoke`/`grant` de rigueur.
- Purge de l'identité : fonction appelable service role + tâche `pg_cron` mensuelle (décision 2), éprouvée sur lignes datées comme les purges existantes.
- Webhook : lecture de `first_name` / `last_name` (repli décision 8) dans `invitee.created`. Les fixtures existantes portent déjà « Camille Dupont » : elles cessent d'être un contrôle d'absence et deviennent un contrôle de présence — le banc `qa:radar` inverse ce point précis (le nom doit être en base) et **garde** tous les autres contrôles d'absence : jamais d'email, de téléphone, de nom dans le journal, les activités, les relevés.
- `db push`, `npm run types`.

## Chantier 2 — L'identité à l'écran

- Liste des rendez-vous (client et admin) : chaque ligne commence par `invitee_display` ; champ « Chercher un nom » (décision 7) qui filtre la liste, borné à l'organisation, archivé du mois compris.
- Fiche du rendez-vous : nom complet en titre, le reste inchangé. Le bloc « À vérifier » du tableau de bord affiche le nom (« Camille D. — mardi 14:00 — Non venue ? »).
- Les rendez-vous antérieurs à cette phase n'ont pas de nom : ils affichent « Invité·e » et un point discret « reçu avant l'identité » en fiche — pas de rétro-remplissage, Calendly ne sera pas réinterrogé.
- Relevés, exports, emails : vérifier par le banc qu'aucun nom n'y transite (décision 1).

## Chantier 3 — La vente

- Fiche du rendez-vous, pour un rendez-vous ni annulé ni non venu : bouton « Vente conclue » → montant (saisie en euros, virgule acceptée), date (défaut aujourd'hui, pas dans le futur, pas avant le rendez-vous), note optionnelle. Une vente posée s'affiche en tête de fiche (« Vente : 1 200 € le 3 septembre — pack 5 séances »), modifiable et retirable tant que le relevé de son mois n'est pas clôturé ; ensuite, verrouillée avec l'explication.
- Liste : badge vente sur les lignes concernées ; filtre « Avec vente / Sans vente ».
- Tableau de bord : en mode `ventes`, la tuile « CA attribué » devient « Ventes du mois » (somme des ventes du mois, canaux Comète) et la commission estimée suit ; en mode `encaissement`, rien ne change. Le bloc « À vérifier » ajoute, en mode `ventes`, les rendez-vous honorés des 14 derniers jours sans vente ni décision — un tap « Pas de vente » les sort de la liste (simple marqueur local d'affichage : `sale_amount_cents` reste nul, activité `sale.declined` pour mémoire).
- Marquer « annulé » ou « non venu » un rendez-vous porteur d'une vente : refusé avec message (« Retire d'abord la vente »), plutôt qu'une cascade silencieuse.

## Chantier 4 — Relevés et admin en mode `ventes`

- Réglage du mode dans l'admin (fiche client → Radar → Réglages), avec un garde-fou : le changement de mode est refusé s'il existe un relevé non payé (on ne change pas de règle du jeu en cours de partie) ; l'activité de réglage est journalisée.
- Clôture en mode `ventes` : les lignes du relevé sont les ventes du mois (nom jamais inclus — la ligne porte date du rendez-vous d'origine, séance, canal, date de vente, montant) plus, pour information, les rendez-vous honorés du mois sans vente (non comptés, raison « pas de vente déclarée »). Base = somme des ventes comptées, commission = taux × base, arrondi une fois comme aujourd'hui. Contestation, re-clôture, validation, paiement, CSV : inchangés.
- Entonnoir admin en mode `ventes` : visiteurs → clics → réservations → honorés → **ventes** (nombre et montant), coût par vente, commission, marge.
- `/admin/radar` : la colonne « commission en brouillon » suit le mode de chaque client.

## Chantier 5 — Recette et mise en ligne

1. `qa:radar` étendu : identité présente après webhook, absente du journal/activités/relevés/CSV ; `radar_set_sale` (droits du membre, verrou de relevé, rendez-vous annulé refusé, retrait) ; bascule de mode refusée avec un relevé ouvert ; clôture en mode `ventes` sur un mois mixte (ventes de rendez-vous d'août vendus en septembre) ; purge de l'identité à 6 et 13 mois sur lignes datées ; un client en `encaissement` (fixtures Jonathan) donne au centime près les mêmes relevés qu'avant la phase.
2. `npm run test`, build, lint, tous les bancs. Tag `v2.6-radar-ventes`.
3. Recette réelle : passer Peggy en mode `ventes` (taux posé, DPA signé), une réservation d'essai → le nom apparaît ; déclarer une vente de test, la retrouver au tableau de bord, la retirer ; puis son premier vrai cycle mensuel.

## Backlog (ne rien commencer sans « go »)

Plusieurs ventes par rendez-vous · paiements échelonnés et acomptes · vente rattachée à une personne sans rendez-vous · import de l'historique Calendly antérieur à la connexion · masquage du nom pour les rôles non-owner · statut « remboursé » · relance automatique « rendez-vous sans décision de vente » par email.
