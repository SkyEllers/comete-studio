import { bilanPossible } from "./format.ts";
import type { RendezVous } from "./queries";

/**
 * Le bloc « À vérifier » du tableau de bord : ce qui attend encore une réponse.
 *
 * Sorti de `queries.ts` pour se tester sans base. Ne fait que trier des lignes
 * déjà lues.
 */

type Ligne = Pick<
  RendezVous,
  "id" | "status" | "scheduled_start" | "has_sale" | "closeuse_id"
>;

/**
 * Les séances passées des sept derniers jours encore « confirmées ».
 *
 * Elles comptent comme honorées tant que personne ne dit le contraire, et
 * c'est justement pour ça qu'il faut les montrer plutôt que de les laisser
 * glisser dans la commission en silence.
 *
 * Dix minutes après le début, et non à la fin du créneau : quand personne ne
 * se présente, la réponse est connue tout de suite, et attendre la fin d'un
 * diagnostic de 45 minutes ne faisait que retarder le clic (voir
 * `bilanPossible`).
 */
export function aVerifier<L extends Ligne>(lignes: L[], maintenant = Date.now()): L[] {
  const ilYAUneSemaine = maintenant - 7 * 86_400_000;

  return lignes
    .filter(
      (ligne) =>
        ligne.status === "confirme" &&
        bilanPossible(ligne.scheduled_start, maintenant) &&
        Date.parse(ligne.scheduled_start) > ilYAUneSemaine,
    )
    .sort((a, b) => Date.parse(b.scheduled_start) - Date.parse(a.scheduled_start));
}

/**
 * Les séances honorées récentes dont on ne sait pas encore si elles ont vendu.
 *
 * Uniquement en mode `ventes`, où c'est la question qui décide de la
 * commission : une séance honorée sans réponse est un trou dans le relevé du
 * mois.
 *
 * Trente jours, et non quatorze. Chez Peggy, beaucoup de personnes ne disent
 * ni oui ni non en sortant du rendez-vous, et la décision tombe des semaines
 * plus tard (Louis, 22/09/2026). À quatorze jours, ces ventes-là se
 * concluaient après que la question avait disparu de l'écran : il fallait
 * retrouver la séance à la main, donc personne ne le faisait.
 *
 * « Sans décision » compte autant que « sans vente » : un « pas de vente » est
 * une réponse, et une réponse ne se redemande pas. Celle qui dit « je n'ai pas
 * encore de réponse » en est une aussi, et c'est le motif `pas_encore` qui la
 * porte, avec le mois où reposer la question.
 */
export function aVendre<L extends Ligne>(
  lignes: L[],
  refusees: Set<string>,
  maintenant = Date.now(),
): L[] {
  const ilYATrenteJours = maintenant - 30 * 86_400_000;

  return lignes
    .filter(
      (ligne) =>
        ligne.status === "confirme" &&
        !ligne.has_sale &&
        !refusees.has(ligne.id) &&
        bilanPossible(ligne.scheduled_start, maintenant) &&
        Date.parse(ligne.scheduled_start) > ilYATrenteJours,
    )
    .sort((a, b) => Date.parse(b.scheduled_start) - Date.parse(a.scheduled_start));
}

/**
 * La liste « À vérifier » telle qu'elle s'affiche.
 *
 * « Cette séance a-t-elle eu lieu ? » vaut dans les deux modes. « A-t-elle
 * vendu ? » ne vaut qu'en mode `ventes`, et sur une fenêtre plus large. Une
 * même séance peut relever des deux : elle apparaît une fois, avec les deux
 * boutons, plutôt que deux fois dans deux listes.
 *
 * En mode `ventes`, **une séance qui a sa réponse sort de la liste** (Louis,
 * 08/10/2026) : une vente, un « pas de vente » avec ou sans raison, un « en
 * attente » (les trois derniers écrivent `sale.declined`). Une vente dit aussi
 * que la séance a eu lieu. Avant, la ligne restait sept jours avec ses
 * boutons, et Peggy croyait que sa réponse n'avait pas été prise.
 *
 * Et **seulement les rendez-vous du client lui-même** : ceux d'une closeuse
 * (`closeuse_id`), c'est elle qui y répond, dans son espace (Louis,
 * 08/10/2026). Peggy les voyait mêlés aux siens, sans savoir à qui ils
 * étaient.
 */
export function aRegarder<L extends Ligne>(
  lignes: L[],
  refusees: Set<string>,
  surLesVentes: boolean,
  maintenant = Date.now(),
): L[] {
  const siens = lignes.filter((ligne) => ligne.closeuse_id === null);
  if (!surLesVentes) return aVerifier(siens, maintenant);

  const sansReponse = siens.filter((ligne) => !ligne.has_sale && !refusees.has(ligne.id));
  return [
    ...new Map(
      [...aVerifier(sansReponse, maintenant), ...aVendre(sansReponse, refusees, maintenant)].map(
        (rdv) => [rdv.id, rdv],
      ),
    ).values(),
  ].sort((a, b) => Date.parse(b.scheduled_start) - Date.parse(a.scheduled_start));
}
