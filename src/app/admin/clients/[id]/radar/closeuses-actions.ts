"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Les réglages des closeuses d'un client (0036), réservés à Louis.
 *
 * Toutes les écritures passent par le client admin, avec l'organisation dans
 * chaque filtre : un identifiant recopié d'un autre onglet ne touche jamais un
 * autre client.
 */

const organisation = z.uuid({ error: "Client introuvable." });

function rafraichir(organizationId: string) {
  revalidatePath(`/admin/clients/${organizationId}/radar`);
}

async function estCloseuse(organizationId: string, userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "closeuse";
}

const typeSchema = z.object({
  organizationId: organisation,
  filterId: z.uuid({ error: "Type de séance introuvable." }),
  closeuseId: z.uuid().nullable(),
});

/** Les réservations de ce type iront à cette closeuse (ou au client : null). */
export async function relierTypeACloseuse(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = typeSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, filterId, closeuseId } = parsed.data;

  if (closeuseId && !(await estCloseuse(organizationId, closeuseId))) {
    return fail("Cette personne n'est pas closeuse chez ce client.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("radar_event_filters")
    .update({ closeuse_id: closeuseId })
    .eq("id", filterId)
    .eq("organization_id", organizationId)
    .select("id");

  if (error) return fail("Impossible de relier ce type pour le moment.");
  if (!data?.length) return fail("Ce type de séance n'existe plus.");

  rafraichir(organizationId);
  return ok();
}

/**
 * Les rendez-vous déjà reçus de ce type, pas encore passés, vont à la
 * closeuse reliée. Le passé ne bouge pas : qui l'a tenu l'a tenu.
 */
export async function attribuerAVenirDuType(
  input: unknown,
): Promise<ActionResult<{ attribues: number }>> {
  await requireAdmin();
  const parsed = typeSchema.omit({ closeuseId: true }).safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, filterId } = parsed.data;

  const admin = createAdminClient();
  const { data: filtre } = await admin
    .from("radar_event_filters")
    .select("event_type_uri, closeuse_id")
    .eq("id", filterId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!filtre) return fail("Ce type de séance n'existe plus.");

  const { data, error } = await admin
    .from("radar_bookings")
    .update({ closeuse_id: filtre.closeuse_id, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("event_type_uri", filtre.event_type_uri)
    .gt("scheduled_start", new Date().toISOString())
    .select("id");

  if (error) return fail("Impossible d'attribuer ces rendez-vous pour le moment.");

  rafraichir(organizationId);
  return ok({ attribues: data?.length ?? 0 });
}

const grilleSchema = z.object({
  organizationId: organisation,
  userId: z.uuid(),
  taux: z.coerce.number().min(0).max(100),
  tauxPalier: z.coerce.number().min(0).max(100),
  palierApres: z.coerce.number().int().min(0).max(100),
});

export async function reglerGrille(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = grilleSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, userId, taux, tauxPalier, palierApres } = parsed.data;

  if (!(await estCloseuse(organizationId, userId))) {
    return fail("Cette personne n'est pas closeuse chez ce client.");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("radar_closeuses").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      taux,
      taux_palier: tauxPalier,
      palier_apres: palierApres,
    },
    { onConflict: "organization_id,user_id" },
  );

  if (error) return fail("Impossible d'enregistrer cette grille pour le moment.");
  rafraichir(organizationId);
  return ok();
}

const incidentSchema = z.object({
  organizationId: organisation,
  bookingId: z.uuid(),
  numero: z.coerce.number().int().min(1).max(24),
  type: z.enum(["impaye", "rembourse", "aucun"]),
});

/** Un paiement impayé ou remboursé ; « aucun » retire l'incident. */
export async function noterIncident(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = incidentSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const { organizationId, bookingId, numero, type } = parsed.data;

  const admin = createAdminClient();

  const { data: rdv } = await admin
    .from("radar_bookings")
    .select("id, sale_fois, closeuse_id")
    .eq("id", bookingId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!rdv?.closeuse_id) return fail("Cette vente n'est pas celle d'une closeuse.");
  if (numero > rdv.sale_fois) return fail("Cette vente n'a pas autant de paiements.");

  const { error } =
    type === "aucun"
      ? await admin
          .from("radar_encaissement_incidents")
          .delete()
          .eq("booking_id", bookingId)
          .eq("numero", numero)
      : await admin.from("radar_encaissement_incidents").upsert(
          { booking_id: bookingId, organization_id: organizationId, numero, type },
          { onConflict: "booking_id,numero" },
        );

  if (error) return fail("Impossible de noter ce paiement pour le moment.");
  rafraichir(organizationId);
  return ok();
}
