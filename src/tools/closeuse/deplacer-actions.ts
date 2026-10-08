"use server";

import { createHash, randomBytes } from "node:crypto";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, failFromZod, ok, type ActionResult } from "@/lib/actions";
import { getMembership } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { horlogeAgent, notifierSite, outilVersAgent } from "@/tools/agent/outil";
import { lienMonRdv } from "@/tools/agent/outil-regles";
import { lecteurOccupe } from "@/tools/reservation/agenda";
import { siteDuClient } from "@/tools/reservation/confier";
import { depotSupabase } from "@/tools/reservation/depot";
import { identifiants } from "@/tools/reservation/google";
import { suivreReport } from "@/tools/reservation/suites";

import { parisVersIso } from "./deplacer";

/**
 * La closeuse déplace un diagnostic avec la cliente au bout du fil (Louis,
 * 08/10/2026 : Flora, arrivée en retard, reportée au lendemain sans que rien
 * ne change dans l'outil). Même chemin que le report de la cliente ou de
 * l'assistante (`reservation_reporter`, puis agenda Google, Radar,
 * l'assistante, le mail « déplacé » du site), mais la closeuse choisit
 * l'heure **même hors de ses horaires**, comme « À prendre », tant que son
 * agenda Google est libre et qu'elle n'a pas déjà un rendez-vous.
 */

type Admin = ReturnType<typeof createAdminClient>;

const schema = z.object({
  bookingId: z.uuid({ error: "Rendez-vous introuvable." }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choisis le jour." }),
  heure: z.string().regex(/^\d{2}:\d{2}$/, { error: "Choisis l'heure." }),
});

const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");

async function personneDe(admin: Admin, org: string, userId: string) {
  const { data } = await admin
    .from("reservation_personnes")
    .select("id")
    .eq("organization_id", org)
    .eq("user_id", userId)
    .eq("role", "closeuse")
    .maybeSingle();
  return data?.id ?? null;
}

export async function deplacerUnRendezVous(
  orgSlug: string,
  input: unknown,
): Promise<ActionResult<{ debut: string; mailCliente: boolean }>> {
  const acces = await getMembership(orgSlug);
  if (!acces) return fail("Cet espace n'est plus accessible.");
  if (acces.role !== "closeuse") return fail("Seule la closeuse du rendez-vous peut le déplacer.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  const ids = identifiants();
  if (!ids) return fail("L'outil ne lit pas les agendas en ce moment : préviens Louis.");

  const debut = parisVersIso(parsed.data.date, parsed.data.heure);
  if (!debut) return fail("Cette date n'existe pas.");
  if (Date.parse(debut) < Date.now() + 15 * 60_000) return fail("Choisis un moment au moins 15 minutes plus tard.");

  const admin = createAdminClient();
  const org = acces.org.id;
  const [{ data: rdv }, personneId, { data: reglages }] = await Promise.all([
    admin
      .from("radar_bookings")
      .select("id, closeuse_id, status, organization_id")
      .eq("id", parsed.data.bookingId)
      .maybeSingle(),
    personneDe(admin, org, acces.userId),
    admin.from("reservation_reglages").select("duree_minutes, pause_minutes").eq("organization_id", org).maybeSingle(),
  ]);
  if (!rdv || rdv.organization_id !== org || rdv.closeuse_id !== acces.userId) return fail("Ce rendez-vous ne t'est pas confié.");
  if (rdv.status !== "confirme") return fail("Seul un rendez-vous confirmé se déplace.");
  if (!personneId) return fail("Relie d'abord ton agenda dans « Mon agenda ».");

  const { data: ancien } = await admin
    .from("reservation_rendez_vous")
    .select("id, personne_id, debut, fin, genre")
    .eq("radar_booking_id", rdv.id)
    .eq("statut", "confirme")
    .maybeSingle();
  if (!ancien) return fail("Ce rendez-vous n'est pas dans l'outil : il se déplace dans Calendly.");
  if (ancien.personne_id !== personneId) return fail("Ce rendez-vous n'est pas dans ton agenda.");

  // Libre ? Ses autres diagnostics (pause comprise), puis son agenda Google,
  // sans compter l'événement du rendez-vous qu'on déplace.
  const d = Date.parse(debut);
  const f = d + (reglages?.duree_minutes ?? 45) * 60_000;
  const bloque = new Date(f + (reglages?.pause_minutes ?? 15) * 60_000).toISOString();
  const { data: chevauche } = await admin
    .from("reservation_rendez_vous")
    .select("id")
    .eq("personne_id", personneId)
    .eq("statut", "confirme")
    .neq("id", ancien.id)
    .lt("debut", bloque)
    .gt("bloque_jusqu_a", debut)
    .limit(1);
  if (chevauche?.length) return fail("Tu as déjà un rendez-vous à ce moment-là.");
  try {
    const occupe = await lecteurOccupe(admin, ids)(personneId, d, f);
    const a = Date.parse(ancien.debut);
    const b = Date.parse(ancien.fin);
    if (occupe.some((o) => o.debut < f && o.fin > d && !(o.debut >= a && o.fin <= b))) {
      return fail("Ton agenda Google est occupé à ce moment-là.");
    }
  } catch {
    return fail("Ton agenda Google ne se lit pas : reconnecte-le dans « Mon agenda ».");
  }

  // Un nouveau lien personnel : il suit le rendez-vous dans la base et part
  // dans le mail « déplacé ».
  const jeton = randomBytes(32).toString("hex");
  const { error: eJeton } = await admin.from("reservation_rendez_vous").update({ jeton_hash: empreinte(jeton) }).eq("id", ancien.id);
  if (eJeton) return fail("Le rendez-vous n'a pas pu être déplacé.");

  const prise = await depotSupabase(admin).reporter(ancien.id, personneId, debut, "personne");
  if (!prise.ok) {
    if (prise.raison === "maximum") return fail("Tu as déjà ton maximum de rendez-vous ce jour-là.");
    if (prise.raison === "deja_pris") return fail("Tu as déjà un rendez-vous à ce moment-là.");
    return fail("Le rendez-vous n'a pas pu être déplacé.");
  }

  await suivreReport(admin, org, ancien.id, prise.id, ids, "personne");
  await outilVersAgent(admin, org, { type: "reporte", ancienId: ancien.id, rdvId: prise.id, jeton });
  after(() => horlogeAgent(admin));
  const mailCliente = await notifierSite(lienMonRdv(await siteDuClient(admin, org), jeton), "deplace");

  revalidatePath(`/app/${orgSlug}/closeuse`);
  return ok({ debut, mailCliente });
}
