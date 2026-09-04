# Brancher un client sur Radar

À suivre dans l'ordre, pour chaque nouveau client. Compter une heure la
première fois, vingt minutes ensuite. Les étapes 1 à 4 se font avec le client,
les étapes 5 à 8 seul.

Un point à garder en tête tout du long : **sans taguage des annonces, tout
arrive en « Direct »**. Le hub ne peut attribuer que ce que la campagne lui
envoie. L'étape 6 est donc la moitié du travail, et c'est celle qui se fait
hors de l'outil.

---

## 1. Le contrat

Avant tout le reste, parce que ça conditionne les réglages.

- [ ] Le **taux** de commission.
- [ ] La **fenêtre de récurrence** (90 jours par défaut) : une personne qui
      revient dans ce délai reste rattachée au canal qui l'avait amenée.
- [ ] La règle : **séance honorée et payée**. Ni les annulations, ni les
      non-venues, ni les séances gratuites n'entrent dans la base.
- [ ] Le **mois de la séance** fait foi, pas celui de la réservation.
- [ ] Une clause de **sous-traitance des données** : le hub traite des données
      de réservation pour le compte du client.

> Louis n'est pas juriste, Claude non plus : faire relire la clause de
> sous-traitance avant de la faire signer.

---

## 2. Le Calendly du client

- [ ] **Plan payant.** Les webhooks et l'encaissement l'exigent ; vérifier sur
      le plan du moment, Calendly bouge ses paliers.
- [ ] **Stripe relié** dans Calendly (Intégrations → Paiements).
- [ ] Chaque **type de séance payante porte son prix**. Sans prix, la séance
      arrive à 0 € et n'entre pas dans la commission.
- [ ] Les séances gratuites (appel découverte) sont laissées à 0 € : elles sont
      suivies, mais ne comptent pas. C'est voulu.

---

## 3. La question « Comment m'avez-vous connu ? »

Sur chaque type de séance, ajouter une question **obligatoire, à choix unique**.

Les réponses doivent reprendre **mot pour mot** les libellés attendus, sinon
elles ne se rattacheront à aucun canal :

| Réponse à proposer | Canal reconnu |
|---|---|
| `Google` | Google Ads |
| `Instagram ou Facebook` | Meta |
| `Recherche Google` | SEO |
| `Bouche à oreille` | Bouche à oreille |
| `Newsletter` | Newsletter |
| `Autre` | Autre |

Cette réponse est **affichée mais jamais utilisée pour attribuer**. Les gens se
souviennent mal d'où ils viennent, et une commission ne se fonde pas sur un
souvenir. Elle sert à repérer les écarts : quand Radar dit « Google Ads » et
que la personne dit « Bouche à oreille », la fiche le signale.

---

## 4. Le jeton d'accès

- [ ] Le client va dans **Calendly → Intégrations → API & Webhooks → Jeton
      d'accès personnel**, en crée un, et le transmet.
- [ ] **Par un canal sûr.** Pas de SMS, pas de message dans un fil de
      conversation qui traîne. Ce jeton ouvre son agenda.
- [ ] Une fois collé dans le hub, il vit dans le Vault de Supabase et n'en
      ressort jamais. Le client peut le révoquer depuis Calendly à tout moment
      — ce qui coupera Radar.

---

## 5. Dans le hub

- [ ] `/admin/clients` → créer le client s'il n'existe pas.
- [ ] Inviter le client comme membre.
- [ ] Sur sa fiche, **activer Radar**. Ses réglages et ses sept canaux se
      posent tout seuls à ce moment-là.
- [ ] Onglet **Radar** → régler le **taux**, la **fenêtre** et la **devise**
      selon le contrat.
- [ ] Coller le **jeton** et cliquer **Connecter**. Le hub vérifie le jeton,
      range ses trois secrets, et crée l'abonnement chez Calendly.
- [ ] Cliquer **Tester la connexion**. La réponse doit être « Abonnement actif,
      à la bonne adresse, sur les deux événements ».

