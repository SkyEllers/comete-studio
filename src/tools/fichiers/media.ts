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
