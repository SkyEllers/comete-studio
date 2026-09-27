import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { lireAccord } from "@/tools/agent/accords";
import { profil as profilDe } from "@/tools/agent/profils";
import { heureEnMots, jourEnMots } from "@/tools/agent/temps";

import { donnerAccord } from "./actions";

export const metadata: Metadata = {
  title: "Tes rappels sur WhatsApp",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const P = "Europe/Paris";

function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-10 text-[15px] leading-relaxed">
      {children}
    </main>
  );
}

/**
 * La page du lien envoyé par mail aux clientes réservées avant le lancement
 * de l'agent (0046). Ouvrir la page ne vaut rien : seul le bouton donne
 * l'accord. Aucune donnée personnelle affichée, hormis l'heure du rendez-vous
 * et les deux derniers chiffres du numéro.
 */
export default async function AccordPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  const admin = createAdminClient();
  const accord = await lireAccord(admin, jeton);

  if (!accord) {
    return (
      <Cadre>
        <h1 className="text-xl font-semibold">Ce lien n&apos;est plus valable</h1>
        <p className="text-muted-foreground">
          Le rendez-vous est peut-être passé, ou le lien a été mal copié. Rien n&apos;a changé pour ton rendez-vous.
        </p>
      </Cadre>
    );
  }

  const { data: r } = await admin
    .from("agent_reglages")
    .select("profil")
    .eq("organization_id", accord.organization_id)
    .maybeSingle();
  const marque = (r && profilDe(r.profil)?.marque) ?? "ton accompagnante";
  const quand = `${jourEnMots(accord.rdv_debut, P)} à ${heureEnMots(accord.rdv_debut, P)}`;

  if (accord.accepte_le) {
    return (
      <Cadre>
        <h1 className="text-xl font-semibold">C&apos;est noté, merci !</h1>
        <p>
          L&apos;assistante de {marque} va t&apos;écrire sur WhatsApp pour ton diagnostic du {quand}. Tu peux
          arrêter quand tu veux en répondant STOP.
        </p>
      </Cadre>
    );
  }

  return (
    <Cadre>
      <h1 className="text-xl font-semibold">Tes rappels sur WhatsApp ?</h1>
      <p>Ton diagnostic offert avec {marque} a lieu {quand}.</p>
      <p>
        Si tu veux, son assistante t&apos;envoie tes rappels et le lien de la visio sur WhatsApp
        {accord.fin_numero ? `, au numéro qui finit par ${accord.fin_numero}` : ""}. Tu recevras aussi des articles
        et des recettes adaptés à toi, et tu pourras lui écrire pour déplacer ton rendez-vous.
      </p>
      <form action={donnerAccord}>
        <input type="hidden" name="jeton" value={jeton} />
        <Button type="submit" size="lg" className="w-full">
          Oui, je veux mes rappels sur WhatsApp
        </Button>
      </form>
      <p className="text-muted-foreground text-sm">Tu peux arrêter quand tu veux en répondant STOP.</p>
    </Cadre>
  );
}
