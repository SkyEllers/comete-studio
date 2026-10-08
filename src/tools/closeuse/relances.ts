/**
 * Les relances qu'une closeuse note sur un rendez-vous (0058, Louis,
 * 08/10/2026), et sa confirmation. Sans dépendance au serveur.
 */

export const ETAPES_RELANCE = [
  { cle: "veille", libelle: "Envoyé la veille", court: "la veille" },
  { cle: "jour", libelle: "Envoyé le jour même", court: "le jour même" },
  { cle: "trente", libelle: "Envoyé 30 min avant", court: "30 min avant" },
  { cle: "pendant", libelle: "Envoyé pendant le RDV", court: "pendant le RDV" },
  { cle: "confirme", libelle: "Elle a confirmé", court: "confirmé" },
] as const;

export type EtapeRelance = (typeof ETAPES_RELANCE)[number]["cle"];

/** Chaque étape cochée et quand (ISO). */
export type Relances = Partial<Record<EtapeRelance, string>>;

export const estEtape = (x: unknown): x is EtapeRelance => ETAPES_RELANCE.some((e) => e.cle === x);

/** « Relances : la veille, 30 min avant · confirmé », ou null s'il n'y a rien. */
export function resumeRelances(r: Relances | null | undefined): string | null {
  if (!r) return null;
  const envoyees = ETAPES_RELANCE.filter((e) => e.cle !== "confirme" && r[e.cle]).map((e) => e.court);
  const morceaux = [envoyees.length ? `Relances : ${envoyees.join(", ")}` : null, r.confirme ? "elle a confirmé" : null];
  const texte = morceaux.filter(Boolean).join(" · ");
  return texte ? texte.charAt(0).toUpperCase() + texte.slice(1) : null;
}
