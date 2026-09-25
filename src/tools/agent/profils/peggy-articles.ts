import type { Contenu } from "../profil.ts";

/**
 * Les articles du blog de Peggy que l'agent peut proposer, relevés le
 * 25/09/2026 sur `origin/main` de `peggygirault-site` (brouillons exclus).
 * Les 23 adresses répondaient 200 le même jour.
 *
 * Les recettes n'y sont pas : elles demandent l'email pour s'ouvrir, et un
 * lien direct tombe sur ce blocage (P12). À relever de nouveau quand le
 * pipeline publie : un nouvel article n'entre pas ici tout seul.
 */
export const articlesPeggy: Contenu[] = [
  {
    titre: "Pourquoi tu as pris du poids depuis que tu es épuisée",
    url: "https://www.peggygirault.fr/blog/prise-de-poids-epuisement/",
    theme: "burnout",
    resume: "Tu manges moins et tu prends quand même du poids depuis que tu es épuisée. Ce n'est pas dans ta tête : voilà la cascade biologique précise qui se déclenche sous cortisol chronique.",
  },
  {
    titre: "Arrêter le sucre pendant 7 jours : ce qui se passe vraiment, jour par jour",
    url: "https://www.peggygirault.fr/blog/arreter-le-sucre-7-jours/",
    theme: "sucre",
    resume: "Tu veux arrêter le sucre ? Voilà ce qui se passe biologiquement, jour par jour. Pas une détox. Pas un challenge. Une chronologie honnête de ce que ton corps va traverser.",
  },
  {
    titre: "Fringale de sucré quand tu es stressée : pourquoi ton cerveau réclame du sucre",
    url: "https://www.peggygirault.fr/blog/fringale-sucre-stress/",
    theme: "faim-emotionnelle",
    resume: "Tu craques sur le sucre dès que le stress monte ? Ce n'est pas un manque de volonté. Voilà la cascade neurochimique précise qui se déclenche — et ce que ça révèle vraiment.",
  },
  {
    titre: "Akkermansia, Christensenella, Faecalibacterium : les 3 bactéries qui décident de ton poids",
    url: "https://www.peggygirault.fr/blog/bacteries-microbiote-poids/",
    theme: "microbiote",
    resume: "Trois bactéries dans ton intestin expliquent une grande partie de ce qui se passe quand tu essaies de perdre du poids. Voilà laquelle te manque probablement, et pourquoi.",
  },
  {
    titre: "Microbiote et perte de poids : pourquoi les régimes ne marchent pas",
    url: "https://www.peggygirault.fr/blog/pourquoi-les-regimes-ne-marchent-pas/",
    theme: "microbiote",
    resume: "Tu as essayé tous les régimes sans résultat durable ? Ce n'est pas une question de volonté. Voilà la cascade biologique qui se déclenche dans ton corps — et ce qui marche vraiment.",
  },
  {
    titre: "Compulsions alimentaires : et si c'était ton cortisol, pas ta volonté ?",
    url: "https://www.peggygirault.fr/blog/cortisol-compulsions-alimentaires/",
    theme: "burnout",
    resume: "Si tu craques le soir devant le placard, ce n'est pas la volonté qui est en cause. C'est ton cortisol. Le mécanisme et les 3 leviers qui le font redescendre.",
  },
  {
    titre: "Pourquoi tu te sens mieux au bord de la mer (et ton microbiote avec)",
    url: "https://www.peggygirault.fr/blog/bord-de-mer-microbiote/",
    theme: "microbiote",
    resume: "Cette détente que tu ressens en arrivant à la mer n'est pas dans ta tête. Voilà le vrai mécanisme biologique, et ce que ça change pour ton microbiote.",
  },
  {
    titre: "Compulsion de gras : pourquoi tu craques sur le fromage le soir",
    url: "https://www.peggygirault.fr/blog/compulsion-gras-pourquoi-tu-craques-fromage/",
    theme: "faim-emotionnelle",
    resume: "Tu te retrouves devant le fromage ou la charcuterie en cachette le soir, après une journée intense ? Ce n'est pas une faiblesse. Voilà le mécanisme biologique et émotionnel précis qui se joue.",
  },
  {
    titre: "Fringale de sucre l'après-midi : pourquoi ton cerveau réclame à 16h",
    url: "https://www.peggygirault.fr/blog/fringale-sucre-apres-midi/",
    theme: "sucre",
    resume: "Cette envie de sucre qui tape tous les jours à la même heure n'est pas de la gourmandise. Voilà ce qui se passe dans ton sang et dans ton cerveau.",
  },
  {
    titre: "Manger devant Netflix : ce qui se rejoue dans le rituel du soir",
    url: "https://www.peggygirault.fr/blog/manger-devant-netflix-faim-emotionnelle/",
    theme: "faim-emotionnelle",
    resume: "Tu manges devant Netflix sans avoir faim, sans vraiment goûter ? Ce n'est pas un manque de discipline. Voilà ce que ton cerveau enregistre — et n'enregistre pas.",
  },
  {
    titre: "Périménopause et microbiote : ce qui change après 40 ans",
    url: "https://www.peggygirault.fr/blog/perimenopause-microbiote-apres-40-ans/",
    theme: "microbiote",
    resume: "Tu manges comme avant, tu vis comme avant, et pourtant ton corps a changé ? Ce n'est pas que tes hormones. C'est aussi ton microbiote, et les deux se nourrissent l'un l'autre.",
  },
  {
    titre: "Probiotiques en pharmacie : pourquoi ils ne marchent presque jamais",
    url: "https://www.peggygirault.fr/blog/probiotiques-pharmacie-pourquoi-ca-marche-pas/",
    theme: "microbiote",
    resume: "Tu as déjà acheté des probiotiques en pharmacie sans résultat clair ? Voilà ce que disent vraiment la science et la réglementation européenne, et ce qui ferait la différence.",
  },
  {
    titre: "Profil hormonal et envies de sucre : œstrogènes et fringales",
    url: "https://www.peggygirault.fr/blog/profil-hormonal-envies-sucre/",
    theme: "sucre",
    resume: "Tes envies de sucre suivent ton cycle ou ont changé depuis 45 ans ? Voilà comment lire le profil hormonal et les leviers adaptés à chaque phase.",
  },
  {
    titre: "Profil microbiote et dépendance au sucre : les signes à lire",
    url: "https://www.peggygirault.fr/blog/profil-microbiote-dependance-sucre/",
    theme: "sucre",
    resume: "Tes envies de sucre sont chroniques, sans pattern temporel, avec des troubles digestifs ? Voilà comment lire le profil microbiote et le restaurer.",
  },
  {
    titre: "Profil stress et compulsion sucrée : reconnaître et sortir",
    url: "https://www.peggygirault.fr/blog/profil-stress-compulsion-sucree/",
    theme: "sucre",
    resume: "Tu craques sur le sucre dès que la pression monte ? Voilà comment identifier le profil stress et les leviers concrets pour t'en sortir.",
  },
  {
    titre: "Le microbiote intestinal, c'est quoi exactement (et pourquoi ça te concerne)",
    url: "https://www.peggygirault.fr/blog/c-est-quoi-le-microbiote-intestinal/",
    theme: "microbiote",
    resume: "Tu entends ce mot partout sans vraiment savoir ce qu'il désigne ? Voilà ce qu'est ton microbiote, ce qu'il fait pour toi, et pourquoi il pèse sur ton poids et ton énergie.",
  },
  {
    titre: "Rééquilibrer son microbiote intestinal : le guide honnête",
    url: "https://www.peggygirault.fr/blog/reequilibrer-microbiote-intestinal/",
    theme: "microbiote",
    resume: "Tu veux rééquilibrer ton microbiote ? Voilà ce qui marche vraiment, ce qui relève du marketing, et pourquoi aucune cure générique ne tient sans connaître ton terrain.",
  },
  {
    titre: "Ventre gonflé en été : pourquoi ton microbiote décroche en août",
    url: "https://www.peggygirault.fr/blog/ventre-gonfle-ete-microbiote/",
    theme: "microbiote",
    resume: "Tu manges plus léger, tu bouges plus, et ton ventre gonfle quand même ? La chaleur, les vacances et ton microbiote y sont pour beaucoup. Voilà le mécanisme.",
  },
  {
    titre: "Photos de vacances et image corporelle : sortir de la comparaison",
    url: "https://www.peggygirault.fr/blog/photos-vacances-image-corporelle/",
    theme: "faim-emotionnelle",
    resume: "Tu regardes tes photos de vacances et tu décides de te restreindre. Voilà le mécanisme de comparaison qui se joue, et comment en sortir sans culpabiliser.",
  },
  {
    titre: "Manger pour combler un vide : ce que ton cerveau cherche",
    url: "https://www.peggygirault.fr/blog/manger-pour-combler-un-vide/",
    theme: "faim-emotionnelle",
    resume: "Manger pour combler un vide n'a rien à voir avec la volonté. Voilà ce que ton cerveau cherche réellement quand la faim n'est pas alimentaire.",
  },
  {
    titre: "Charge mentale de rentrée : ce qu'elle fait vraiment à ton corps",
    url: "https://www.peggygirault.fr/blog/charge-mentale-rentree-corps/",
    theme: "burnout",
    resume: "La charge mentale de rentrée n'est pas qu'une fatigue d'organisation. Voilà ce qu'elle fait vraiment à ton cortisol, à ton sommeil et à ton intestin.",
  },
  {
    titre: "Faim émotionnelle chez les femmes : pourquoi l'écart avec les hommes",
    url: "https://www.peggygirault.fr/blog/faim-emotionnelle-ecart-femmes-hommes/",
    theme: "faim-emotionnelle",
    resume: "Tu es plus touchée par la faim émotionnelle que les hommes. Voilà ce que disent les études, ce qu'elles ne disent pas, et par où tu peux commencer.",
  },
  {
    titre: "Écart de burnout femmes hommes : ce que disent deux enquêtes",
    url: "https://www.peggygirault.fr/blog/ecart-burnout-femmes-hommes/",
    theme: "burnout",
    resume: "Deux enquêtes récentes chiffrent l'écart de burnout entre femmes et hommes. Voilà ce que tu peux en retenir, et ce que ces données ne mesurent pas.",
  },
];
