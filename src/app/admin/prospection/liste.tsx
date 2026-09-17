"use client";

import { Mail, Video } from "lucide-react";
import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/tools/kanban/markdown";
import { formeDe, groupeDe, repartirVideos, trierDansGroupe } from "@/tools/prospection/tri";
import {
  LIBELLE_GROUPE,
  ORDRE_GROUPES,
  type Groupe,
  type Prospect,
} from "@/tools/prospection/types";

import { marquer } from "./actions";

/**
 * La liste des prospects, dépliable.
 *
 * Un `<details>` natif plutôt qu'un accordéon maison : la page doit s'ouvrir
 * vite sur un téléphone, au moment où Louis filme, et le navigateur sait déjà
 * faire ça sans une ligne de JavaScript.
 */

const JOUR = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Paris",
});

const date = (iso: string | null) =>
  iso ? JOUR.format(new Date(`${iso}T12:00:00Z`)) : "—";

function Etoiles({ note }: { note: number | null }) {
  if (note === null) {
    return (
      <span className="text-muted-foreground font-mono text-xs" title="Pas encore noté">
        ·····
      </span>
    );
  }
  return (
    <span className="font-mono text-xs" title={`${note} étoiles sur 5`}>
      <span className="text-ember">{"★".repeat(note)}</span>
      <span className="text-muted-foreground">{"·".repeat(5 - note)}</span>
    </span>
  );
}

function Coche({
  slug,
  quoi,
  children,
  variant = "outline",
}: {
  slug: string;
  quoi: string;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
}) {
  const [state, action, pending] = useActionState(marquer, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="quoi" value={quoi} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {children}
      </Button>
      {state && !state.ok ? (
        <span className="text-destructive ml-2 text-xs">{state.error}</span>
      ) : null}
    </form>
  );
}

