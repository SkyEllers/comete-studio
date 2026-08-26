import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
} from "lucide-react";

/**
 * L'icône d'un fichier, d'après son type.
 *
 * Le composant rend directement son JSX plutôt que de renvoyer une icône à
 * poser plus loin : une fonction qui rend un composant se lit comme une
 * fabrique de composants pendant le rendu, ce que React n'aime pas — et à
 * juste titre, l'identité changerait à chaque passage.
 */
export function IconeFichier({
  mimeType,
  className,
}: {
  mimeType: string;
  className?: string;
}) {
  const commun = {
    "aria-hidden": true as const,
    className,
    strokeWidth: 1.5,
  };

  if (mimeType.startsWith("image/")) return <FileImage {...commun} />;
  if (mimeType.startsWith("video/")) return <FileVideo {...commun} />;
  if (mimeType.startsWith("audio/")) return <FileAudio {...commun} />;

  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType.includes("document") ||
    mimeType.includes("word")
  ) {
    return <FileText {...commun} />;
  }

  if (
    mimeType.includes("zip") ||
    mimeType.includes("rar") ||
    mimeType.includes("tar") ||
    mimeType.includes("7z")
  ) {
    return <FileArchive {...commun} />;
  }

  return <File {...commun} />;
}

/** Une image ou une vidéo mérite une vignette ; le reste, une ligne. */
export function aUneVignette(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType.startsWith("video/");
}
