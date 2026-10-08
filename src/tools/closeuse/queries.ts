import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getEnregistrements } from "@/tools/resultats/enregistrement";
import type { Enregistrement } from "@/tools/resultats/enregistrement-format";
import type { R2Vu } from "@/tools/r2/regles";

import type { EtapeRelance, Relances } from "./relances";
import { etatsParRendezVous, TYPES_NON_VENTE, type Raison } from "@/tools/resultats/non-vente";

import { calculer, type Grille, type Incident, type Vente } from "./commission";

/**
 * Ce que l'espace d'une closeuse lit. Tout passe par la session de qui
 * regarde : pour elle, la RLS de la 0036 ne laisse passer que ses rendez-vous ;
 * pour Louis, le filtre sur `closeuse_id` fait le même tri.
 */

export type RdvCloseuse = {
  id: string;
  prenom: string;
  debut: string;
  fin: string;
  statut: string;
  typeNom: string;
  vente: { montantCents: number; date: string; fois: number; premierCents: number | null } | null;
  declinee: boolean;
  raison: Raison | null;
  recontactFait: boolean;
  reponses: { q: string; r: string }[] | null;
  /** Où en est la cliente avec l'assistante (0041), ou null. */
  agentSuivi: string | null;
  /** Le R2 avec la titulaire, s'il est demandé (0054). */
  r2: R2Vu | null;
  /** La note qu'elle a écrite en notant « pas venue » (08/10/2026), ou null. */
  noteAbsence: string | null;
  /** Les relances qu'elle a cochées, et sa confirmation (0058). */
  relances: Relances;
};

export type EspaceCloseuse = {
  nom: string;
  grille: Grille;
  rdvs: RdvCloseuse[];
  commission: ReturnType<typeof calculer>;
  incidents: Incident[];
  /** L'enregistrement de chaque diagnostic tenu, ou son résumé écrit (0049). */
  enregistrements: Record<string, Enregistrement>;
};

export const GRILLE_PAR_DEFAUT: Grille = { taux: 15, tauxPalier: 18, palierApres: 5 };

