/**
 * Tailles lisibles.
 *
 * En base 1000, comme les fabricants de disques et les systèmes que nos
 * clientes utilisent : « 1,8 Go » doit vouloir dire la même chose ici et dans
 * le Finder. Le calcul se fait côté serveur et voyage en texte, sinon le rendu
 * diverge entre le serveur et le navigateur.
 */
const UNITES = ["Ko", "Mo", "Go", "To"] as const;

export function tailleLisible(octets: number): string {
  if (!Number.isFinite(octets) || octets < 0) return "—";
  if (octets < 1000) return `${octets} octet${octets > 1 ? "s" : ""}`;

  let valeur = octets / 1000;
  let rang = 0;

  while (valeur >= 1000 && rang < UNITES.length - 1) {
    valeur /= 1000;
    rang += 1;
  }

  // Une décimale tant que le nombre est petit : « 1,8 Go » mais « 340 Mo ».
  const decimales = valeur < 10 ? 1 : 0;

  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} ${UNITES[rang]}`;
}

/** « 3 fichiers », « 1 fichier », « Aucun fichier ». */
export function compteFichiers(nombre: number): string {
  if (nombre === 0) return "Aucun fichier";
  return `${nombre} fichier${nombre > 1 ? "s" : ""}`;
}
