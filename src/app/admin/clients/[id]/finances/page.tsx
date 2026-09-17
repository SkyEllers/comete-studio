import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientTabs } from "@/components/admin/client-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { libelleMois, moisCourant } from "@/lib/mois";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ecrireLignes, euros } from "@/tools/horizon/contenu";
import { getReleves } from "@/tools/horizon/queries";
import { VueReleve } from "@/tools/horizon/releve";

import type { SaisieReleve } from "./actions";
import { ReleveForm } from "./releve-form";

/**
 * L'onglet Horizon d'une fiche client : les relevés du mois, leur saisie, et
 * l'aperçu exact de ce que le client verra.
 *
 * Le mois voyage par l'URL (`?mois=2026-09-01`) ; `?mois=nouveau` ouvre un
 * relevé vierge, prérempli avec les poches et les objectifs du dernier mois —
 * ce sont eux qui changent le moins d'un mois à l'autre.
 */
export default async function AdminHorizonPage({
  params,
  searchParams,
}: PageProps<"/admin/clients/[id]/finances">) {
  const { id } = await params;
  const { mois: demande } = await searchParams;
  await requireAdmin();

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("id", id)
    .maybeSingle();

  if (!org) notFound();

  const [{ data: horizon }, { data: radar }, { data: sonde }] = await Promise.all(
    ["finances", "resultats", "sonde"].map((slug) =>
      supabase
        .from("organization_tools")
        .select("enabled, tools!inner(slug)")
        .eq("organization_id", org.id)
        .eq("tools.slug", slug)
        .maybeSingle(),
    ),
  );

  if (!horizon?.enabled) notFound();

  const releves = await getReleves(org.id);
  const nouveau = demande === "nouveau" || releves.length === 0;
  const choisi = nouveau ? null : (releves.find((releve) => releve.mois === demande) ?? releves[0]!);
  const dernier = releves[0] ?? null;

  const initial: SaisieReleve = choisi
    ? {
        organizationId: org.id,
        mois: choisi.mois.slice(0, 7),
        publie: choisi.publie,
        resume: choisi.contenu.resume,
        entrees: ecrireLignes(choisi.contenu.entrees),
        charges: ecrireLignes(choisi.contenu.charges),
        vie: ecrireLignes(choisi.contenu.vie),
        aVenir: ecrireLignes(choisi.contenu.aVenir),
        tauxImpots: String(choisi.contenu.tauxImpots),
        salaire: euros(choisi.contenu.salaireCentimes),
        impots: euros(choisi.contenu.poches.impotsCentimes),
        bloque: euros(choisi.contenu.poches.bloqueCentimes),
        fondsRoulement: euros(choisi.contenu.poches.fondsRoulementCentimes),
        reserve: euros(choisi.contenu.poches.reserveCentimes),
        palierReserve: euros(choisi.contenu.objectifs.palierReserveCentimes),
        objectifReserve: euros(choisi.contenu.objectifs.objectifReserveCentimes),
        ecarts: choisi.contenu.ecarts.join("\n"),
        notionTitre: choisi.contenu.notion.titre,
        notionTexte: choisi.contenu.notion.texte,
      }
    : {
        organizationId: org.id,
        mois: moisCourant().slice(0, 7),
        publie: false,
        resume: "",
        entrees: "",
        charges: dernier ? ecrireLignes(dernier.contenu.charges.map((ligne) => ({ ...ligne, centimes: ligne.centimes }))) : "",
        vie: "",
        aVenir: "",
        tauxImpots: String(dernier?.contenu.tauxImpots ?? 40),
        salaire: dernier ? euros(dernier.contenu.salaireCentimes) : "",
        impots: dernier ? euros(dernier.contenu.poches.impotsCentimes) : "",
        bloque: dernier ? euros(dernier.contenu.poches.bloqueCentimes) : "",
        fondsRoulement: dernier ? euros(dernier.contenu.poches.fondsRoulementCentimes) : "",
        reserve: dernier ? euros(dernier.contenu.poches.reserveCentimes) : "",
        palierReserve: dernier ? euros(dernier.contenu.objectifs.palierReserveCentimes) : "",
        objectifReserve: dernier ? euros(dernier.contenu.objectifs.objectifReserveCentimes) : "",
        ecarts: "",
        notionTitre: "",
        notionTexte: "",
      };

  return (
    <>
      <div className="mb-8 space-y-4">
        <Link
          href={`/admin/clients/${org.id}`}
          prefetch
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {org.name}
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl">Horizon</h1>
            <p className="text-muted-foreground text-sm">
              La page du mois de {org.name} : tu la remplis, elle la lit quand elle veut.
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href={`/app/${org.slug}/finances`} prefetch>
              <ExternalLink aria-hidden="true" />
              Voir sa page
            </Link>
          </Button>
        </div>
      </div>

      <ClientTabs
        organizationId={org.id}
        actif="finances"
        radarActif={Boolean(radar?.enabled)}
        sondeActif={Boolean(sonde?.enabled)}
      />

      <nav aria-label="Relevés" className="mt-8 flex flex-wrap gap-2">
        {releves.map((releve) => (
          <Link
            key={releve.id}
            href={`?mois=${releve.mois}`}
            prefetch
            aria-current={choisi?.id === releve.id ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
              choisi?.id === releve.id
                ? "border-ember text-foreground"
                : "border-line text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="capitalize">{libelleMois(releve.mois)}</span>
            {!releve.publie ? <Badge variant="outline">brouillon</Badge> : null}
          </Link>
        ))}
        <Link
          href="?mois=nouveau"
          prefetch
          aria-current={nouveau ? "page" : undefined}
          className={cn(
            "rounded-full border border-dashed px-3 py-1.5 text-sm transition-colors",
            nouveau ? "border-ember text-foreground" : "border-line text-muted-foreground hover:text-foreground",
          )}
        >
          + Nouveau mois
        </Link>
      </nav>

      <section className="mt-8">
        <ReleveForm key={choisi?.id ?? "nouveau"} initial={initial} releveId={choisi?.id ?? null} />
      </section>

      {choisi ? (
        <section className="border-line mt-12 space-y-4 border-t pt-8">
          <h2 className="text-lg">Ce que {org.name} voit</h2>
          <VueReleve releve={choisi} />
        </section>
      ) : null}
    </>
  );
}