> `NEXT_PUBLIC_SITE_URL` doit pointer sur le domaine de production : Calendly
> refuse les adresses qui ne sont pas en `https`. La connexion échouera avec un
> message explicite si ce n'est pas le cas.

---

## 6. Le taguage des annonces

**C'est l'étape que l'on oublie, et sans laquelle tout arrive en « Direct ».**

### Google Ads

Poser un **modèle de suivi au niveau du compte** (Paramètres → Suivi → Modèle
de suivi), une seule fois :

```
{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}
```

Il s'applique à toutes les annonces existantes et futures. Vérifier ensuite sur
une annonce que l'URL finale porte bien les paramètres.

### Meta (Facebook, Instagram)

Le taguage se fait **par annonce**, dans le champ « Paramètres d'URL » :

```
utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
```

Meta n'a pas d'équivalent au modèle de compte : **chaque nouvelle annonce doit
être taguée**. C'est la source d'erreur la plus fréquente.

### Ce que fait le script si l'on oublie

`radar.js` traduit un identifiant de clic seul en campagne : un `gclid` sans
UTM devient `utm_source=google&utm_medium=cpc`, un `fbclid` devient
`utm_source=facebook&utm_medium=paid`. C'est un filet, pas une solution : il
rattrape le canal, jamais la campagne ni l'annonce. **Taguer reste nécessaire
pour savoir *quelle* annonce a payé.**

Une campagne correctement taguée n'est jamais écrasée par ce filet.

---

## 7. Le script sur la landing

Ajouter cette ligne dans le `<head>` de la landing du client :

```html
<script src="https://cometestudio.fr/radar.js" defer></script>
```

- [ ] Le script est posé **avant** le script d'embarquement Calendly, ou juste
      après : il rattrape les widgets montés plus tard.
- [ ] **Aucun bandeau de consentement n'est nécessaire** : pas de cookie, pas
      de requête sortante, rien qui survive à la fermeture de l'onglet. Le
      script ne mémorise que les paramètres de campagne, en `sessionStorage`.
- [ ] Vérifier : ouvrir la landing avec `?utm_source=google&utm_medium=cpc`,
      cliquer sur le bouton de réservation, et regarder l'adresse de la page
      Calendly. Elle doit porter les deux paramètres.

---

## 8. La réservation de contrôle

- [ ] Depuis la landing, avec une adresse taguée, prendre un vrai rendez-vous —
      sur une séance à 0 €, ou remboursée ensuite.
- [ ] Dans les trente secondes, il apparaît dans `/admin/clients/…/radar` :
      bon canal, bon montant, statut « Confirmé ».
- [ ] L'annuler depuis Calendly. La ligne passe « Annulé » avec le motif.
- [ ] Regarder le **journal des webhooks** : deux lignes `accepted`.

### Ce qu'il faut lire dans le journal, la première fois

Les cinquante premiers appels acceptés notent **les noms des champs** que
Calendly envoie réellement dans `payload.tracking` et `payload.payment` —
jamais leurs valeurs.

C'est le moment de vérifier deux choses :

1. **`gclid` et `fbclid` apparaissent-ils dans `tracking` ?** La documentation
   de Calendly ne les liste pas. S'ils n'y sont pas, c'est le filet de
   `radar.js` (étape 6) qui fait tout le travail, et le taguage devient
   indispensable plutôt que recommandé.
2. **`payment` porte-t-il bien `amount`, `currency`, `successful` et
   `external_id` ?** Si un de ces champs manque ou change de nom, le montant
   arriverait à zéro sans que rien ne le signale.

---

## Après la mise en route

- **Le 1er du mois** : `/admin/radar` montre tous les clients d'un coup. Ce
  qu'il faut y regarder : les relevés à clôturer, ceux qui attendent une
  réponse, et surtout **un Calendly muet depuis plus de quatorze jours** —
  c'est la panne la plus coûteuse et la plus silencieuse de cet outil.
- **Clôturer**, puis laisser le client valider ou contester. S'il conteste,
  corriger les séances concernées et **re-clôturer** : son commentaire reste
  affiché pour qu'il vérifie que la correction porte bien dessus.
