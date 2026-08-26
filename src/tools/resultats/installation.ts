import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { CANAUX_PAR_DEFAUT } from "./attribution";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Ce qu'un client reçoit quand Louis lui ouvre Radar.
 *
 * Des réglages et un jeu de canaux, posés à l'activation plutôt qu'à la
 * connexion Calendly : le premier webhook peut arriver dans la minute qui suit
 * la connexion, et un rendez-vous qui trouverait une table de canaux vide
 * partirait sans attribution — donc hors commission, en silence.
 *
 * Idempotent : réactiver l'outil ne réécrit ni le taux négocié ni les règles
 * que Louis a ajustées.
 */
export async function preparerRadar(admin: Admin, organizationId: string) {
  await admin
    .from("radar_settings")
    .upsert(
      { organization_id: organizationId },
      { onConflict: "organization_id", ignoreDuplicates: true },
    );

  const { data: existants } = await admin
    .from("radar_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1);

  if (existants && existants.length > 0) return;

  await admin.from("radar_channels").insert(
    CANAUX_PAR_DEFAUT.map((canal) => ({
      organization_id: organizationId,
      key: canal.key,
      label: canal.label,
      is_comete: canal.is_comete,
      rules: canal.rules,
      sort_order: canal.sort_order,
    })),
  );
}
