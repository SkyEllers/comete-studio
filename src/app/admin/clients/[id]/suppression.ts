import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

// Chemin relatif et extension explicite : le banc Radar importe ce module sous
// `node`, sans les alias du bundler, pour supprimer un client de test par le
// chemin exact de l'administration.
import { desinstallerRadar } from "../../../../tools/resultats/desinstallation.ts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Supprimer un client, et tout ce que la cascade ne voit pas.
 *
 * La base emporte d'elle-même ce qui porte l'identifiant de l'organisation :
 * appartenances, outils, rendez-vous, cartes, notes. Deux endroits lui
 * échappent, et sont vidés d'abord :
 *
 * - le **Storage**, où les fichiers d'un client resteraient pour toujours —
 *   invisibles, puisque la RLS s'appuie sur une organisation qui n'existe plus,
 *   mais bien présents et bien facturés ;
 * - **ce que Radar a posé ailleurs** : l'abonnement chez Calendly, les secrets
 *   du Vault, les jetons d'export (voir `desinstallerRadar`).
 *
 * La ligne du client part en dernier. Tant qu'elle existe, un ménage qui a
 * échoué se recommence ; dans l'autre sens, plus rien ne relierait les restes à
 * qui que ce soit.
 *
 * Seul l'abonnement Calendly est au meilleur effort : son échec n'arrête rien
 * et remonte en avertissement.
 */

const BUCKET = "fichiers";
const PAGE = 1000;

/** On pagine : un client peut avoir plus de fichiers qu'une page de liste. */
async function viderStockage(admin: Admin, organizationId: string): Promise<boolean> {
  for (;;) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(organizationId, { limit: PAGE });

    if (error) return false;

    // `id` nul = un préfixe, pas un objet. Notre rangement est plat, mais
    // mieux vaut ne pas tenter d'effacer ce qui n'est pas un fichier.
    const chemins = (data ?? [])
      .filter((objet) => objet.id !== null)
      .map((objet) => `${organizationId}/${objet.name}`);

    if (chemins.length === 0) return true;

    const { error: erreurSuppression } = await admin.storage.from(BUCKET).remove(chemins);

    if (erreurSuppression) return false;
    if ((data ?? []).length < PAGE) return true;
  }
}

export type Suppression =
  | { ok: true; avertissement: string | null }
  | { ok: false; error: string };

export async function supprimerOrganisation(
  admin: Admin,
  organizationId: string,
): Promise<Suppression> {
  if (!(await viderStockage(admin, organizationId))) {
    return { ok: false, error: "Impossible de supprimer les fichiers de ce client. Rien n'a été supprimé." };
  }

  const radar = await desinstallerRadar(admin, organizationId);
  if (!radar.ok) return radar;

  // Les appartenances, les outils activés et les données des outils partent
  // en cascade (migrations 0001 et suivantes).
  const { error } = await admin.from("organizations").delete().eq("id", organizationId);

  if (error) return { ok: false, error: "Impossible de supprimer ce client pour le moment." };

  return { ok: true, avertissement: radar.avertissement };
}
