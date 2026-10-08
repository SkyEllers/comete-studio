import {
  CHAMPS_RESUME,
  texteACopier,
  type EtatTranscription,
  type Replique,
  type ResumeDiagnostic,
} from "../resultats/enregistrement-format.ts";

/**
 * Le dossier de la cliente en un seul texte (Louis, 08/10/2026) : Peggy le
 * colle dans ChatGPT pour préparer son premier rendez-vous. Ce qu'elle a
 * répondu en réservant son diagnostic, puis l'appel avec la closeuse
 * (transcription, ou résumé écrit à sa place). Fonction pure : testée sans
 * réseau, lue par l'action `lireDossier`.
 */

export type Dossier = {
  nom: string;
  /** Début du diagnostic (ISO), ou null s'il n'est pas connu. */
  diagnosticLe: string | null;
  closeuse: string | null;
  /** « Ce qu'elle veut », écrit par la closeuse dans le devis. */
  objet: string | null;
  reponses: { question: string; reponse: string }[];
  enregistrement: {
    sansEnregistrement: boolean;
    resume: ResumeDiagnostic | null;
    transcriptionEtat: EtatTranscription;
    transcription: Replique[] | null;
  } | null;
};

const jourDuDiagnostic = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(iso));

/** Le texte à copier, et ce qui manque encore (à dire à côté du bouton). */
export function dossierACopier(d: Dossier): { texte: string; manque: string[] } {
  const manque: string[] = [];
  const blocs: string[] = [];

  const tete = [`Dossier de ${d.nom}`];
  if (d.diagnosticLe) tete.push(`Diagnostic du ${jourDuDiagnostic(d.diagnosticLe)}${d.closeuse ? `, avec ${d.closeuse}` : ""}.`);
  if (d.objet?.trim()) tete.push(`Ce qu'elle veut (écrit dans son devis) : « ${d.objet.trim()} »`);
  blocs.push(tete.join("\n"));

  if (d.reponses.length) {
    blocs.push(
      ["SES RÉPONSES AU QUESTIONNAIRE (en réservant son diagnostic)", ...d.reponses.map((r) => `Question : ${r.question}\nSa réponse : ${r.reponse}`)].join(
        "\n\n",
      ),
    );
  } else {
    manque.push("pas de réponses au questionnaire");
  }

  const e = d.enregistrement;
  if (!e) {
    manque.push("pas d'enregistrement du diagnostic");
  } else if (e.sansEnregistrement) {
    const champs = CHAMPS_RESUME.map((c) => ({ libelle: c.libelle, texte: e.resume?.[c.cle]?.trim() ?? "" })).filter((c) => c.texte);
    if (champs.length) {
      blocs.push(["RÉSUMÉ DU DIAGNOSTIC (écrit par la closeuse, sans enregistrement)", ...champs.map((c) => `${c.libelle} : ${c.texte}`)].join("\n\n"));
    } else {
      manque.push("pas d'enregistrement ni de résumé du diagnostic");
    }
  } else if (e.transcriptionEtat === "faite" && e.transcription?.length) {
    blocs.push(
      texteACopier(e.transcription, "TRANSCRIPTION DU DIAGNOSTIC (deux voix : la cliente et la closeuse ; « Voix A » parle en premier)"),
    );
  } else if (e.transcriptionEtat === "echec") {
    manque.push("la transcription du diagnostic n'a pas marché");
  } else {
    manque.push("transcription du diagnostic pas encore prête");
  }

  return { texte: blocs.join("\n\n\n") + "\n", manque };
}
