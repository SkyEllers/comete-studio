import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { requireMembership } from "@/lib/access";
import { heureEnMots, jourEnMots } from "@/tools/agent/temps";
import { AgendaClient } from "@/tools/reservation/agenda-client";
import type { Issue } from "@/tools/reservation/etat";
import { maFiche, monAgenda } from "@/tools/reservation/personne";
import { Absences, Horaires, Maximum, Visio } from "@/tools/reservation/reglages-client";
import { nomComplet, reponsesLues, type Reservee } from "@/tools/reservation/reponses";

export const metadata: Metadata = {
  title: "Mon agenda · Comète Studio",
};

const ISSUES: Issue[] = ["ok", "refus", "droits", "erreur", "expire"];

/**
 * « Mon agenda » : tout ce que la personne règle pour recevoir des
 * diagnostics, sur un seul écran (Louis, 27/09/2026). Son agenda Google, sa
 * visio, ses horaires habituels, ses absences, son maximum par jour, puis
 * ses prochains rendez-vous. Ouverte à quiconque a une fiche de réservation
 * chez ce client, titulaire comme closeuse.
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

  if (!lue) {
    return (
      <>
        <PageHeader title="Mon agenda" />
        <p className="text-muted-foreground max-w-2xl text-sm">
          Tu ne prends pas encore de diagnostics ici. Louis t&apos;ajoute dès que tu es prête.
        </p>
      </>
    );
  }

  const { fiche } = lue;
  const { aujourdhui, horaires, absences, rendezVous } = await monAgenda(fiche.id, fiche.fuseau);

  return (
    <>
      <PageHeader title="Mon agenda" />
      <div className="max-w-2xl space-y-6">
        <AgendaClient
          orgSlug={orgSlug}
          email={fiche.google_connecte_le && fiche.google_agenda !== "primary" ? (fiche.google_email ?? "") : null}
          issue={issue}
        />
        <Visio orgSlug={orgSlug} visio={fiche.visio} lien={fiche.lien_visio} />
        <Horaires orgSlug={orgSlug} initiales={horaires} fuseau={fiche.fuseau} />
        <Absences orgSlug={orgSlug} absences={absences} aujourdhui={aujourdhui} />
        <Maximum orgSlug={orgSlug} initial={fiche.max_par_jour} />

        <section className="border-line space-y-4 rounded-lg border p-5">
          <h2 className="text-base font-medium">Mes prochains rendez-vous</h2>
          {rendezVous.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun rendez-vous à venir.</p>
          ) : (
            <ul className="divide-line divide-y">
              {rendezVous.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                  <span className="w-56 shrink-0 first-letter:uppercase">
                    {jourEnMots(r.debut, fiche.fuseau)} à {heureEnMots(r.debut, fiche.fuseau)}
                  </span>
                  <span className="font-medium">{r.prenom ?? ""}</span>
                  {/* Le premier rendez-vous après un devis payé (0055), pas un diagnostic. */}
                  {r.genre === "premier" ? (
                    <span className="text-muted-foreground border-line rounded border px-1.5 py-0.5 text-xs">
                      Premier rendez-vous
                    </span>
                  ) : null}
                  {r.lien_visio ? (
                    <a
                      href={r.lien_visio}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-4"
                    >
                      Ouvrir la visio
                    </a>
                  ) : null}
                  <Reponses rdv={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Qui elle est et ses réponses au formulaire, repliées sous le rendez-vous (Louis, 30/09/2026). */
function Reponses({ rdv }: { rdv: Reservee }) {
  const reponses = reponsesLues(rdv.reponses);
  return (
    <details className="basis-full">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
        {reponses.length ? "Ses réponses" : "Ses coordonnées"}
      </summary>
      <div className="mt-2 space-y-3 pb-1">
        <p className="text-muted-foreground text-xs leading-relaxed">
          {nomComplet(rdv)}
          {rdv.telephone ? (
            <>
              <br />
              <a href={`tel:${rdv.telephone}`} className="underline underline-offset-4">
                {rdv.telephone}
              </a>
            </>
          ) : null}
          {rdv.email ? (
            <>
              <br />
              {rdv.email}
            </>
          ) : null}
        </p>
        {reponses.map((x, i) => (
          <div key={i}>
            <p className="text-xs font-medium">{x.question}</p>
            <p className="text-muted-foreground text-sm whitespace-pre-line">{x.reponse}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
