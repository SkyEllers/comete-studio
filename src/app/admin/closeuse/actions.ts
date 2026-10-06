"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { preparerProfilTest, remettreLesDemos } from "@/tools/closeuse/profil-test";

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
