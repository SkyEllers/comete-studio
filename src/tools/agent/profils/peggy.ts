import type { Profil } from "../profil.ts";
import { articlesPeggy } from "./peggy-articles.ts";
import { consignesPeggy } from "./peggy-consignes.ts";

/**
 * Peggy Girault : le diagnostic offert de 45 minutes, en visio (Zoom tant
 * que Calendly réserve ; au choix de chacune avec l'outil de réservation).
 *
 * Les cinq modèles sont ceux que Louis a validés le 25/09/2026, « sur Zoom »
 * devenu « en visio » le 27/09 (vault,
 * `00-studio/pistes-comete/P12.md`), mot pour mot : c'est ce texte-là qui
 * sera soumis à Meta. Une virgule changée ici est un modèle à refaire valider.
 * Aucun ne nomme la personne qui recevra la cliente : la closeuse pourra
 * prendre des diagnostics.
 */
export const peggy: Profil = {
  cle: "peggy",
  marque: "Peggy Girault",
  pied: "Assistante IA de Peggy Girault",

  questions: {
    telephone: /t[ée]l[ée]phone|num[ée]ro|whatsapp/i,
    faconDeDecider: /fonctionne|d[ée]cides?\b/i,
  },

  faconsDeDecider: [
    { facon: "fonce", motif: /fonce/i },
    { facon: "analyse", motif: /analys/i },
    { facon: "pas_a_pas", motif: /pas\s*[àa]\s*pas|[ée]tape/i },
    { facon: "accompagnee", motif: /accompagn/i },
  ],

  dureeMinutes: 45,

  // Les six questions obligatoires du « RDV diagnostic offert 45 min », mot
  // pour mot (reprises de la démo closeuse du hub, commit 09c370a du
  // 25/09/2026). Les réponses sont des exemples que Louis modifie.
  formulaire: [
    { question: "Quel est ton numéro de téléphone ?", exemple: "06 00 00 00 00" },
    {
      question:
        "Qu'est-ce qui te pousse à vouloir perdre du poids aujourd'hui ? Et qu'as-tu déjà essayé qui n'a pas tenu ?",
      exemple: "Je n'arrive plus à perdre depuis ma ménopause. J'ai fait Weight Watchers deux fois.",
    },
    {
      question: "Quel est ton âge, ton poids actuel, et le poids que tu aimerais atteindre ?",
      exemple: "52 ans, 78 kg, 68 kg",
    },
    {
      question:
        "Quand tu décides de changer quelque chose dans ta vie, comment ça se passe en général ? Tu fonces, tu analyses tout avant, tu avances pas à pas, ou tu as besoin d'être accompagnée ?",
      exemple: "J'ai besoin d'être accompagnée",
    },
    { question: "Comment m'as-tu connue ?", exemple: "Facebook" },
    {
      question:
        "Pour préparer notre échange : quel budget mensuel pourrais-tu consacrer à ta santé aujourd'hui ?",
      exemple: "Entre 100 et 150 €/mois",
      choix: [
        "Moins de 100 €/mois",
        "Entre 100 et 150 €/mois",
        "Entre 150 et 250 €/mois",
        "Plus de 250 €/mois",
      ],
    },
  ],

  // PROVISOIRE : pas encore passés par humaniseur-fr ni validés par Louis.
  textes: {
    stop: "C'est noté, je ne t'écris plus. Ton rendez-vous reste réservé : pour le déplacer ou l'annuler, le lien est dans ton mail de confirmation.",
    detresse:
      "Ce que tu vis a l'air très lourd, et tu n'as pas à le porter seule. Tu peux appeler le 3114, jour et nuit, c'est gratuit : des professionnels sont là pour t'écouter. Si tu es en danger tout de suite, appelle le 15.",
    attente: "Je vérifie et je reviens vers toi très vite.",
    creneauPris: "Ce créneau vient d'être pris juste avant toi. Je regarde ce qui reste et je reviens vers toi très vite.",
    raisonAnnulation: "Rendez-vous déplacé à ta demande : ton nouveau créneau t'a été confirmé par mail.",
    // Validé par Louis le 28/09/2026, passé par humaniseur-fr.
    raisonAnnulationDemandee: "Annulé à ta demande, sur WhatsApp.",
  },

  consignes: consignesPeggy,
  catalogue: articlesPeggy,
  urlTarifs: "https://www.peggygirault.fr/tarifs/",
  urlReservation: "https://www.peggygirault.fr/rdv-diagnostic/",
  // Le premier message d'avant le 28/09/2026 (`diag_reservation`).
  boutonsAnciens: [{ texte: "Oui, c'est bon", sens: "confirme" }],

  modeles: {
    // Validé par Louis le 28/09/2026 (humaniseur-fr) : on ne lui demande plus de
    // confirmer un créneau qu'elle vient de choisir, on lance la préparation
    // (ce qu'elle attend du rendez-vous) ; la confirmation vient aux rappels.
    // Nouveau nom chez Meta : `diag_reservation` part jusqu'à sa validation.
    reservation: {
      nomMeta: "diag_reservation_v2",
      corps:
        "Bonjour {{1}}, ici l'assistante de Peggy Girault. Je suis une IA, je m'occupe de ton rendez-vous jusqu'au jour J.\n" +
        "C'est réservé : ton diagnostic offert a lieu {{2}} à {{3}}, en visio (45 minutes).\n" +
        "Pour qu'il te serve vraiment : qu'est-ce que tu aimerais avoir compris à la fin ?",
      variables: ["prenom", "jour", "heure"],
      // Sans bouton (Louis, 28/09/2026) : on attend sa réponse en mots.
      boutons: [],
    },
    rappel: {
      corps:
        "Bonjour {{1}}, petit rappel pour ton diagnostic offert : {{2}} à {{3}}, en visio.\n" +
        "Prévois 45 minutes au calme, avec ton téléphone ou ton ordinateur.\n" +
        "Le créneau tient toujours ?",
      variables: ["prenom", "jour", "heure"],
      boutons: [
        { texte: "Oui, ça tient", sens: "confirme" },
        { texte: "Je dois changer", sens: "changer" },
      ],
    },
    preparation: {
      corps:
        "Bonjour {{1}}, plus que quelques jours avant ton diagnostic offert : {{2}} à {{3}}, en visio.\n" +
        "Une question pour le préparer : qu'est-ce que tu aimerais avoir compris à la fin des 45 minutes ?\n" +
        "Une phrase suffit, je la transmets avant ton rendez-vous.",
      variables: ["prenom", "jour", "heure"],
      // Pas de bouton, exprès : on veut sa réponse en mots.
      boutons: [],
    },
    veille: {
      corps:
        "Bonjour {{1}}, c'est demain ! Ton diagnostic offert a lieu {{2}} à {{3}}, en visio.\n" +
        "Tu me confirmes que tu seras là ?\n" +
        "Un empêchement ? Dis-le-moi, je te trouve un autre créneau.",
      variables: ["prenom", "jour", "heure"],
      boutons: [
        { texte: "Je confirme", sens: "confirme" },
        { texte: "Je dois décaler", sens: "changer" },
      ],
    },
    matin: {
      corps:
        "Bonjour {{1}}, c'est aujourd'hui à {{2}} !\n" +
        "Voici le lien pour rejoindre la visio : {{3}}\n" +
        "À tout à l'heure.",
      variables: ["prenom", "heure", "lienVisio"],
      boutons: [
        { texte: "Je serai là", sens: "confirme" },
        { texte: "J'ai un empêchement", sens: "changer" },
      ],
    },
    // Entre deux rappels (rythme du 27/09/2026). Texte à valider par Louis
    // avant la soumission à Meta, en catégorie Marketing.
    contenu: {
      corps:
        "Bonjour {{1}}, en attendant ton diagnostic, voici un article de Peggy qui devrait te parler : {{2}}\n" +
        "{{3}}\n" +
        "Tu me dis ce que tu en penses ?",
      variables: ["prenom", "titreContenu", "lienContenu"],
      // Le moyen de ne plus recevoir, exigé pour un message commercial : un
      // bouton plutôt qu'une phrase (Louis, 27/09/2026). Lu comme un STOP.
      boutons: [{ texte: "Ne plus recevoir", sens: "stop" }],
      categorie: "MARKETING",
    },
  },
};
