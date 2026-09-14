import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

// Extension explicite : le banc Radar importe ce module sous `node`, qui
// l'exige, pour éprouver la suppression d'un client par le même chemin que
// l'administration.
import { supprimerAbonnement } from "./calendly-api.ts";

type Admin = ReturnType<typeof createAdminClient>;

export type Desinstallation =
  | { ok: true; avertissement: string | null }
  | { ok: false; error: string };

/**
 * Ce que Radar laisse derrière un client, hors de ses tables.
 *
 * Le pendant de `preparerRadar`. Supprimer l'organisation emporte en cascade
 * tout ce qui porte son identifiant ; restent trois choses que la cascade ne
 * voit pas, et que ce module démonte avant que la ligne ne parte :
 *
 * 1. **L'abonnement chez Calendly.** Au meilleur effort, avec le jeton du
 *    client, et selon la règle de « Déconnecter » : s'il échoue, on continue et
 *    on le dit. Un client qu'on supprime ne doit pas rester indélébile parce
 *    que son jeton a été révoqué entre-temps.
 * 2. **Les trois secrets du Vault** — jeton, clé de signature, sel. Ceux-là ne
 *    se négocient pas : un sel orphelin permet de retrouver qui se cache
 *    derrière des clés d'invité. Si l'effacement échoue, ou s'il reste quoi
 *    que ce soit sous le préfixe du client, la suppression s'arrête.
 * 3. **Les jetons d'export.** La cascade les emporterait avec l'organisation ;
 *    ils partent ici, explicitement, pour qu'aucun rapport externe ne lise
 *    encore une seconde pendant le reste du ménage.
 *
 * L'ordre suit la dépendance : le jeton Calendly sert à désabonner, il ne
 * s'efface donc qu'après.
 */
export async function desinstallerRadar(
  admin: Admin,
  organizationId: string,
): Promise<Desinstallation> {
  const { data: reglages, error: illisible } = await admin
    .from("radar_settings")
    .select("calendly_webhook_uri")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (illisible) {
    return { ok: false, error: "La connexion Calendly de ce client est illisible. Le client n'a pas été supprimé." };
  }

  let avertissement: string | null = null;

  if (reglages?.calendly_webhook_uri) {
    const { data: jeton } = await admin.rpc("radar_get_secret", {
      org: organizationId,
      kind: "token",
    });

    if (jeton) {
      const retrait = await supprimerAbonnement(jeton, reglages.calendly_webhook_uri);
      if (!retrait.ok) {
        avertissement = `L'abonnement Calendly n'a pas pu être supprimé (${retrait.error}). Il continuera d'appeler une adresse qui ne répond plus ; supprime-le à la main.`;
      }
    }
  }

  const effacement = await admin.rpc("radar_clear_secrets", { org: organizationId });
  const restants = await admin.rpc("radar_secrets_restants", { org: organizationId });

  if (effacement.error || restants.error || restants.data !== 0) {
    return {
      ok: false,
      error: "Les secrets Radar de ce client n'ont pas pu être effacés du Vault. Le client n'a pas été supprimé.",
    };
  }

  const { error: jetons } = await admin
    .from("radar_export_tokens")
    .delete()
    .eq("organization_id", organizationId);

  if (jetons) {
    return {
      ok: false,
      error: "Les jetons d'export de ce client n'ont pas pu être supprimés. Le client n'a pas été supprimé.",
    };
  }

  return { ok: true, avertissement };
}
