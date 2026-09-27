import { NextResponse } from "next/server";

import { adresseConsentement, CHEMIN_RETOUR, identifiants } from "@/tools/reservation/google";
import { COOKIE, DUREE_S, emballer, nouvelEtat } from "@/tools/reservation/etat";
import { maFiche } from "@/tools/reservation/personne";

/**
 * « Connecter mon agenda » : on vérifie qu'elle a une fiche chez ce client,
 * on pose le témoin, et on l'envoie chez Google.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgSlug = url.searchParams.get("org") ?? "";

  const ids = identifiants();
  if (!ids) return new Response("La connexion à Google n'est pas encore réglée.", { status: 503 });

  const lue = await maFiche(orgSlug);
  // Pas connectée, ou pas de fiche chez ce client : la page de l'agenda dit
  // quoi faire (le proxy l'envoie d'abord se connecter si besoin).
  if (!lue) return NextResponse.redirect(new URL(`/app/${encodeURIComponent(orgSlug)}/agenda`, url.origin));

  const etat = nouvelEtat(lue.fiche.id, lue.org.slug);
  const reponse = NextResponse.redirect(
    adresseConsentement({
      clientId: ids.clientId,
      retour: `${url.origin}${CHEMIN_RETOUR}`,
      etat: etat.etat,
      email: lue.fiche.google_email ?? lue.session.email,
    }),
  );
  reponse.cookies.set(COOKIE, emballer(etat), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/api/reservation/google",
    maxAge: DUREE_S,
  });
  reponse.headers.set("cache-control", "no-store");
  return reponse;
}
