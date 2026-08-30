import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { compteIdees } from "./format";
import type { Compteur } from "./queries";

/**
 * Une place, et ce qu'elle contient.
 *
 * Composant serveur, et c'est ce qui décide de sa forme : une icône est une
 * fonction, et une fonction ne traverse pas la frontière vers un composant
 * client. Rendre la tuile ici et ne lui passer que son menu — déjà client —
 * en `action` évite d'avoir à choisir l'icône par un mot-clé qu'un `switch`
 * traduirait de l'autre côté.
 *
 * Le même carré sert aux boîtes, à Perso et à « À ranger » : ce sont trois
 * façons de ranger, pas trois objets différents, et l'écran gagne à les
 * montrer au même niveau. Seules les boîtes portent un menu — Perso et
 * « À ranger » ne se renomment pas et ne se suppriment pas, elles sont des
 * états, pas des tiroirs.
 */
export function Tuile({
  href,
  nom,
  compteur,
  icone: Icone,
  systeme,
  action,
}: {
  href: string;
  nom: string;
  compteur: Compteur;
  icone: LucideIcon;
  /** Une place qu'on ne peut ni renommer ni supprimer. */
  systeme?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="group border-line bg-surface-1 hover:bg-surface-2 relative rounded-lg border transition-colors">
      <Link
        href={href}
        prefetch
        className="focus-visible:ring-ring block p-4 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Icone
          aria-hidden="true"
          className={systeme ? "text-muted-foreground size-5" : "text-ember size-5"}
          strokeWidth={1.75}
        />
        <p className="font-display mt-3 truncate pr-8 font-semibold">{nom}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {compteIdees(compteur.notes)}
        </p>
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          {compteur.derniereLabel ? `Dernière ${compteur.derniereLabel}` : "—"}
        </p>
      </Link>

      {action ? <div className="absolute top-3 right-2">{action}</div> : null}
    </div>
  );
}
