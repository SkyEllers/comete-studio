import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import type {
  Auteur,
  Depot,
  Diagnostic,
  DonneesReservation,
  Echec,
  PersonneLue,
  Prise,
  ReglagesLus,
  StatsRadar,
} from "./moteur.ts";

/**
 * Le dépôt du moteur sur la base du hub, avec la clé de service : la page de
 * réservation et le setter n'ont pas de session. Chaque lecture filtre par
 * client ; les écritures passent par les fonctions de la 0042, qui revérifient
 * sous verrou.
 */

type Admin = ReturnType<typeof createAdminClient>;

const hhmm = (t: string) => t.slice(0, 5);

/** Les refus de la base, lus par leur mot-clé ou leur code. */
export function lireRefus(erreur: { code?: string; message?: string }): Echec {
  const m = erreur.message ?? "";
  if (erreur.code === "23P01") return "deja_pris";
  if (m.includes("maximum_atteint")) return "maximum";
  if (m.includes("personne_indisponible")) return "indisponible";
  if (m.includes("creneau_passe")) return "passe";
  if (m.includes("rendez_vous_introuvable")) return "introuvable";
  return "erreur";
}

function prise(data: string | null, error: { code?: string; message?: string } | null): Prise {
  if (error) return { ok: false, raison: lireRefus(error), message: error.message };
  if (!data) return { ok: false, raison: "erreur", message: "aucun identifiant rendu" };
  return { ok: true, id: data };
}

export function depotSupabase(db: Admin): Depot {
  return {
    async reglages(org): Promise<ReglagesLus | null> {
      const { data, error } = await db
        .from("reservation_reglages")
        .select("*")
        .eq("organization_id", org)
        .maybeSingle();
      if (error) throw new Error(`réglages : ${error.message}`);
      if (!data) return null;
      return {
        actif: data.actif,
        dureeMinutes: data.duree_minutes,
        pauseMinutes: data.pause_minutes,
        pasMinutes: data.pas_minutes,
        preavisMinutes: data.preavis_minutes,
        fenetreJours: data.fenetre_jours,
        fenetrePasJours: data.fenetre_pas_jours,
        fenetreMaxJours: data.fenetre_max_jours,
        fuseau: data.fuseau,
        seuilDebutante: data.seuil_debutante,
        periodeTauxJours: data.periode_taux_jours,
      };
    },

    async personnes(org): Promise<PersonneLue[]> {
      const [personnes, horaires, absences] = await Promise.all([
        db
          .from("reservation_personnes")
          .select("id, user_id, role, fuseau, max_par_jour, google_connecte_le, google_agenda")
          .eq("organization_id", org)
          .eq("actif", true),
        db.from("reservation_horaires").select("personne_id, jour, debut, fin").eq("organization_id", org),
        db.from("reservation_absences").select("personne_id, du, au").eq("organization_id", org),
      ]);
      for (const r of [personnes, horaires, absences]) {
        if (r.error) throw new Error(`personnes : ${r.error.message}`);
      }

      return (personnes.data ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        role: p.role === "titulaire" ? "titulaire" : "closeuse",
        fuseau: p.fuseau,
        maxParJour: p.max_par_jour,
        agendaConnecte: p.google_connecte_le !== null,
        googleAgenda: p.google_agenda,
        plages: (horaires.data ?? [])
          .filter((h) => h.personne_id === p.id)
          .map((h) => ({ jour: h.jour, debut: hhmm(h.debut), fin: hhmm(h.fin) })),
        absences: (absences.data ?? [])
          .filter((a) => a.personne_id === p.id)
          .map((a) => ({ du: a.du, au: a.au })),
      }));
    },

    async diagnostics(org, de, a): Promise<Diagnostic[]> {
      const { data, error } = await db
        .from("reservation_rendez_vous")
        .select("id, personne_id, debut, fin")
        .eq("organization_id", org)
        .eq("statut", "confirme")
        .lt("debut", new Date(a).toISOString())
        .gt("fin", new Date(de).toISOString());
      if (error) throw new Error(`diagnostics : ${error.message}`);
      return (data ?? []).map((d) => ({
        id: d.id,
        personneId: d.personne_id,
        debut: Date.parse(d.debut),
        fin: Date.parse(d.fin),
      }));
    },

    async rendezVous(org, id): Promise<Diagnostic | null> {
      const { data, error } = await db
        .from("reservation_rendez_vous")
        .select("id, personne_id, debut, fin")
        .eq("organization_id", org)
        .eq("id", id)
        .eq("statut", "confirme")
        .maybeSingle();
      if (error) throw new Error(`rendez-vous : ${error.message}`);
      return data
        ? { id: data.id, personneId: data.personne_id, debut: Date.parse(data.debut), fin: Date.parse(data.fin) }
        : null;
    },

    /*
     * Radar attribue un rendez-vous à une closeuse par `closeuse_id` (0036).
     * Honoré : la séance a eu lieu. Vente : une vente est déclarée dessus.
     */
    async stats(org, userIds, depuis): Promise<Map<string, StatsRadar>> {
      const resultat = new Map<string, StatsRadar>();
      if (userIds.length === 0) return resultat;

      const { data, error } = await db
        .from("radar_bookings_effective")
        .select("closeuse_id, scheduled_start, has_sale")
        .eq("organization_id", org)
        .eq("effective_status", "honore")
        .in("closeuse_id", userIds);
      if (error) throw new Error(`stats Radar : ${error.message}`);

      for (const id of userIds) resultat.set(id, { honoresTotal: 0, honoresPeriode: 0, ventesPeriode: 0 });
      for (const l of data ?? []) {
        if (!l.closeuse_id || !l.scheduled_start) continue;
        const s = resultat.get(l.closeuse_id);
        if (!s) continue;
        s.honoresTotal += 1;
        if (Date.parse(l.scheduled_start) >= depuis) {
          s.honoresPeriode += 1;
          if (l.has_sale) s.ventesPeriode += 1;
        }
      }
      return resultat;
    },

    async dernieresAttributions(org): Promise<Map<string, number>> {
      const { data, error } = await db
        .from("reservation_rendez_vous")
        .select("personne_id, created_at")
        .eq("organization_id", org)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(`attributions : ${error.message}`);
      const resultat = new Map<string, number>();
      for (const l of data ?? []) {
        if (!resultat.has(l.personne_id)) resultat.set(l.personne_id, Date.parse(l.created_at));
      }
      return resultat;
    },

    async prendre(personneId: string, debut: string, d: DonneesReservation): Promise<Prise> {
      const { data, error } = await db.rpc("reservation_prendre", {
        personne: personneId,
        debut,
        donnees: {
          origine: d.origine,
          prenom: d.prenom,
          nom: d.nom ?? null,
          email: d.email,
          telephone: d.telephone ?? null,
          fuseau_cliente: d.fuseauCliente,
          reponses: d.reponses,
          utm: d.utm,
          jeton_hash: d.jetonHash,
        },
      });
      return prise(data, error);
    },

    async reporter(ancienId: string, personneId: string, debut: string, par: Auteur): Promise<Prise> {
      const { data, error } = await db.rpc("reservation_reporter", {
        ancien: ancienId,
        personne: personneId,
        debut,
        par,
      });
      return prise(data, error);
    },
  };
}
