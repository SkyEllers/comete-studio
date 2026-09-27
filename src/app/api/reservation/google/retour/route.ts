import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { enregistrerConnexion } from "@/tools/reservation/agenda";
import { COOKIE, deballer, memeEtat, pageAgenda, type Issue } from "@/tools/reservation/etat";
import { CHEMIN_RETOUR, echangerCode, identifiants, revoquer } from "@/tools/reservation/google";
import { maFiche } from "@/tools/reservation/personne";

/**
 * Le retour de Google. Rien ne s'écrit tant que trois choses ne sont pas
 * vraies : le témoin correspond, la personne connectée est bien celle de la
 * fiche, et les deux droits d'agenda ont été accordés.
 */

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const etat = deballer(request.cookies.get(COOKIE)?.value);

  const vers = (orgSlug: string, issue: Issue) => {
    const r = NextResponse.redirect(new URL(pageAgenda(orgSlug, issue), url.origin));
    r.cookies.set(COOKIE, "", { path: "/api/reservation/google", maxAge: 0 });
    r.headers.set("cache-control", "no-store");
    return r;
  };

  if (!etat) return NextResponse.redirect(new URL("/app", url.origin));
  if (!memeEtat(url.searchParams.get("state"), etat.etat)) return vers(etat.orgSlug, "expire");
  if (url.searchParams.get("error")) return vers(etat.orgSlug, "refus");

  const code = url.searchParams.get("code");
  const ids = identifiants();
  const lue = await maFiche(etat.orgSlug);
  if (!code || !ids || !lue || lue.fiche.id !== etat.personneId) return vers(etat.orgSlug, "erreur");

  try {
    const connexion = await echangerCode(code, `${url.origin}${CHEMIN_RETOUR}`, ids);
    if (connexion.droitsManquants.length > 0) {
      // Elle a décoché une case : on rend l'accès plutôt que garder un
      // jeton qui ne sert à rien.
      await revoquer(connexion.jetonRafraichissement).catch(() => undefined);
      return vers(etat.orgSlug, "droits");
    }
    await enregistrerConnexion(createAdminClient(), etat.personneId, connexion);
    return vers(etat.orgSlug, "ok");
  } catch (erreur) {
    console.error("Réservation : connexion Google échouée", erreur instanceof Error ? erreur.message : erreur);
    return vers(etat.orgSlug, "erreur");
  }
}
