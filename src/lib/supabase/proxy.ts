import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "./database.types";

/**
 * Zones fermées. Sans session, on renvoie vers la connexion avec la
 * destination en paramètre pour y revenir après.
 */
const PROTECTED_PREFIXES = ["/app", "/admin", "/reinitialiser", "/invitation"];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Rafraîchit la session à chaque requête et arbitre l'accès.
 *
 * Deux précautions :
 * - rien ne s'exécute entre `createServerClient` et `auth.getUser()`, sinon la
 *   session peut être perdue au milieu d'un rafraîchissement ;
 * - les cookies rafraîchis sont recopiés sur les redirections. Un refresh token
 *   ne sert qu'une fois : le jeton perdu ici déconnecterait à la requête suivante.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const authHeaders: Record<string, string> = {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Configuration Supabase incomplète : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont attendues.",
    );
  }

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
        // Une réponse qui pose des cookies d'auth ne doit jamais être mise en
        // cache par un CDN : la bibliothèque fournit les en-têtes qu'il faut.
        for (const [header, value] of Object.entries(headers)) {
          authHeaders[header] = value;
          supabaseResponse.headers.set(header, value);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectTo = (destination: URL) => {
    const response = NextResponse.redirect(destination);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    for (const [header, value] of Object.entries(authHeaders)) {
      response.headers.set(header, value);
    }
    return response;
  };

  const { pathname, search } = request.nextUrl;

  if (!user && isProtected(pathname)) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/";
    destination.search = "";
    destination.searchParams.set("next", `${pathname}${search}`);
    return redirectTo(destination);
  }

  if (user && pathname === "/") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/app";
    destination.search = "";
    return redirectTo(destination);
  }

  return supabaseResponse;
}
