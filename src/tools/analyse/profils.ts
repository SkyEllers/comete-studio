/**
 * Ce que l'analyse doit savoir d'un client pour lire ses diagnostics : son
 * offre, ses prix, ses règles, la méthode de son script. Sans profil, les
 * diagnostics de ce client ne sont pas analysés.
 *
 * Peggy (Étincelle ta vie) : repris du kit des closeuses du 07/10/2026
 * (« À lire en premier », script de Peggy, protocole R2) et des réponses de
 * Louis sur l'appel de Géraldine T. (07/10 : rétractation, mensualités). Un
 * prix qui change dans le kit change ici.
 */

export type ProfilAnalyse = {
  /** Le prénom de la titulaire, tel que les closeuses en parlent. */
  titulaire: string;
  contexte: string;
};

const PEGGY: ProfilAnalyse = {
  titulaire: "Peggy",
  contexte: `## Le client : Étincelle ta vie, de Peggy Girault

Peggy Girault est thérapeute, spécialisée dans le surpoids féminin, le microbiote et l'hypnose. Laetitia Dupinet, coach en motivation et amour de soi, suit les clientes chaque semaine et fait une partie des rendez-vous individuels. Louis Girault s'occupe du marketing, des outils et des closeuses.

Les rendez-vous analysés sont des « RDV diagnostic offerts » de 45 minutes en visio, tenus soit par une closeuse (une vendeuse indépendante, payée à la commission, qui n'est pas Peggy), soit par Peggy elle-même. La cliente a vu une publicité de Peggy, une courte vidéo, puis a réservé et répondu à un questionnaire (motivation, âge et poids, façon de changer, comment elle a connu Peggy, budget mensuel).

Les clientes : surtout des femmes de 35 à 65 ans qui veulent perdre du poids (parfois un homme). Elles ont presque toutes fait plusieurs régimes, perdu puis tout repris. Ménopause, fatigue, sucre, grignotage du soir, digestion reviennent souvent. Elles ont souvent été mal écoutées, n'achètent pas sur un coup de tête, ont parfois honte. Environ une vente pour cinq rendez-vous tenus venus de la pub.

## Ce que Louis a vérifié (09/10/2026)

- Peggy s'est formée à partir de 2019 et accompagne des clientes depuis 2020 (« Qui est Peggy ? »).
- Peggy n'est pas médecin et ne collabore pas avec des médecins. Quand c'est nécessaire, elle oriente la cliente vers son médecin.
- Une seule analyse passe par un laboratoire : celle du microbiote (GniomCheck), au laboratoire Physiosens (gamme de Physioquanta).
- L'OligoCheck n'est pas envoyé à un laboratoire : la mesure se fait chez un professionnel de santé près de chez la cliente, et c'est Peggy qui en fait l'analyse.

## L'offre et les prix (exacts : tout autre chiffre dit dans l'appel est une erreur)

L'accompagnement a quatre étapes : 1. Comprendre (l'investigation : des tests choisis par Peggy selon la personne, dont l'analyse du microbiote GniomCheck, le bilan OligoCheck — minéraux, vitamines, métaux lourds — et des questionnaires émotionnels, neuromédiateurs, stress, addiction au sucre, rapport au corps) ; 2. Transformer (un rendez-vous individuel par mois avec Peggy ou Laetitia, des messages privés entre les rendez-vous avec une réponse sous 24 à 72 h, un suivi chaque lundi par Laetitia, des ateliers collectifs chaque semaine, des ressources dans l'application) ; 3. Consolider ; 4. S'envoler (l'autonomie). Les clientes échangent sur une application communautaire, Skool (pas WhatsApp).

- L'investigation de départ : 500 €. Elle comprend plusieurs analyses et les questionnaires : ce n'est pas « 350 € d'analyse plus 150 € d'explication ».
- Puis l'accompagnement : 150 € par mois. Durée écrite dans le devis : 6, 9 ou 12 mois (1 400 €, 1 850 €, 2 300 € au total). 50 € de moins si elle paie tout en une fois.
- En plusieurs fois : le premier paiement couvre l'investigation et le premier mois (650 €), puis 150 € par mois. Les mensualités tombent le même jour chaque mois, celui de la signature (abonnement Stripe).
- L'investigation seule : 500 €, en une fois.
- Le bilan microbiote seul : 365 € en une fois, ou 2 × 190 € (15 € de frais). Kit et analyse au laboratoire, un rendez-vous de lancement de 15 minutes avec Peggy, un bilan écrit avec un plan d'actions en quatre parties, un rendez-vous de restitution de 45 minutes avec Peggy. Pas de suivi mensuel. Le site parle d'une « Analyse Microbiote Premium » à 350 € : c'est un écart connu, pas une faute de la closeuse si elle dit 350 €.
- Le devis porte « 110 € par séance réalisée » : c'est ce qui serait dû en cas de rétractation après des séances.
- Engagement : seulement les 14 jours de rétractation légale après la signature ; ensuite, la cliente est engagée pour la durée du devis. On ne peut pas « arrêter au bout de 6 mois » d'un devis de 9 ou 12 mois.
- La durée à proposer (Peggy, 09/10/2026, remplace « la durée la plus courte » du 07/10) : le programme est construit sur un an, donc la vendeuse propose d'abord 12 mois. 6 ou 9 mois seulement si la cliente ne peut pas payer 12 mois, ou si elle demande elle-même une durée plus courte. La durée ne se relie jamais à un nombre de kilos devant la cliente.
- Pour Peggy, une cliente qui suit tout perd en moyenne environ 2 kg par mois, selon son corps et sa motivation. C'est une information interne : dite à une cliente (« vous perdrez 2 kg par mois », « 5 kg en 3 mois »), c'est une promesse de kilos et de délai, donc une alerte sûre.
- Le paiement se fait juste après la signature du devis en ligne (lien Stripe, carte ou prélèvement SEPA). La vente est conclue au paiement ; Peggy fixe ensuite le premier rendez-vous.

## Les règles qu'on ne discute pas

- Jamais de diagnostic médical, jamais d'avis sur un traitement : l'accompagnement ne remplace pas un médecin.
- Jamais de promesse de kilos, de délai ou de guérison. Une promesse trop précise sur ce que « va donner » un test (« précisément ce qui vous manque », « les aliments précisément à éviter ») en est une aussi. « Si elle y arrive, je ne vois pas pourquoi vous n'y arriveriez pas » aussi. Citer un résultat de cliente (« elle a perdu 48 kg ») n'est permis que s'il est vrai et que la cliente est d'accord : à signaler pour vérification.
- Jamais la peur pour faire signer.
- Ne jamais dévaloriser ce qu'elle a essayé avant.
- Le rendez-vous n'est pas une consultation gratuite : pas de plan alimentaire, pas de compléments.
- Ne rien inventer : un prix, un délai, une procédure, un contenu de l'offre qu'elle ne connaît pas se note et se vérifie (« je vérifie avec Peggy »).

## La méthode du script de Peggy (ce que les repères mesurent)

Mission : comprendre profondément la femme en face, 80 % d'écoute et 20 % de parole. « Enfin quelqu'un comprend ce que je vis et ne me propose pas simplement un régime de plus. »

1. Créer la sécurité (2 à 3 minutes) : remercier, annoncer qu'on va parler d'elle, « mon objectif n'est pas de vous convaincre », « je vous dirai honnêtement si ce n'est pas adapté », « est-ce que cela vous convient ? ». Une closeuse dit qu'elle n'est pas Peggy et ce qu'elle fait.
2. Pourquoi maintenant : « Qu'est-ce qui vous a donné envie de prendre ce rendez-vous aujourd'hui ? », puis écouter, sans cours ni solution. Creuser jusqu'au vrai déclencheur (un événement, une phrase, un moment).
3. Ce qu'elle a déjà essayé, et pourquoi ça n'a pas tenu, sans juger.
4. La vraie demande : ce qu'elle veut retrouver (« si demain ces kilos avaient disparu, qu'est-ce que ça changerait ? »).
5. L'enjeu si rien ne change.
6. La grande reformulation, avec ses mots, et sa validation (« c'est bien ça ? »).
7 à 12. L'enquête en hypothèses (« je me demande si… », « c'est une piste que Peggy pourra vérifier »), le principe du détective, relier les explications à son histoire, présenter les outils d'investigation sans conférence sur le microbiote (montrer la rubrique « Gestion du poids » d'un exemple d'analyse), le pont entre le corps et l'émotionnel, arrêter de se battre contre son corps.
13-14. Présenter Étincelle ta vie, en moins de 5 minutes, chaque étape reliée à ce qu'elle a raconté.
15. Les objections : ne jamais répondre trop vite, questionner d'abord (« qu'est-ce qui vous inquiète exactement ? »). « C'est cher », « je dois réfléchir », « j'en parle à mon conjoint » (proposer un moment avec lui), « j'ai peur que ça ne marche pas », « je sais déjà ce qu'il faut faire ».
16. Présenter le devis : l'envoyer pendant l'appel, le lire ensemble en partage d'écran, calmement, sans se justifier.
17. La question de décision, puis le silence : ne jamais répondre à la place de la cliente.
Si oui : signature et paiement pendant l'appel. Si elle hésite : comprendre ce qui manque, une suite datée. Si non : respecter, demander ce qui fait que ce n'est pas le moment, noter la raison.

Le R2 avec Peggy : quand la cliente a besoin de réponses techniques précises (microbiote, analyses, parcours et formations de Peggy, laboratoires, limites avec le médecin) que la closeuse ne peut pas donner, et que la compétence de Peggy est le dernier élément qui manque. Une personne sceptique ou qui pose beaucoup de questions n'appelle pas automatiquement un R2. Avant de le proposer : « Si Peggy répond à toutes vos questions, existe-t-il réellement une possibilité d'avancer ensuite ? ». La closeuse transmet ses notes, dit que Peggy va rappeler ; la vente reste la sienne.

Le profil DISC (script V4 de Peggy) : adapter le style au profil de la cliente. D : questions courtes, rythme direct, peu d'explications, objectif et résultat. I : ton chaleureux, la laisser raconter, émotions et projection. S : sécurité, pas à pas, rassurer sur l'accompagnement. C : précision, méthode, ce qu'on mesure et ses limites, pas de discours émotionnel. Le script dit de ne jamais affirmer un profil avec certitude.

La question de clôture de Peggy, dans son script : « J'ai le sentiment que cette démarche correspond vraiment à ce que vous recherchiez. Est-ce aussi votre ressenti ? » Elle distingue l'intérêt pour l'investigation de l'intérêt pour le programme complet.

Ce que Peggy a relevé en analysant elle-même un appel (08/10/2026), à appliquer :
- Une cliente qui dit « ce n'est pas très concret » donne le signal d'arrêter le script et de montrer, dans l'ordre, ce qu'elle recevra, quand, et ce que Peggy en fera.
- Quand l'argent est le vrai frein, il faut proposer le bilan microbiote seul (365 €, ou deux fois 190 €) ou l'investigation seule (500 €), au lieu de s'arrêter sur le non. Le proposer, ce n'est pas pousser.
- La vendeuse clarifie son rôle sans se dévaloriser : pas de « je suis juste là, la professionnelle c'est Peggy ».
- Ne pas relier une douleur ou un symptôme au poids sans avis médical ; demander plutôt s'il a été exploré avec son médecin.
- Ne pas forcer la souffrance émotionnelle chez une cliente qui cherche de la précision : ça produit l'effet inverse.
- Un exemple de bilan montré pendant l'appel doit être anonymisé et autorisé.
- Les analyses (GniomCheck, OligoCheck) ne sont pas des dosages hormonaux et ne disent pas, à elles seules, la cause d'une prise de poids.
- Le script V4 est une trame, pas un texte à réciter : de longs passages appris font décrocher la cliente.

Ce que Peggy a relevé en analysant un autre appel (10/10/2026) :
- Quand le questionnaire annonce un petit budget (moins de 100 € par mois) ou une décision lointaine (« plutôt l'an prochain »), la vendeuse pose la question du budget avant la présentation, pas après : « Est-ce que vous préparez ce projet pour plus tard, ou est-ce que vous voulez aussi voir une première étape possible dès maintenant ? »
- Quand la cliente demande une porte d'entrée plus petite (« est-ce qu'on peut faire juste la phase 1 ? »), c'est une ouverture : demander pourquoi (avancer seule, ou limiter la dépense) avant de comparer les offres.
- La présentation tient en 5 minutes, reliée à ce qu'elle a dit : pas un inventaire des analyses et des étapes. Trop d'informations la laissent repartir satisfaite de l'information, sans décider.
- L'analyse du microbiote ne diagnostique ni intolérance ni allergie alimentaire : ça relève d'un avis médical. Des douleurs importantes ou un essoufflement appellent un avis médical, indépendamment des analyses.
- Ne jamais expliquer une absence de résultat par ce que la cliente ferait ou ne ferait pas : parler de la variabilité de chaque corps.
- Une préoccupation de la cliente (par exemple sur l'usage de l'intelligence artificielle) s'accueille et se questionne avant de s'expliquer, sans se défendre.
- Toujours finir par une décision claire ou une suite datée, même petite (« je peux revenir vers vous en janvier ? »).
- Rappel des prix : le bilan microbiote seul coûte 365 € en une fois, ou 2 × 190 € (15 € de frais). Dire les deux n'est pas une incohérence.

Les closeuses peuvent mener le rendez-vous à leur manière : seules les règles qu'on ne discute pas sont les mêmes pour tout le monde. Juge le résultat (la cliente s'est-elle sentie comprise, a-t-elle pu décider), pas la récitation du script.`,
};

const PROFILS: Record<string, ProfilAnalyse> = { peggy: PEGGY };

export function profilDuClient(slug: string | null | undefined): ProfilAnalyse | null {
  return slug ? (PROFILS[slug] ?? null) : null;
}

export const CLIENTS_ANALYSES = Object.keys(PROFILS);
