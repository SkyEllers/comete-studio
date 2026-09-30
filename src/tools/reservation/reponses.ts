import { heureEnMots, jourEnMots } from "../agent/temps.ts";

/**
 * Les réponses au formulaire de réservation, là où la personne qui reçoit le
 * diagnostic les lit (Louis, 30/09/2026) : sous le rendez-vous dans « Mon
 * agenda », dans l'événement de son agenda « Diagnostics », et dans le mail
 * qui la prévient de chaque réservation. Avant, seules les closeuses les
 * voyaient (Radar) ; Peggy arrivait à ses diagnostics sans elles.
 *
 * Tout ici est pur : la mise en forme, sans base ni envoi.
 */

export type Reponse = { question: string; reponse: string };

export type Reservee = {
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  reponses: unknown;
};

/** Les réponses lisibles, dans l'ordre du formulaire ; le reste est ignoré. */
export function reponsesLues(brut: unknown): Reponse[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter((r): r is Reponse => typeof r?.question === "string" && typeof r?.reponse === "string")
    .map((r) => ({ question: r.question.trim(), reponse: r.reponse.trim() }))
    .filter((r) => r.question && r.reponse);
}

export function nomComplet(r: Pick<Reservee, "prenom" | "nom">): string {
  return [r.prenom, r.nom].map((x) => x?.trim()).filter(Boolean).join(" ") || "une cliente";
}

const couper = (texte: string, max: number) => (texte.length > max ? `${texte.slice(0, max - 1)}…` : texte);

/*
 * Google n'annonce pas de limite pour la description d'un événement, mais
 * refuse les très longues : 12 réponses de 2 000 caractères n'y entrent pas.
 * On coupe chaque réponse, puis l'ensemble ; le texte entier reste dans son
 * espace et dans le mail.
 */
const MAX_REPONSE_GOOGLE = 1500;
const MAX_DESCRIPTION_GOOGLE = 7000;

/** La description de l'événement Google : qui, son numéro, ses réponses. */
export function descriptionEvenement(r: Reservee, lienEspace: string): string {
  const reponses = reponsesLues(r.reponses);
  const tete = [
    `Diagnostic réservé en ligne par ${nomComplet(r)}.`,
    r.telephone ? `Téléphone : ${r.telephone}` : null,
    "",
    "Pense à lancer l'enregistrement de l'appel dès le début : tu déposeras la vidéo sur la fiche du rendez-vous.",
  ].filter((l) => l !== null);
  const pied = ["", `Tout est aussi dans ton espace : ${lienEspace}`];
  const corps = reponses.length
    ? ["", "Ses réponses :", ...reponses.flatMap((x) => ["", x.question, couper(x.reponse, MAX_REPONSE_GOOGLE)])]
    : [];

  const place = MAX_DESCRIPTION_GOOGLE - [...tete, ...pied].join("\n").length - 2;
  return [...tete, couper(corps.join("\n"), place), ...pied].join("\n");
}

export type Prevenir = {
  type: "nouveau" | "deplace";
  rdv: Reservee & { debut: string };
  fuseau: string;
  lienVisio: string | null;
  lienEspace: string;
};

function echapper(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Le mail à la personne qui tient le diagnostic : quand, qui, ses réponses. */
export function mailReservation(p: Prevenir): { sujet: string; texte: string; html: string } {
  const qui = nomComplet(p.rdv);
  const prenom = p.rdv.prenom?.trim() || qui;
  const quand = `${jourEnMots(p.rdv.debut, p.fuseau)} à ${heureEnMots(p.rdv.debut, p.fuseau)}`;
  const reponses = reponsesLues(p.rdv.reponses);

  const sujet =
    p.type === "nouveau" ? `Nouveau diagnostic : ${prenom}, ${quand}` : `Diagnostic déplacé : ${prenom}, ${quand}`;
  const phrase =
    p.type === "nouveau"
      ? `${prenom} a réservé un diagnostic pour ${quand}.`
      : `${prenom} a déplacé son diagnostic au ${quand}. Ton agenda est à jour.`;
  const coordonnees = [
    qui,
    p.rdv.telephone ? `Téléphone : ${p.rdv.telephone}` : null,
    p.rdv.email ? `Email : ${p.rdv.email}` : null,
  ].filter((l): l is string => l !== null);

  const texte = [
    phrase,
    "",
    ...coordonnees,
    ...(reponses.length ? ["", "Ses réponses :", ...reponses.flatMap((x) => ["", x.question, x.reponse])] : []),
    "",
    ...(p.lienVisio ? [`Visio : ${p.lienVisio}`] : []),
    `Ton espace : ${p.lienEspace}`,
    "",
  ].join("\n");

  const para = (t: string) => echapper(t).replace(/\n/g, "<br>");
  const html = [
    `<p>${echapper(phrase)}</p>`,
    `<p>${coordonnees.map(echapper).join("<br>")}</p>`,
    ...(reponses.length
      ? [
          "<p><strong>Ses réponses</strong></p>",
          ...reponses.map((x) => `<p><strong>${echapper(x.question)}</strong><br>${para(x.reponse)}</p>`),
        ]
      : []),
    `<p>${p.lienVisio ? `<a href="${echapper(p.lienVisio)}">Ouvrir la visio</a> · ` : ""}<a href="${echapper(p.lienEspace)}">Ton espace</a></p>`,
  ].join("\n");

  return { sujet, texte, html };
}
