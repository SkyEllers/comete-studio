import { MailCheck, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  COULEUR,
  aRegarder,
  aSurveiller,
  compteur,
  ecart,
  infobulle,
  jamaisVues,
  parClient,
  quand,
  resume,
} from "@/tools/automatisations/affichage";
import { ETATS, type Automatisation, type Passage } from "@/tools/automatisations/types";

/**
 * Automatisations — le courrier que Comète doit recevoir.
 *
 * Ce que Louis vient y chercher : « le rapport ads de mardi est-il arrivé ? »,
 * « qu'est-ce qui doit tomber cette semaine ? », « est-ce qu'il en manque une ? ».
 * Rien ne se saisit ici et rien ne s'y déclenche : la page montre ce que le
 * relevé du vault a constaté dans la boîte Gmail et sur GitHub.
 *
 * Le calendrier vit dans `00-studio/automatisations.md` ; pour ajouter une
 * automatisation, on écrit une ligne là-bas, pas ici.
 */

export const metadata = { title: "Automatisations — Comète Studio" };

const CHAMPS =
  "slug, client, nom, cadence, depot, workflow, mail_attendu, actif, ordre, prochaine_le, attendue_le, recu_le, recu_objet, run_statut, run_le, run_url, etat, releve_le";

const RELEVE = "python .claude/scripts/automatisations-vers-hub.py";

/** Le nom du client tel qu'on l'écrit : le slug du vault, première lettre en capitale. */
const nomClient = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

function Pastille({ passage }: { passage: Passage }) {
  return (
    <span
      className={cn("size-2 rounded-full", COULEUR[passage.etat])}
      title={infobulle(passage.etat, passage.attendue_le, passage.recu_le)}
    />
  );
}

function Ligne({ ligne, maintenant }: { ligne: Automatisation; maintenant: Date }) {
  const etat = ETATS[ligne.etat];
  const alerte = etat.gravite === 2;

  return (
    <div className="border-line flex gap-3 border-t py-3 first:border-t-0">
      <span
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", COULEUR[ligne.etat])}
        title={etat.quoi}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={cn("text-sm", !ligne.actif && "text-muted-foreground")}>{ligne.nom}</span>
          {/* La cadence peut porter un « (depuis le …) » : il explique une absence
              ancienne, il n'a pas à encombrer la ligne. Il reste au survol. */}
          <span className="text-muted-foreground font-mono text-xs" title={ligne.cadence}>
            {ligne.cadence.split(" (")[0]}
          </span>
        </div>

        <p className={cn("mt-0.5 text-xs", alerte ? "text-danger" : "text-muted-foreground")}>
          {resume(ligne, maintenant)}
        </p>

        {ligne.recu_objet ? (
          <p className="text-muted-foreground/70 mt-1 truncate font-mono text-[11px]">
            {ligne.recu_objet}
          </p>
        ) : null}

        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center gap-1" aria-hidden="true">
            {ligne.passages.map((p) => (
              <Pastille key={p.attendue_le} passage={p} />
            ))}
          </div>
          {alerte && ligne.run_url ? (
            <a
              href={ligne.run_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground font-mono text-[11px] underline underline-offset-2"
            >
              voir le job
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default async function AutomatisationsPage() {
  await requireAdmin();

  const supabase = await createClient();
  const [{ data: lignes }, { data: passages }] = await Promise.all([
    // `ordre` suit le fichier du vault d'un bout à l'autre : trier dessus seul
    // garde les clients dans l'ordre où Louis les a écrits, Peggy avant Jonathan.
    supabase.from("automatisations").select(CHAMPS).order("ordre"),
    supabase.from("automatisations_passages").select("*").order("attendue_le"),
  ]);

  const parSlug = new Map<string, Passage[]>();
  for (const p of passages ?? []) {
    const liste = parSlug.get(p.slug) ?? [];
    liste.push(p as Passage);
    parSlug.set(p.slug, liste);
  }

  const automatisations: Automatisation[] = (lignes ?? []).map((l) => ({
    ...(l as Omit<Automatisation, "passages">),
    passages: parSlug.get(l.slug) ?? [],
  }));

  const maintenant = new Date();
  const releve = automatisations[0]?.releve_le ?? null;
  const ennuis = aRegarder(automatisations);
  const veilles = aSurveiller(automatisations);
  const neuves = jamaisVues(automatisations);

  return (
    <>
      <PageHeader
        title="Automatisations"
        description="Le courrier que Comète doit recevoir : ce qui est arrivé, ce qui manque, et ce qui tombe bientôt."
        action={
          releve ? (
            <p className="text-muted-foreground text-right text-xs">
              Relevé {ecart(releve, maintenant)}
              <br />
              <span className="font-mono text-[11px]">{quand(releve)}</span>
            </p>
          ) : null
        }
      />

      {automatisations.length === 0 ? (
        <EmptyState
          icon={MailCheck}
          title="Aucun relevé pour l'instant"
          description={`Le calendrier vit dans 00-studio/automatisations.md du vault. Pour le pousser ici : ${RELEVE}`}
        />
      ) : (
        <div className="space-y-6">
          {ennuis.length > 0 ? (
            <div className="border-danger/40 bg-danger/5 rounded-lg border p-4">
              <p className="text-danger flex items-center gap-2 text-sm">
                <TriangleAlert aria-hidden="true" className="size-4" />
                {ennuis.length === 1
                  ? "Une automatisation n'a pas rendu son courrier"
                  : `${ennuis.length} automatisations n'ont pas rendu leur courrier`}
              </p>
              <ul className="mt-2 space-y-1">
                {ennuis.map((l) => (
                  <li key={l.slug} className="text-sm">
                    <span className="text-muted-foreground font-mono text-xs">{l.slug}</span>{" "}
                    — {ETATS[l.etat].quoi}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {veilles.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              {veilles.length === 1
                ? "Un mail est arrivé après sa limite"
                : `${veilles.length} mails sont arrivés après leur limite`}{" "}
              : {veilles.map((l) => l.nom).join(", ")}.
            </p>
          ) : null}

          {neuves.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              {neuves.length === 1
                ? "Une automatisation attend son premier passage"
                : `${neuves.length} automatisations attendent leur premier passage`}{" "}
              :{" "}
              {neuves
                .map((l) => `${l.nom} (${nomClient(l.client)}, ${ecart(l.prochaine_le, maintenant)})`)
                .join(", ")}
              .
            </p>
          ) : null}

          {parClient(automatisations).map(({ client, lignes: siennes }) => {
            const { sereines, jugees, jamais, pause } = compteur(siennes);
            return (
              <section key={client} className="border-line bg-surface-1 rounded-lg border p-5">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg">{nomClient(client)}</h2>
                  <p className="text-muted-foreground font-mono text-xs">
                    {jugees > 0 ? `${sereines} sur ${jugees}` : "rien encore jugé"}
                    {jamais > 0 ? ` · ${jamais} en attente du 1er passage` : ""}
                    {pause > 0 ? ` · ${pause} en pause` : ""}
                  </p>
                </div>
                <div>
                  {siennes.map((ligne) => (
                    <Ligne key={ligne.slug} ligne={ligne} maintenant={maintenant} />
                  ))}
                </div>
              </section>
            );
          })}

          <p className="text-muted-foreground text-xs">
            Le calendrier est dans <span className="font-mono">00-studio/automatisations.md</span> du
            vault : une ligne par automatisation, avec l&apos;objet du mail attendu. Le relevé se
            relance avec <span className="font-mono">{RELEVE}</span>.
          </p>
        </div>
      )}
    </>
  );
}