- **Marquer payé** une fois le virement reçu.
- Les **saisies mensuelles** (dépense, visiteurs, clics) alimentent l'entonnoir
  et la marge. Elles ne sortent jamais de l'administration.

## Ouvrir un export à un rapport externe

Un outil tenu ailleurs — un rapport Google Ads, un tableur, un tableau de bord
maison — peut lire les rendez-vous d'un client sans compte et sans session, par
une route en lecture seule.

**Créer le jeton.** Fiche client → onglet **Radar** → section **Exports** →
libellé (« Rapport Google Ads ») → *Créer un jeton*.

Le jeton **s'affiche une seule fois**. La base n'en garde que le SHA-256 : ni
Louis ni personne ne peut le relire ensuite. Perdu, il ne se retrouve pas — on
en crée un autre et on révoque l'ancien, ce qui prend dix secondes.

**Le transmettre.** Par un canal qui ne le laisse pas traîner : un gestionnaire
de mots de passe partagé, à défaut un message qu'on supprime. Jamais dans un
ticket, un dépôt Git, ni un fil de discussion qui sera relu dans six mois.

**Ce que le jeton ouvre**, et uniquement cela :

```
GET /api/export/radar/rendez-vous?depuis=AAAA-MM-JJ&jusqua=AAAA-MM-JJ
Authorization: Bearer <jeton>
```

- Un jeton = **une organisation**. Le périmètre se déduit du jeton, aucun
  paramètre d'URL ne peut l'élargir.
- **Aucune identité ne sort** : ni prénom, ni nom, ni `invitee_key`, ni note de
  vente. Ce qui sort est une liste fermée — dates, type de séance, canal,
  statut, montant de vente, et les quatre `utm_*` du rendez-vous — vérifiée par
  `npm run qa:export`, qui cherche les noms des lignes de recette dans le corps
  de la réponse.
- **Les UTM sortent à plat** : `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content`, à `null` quand la campagne n'était pas taguée. Ni `utm_term`,
  ni les identifiants de clic (`gclid`, `fbclid`), ni le reste de l'objet. La
  colonne qui les porte est libre — une campagne peut y coller ce qu'elle veut
  — et seuls ces quatre champs sont nommés dans la liste blanche. En servir un
  cinquième est un chantier, pas un réglage.
- **Lecture seule.** La route n'écrit qu'une chose : la date de dernière
  lecture du jeton, visible dans la même section.
- Plage obligatoire, **366 jours au maximum**, 500 lignes par page.

**Révoquer.** Même section, bouton *Révoquer*. Le rapport cesse de lire à
l'appel suivant. La ligne reste, datée : on sait qu'un jeton a existé et
jusqu'à quand il a servi.

**Ce que le consommateur doit savoir**, et qui est écrit dans chaque réponse :
les jours sont ceux du calendrier français (`Europe/Paris`), et **ce flux n'est
pas une archive**. Les rendez-vous sont supprimés treize mois après la clôture
du relevé qui les a facturés ; un rapport qui veut de l'historique long doit
recopier ce qu'il lit.

### Le compte-rendu type, à transmettre avec le jeton

À recopier tel quel dans le message qui accompagne le jeton, en remplaçant le
nom du client. Il dit ce que la machine d'en face ne peut pas deviner, et il
sera relu dans un an par quelqu'un qui n'était pas là au branchement. Le jeton,
lui, part par un autre canal.

---

**Export des rendez-vous — Radar (Comète Studio)**

Une requête, en lecture seule, sans compte ni session :

```
GET https://cometestudio.fr/api/export/radar/rendez-vous?depuis=2026-09-01&jusqua=2026-09-30
Authorization: Bearer <jeton>
```

La réponse est un JSON `{ "meta": …, "lignes": [ … ] }`. Une ligne, au complet :

