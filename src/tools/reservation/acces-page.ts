import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { creerLimiteur } from "@/lib/debit";
import type { createAdminClient } from "@/lib/supabase/admin";

import { jetonPresente } from "./page.ts";

/**
 * Qui appelle les routes de la page : un jeton de `reservation_jetons` (0045),
 * qui désigne une organisation et rien d'autre. Même contrôle que la route
 * d'export de Radar : recherche par empreinte, comparaison en temps constant,
 * révoqué = inconnu.
 */

type Admin = ReturnType<typeof createAdminClient>;

/*
 * Tous les appels d'un site arrivent des serveurs de Vercel : l'adresse ne dit
 * pas qui est la cliente. On amortit donc par jeton. La page appelle les
 * créneaux à chaque ouverture ; 120 par minute laisse de la marge à un pic de
 * pub, et arrête une boucle mal écrite.
 */
const autorise = creerLimiteur({ maximum: 120 });

const derniereTrace = new Map<string, number>();
const TRACE_MS = 60_000;

export type Acces = { ok: true; organizationId: string } | { ok: false; code: 401 | 429 };

export async function accesPage(db: Admin, entetes: Headers): Promise<Acces> {
  const jeton = jetonPresente(entetes);
  if (!jeton) return { ok: false, code: 401 };

  const empreinte = createHash("sha256").update(jeton).digest("hex");
  if (!autorise(empreinte)) return { ok: false, code: 429 };

  const { data: ligne } = await db
    .from("reservation_jetons")
    .select("id, organization_id, token_hash, revoked_at")
    .eq("token_hash", empreinte)
    .maybeSingle();
  if (!ligne) return { ok: false, code: 401 };

  const attendu = Buffer.from(ligne.token_hash, "utf8");
  const recu = Buffer.from(empreinte, "utf8");
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) return { ok: false, code: 401 };
  if (ligne.revoked_at) return { ok: false, code: 401 };

  const maintenant = Date.now();
  if ((derniereTrace.get(ligne.id) ?? 0) < maintenant - TRACE_MS) {
    derniereTrace.set(ligne.id, maintenant);
    await db.from("reservation_jetons").update({ last_used_at: new Date(maintenant).toISOString() }).eq("id", ligne.id);
  }

  return { ok: true, organizationId: ligne.organization_id };
}

export const json = (corps: unknown, code = 200) =>
  new Response(JSON.stringify(corps), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const sansCorps = (code: number) => new Response(null, { status: code, headers: { "cache-control": "no-store" } });

export type RdvCliente = {
  id: string;
  statut: "confirme" | "annule";
  debut: string;
  fin: string;
  prenom: string | null;
  email: string | null;
  lien_visio: string | null;
  fuseau_cliente: string;
};

/**
 * Le rendez-vous désigné par le lien personnel de la cliente, chez ce client
 * seulement. Le lien suit les reports (0042) : c'est toujours le dernier.
 */
export async function rdvDuLien(db: Admin, organizationId: string, lien: string): Promise<RdvCliente | null> {
  if (!/^[0-9a-f]{64}$/.test(lien)) return null;
  const empreinte = createHash("sha256").update(lien).digest("hex");
  const { data } = await db
    .from("reservation_rendez_vous")
    .select("id, statut, debut, fin, prenom, email, lien_visio, fuseau_cliente")
    .eq("organization_id", organizationId)
    .eq("jeton_hash", empreinte)
    .maybeSingle();
  return data ? { ...data, statut: data.statut === "annule" ? "annule" : "confirme" } : null;
}

/** Ce que le site reçoit d'un rendez-vous : de quoi écrire le mail, rien de plus. */
export const rdvPourSite = (r: RdvCliente) => ({
  id: r.id,
  statut: r.statut,
  debut: new Date(r.debut).toISOString(),
  fin: new Date(r.fin).toISOString(),
  prenom: r.prenom,
  email: r.email,
  lienVisio: r.lien_visio,
  fuseau: r.fuseau_cliente,
});
