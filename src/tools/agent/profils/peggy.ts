import type { Profil } from "../profil.ts";

/**
 * Peggy Girault : le diagnostic offert de 45 minutes, sur Zoom.
 *
 * Les cinq modèles sont ceux que Louis a validés le 25/09/2026 (vault,
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

  // PROVISOIRE : pas encore passé par humaniseur-fr ni validé par Louis.
  textes: {
    stop: "C'est noté, je ne t'écris plus. Ton rendez-vous reste réservé : pour le déplacer ou l'annuler, le lien est dans ton mail de confirmation.",
  },

  modeles: {
    reservation: {
      corps:
        "Bonjour {{1}}, ici l'assistante de Peggy Girault. Je suis une IA, je m'occupe de ton rendez-vous jusqu'au jour J.\n" +
        "C'est réservé : ton diagnostic offert a lieu {{2}} à {{3}}, sur Zoom (45 minutes).\n" +
        "Le créneau te va bien ?\n" +
        "Si tu préfères parler à quelqu'un de l'équipe, dis-le-moi ici.",
      variables: ["prenom", "jour", "heure"],
      boutons: [
        { texte: "Oui, c'est bon", sens: "confirme" },
        { texte: "Je dois changer", sens: "changer" },
      ],
    },
    rappel: {
      corps:
        "Bonjour {{1}}, petit rappel pour ton diagnostic offert : {{2}} à {{3}}, sur Zoom.\n" +
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
        "Bonjour {{1}}, plus que quelques jours avant ton diagnostic offert : {{2}} à {{3}}, sur Zoom.\n" +
        "Une question pour le préparer : qu'est-ce que tu aimerais avoir compris à la fin des 45 minutes ?\n" +
        "Une phrase suffit, je la transmets avant ton rendez-vous.",
      variables: ["prenom", "jour", "heure"],
      // Pas de bouton, exprès : on veut sa réponse en mots.
      boutons: [],
    },
    veille: {
      corps:
        "Bonjour {{1}}, c'est demain ! Ton diagnostic offert a lieu {{2}} à {{3}}, sur Zoom.\n" +
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
        "Le lien Zoom pour ton diagnostic : {{3}}\n" +
        "À tout à l'heure.",
      variables: ["prenom", "heure", "lienVisio"],
      boutons: [
        { texte: "Je serai là", sens: "confirme" },
        { texte: "J'ai un empêchement", sens: "changer" },
      ],
    },
  },
};
