import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { requireMembership } from "@/lib/access";
import { AgendaClient } from "@/tools/reservation/agenda-client";
import type { Issue } from "@/tools/reservation/etat";
import { maFiche } from "@/tools/reservation/personne";

export const metadata: Metadata = {
  title: "Mon agenda · Comète Studio",
};

const ISSUES: Issue[] = ["ok", "refus", "droits", "erreur", "expire"];

/**
 * Son agenda Google : le connecter, voir lequel est connecté, le retirer.
 * Ouverte à quiconque a une fiche de réservation chez ce client (la
 * titulaire comme les closeuses). Les trois réglages viendront ici.
 */
export default async function AgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ google?: string }>;
}) {
  const [{ orgSlug }, { google }] = await Promise.all([params, searchParams]);
  await requireMembership(orgSlug);
  const lue = await maFiche(orgSlug);
  const issue = ISSUES.find((i) => i === google) ?? null;

  return (
    <>
      <PageHeader title="Mon agenda" />
      {lue ? (
        <AgendaClient
          orgSlug={orgSlug}
          email={lue.fiche.google_connecte_le ? (lue.fiche.google_email ?? "") : null}
          issue={issue}
        />
      ) : (
        <p className="text-muted-foreground max-w-2xl text-sm">
          Tu ne prends pas encore de diagnostics ici. Louis t&apos;ajoute dès que tu es prête.
        </p>
      )}
    </>
  );
}
