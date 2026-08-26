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

## Débrancher un client

Onglet Radar → **Déconnecter**. L'abonnement est supprimé chez Calendly et les
trois secrets sont effacés. Si Calendly refuse la suppression — jeton déjà
révoqué, par exemple — les secrets sont effacés quand même et un avertissement
le dit : il faudra retirer l'abonnement à la main dans Calendly.

Les rendez-vous déjà reçus restent. Ils sont purgés automatiquement treize mois
après la clôture du relevé qui les a facturés ; les relevés, eux, sont
conservés.
