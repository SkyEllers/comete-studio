import type { ProfilDevis } from "../regles.ts";

/**
 * Le devis de Peggy, repris mot pour mot de son modèle LibreOffice
 * (« Devis personnalisé », reçu le 28/09/2026), sauf :
 * - les cases à remplir (identité, durée, totaux), remplies par l'outil ;
 * - les modalités de paiement : le lien Stripe envoyé après la signature,
 *   carte d'abord, SEPA possible (Louis, 28/09/2026), au lieu du virement et
 *   de GoCardless ; le RIB de la dernière page n'a plus lieu d'être ;
 * - l'adresse postale de la procédure de rétractation, restée à remplir ;
 * - le formulaire type de rétractation, ajouté par l'outil (`regles.ts`).
 *
 * Les points relevés le 28/09 pour le juriste (« aucun remboursement » à côté
 * des 14 jours, rétractation par rendez-vous puis recommandé, frais
 * d'échelonnement, ancienne numérotation L121-21-5) ne sont PAS corrigés
 * ici : le texte reste celui de Peggy tant que le juriste n'a pas parlé.
 *
 * L'entreprise est la LLC tant que l'EURL n'est pas immatriculée ; à ce
 * moment, changer `vendeur` et `versionTexte`.
 */
export const devisPeggy: ProfilDevis = {
  slug: "peggy",
  site: "https://www.peggygirault.fr",
  titre: "Devis personnalisé",
  sousTitre: "Stratégie biologique et émotionnelle sur-mesure",
  enTete: "Devis personnalisé réalisé par Peggy Girault | Surpoids • Microbiote • Hypnose · 06 89 65 22 97 • www.peggygirault.fr",
  vendeur: {
    nom: "Shine Your Life LLC",
    identifiant: "EIN : 32-0812179",
    adresse: "4 rue Léon Fabre, 69100 Villeurbanne",
    telephone: "06 89 65 22 97",
    email: "girault.peggy@gmail.com",
    intervenants: [
      "Peggy Girault, thérapeute spécialisée surpoids féminin, microbiote et hypnose",
      "Laetitia Dupinet, coach motivation, activité physique adaptée et accompagnement au changement",
    ],
    signataire: "Peggy GIRAULT",
  },
  investigationCents: 50_000,
  // 170 €/mois, décidé par Louis le 06/10/2026 (150 jusque-là ; le kit des closeuses dit 170).
  mensualiteCents: 17_000,
  remiseUneFoisCents: 5_000,
  dureeParDefaut: 6,
  validiteJours: 7,
  versionTexte: "peggy-2026-09-28",

  avant: [
    {
      titre: "Objet de votre accompagnement personnalisé",
      paragraphes: [
        "Votre accompagnement personnalisé « Étincelle ta Vie »",
        "Cet accompagnement comprend 4 grandes phases.",
      ],
    },
    {
      titre: "1. Phase d'investigation : comprendre votre fonctionnement",
      paragraphes: [
        "Avant de proposer une stratégie, mon rôle est d'abord de comprendre pourquoi votre corps fonctionne aujourd'hui comme il fonctionne.",
        "Je ne travaille jamais à partir de suppositions. Mon rôle est de rassembler les différentes pièces du puzzle afin d'identifier les causes pouvant expliquer votre fatigue, vos ballonnements et les difficultés que vous rencontrez pour retrouver votre poids d'équilibre.",
        "Selon vos besoins, cette phase peut inclure :",
      ],
      puces: [
        "analyse du microbiote avec GniomCheck",
        "bilan OligoCheck",
        "questionnaires émotionnels",
        "analyse du rapport au corps",
        "exploration des croyances limitantes",
        "bilan neuromédiateurs et analyse de vos habitudes de vie",
        "autres outils pertinents selon votre situation comme test du stress, test d'addiction au sucre, bilan de potentiels …",
      ],
      apres: [
        "Les outils d'investigation sont sélectionnés exclusivement par la thérapeute selon les besoins identifiés lors du rendez-vous diagnostic et pourront évoluer au cours de l'accompagnement.",
      ],
    },
    {
      titre: "2. Phase de transformation : construire une stratégie sur mesure",
      paragraphes: [
        "À partir des éléments recueillis, nous construisons ensemble une stratégie personnalisée.",
        "Cette phase peut inclure :",
      ],
      puces: [
        "séances individuelles personnalisées : 1 rdv par mois avec Mme Girault ou Mme Dupinet",
        "Rdv en fonction des besoins : hypnose thérapeutique lorsque nécessaire",
        "stratégie nutritionnelle adaptée à votre terrain",
        "ajustements autour du microbiote, de l'énergie et de l'équilibre général",
        "accompagnement émotionnel, motivation",
      ],
      apres: [
        "Tout rdv non pris n'est pas reconductible. La cliente réserve elle-même ses rdv via l'agenda fourni et peut ainsi les déplacer si besoin. Voir paragraphe ci-dessous « Modalité de prise de rdv ».",
        "+ messages privés entre les rdv (réponses quotidiennes avec un délai pouvant aller de 24h à 72h pour recevoir une réponse suffisamment étoffée)",
        "Suivi régulier pour ajuster au fur et à mesure : suivi hebdomadaire tous les lundis par Laetitia.",
        "Accès aux ressources, aux ateliers collectifs et exercices proposés dans le cadre du programme.",
        "L'objectif n'est pas de vous faire entrer dans une méthode standard, mais d'adapter l'accompagnement à votre fonctionnement réel.",
      ],
    },
    {
      titre: "3. Phase de consolidation : stabiliser les résultats",
      paragraphes: [
        "Cette étape permet de consolider les changements mis en place, d'observer ce qui fonctionne pour vous, d'ajuster ce qui doit l'être et de vous aider à installer de nouvelles habitudes durables.",
        "Nous travaillons notamment sur :",
      ],
      puces: [
        "l'autonomie",
        "la relation au corps",
        "l'écoute des signaux corporels",
        "la stabilité émotionnelle",
        "la régularité sans pression",
        "la prévention des retours en arrière",
      ],
    },
    {
      titre: "4. Phase d'envol : retrouver confiance et autonomie",
      paragraphes: [
        "La dernière phase vise à vous permettre de continuer votre chemin avec davantage de confiance, de clarté et d'autonomie avec votre plan d'envol.",
        "L'objectif est que vous puissiez repartir avec une meilleure compréhension de votre corps, de vos besoins et de vos ressources.",
      ],
    },
  ],

  mensualiteComprend: [
    "1 rendez-vous individuel mensuel",
    "suivi hebdomadaire par Laetitia",
    "messagerie privée entre les RDV",
    "accès à votre dossier confidentiel et aux ressources dans l'application",
    "ateliers collectifs hebdomadaires",
    "ajustement de votre stratégie au fil de votre évolution",
  ],

  apres: [
    {
      titre: "Remarque importante",
      paragraphes: [
        "L'accompagnement est entièrement personnalisé.",
        "Les tests recommandés et la durée d'accompagnement sont déterminés en fonction des besoins spécifiques de chaque participante et peuvent évoluer au fil de la progression.",
      ],
    },
    {
      titre: "Engagement thérapeutique",
      paragraphes: [
        "L'atteinte de l'objectif va dépendre de l'engagement des 2 parties : 50% de la responsabilité de la part de Mme Girault et son équipe ainsi que 50% de la responsabilité de la part de la cliente sus-nommée. Le programme sera réussi si la participante s'engage dans le changement grâce à l'accompagnement de Mme Girault et de son équipe : chacun a sa part de responsabilité. Mme Girault et son équipe ont une obligation de moyens (voir contenu du programme ci-dessus) et l'accompagnée a une obligation de mise en œuvre : réserver ses rdv individuels, s'engager à être présente aux rendez-vous individuels prévus et à utiliser les ressources dans l'application, mettre en œuvre les conseils et à communiquer par écrit via le chat de l'application.",
        "Je m'engage à vous accompagner avec sérieux, bienveillance et respect de votre rythme.",
        "Mon rôle n'est pas de vous faire atteindre un chiffre à tout prix, mais de vous aider à retrouver un meilleur équilibre, dans le respect de votre santé et de votre corps.",
        "Si, au cours de l'accompagnement, je considère qu'un objectif de poids pourrait devenir défavorable à votre santé, je vous le dirai avec transparence.",
      ],
    },
    {
      titre: "Modalité de prise de rdv",
      paragraphes: [
        "La cliente réserve ses rdv via ces liens :",
        "Lien pour prendre rdv avec Peggy Girault : https://calendly.com/girault-peggy/rdv-individuel-pour-les-clientes-programme-etincelle",
        "Lien pour prendre rdv avec Laetitia Dupinet : https://calendly.com/laetitia-dupinet19/45min",
        "La signature vaut acceptation des 2 parties. Aucun remboursement n'est possible. Tout programme commencé est dû dans sa totalité. Les CGV sont approuvées par le présent contrat et consultables sur le site www.peggygirault.fr",
      ],
    },
    {
      titre: "Droit de rétractation",
      paragraphes: [
        "Conformément au Code de la consommation, vous disposez d'un délai de 14 jours à compter de la date de signature du devis pour exercer votre droit de rétractation.",
        "En cas de rétractation dans ce délai, le remboursement sera effectué dans un délai maximal de 14 jours suivant la réception de votre demande, déduction faite des prestations éventuellement exécutées avant la rétractation, conformément à l'article L121-21-5 du Code de la consommation :",
      ],
      puces: [
        "110 € par séance individuelle réalisée",
        "110 € par test déjà effectué",
        "200 € par kit d'analyse du microbiote déjà commandé",
        "20 € par atelier collectif suivi",
        "5 €/jour d'utilisation des services sur l'application Skool",
        "5,22 € de frais d'envoi du kit d'analyse microbiote (13,22 € pour la Suisse et la Belgique)",
        "ainsi que tout autre service déjà exécuté.",
      ],
    },
    {
      titre: "Procédure de rétractation",
      paragraphes: ["Pour exercer votre droit de rétractation, deux étapes sont nécessaires :"],
      puces: [
        "1. Prendre rendez-vous pour un entretien de rétractation (visioconférence ou téléphone) afin de valider votre demande, calculer le montant du remboursement et clôturer vos accès aux services.",
        "2. Confirmer votre demande par lettre recommandée avec accusé de réception, envoyée à l'adresse suivante : Peggy Girault, 4 rue Léon Fabre, 69100 Villeurbanne.",
      ],
      apres: ["La date de première demande (prise de rendez-vous) fera foi pour le respect du délai légal de 14 jours."],
    },
    {
      titre: "Rupture anticipée du contrat à l'initiative de la thérapeute",
      paragraphes: [
        "Sans préjudice du droit de rétractation prévu par la loi, la thérapeute et sa collaboratrice se réservent le droit de mettre fin unilatéralement au présent contrat, sans indemnité ni remboursement des sommes déjà versées, dans les cas où les conditions nécessaires au bon déroulement de la relation thérapeutique ne seraient plus réunies.",
        "Constituent notamment des motifs légitimes de rupture anticipée :",
      ],
      puces: [
        "tout comportement agressif, injurieux, diffamatoire ou irrespectueux à l'égard de la thérapeute, de sa collaboratrice ou d'un membre de l'équipe ;",
        "une opposition systématique, une contestation permanente ou un refus répété de suivre les recommandations formulées ;",
        "une absence manifeste d'engagement dans le processus de changement, rendant impossible la poursuite du travail thérapeutique ;",
        "tout acte ou propos portant atteinte à la réputation, à l'image ou à la sécurité morale de Mme Girault ou de Mme Dupinet.",
      ],
      apres: [
        "Dans ces circonstances, la thérapeute notifiera la rupture du contrat par écrit (courriel ou courrier recommandé), en précisant les motifs de cette décision. Les prestations déjà effectuées resteront intégralement dues et aucun remboursement ne pourra être exigé.",
        "Il est expressément rappelé qu'une relation thérapeutique repose sur la confiance mutuelle, le respect réciproque et la sérénité du dialogue, conditions indispensables à la réussite de l'accompagnement.",
      ],
    },
    {
      titre: "Clause : non-substitution à l'avis médical (valable Europe)",
      paragraphes: [
        "L'accompagnement proposé par Peggy Girault s'inscrit dans une démarche de bien-être, de prévention et d'hygiène de vie.",
        "Il ne constitue pas un acte médical et ne se substitue en aucun cas à un diagnostic, un traitement ou un suivi médical réalisé par un médecin ou tout autre professionnel de santé habilité, conformément aux législations en vigueur dans le pays de résidence de la cliente.",
        "La cliente est invitée à maintenir son suivi médical habituel et à consulter un professionnel de santé compétent pour toute question relevant du domaine médical.",
        "Les Parties déclarent et reconnaissent que les négociations ayant précédé la conclusion de ce devis ont été conduites de bonne foi, et avoir bénéficié, pendant ces négociations, de toutes les informations nécessaires et utiles pour leur permettre de s'engager en toute connaissance de cause, et s'être mutuellement communiqué toute information susceptible de déterminer leur consentement et qu'elles pouvaient légitimement ignorer.",
      ],
    },
  ],
};

/** Les profils de devis, par slug d'organisation. */
export const PROFILS_DEVIS: Record<string, ProfilDevis> = { peggy: devisPeggy };
