import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** Le client système qui porte tout le non facturable. */
export const CLIENT_INTERNE = "Comète";

/**
 * Ce qu'une organisation reçoit quand Louis lui ouvre Pulsar.
 *
 * Deux lignes, posées à l'activation plutôt qu'au premier chronomètre : les
 * seuils d'alerte, et le client interne « Comète ». Sans ce dernier, le
 * premier geste de l'outil — démarrer sur « prospection » — n'aurait nulle
 * part où aller, et la vue Comète n'aurait rien à opposer au facturable.
 *
 * Idempotent : réactiver l'outil ne réécrit ni les seuils que Louis a ajustés,
 * ni le client interne, dont l'identité porte des heures déjà comptées.
 */
export async function preparerPulsar(admin: Admin, organizationId: string) {
  await admin
    .from("pulsar_settings")
    .upsert(
      { organization_id: organizationId },
      { onConflict: "organization_id", ignoreDuplicates: true },
    );

  const { data: interne } = await admin
    .from("pulsar_clients")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_internal", true)
    .limit(1);

  if (interne && interne.length > 0) return;

  /*
   * Son modèle et son montant ne veulent rien dire — il ne facture pas, et les
   * écrans l'écartent de l'encaissé avant même de les lire. On les laisse à
   * leur valeur par défaut plutôt que d'inventer une quatrième valeur d'enum
   * qui n'aurait de sens que pour cette seule ligne.
   */
  await admin.from("pulsar_clients").insert({
    organization_id: organizationId,
    name: CLIENT_INTERNE,
    is_internal: true,
  });
}
