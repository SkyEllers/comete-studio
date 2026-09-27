"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { accepter } from "@/tools/agent/accords";
import { FORMAT_JETON } from "@/tools/agent/accords-regles";

const schema = z.object({ jeton: z.string().regex(FORMAT_JETON) });

/**
 * Elle a cliqué « Oui ». Sans session : le jeton, personnel et tiré au
 * hasard, est la seule preuve de qui elle est ; la base n'en garde que
 * l'empreinte. Un jeton faux ou passé ne fait rien et ne dit rien.
 */
export async function donnerAccord(formData: FormData): Promise<void> {
  const lu = schema.safeParse({ jeton: formData.get("jeton") });
  if (!lu.success) redirect("/accord/invalide");
  const accord = await accepter(createAdminClient(), lu.data.jeton);
  redirect(accord ? `/accord/${lu.data.jeton}` : "/accord/invalide");
}
