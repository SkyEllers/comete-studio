/**
 * L'enregistrement du diagnostic : ce qui se lit des deux côtés, sans rien
 * appeler. Les fonctions pures sont ici pour être testées sans réseau.
 */

export type Replique = { qui: string; debut: number; fin: number; texte: string };

export type ResumeDiagnostic = {
  probleme: string;
  objectif: string;
  freins: string;
  propose: string;
};

export const CHAMPS_RESUME: { cle: keyof ResumeDiagnostic; libelle: string; aide: string }[] = [
  { cle: "probleme", libelle: "Son problème", aide: "Ce qui l'a fait réserver, avec ses mots." },
  { cle: "objectif", libelle: "Ce qu'elle veut", aide: "Où elle voudrait en être." },
  { cle: "freins", libelle: "Ses freins", aide: "Ce qui la retient : l'argent, le temps, le doute…" },
  { cle: "propose", libelle: "Ce qui a été proposé", aide: "L'accompagnement, le prix, la suite." },
];

export type EtatTranscription = "aucune" | "en_cours" | "faite" | "echec";

export type Enregistrement = {
  bookingId: string;
  /** Lien signé pour lire la vidéo, valable une heure ; null sans vidéo. */
  lien: string | null;
  nomFichier: string | null;
  taille: number | null;
  sansEnregistrement: boolean;
  resume: ResumeDiagnostic | null;
  transcriptionEtat: EtatTranscription;
  transcription: Replique[] | null;
  deposeLe: string;
  deposePar: string | null;
};

/** Les répliques d'AssemblyAI, gardées sans ce dont on n'a pas besoin (mots, confiance). */
export function versRepliques(utterances: unknown): Replique[] {
  if (!Array.isArray(utterances)) return [];
  const sortie: Replique[] = [];
  for (const u of utterances) {
    if (!u || typeof u !== "object") continue;
    const { speaker, start, end, text } = u as Record<string, unknown>;
    const texte = typeof text === "string" ? text.trim() : "";
    if (!texte) continue;
    sortie.push({
      qui: typeof speaker === "string" && speaker ? speaker : "?",
      debut: typeof start === "number" ? Math.max(0, Math.round(start)) : 0,
      fin: typeof end === "number" ? Math.max(0, Math.round(end)) : 0,
      texte,
    });
  }
  return sortie;
}

/** « 12:05 », ou « 1:02:05 » au-delà d'une heure. */
export function horodatage(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const deux = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${deux(m)}:${deux(s)}` : `${m}:${deux(s)}`;
}

export const nomVoix = (qui: string) => `Voix ${qui}`;

/** Le texte à coller ailleurs (ChatGPT, un dossier) : une réplique par paragraphe. */
export function texteACopier(repliques: Replique[], titre?: string): string {
  const corps = repliques
    .map((r) => `${nomVoix(r.qui)} (${horodatage(r.debut)}) : ${r.texte}`)
    .join("\n\n");
  return titre ? `${titre}\n\n${corps}` : corps;
}

/** Le résumé écrit, relu depuis la base : un objet aux quatre champs, ou rien. */
export function lireResume(valeur: unknown): ResumeDiagnostic | null {
  if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) return null;
  const v = valeur as Record<string, unknown>;
  const champ = (cle: keyof ResumeDiagnostic) => (typeof v[cle] === "string" ? (v[cle] as string) : "");
  return { probleme: champ("probleme"), objectif: champ("objectif"), freins: champ("freins"), propose: champ("propose") };
}

/** « 412 Mo », « 1,2 Go ». */
export function poids(octets: number): string {
  if (octets >= 1024 ** 3) return `${(octets / 1024 ** 3).toFixed(1).replace(".", ",")} Go`;
  return `${Math.max(1, Math.round(octets / 1024 ** 2))} Mo`;
}

/**
 * Le type d'un fichier que le bucket accepte (vidéo ou audio). Le navigateur
 * ne le connaît pas toujours : un .m4a de Zoom arrive parfois sans type.
 */
export function typeDuFichier(nom: string, type: string): string | null {
  if (type.startsWith("video/") || type.startsWith("audio/")) return type;
  const ext = nom.toLowerCase().split(".").pop() ?? "";
  const parExtension: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
  };
  return parExtension[ext] ?? null;
}