export async function getEspaceCloseuse(
  organizationId: string,
  closeuseId: string,
  aujourdhui: string,
): Promise<EspaceCloseuse> {
  const supabase = await createClient();

  const [{ data: profil }, { data: reglage }, { data: lignes }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", closeuseId).maybeSingle(),
    supabase
      .from("radar_closeuses")
      .select("taux, taux_palier, palier_apres")
      .eq("organization_id", organizationId)
      .eq("user_id", closeuseId)
      .maybeSingle(),
    supabase
      .from("radar_bookings_effective")
      .select(
        "id, invitee_display, scheduled_start, scheduled_end, effective_status, event_type_name, sale_amount_cents, sale_date, sale_fois",
      )
      .eq("organization_id", organizationId)
      .eq("closeuse_id", closeuseId)
      .order("scheduled_start", { ascending: true }),
  ]);

  const ids = (lignes ?? []).map((l) => l.id).filter((id): id is string => Boolean(id));

  const [{ data: premiers }, { data: activites }, { data: reponses }, { data: incidents }, enregistrements] =
    ids.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, {}]
      : await Promise.all([
          supabase.from("radar_bookings").select("id, sale_premier_cents, agent_suivi, status_note, status_origin").in("id", ids),
          supabase
            .from("radar_booking_activities")
            .select("booking_id, type, payload, created_at")
            .in("booking_id", ids)
            .in("type", ["sale.declined", ...TYPES_NON_VENTE]),
          supabase.from("radar_booking_answers").select("booking_id, answers").in("booking_id", ids),
          supabase
            .from("radar_encaissement_incidents")
            .select("booking_id, numero, type")
            .in("booking_id", ids),
          getEnregistrements(ids),
        ]);

  // 0054 : pas encore dans les types générés. Lu avec la session (RLS).
  const { data: r2s } = ids.length
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("radar_r2")
        .select("booking_id, demandee_le, resultat, appelee_le, note_titulaire")
        .in("booking_id", ids)
    : { data: [] };
  const r2Par = new Map<string, R2Vu>(
    ((r2s ?? []) as { booking_id: string; demandee_le: string; resultat: R2Vu["resultat"]; appelee_le: string | null; note_titulaire: string | null }[]).map(
      (r) => [r.booking_id, { demandeeLe: r.demandee_le, resultat: r.resultat, appeleeLe: r.appelee_le, noteTitulaire: r.note_titulaire }],
    ),
  );

  // 0058 : pas encore dans les types générés. Lu avec la session (RLS).
  const { data: relancesLues } = ids.length
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("radar_relances").select("booking_id, etape, coche_le").in("booking_id", ids)
    : { data: [] };
  const relancesPar = new Map<string, Relances>();
  for (const l of (relancesLues ?? []) as { booking_id: string; etape: EtapeRelance; coche_le: string }[]) {
    relancesPar.set(l.booking_id, { ...(relancesPar.get(l.booking_id) ?? {}), [l.etape]: l.coche_le });
  }

  const premierPar = new Map((premiers ?? []).map((p) => [p.id, p.sale_premier_cents]));
  // Seulement une note écrite par la closeuse (origine « client ») : les notes
  // posées par Calendly ou l'outil (« Annulée par la personne ») n'en sont pas.
  const noteAbsencePar = new Map(
    (premiers ?? []).map((p) => [p.id, p.status_origin === "client" ? (p.status_note ?? null) : null]),
  );
  const suiviPar = new Map((premiers ?? []).map((p) => [p.id, p.agent_suivi]));
  const reponsesPar = new Map(
    (reponses ?? []).map((r) => [r.booking_id, r.answers as { q: string; r: string }[]]),
  );
  const declinees = new Set(
    (activites ?? []).filter((a) => a.type === "sale.declined").map((a) => a.booking_id),
  );
  const etats = etatsParRendezVous(
    (activites ?? []).filter((a) => a.type !== "sale.declined"),
  );

  const rdvs: RdvCloseuse[] = (lignes ?? [])
    .filter((l) => l.id && l.scheduled_start && l.scheduled_end)
    .map((l) => {
      const id = l.id as string;
      return {
        id,
        prenom: l.invitee_display ?? "Invitée",
        debut: l.scheduled_start as string,
        fin: l.scheduled_end as string,
        statut: l.effective_status ?? "confirme",
        typeNom: l.event_type_name ?? "",
        vente:
          l.sale_amount_cents != null && l.sale_date
            ? {
                montantCents: l.sale_amount_cents,
                date: l.sale_date,
                fois: l.sale_fois ?? 1,
                premierCents: premierPar.get(id) ?? null,
              }
            : null,
        declinee: declinees.has(id),
        raison: etats[id]?.raison ?? null,
        recontactFait: etats[id]?.fait ?? false,
        reponses: reponsesPar.get(id) ?? null,
        agentSuivi: suiviPar.get(id) ?? null,
        noteAbsence: l.effective_status === "no_show" ? (noteAbsencePar.get(id) ?? null) : null,
        relances: relancesPar.get(id) ?? {},
        r2: r2Par.get(id) ?? null,
      };
    });

  const grille: Grille = reglage
    ? { taux: Number(reglage.taux), tauxPalier: Number(reglage.taux_palier), palierApres: reglage.palier_apres }
    : GRILLE_PAR_DEFAUT;

  const ventes: Vente[] = rdvs
    .filter((r) => r.vente && r.statut !== "annule" && r.statut !== "no_show")
    .map((r) => ({
      bookingId: r.id,
      prenom: r.prenom,
      rendezVous: r.debut,
      dateVente: r.vente!.date,
      montantCents: r.vente!.montantCents,
      fois: r.vente!.fois,
      premierCents: r.vente!.premierCents,
    }));

  const listeIncidents: Incident[] = (incidents ?? []).map((i) => ({
    bookingId: i.booking_id,
    numero: i.numero,
    type: i.type as Incident["type"],
  }));

  return {
    nom: profil?.full_name ?? "",
    grille,
    rdvs,
    commission: calculer(ventes, listeIncidents, grille, aujourdhui),
    incidents: listeIncidents,
    enregistrements,
  };
}
