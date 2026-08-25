import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Next 16 : `proxy.ts` remplace `middleware.ts`, et tourne sur le runtime Node.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Tout, sauf les fichiers servis tels quels : bundles, images optimisées,
    // favicons, robots.txt, polices et logos de public/.
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