```json
{
  "id": "9a2115f5-bab3-496e-9a46-aa27eda52db1",
  "event_uri": "https://api.calendly.com/scheduled_events/E",
  "invitee_uri": "https://api.calendly.com/scheduled_events/E/invitees/I",
  "scheduled_start": "2026-09-01T10:30:00+02:00",
  "scheduled_end": "2026-09-01T11:15:00+02:00",
  "canceled_at": null,
  "event_type_name": "Diagnostic offert",
  "channel": "google_ads",
  "channel_label": "Google Ads",
  "attribution": "utm",
  "rescheduled_from": null,
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "diagnostic-septembre",
  "utm_content": "annonce-b",
  "status": "confirme",
  "effective_status": "honore",
  "sale_amount_cents": 120000,
  "sale_date": "2026-09-03",
  "sale_recorded_at": "2026-09-03T10:12:00+02:00",
  "currency": "EUR",
  "updated_at": "2026-09-03T10:12:00+02:00"
}
```

Ces vingt-deux champs sont la liste complète. Il n'y en a pas d'autres, et rien ne
s'y ajoutera sans qu'on le dise.

- `id` est l'identifiant de la ligne, et le seul identifiant technique servi.
  Il ne bouge plus : c'est la clé de déduplication à employer, plutôt
  qu'`invitee_uri`, qui est une URL Calendly.
- `channel` est la clé stable du canal (`google_ads`, `meta`, `seo`, …),
  `channel_label` son libellé d'affichage, qui peut changer. **Regrouper sur la
  clé.**
- `attribution` dit *comment* le canal a été trouvé : `utm` (la landing portait
  le taguage), `recurrence` (la personne était déjà venue par un canal),
  `direct` ou `manuel`.
- `rescheduled_from` : une ligne reprogrammée pointe l'`id` de sa ligne
  d'origine, `null` sinon ; la granularité UTM se lit sur l'origine — une
  séance déplacée hérite du canal, pas du taguage. L'origine n'est dans la
  réponse que si elle tombe dans la plage demandée.
- Les quatre `utm_*` sont ceux du rendez-vous, à `null` quand la campagne
  n'était pas taguée. `utm_term` et les identifiants de clic (`gclid`,
  `fbclid`) ne sont **pas** servis : recouper par `utm_campaign` et
  `utm_content`.
- `status` est le statut déclaré, `effective_status` celui qui fait foi — une
  séance confirmée dont l'heure est passée compte comme `honore`. Valeurs
  possibles : `confirme`, `honore`, `annule`, `no_show`.
- `sale_amount_cents` est en **centimes**, dans la devise de `currency` ;
  `null` signifie qu'aucune vente n'a été déclarée. `sale_date` est le jour de
  la vente, `sale_recorded_at` l'instant où elle a été saisie.
- `depuis` et `jusqua` sont des jours du **calendrier français**
  (`Europe/Paris`), bornes comprises, obligatoires, **366 jours au maximum**.
  Les horodatages rendus sont en ISO 8601 avec leur décalage.
- **500 lignes par page.** S'il y a une suite, `meta.suivant` porte un curseur à
  repasser tel quel en `&curseur=…` ; la dernière page a `meta.suivant` à
  `null`. Ne pas fabriquer de curseur : seul celui qui est rendu est valide.
- **Aucune identité n'est servie** : ni nom, ni prénom, ni email, ni clé
  d'invité. Ce n'est pas un oubli, c'est la règle du flux.
- **Ce flux n'est pas une archive.** Les rendez-vous sont supprimés treize mois
  après la clôture du relevé qui les a facturés. Recopier ce qu'on lit.
- Codes de retour : `401` jeton absent, inconnu ou révoqué — sans motif, c'est
  volontaire ; `400` plage ou curseur fautif, avec le motif ; `429` trop
  d'appels ; `500` panne de notre côté, à rejouer.

---

## Débrancher un client

Onglet Radar → **Déconnecter**. L'abonnement est supprimé chez Calendly et les
trois secrets sont effacés. Si Calendly refuse la suppression — jeton déjà
révoqué, par exemple — les secrets sont effacés quand même et un avertissement
le dit : il faudra retirer l'abonnement à la main dans Calendly.

Les rendez-vous déjà reçus restent. Ils sont purgés automatiquement treize mois
après la clôture du relevé qui les a facturés ; les relevés, eux, sont
conservés.
