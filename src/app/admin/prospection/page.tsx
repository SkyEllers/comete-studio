import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { groupeDe, repartirVideos } from "@/tools/prospection/tri";
import { estVivante, type Demande, type MessagePret } from "@/tools/prospection/demandes";
import type { LigneHistorique, Lien, Prospect, Suivi } from "@/tools/prospection/types";

import { Liste } from "./liste";
import { BoutonRecherche, Demandes } from "./recherche";

/**
 * Prospection — les praticiens contactés, et ce qu'il reste à faire avec eux.
 *
 * Ce que Louis vient y chercher : qui il relance aujourd'hui, ce qu'il leur a
 * déjà écrit, et ce qu'il doit dire dans la vidéo — sans rouvrir le vault.
 *
 * Les fiches viennent de `20-prospects/`, poussées par le script
 * `prospects-vers-hub.mjs`. Rien ne se saisit ici : ce qui naît dans cette
 * page, ce sont les coches de Louis (`prospection_suivi`) et ses demandes de
 * recherche (`prospection_demandes`), que son PC prend et exécute.
 */

export const metadata = { title: "Prospection — Comète Studio" };

const CHAMPS =
  "slug, nom, metier, ville, statut, source, canal, contact, contacte_le, relance_le, question, note, avis_google, message_titre, message, note_detail, video, tri_rapide, historique, liens, maj_vault";

const DEMANDES =
  "id, nombre, statut, demandee_le, commencee_le, finie_le, etape, trouves, bloques, en_file, envoyes, compte_rendu, messages, envoi_valide_le, envoi_exclus";

const aujourdhuiParis = () =>
  new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());

export default async function ProspectionPage({
  searchParams,
}: PageProps<"/admin/prospection">) {
  await requireAdmin();
  const params = await searchParams;
  const vue =
    params.vue === "contacts" ? "contacts" : params.vue === "relances" ? "relances" : "aujourdhui";

  const supabase = await createClient();
  const [{ data: fiches }, { data: suivis }, { data: lignesDemandes }] = await Promise.all([
    supabase.from("prospection_prospects").select(CHAMPS).order("relance_le", { nullsFirst: false }),
    supabase.from("prospection_suivi").select("*"),
    supabase
      .from("prospection_demandes")
      .select(DEMANDES)
      .order("demandee_le", { ascending: false })
      .limit(3),
  ]);
  const demandes = (lignesDemandes ?? []).map((d) => ({
    ...d,
    messages: (d.messages as MessagePret[]) ?? [],
    envoi_exclus: d.envoi_exclus ?? [],
  })) as Demande[];

  const parSlug = new Map((suivis ?? []).map((s) => [s.slug, s as Suivi & { slug: string }]));
  const prospects: Prospect[] = (fiches ?? []).map((f) => ({
    ...f,
    historique: (f.historique as LigneHistorique[]) ?? [],
    liens: (f.liens as Lien[]) ?? [],
    suivi: parSlug.get(f.slug) ?? null,
  }));

  const aujourdhui = aujourdhuiParis();
  const formes = repartirVideos(prospects);
  const aRelancer = prospects.filter((p) => {
    const g = groupeDe(p, aujourdhui);
    return g === "retard" || g === "aujourdhui" || g === "semaine";
  });
  const videosAFilmer = aRelancer.filter(
    (p) => formes.get(p.slug) === "video" && !p.suivi?.video_filmee_le,
  ).length;
  const sansNote = prospects.filter((p) => p.note === null).length;
  const reponses = prospects.filter((p) => p.suivi?.reponse_le).length;

  const onglets = [
    { cle: "aujourdhui", libelle: "Aujourd'hui", href: "/admin/prospection" },
    { cle: "relances", libelle: "Toutes les relances", href: "/admin/prospection?vue=relances" },
    { cle: "contacts", libelle: "Tous les contacts", href: "/admin/prospection?vue=contacts" },
  ];

  return (
    <>
      <PageHeader
        title="Prospection"
        description="Qui tu relances, ce que tu leur as déjà écrit, et ce que tu dis dans la vidéo. Les fiches viennent du vault."
        action={<BoutonRecherche vivante={demandes.some(estVivante)} />}
      />

      <Demandes demandes={demandes} />

      <dl className="border-line bg-surface-1 mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border sm:grid-cols-4">
        {[
          { libelle: "À relancer d'ici 7 jours", valeur: aRelancer.length },
          { libelle: "Vidéos à filmer", valeur: videosAFilmer },
          { libelle: "Réponses reçues", valeur: reponses },
          { libelle: "Pas encore notés", valeur: sansNote },
        ].map((c) => (
          <div key={c.libelle} className="bg-surface-1 px-3 py-2.5">
            <dt className="text-muted-foreground text-xs">{c.libelle}</dt>
            <dd className="font-mono text-xl">{c.valeur}</dd>
          </div>
        ))}
      </dl>

      <nav className="border-line -mb-px mb-6 flex gap-1 border-b" aria-label="Vues">
        {onglets.map((o) => (
          <Link
            key={o.cle}
            href={o.href}
            prefetch
            aria-current={vue === o.cle ? "page" : undefined}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm transition-colors",
              vue === o.cle
                ? "border-ember text-ember border-b-2"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.libelle}
          </Link>
        ))}
      </nav>

      {prospects.length === 0 ? (
        <EmptyState
          title="Aucun prospect ici pour l'instant"
          description="Appuie sur « Trouver des prospects », ou lance `node .claude/scripts/prospects-vers-hub.mjs` dans le vault pour envoyer les fiches."
        />
      ) : (
        <Liste prospects={prospects} aujourdhui={aujourdhui} vue={vue} />
      )}
    </>
  );
}
