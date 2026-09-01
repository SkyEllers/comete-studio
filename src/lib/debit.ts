/**
 * L'amortisseur de débit des routes sans session.
 *
 * Il vivait dans `src/tools/sonde/collecte.ts`, où il est né avec le point de
 * collecte. La route d'export de Radar en veut le même, et un outil n'a pas à
 * dépendre d'un autre pour ça : il monte donc ici, où les deux le trouvent
 * sans se connaître. `collecte.ts` le réexporte, si bien que ni la route Sonde
 * ni son banc n'ont bougé.
 *
 * Ce que c'est, et ce que ce n'est pas : la fenêtre est glissante et vit dans
 * la mémoire de l'instance. Vercel en fait tourner plusieurs, et un même
 * appelant réparti sur trois instances obtient trois fois la limite. C'est
 * connu et accepté — le rôle de ce compteur est d'empêcher qu'une boucle mal
 * écrite fasse mille appels par minute, pas de résister à quelqu'un qui s'en
 * donne les moyens. Ce qui protège vraiment est ailleurs : un jeton public et
 * sans pouvoir côté Sonde, un jeton secret comparé en temps constant côté
 * export.
 *
 * L'horloge est injectable pour que le banc puisse dérouler une minute en
 * quelques microsecondes.
 */
export function creerLimiteur({
  fenetreMs = 60_000,
  maximum = 60,
  cles = 5_000,
  horloge = () => Date.now(),
}: {
  fenetreMs?: number;
  maximum?: number;
  cles?: number;
  horloge?: () => number;
} = {}) {
  const passages = new Map<string, number[]>();

  return function autorise(cle: string): boolean {
    const maintenant = horloge();
    const depuis = maintenant - fenetreMs;

    // Le garde-fou de mémoire : au-delà de quelques milliers de clés, on
    // repart de zéro plutôt que de grossir sans fin. Une instance Vercel qui
    // vit longtemps verrait sinon sa table enfler à chaque nouvel appelant.
    if (passages.size > cles) passages.clear();

    const recents = (passages.get(cle) ?? []).filter((instant) => instant > depuis);

    if (recents.length >= maximum) {
      passages.set(cle, recents);
      return false;
    }

    recents.push(maintenant);
    passages.set(cle, recents);
    return true;
  };
}
