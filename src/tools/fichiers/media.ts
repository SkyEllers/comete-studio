/**
 * Ce qu'on peut lire d'un média sans le décoder entièrement : les dimensions
 * d'une image, la durée d'une vidéo. Rien d'indispensable — c'est du confort
 * d'affichage — donc tout échec est silencieux et le fichier part quand même.
 */
const DELAI = 5000;

export type Mesures = {
  width?: number;
  height?: number;
  durationSeconds?: number;
};

async function mesurerImage(fichier: File): Promise<Mesures> {
  const image = await createImageBitmap(fichier);
  const mesures = { width: image.width, height: image.height };
  image.close();
  return mesures;
}

function mesurerVideo(fichier: File): Promise<Mesures> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier);
    const video = document.createElement("video");

    const finir = (issue: () => void) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      issue();
    };

    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finir(() =>
        resoudre({
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          durationSeconds: Number.isFinite(video.duration)
            ? Math.round(video.duration)
            : undefined,
        }),
      );
    video.onerror = () => finir(() => rejeter(new Error("vidéo illisible")));
    video.src = url;
  });
}

/** Un fichier qui résiste part sans mesures plutôt que de bloquer la file. */
export async function mesurer(fichier: File): Promise<Mesures> {
  const chantier = fichier.type.startsWith("image/")
    ? mesurerImage(fichier)
    : fichier.type.startsWith("video/")
      ? mesurerVideo(fichier)
      : Promise.resolve({});

  const garde = new Promise<Mesures>((resoudre) =>
    setTimeout(() => resoudre({}), DELAI),
  );

  try {
    return await Promise.race([chantier, garde]);
  } catch {
    return {};
  }
}

/**
 * Une image de couverture pour une vidéo.
 *
 * C'est le seul dérivé qu'on stocke : le fichier d'origine, lui, n'est jamais
 * transformé. On vise la première seconde — l'image zéro d'une vidéo est
 * souvent noire.
 *
 * Renvoie `null` dès que ça résiste : un format que le navigateur ne décode
 * pas, une vidéo protégée, un canevas refusé. La vidéo partira sans vignette,
 * ce qui n'empêche rien.
 */
export function posterVideo(fichier: File): Promise<Blob | null> {
  if (!fichier.type.startsWith("video/")) return Promise.resolve(null);

  return new Promise((resoudre) => {
    const url = URL.createObjectURL(fichier);
    const video = document.createElement("video");
    let fini = false;

    const finir = (blob: Blob | null) => {
      if (fini) return;
      fini = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resoudre(blob);
    };

    const garde = setTimeout(() => finir(null), DELAI * 2);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 1) / 2);
    };

    video.onseeked = () => {
      try {
        const canevas = document.createElement("canvas");
        // 480 de large, comme les vignettes d'images : inutile d'aller plus loin.
        const echelle = Math.min(1, 480 / (video.videoWidth || 480));
        canevas.width = Math.round((video.videoWidth || 480) * echelle);
        canevas.height = Math.round((video.videoHeight || 270) * echelle);

        const pinceau = canevas.getContext("2d");
        if (!pinceau) return finir(null);

        pinceau.drawImage(video, 0, 0, canevas.width, canevas.height);
        canevas.toBlob(
          (blob) => {
            clearTimeout(garde);
            finir(blob);
          },
          "image/jpeg",
          0.7,
        );
      } catch {
        finir(null);
      }
    };

    video.onerror = () => finir(null);
    video.src = url;
  });
}