function Fiche({
  p,
  forme,
  choisie,
  avecQuestion = false,
}: {
  p: Prospect;
  forme: "video" | "mail";
  choisie: boolean;
  /** Dans la vue du jour, le sujet se lit sans déplier : c'est ce qu'on vient chercher. */
  avecQuestion?: boolean;
}) {
  const suivi = p.suivi;
  const etat = suivi?.reponse_le
    ? `a répondu le ${date(suivi.reponse_le)}`
    : suivi?.relance_envoyee_le
      ? `relancé le ${date(suivi.relance_envoyee_le)}`
      : suivi?.video_filmee_le
        ? `vidéo filmée le ${date(suivi.video_filmee_le)}`
        : null;

  return (
    <details className="border-line bg-surface-1 group rounded-md border">
      <summary className="cursor-pointer px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Etoiles note={p.note} />
          <span className="font-medium">{p.nom}</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {[p.metier, p.ville].filter(Boolean).join(" · ")}
          </span>
          {forme === "video" ? (
            <Badge variant={suivi?.video_filmee_le ? "default" : "outline"}>
              <Video aria-hidden /> vidéo{choisie ? "" : " proposée"}
            </Badge>
          ) : (
            <Badge variant="ghost">
              <Mail aria-hidden /> mail court
            </Badge>
          )}
          <span className="text-muted-foreground font-mono text-xs">
            relance {date(p.relance_le)}
          </span>
          {etat ? <span className="text-success text-xs">{etat}</span> : null}
        </span>
        {avecQuestion && p.question ? (
          <span className="text-muted-foreground mt-1 block text-xs">{p.question}</span>
        ) : null}
      </summary>

      <div className="border-line space-y-4 border-t px-3 py-3 text-sm">
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
          <span>contacté le {date(p.contacte_le)}</span>
          <span>par {p.canal ?? "?"}</span>
          {p.contact ? <span>{p.contact}</span> : null}
          {p.avis_google !== null ? <span>{p.avis_google} avis Google</span> : null}
          <span>statut {p.statut}</span>
        </div>

        {p.question ? (
          <p>
            <span className="text-muted-foreground">La question posée : </span>
            {p.question}
          </p>
        ) : null}

        {p.liens.length > 0 ? (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {p.liens.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
              >
                {l.libelle}
              </a>
            ))}
          </p>
        ) : null}

        {p.tri_rapide ? (
          <section>
            <h3 className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
              Ce qu&apos;on a vu chez elle, et où le vérifier
            </h3>
            <MarkdownText>{p.tri_rapide}</MarkdownText>
          </section>
        ) : null}

        <section>
          <h3 className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
            Le sujet de la vidéo
          </h3>
          {p.video ? (
            <MarkdownText>{p.video}</MarkdownText>
          ) : (
            <p className="text-muted-foreground text-xs">
              Pas encore écrit. Le sujet se prépare dans la fiche du vault, en session.
            </p>
          )}
        </section>

        <section>
          <h3 className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
            {p.message_titre ?? "Le message envoyé"}
          </h3>
          {p.message ? (
            <pre className="bg-surface-2 border-line overflow-x-auto rounded-md border p-3 font-sans text-xs whitespace-pre-wrap">
              {p.message}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">Message introuvable dans sa fiche.</p>
          )}
        </section>

        {p.note_detail ? (
          <section>
            <h3 className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">La note</h3>
            <MarkdownText>{p.note_detail}</MarkdownText>
          </section>
        ) : null}

        {p.historique.length > 0 ? (
          <section>
            <h3 className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
              Ce qui s&apos;est passé
            </h3>
            <ul className="space-y-1 text-xs">
              {p.historique.map((h, i) => (
                <li key={`${h.date}-${i}`} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 font-mono">{h.date}</span>
                  <span className="text-muted-foreground shrink-0">{h.canal}</span>
                  <span className="min-w-0">{h.texte}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          {suivi?.video_filmee_le ? null : forme === "video" ? (
            <Coche slug={p.slug} quoi="video">
              Vidéo filmée
            </Coche>
          ) : null}
          {suivi?.relance_envoyee_le ? null : (
            <Coche slug={p.slug} quoi={forme === "video" ? "relance-video" : "relance-mail"} variant="default">
              Relance envoyée
            </Coche>
          )}
          {suivi?.reponse_le ? null : (
            <Coche slug={p.slug} quoi="reponse">
              A répondu
            </Coche>
          )}
          {suivi ? (
            <Coche slug={p.slug} quoi="annuler" variant="ghost">
              Annuler mes coches
            </Coche>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function Bloc({
  titre,
  aide,
  liste,
  formes,
}: {
  titre: string;
  aide: string;
  liste: Prospect[];
  formes: Map<string, "video" | "mail">;
}) {
  if (liste.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-sm font-medium">
        {titre}
        <span className="text-muted-foreground ml-2 font-mono text-xs">{liste.length}</span>
      </h2>
      <p className="text-muted-foreground mb-2 text-xs">{aide}</p>
      <div className="space-y-2">
        {liste.map((p) => {
          const { forme, choisie } = formeDe(p, formes);
          return <Fiche key={p.slug} p={p} forme={forme} choisie={choisie} avecQuestion />;
        })}
      </div>
    </section>
  );
}

export function Liste({
  prospects,
  aujourdhui,
  vue,
}: {
  prospects: Prospect[];
  aujourdhui: string;
  vue: "aujourdhui" | "relances" | "contacts";
}) {
  const formes = repartirVideos(prospects);

  if (vue === "aujourdhui") {
    const enRetard = prospects
      .filter((p) => groupeDe(p, aujourdhui) === "retard")
      .sort(trierDansGroupe);
    const duJour = prospects
      .filter((p) => groupeDe(p, aujourdhui) === "aujourdhui")
      .sort(trierDansGroupe);
    const aFilmer = prospects
      .filter((p) => {
        const g = groupeDe(p, aujourdhui);
        return (
          (g === "aujourdhui" || g === "semaine" || g === "retard") &&
          formeDe(p, formes).forme === "video" &&
          !p.suivi?.video_filmee_le
        );
      })
      .sort(trierDansGroupe);
    const aRepondu = prospects.filter((p) => p.suivi?.reponse_le && !p.suivi.classe);

    const rien =
      enRetard.length === 0 && duJour.length === 0 && aFilmer.length === 0 && aRepondu.length === 0;

    return (
      <div className="space-y-8">
        <Bloc
          titre="Ils ont répondu"
          aide="À traiter avant tout le reste."
          liste={aRepondu}
          formes={formes}
        />
        <Bloc
          titre="En retard"
          aide="Leur date de relance est passée et rien n'est parti."
          liste={enRetard}
          formes={formes}
        />
        <Bloc
          titre="À relancer aujourd'hui"
          aide="Dix jours après leur message, sans réponse."
          liste={duJour}
          formes={formes}
        />
        <Bloc
          titre="Vidéos à filmer"
          aide="Pour les relances des sept prochains jours. Le sujet et les liens à ouvrir sont dans chaque fiche."
          liste={aFilmer}
          formes={formes}
        />
        {rien ? (
          <p className="text-muted-foreground border-line rounded-md border border-dashed px-6 py-10 text-center text-sm">
            Rien ne tombe aujourd&apos;hui.
          </p>
        ) : null}
      </div>
    );
  }

  if (vue === "contacts") {
    const tous = [...prospects].sort((a, b) =>
      (b.contacte_le ?? "").localeCompare(a.contacte_le ?? ""),
    );
    return (
      <div className="space-y-2">
        {tous.map((p) => {
          const { forme, choisie } = formeDe(p, formes);
          return <Fiche key={p.slug} p={p} forme={forme} choisie={choisie} />;
        })}
      </div>
    );
  }

  const groupes = new Map<Groupe, Prospect[]>();
  for (const p of prospects) {
    const g = groupeDe(p, aujourdhui);
    const liste = groupes.get(g);
    if (liste) liste.push(p);
    else groupes.set(g, [p]);
  }

  return (
    <div className="space-y-8">
      {ORDRE_GROUPES.filter((g) => groupes.has(g)).map((g) => {
        const liste = [...(groupes.get(g) ?? [])].sort(trierDansGroupe);
        return (
          <section key={g}>
            <h2 className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
              {LIBELLE_GROUPE[g]}
              <span className="ml-2 font-mono">{liste.length}</span>
            </h2>
            <div className="space-y-2">
              {liste.map((p) => {
                const { forme, choisie } = formeDe(p, formes);
                return <Fiche key={p.slug} p={p} forme={forme} choisie={choisie} />;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
