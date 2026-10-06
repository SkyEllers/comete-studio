"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { preparerProfilTest, remettreLesDemos, simulerDevis } from "@/tools/closeuse/profil-test";

/** Le profil closeuse de test de Louis : réservé à l'admin. */

export async function preparerLeProfil(): Promise<ActionResult<{ invite: boolean }>> {
  await requireAdmin();
  const r = await preparerProfilTest();
  if ("erreur" in r) return fail(r.erreur);
  revalidatePath("/admin/closeuse");
  return ok({ invite: r.invite });
}

export async function remettreLesRendezVousDemo(): Promise<ActionResult<{ crees: number }>> {
  await requireAdmin();
  const r = await remettreLesDemos();
  if ("erreur" in r) return fail(r.erreur);
  revalidatePath("/admin/closeuse");
  return ok({ crees: r.crees });
}

const simulationSchema = z.object({
  devisId: z.uuid({ error: "Devis introuvable." }),
  geste: z.enum(["ouvrir", "signer", "payer"]),
});

/** Jouer à la place de la cliente un geste sur un devis de l'espace d'essai. */
export async function simulerLaCliente(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = simulationSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const r = await simulerDevis(parsed.data.devisId, parsed.data.geste);
  if ("erreur" in r) return fail(r.erreur);
  revalidatePath("/admin/closeuse");
  return ok();
}
