import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { CleModele, Modele, ValeursModele } from "./profil.ts";

/**
 * Ce que l'agent dit à l'API Cloud de WhatsApp, et ce qu'il comprend de ce
 * qu'elle lui renvoie. Sans réseau ni base : tout se teste à part.
 *
 * Les modèles portent chez Meta le nom `diag_<clé>` (soumis le 27/09/2026 par
 * `scripts/agent-soumettre-modeles.mjs`), en français.
 */

export const VERSION_API = "v25.0";
export const LANGUE_MODELES = "fr";

export function nomModeleMeta(cle: CleModele): string {
  return `diag_${cle}`;
}

/** « +33612345678 » pour nous, « 33612345678 » pour Meta, dans les deux sens. */
export const versMeta = (telephone: string) => telephone.replace(/^\+/, "");
export const depuisMeta = (waId: string) => (waId.startsWith("+") ? waId : `+${waId}`);

/** Un modèle validé : ses variables, dans l'ordre de `{{1}}`, `{{2}}`… */
export function corpsModele(telephone: string, cle: CleModele, modele: Modele, valeurs: ValeursModele) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: versMeta(telephone),
    type: "template",
    template: {
      name: nomModeleMeta(cle),
      language: { code: LANGUE_MODELES },
      components: [
        {
          type: "body",
          parameters: modele.variables.map((v) => ({ type: "text", text: valeurs[v] })),
        },
      ],
    },
  };
}

/** Un message libre, dans la fenêtre de 24 h ouverte par sa dernière parole. */
export function corpsTexte(telephone: string, texte: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: versMeta(telephone),
    type: "text",
    text: { body: texte, preview_url: true },
  };
}

/**
 * La signature que Meta pose sur chaque webhook : `sha256=<hex>`, HMAC du
 * corps brut avec la clé secrète de l'app. Comparée en temps constant.
 */
export function signatureValide(corpsBrut: string, entete: string | null, secret: string): boolean {
  const recu = /^sha256=([0-9a-f]{64})$/.exec(entete ?? "")?.[1];
  if (!recu) return false;
  const attendu = createHmac("sha256", secret).update(corpsBrut, "utf8").digest();
  return timingSafeEqual(Buffer.from(recu, "hex"), attendu);
}

/** Le refus de Meta, lisible : code, titre, message (proposition 199 du vault). */
export function raisonRefus(corps: unknown, statutHttp: number): string {
  const e = z
    .object({
      error: z.looseObject({
        code: z.number().optional(),
        message: z.string().optional(),
        error_user_title: z.string().optional(),
        error_user_msg: z.string().optional(),
      }),
    })
    .safeParse(corps);
  if (!e.success) return `HTTP ${statutHttp}`;
  const { code, message, error_user_title, error_user_msg } = e.data.error;
  return [`HTTP ${statutHttp}`, code, error_user_title ?? message, error_user_msg]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);
}

// ------------------------------ Le webhook ---------------------------------

// L'enveloppe est stricte sur ce qu'on lit, tolérante sur le reste : un champ
// que Meta ajoute demain ne doit pas faire perdre un message (CLAUDE.md §7).
const souple = z.looseObject;

const message = souple({
  from: z.string(),
  id: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: souple({ body: z.string() }).optional(),
  button: souple({ text: z.string(), payload: z.string().optional() }).optional(),
  interactive: souple({
    button_reply: souple({ title: z.string() }).optional(),
    list_reply: souple({ title: z.string() }).optional(),
  }).optional(),
});

const statut = souple({
  id: z.string(),
  status: z.string(),
  errors: z
    .array(souple({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

const enveloppe = souple({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    souple({
      changes: z.array(
        souple({
          field: z.string(),
          value: souple({
            metadata: souple({ phone_number_id: z.string() }).optional(),
            messages: z.array(message).optional(),
            statuses: z.array(statut).optional(),
          }),
        }),
      ),
    }),
  ),
});

export type Entree = { numeroId: string; idExterne: string; de: string; texte: string };
export type StatutMeta = "distribue" | "lu" | "echec";
export type Suivi = { numeroId: string; idExterne: string; statut: StatutMeta; erreur: string | null };

/** Ce qu'elle a envoyé, en texte : un bouton se lit par son libellé. */
function texteDe(m: z.infer<typeof message>): string {
  if (m.type === "text" && m.text) return m.text.body;
  if (m.type === "button" && m.button) return m.button.text;
  if (m.type === "interactive") {
    const titre = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
    if (titre) return titre;
  }
  // Un vocal, une photo, un autocollant : l'agent sait qu'il y a eu quelque
  // chose, sans pouvoir le lire.
  const noms: Record<string, string> = {
    audio: "un message vocal",
    image: "une photo",
    video: "une vidéo",
    document: "un document",
    sticker: "un autocollant",
    location: "une position",
    contacts: "un contact",
    reaction: "une réaction",
  };
  return `[Elle a envoyé ${noms[m.type] ?? "un message que l'agent ne sait pas lire"}]`;
}

const STATUTS: Record<string, StatutMeta> = { delivered: "distribue", read: "lu", failed: "echec" };

/**
 * Un webhook de Meta, déplié : les messages reçus et le suivi des envois.
 * `null` si ce n'est pas un webhook WhatsApp lisible.
 */
export function lireWebhook(json: unknown): { entrees: Entree[]; suivis: Suivi[] } | null {
  const lu = enveloppe.safeParse(json);
  if (!lu.success) return null;

  const entrees: Entree[] = [];
  const suivis: Suivi[] = [];
  for (const entry of lu.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const numeroId = change.value.metadata?.phone_number_id;
      if (!numeroId) continue;

      for (const m of change.value.messages ?? []) {
        entrees.push({ numeroId, idExterne: m.id, de: depuisMeta(m.from), texte: texteDe(m).slice(0, 4000) });
      }
      for (const s of change.value.statuses ?? []) {
        const st = STATUTS[s.status];
        if (!st) continue;
        const e = s.errors?.[0];
        const erreur = e ? [e.code, e.title ?? e.message].filter(Boolean).join(" · ").slice(0, 500) : null;
        suivis.push({ numeroId, idExterne: s.id, statut: st, erreur });
      }
    }
  }
  return { entrees, suivis };
}

/** Un suivi ne fait jamais reculer un message : « lu » ne redevient pas « distribué ». */
export function suiviAvance(actuel: string, nouveau: StatutMeta): boolean {
  if (nouveau === "echec") return actuel !== "echec";
  const rang: Record<string, number> = { envoye: 0, distribue: 1, lu: 2 };
  return (rang[nouveau] ?? -1) > (rang[actuel] ?? 99);
}
