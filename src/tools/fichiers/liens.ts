import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * Les liens signés vers le bucket privé.
 *
 * Toujours produits avec la session de l'utilisateur, jamais avec la clé
 * secrète : signer, c'est ouvrir une porte, et c'est la RLS qui doit décider
 * qui peut la faire ouvrir. Une heure de validité, et rien n'est conservé —
 * un lien périmé se redemande.
 */
export const BUCKET = "fichiers";
export const DUREE = 3600;

/** Largeur des vignettes de liste, et qualité qui va avec. */
const VIGNETTE = { largeur: 480, qualite: 75 };

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const cheminObjet = (organizationId: string, fileId: string) =>
  `${organizationId}/${fileId}`;

/** Le seul dérivé jamais stocké : l'image de couverture d'une vidéo. */
export const cheminPoster = (organizationId: string, fileId: string) =>
  `${organizationId}/${fileId}.poster.jpg`;

/**
 * Vignettes d'une liste.
 *
 * Les images sont signées une par une, avec leur transformation : un jeton
 * n'autorise que les transformations avec lesquelles il a été signé. Un jeton
 * signé sans transformation, passé à la route de rendu avec une largeur en
 * paramètre, répond 200 — mais sert l'image entière : le paramètre est
 * ignoré. Vérifié à la mesure, une vignette faisait 1600 px de large.
 *
 * Les couvertures de vidéo, elles, sont déjà à la bonne taille : une seule
 * signature groupée suffit.
 */
export async function vignettes(
  supabase: Supabase,
  organizationId: string,
  fichiers: { id: string; mimeType: string }[],
): Promise<Record<string, string>> {
  const images = fichiers.filter((f) => f.mimeType.startsWith("image/"));
  const videos = fichiers.filter((f) => f.mimeType.startsWith("video/"));

  const [signatures, posters] = await Promise.all([
    // En parallèle : une page de cinquante photos coûte une latence, pas cinquante.
    Promise.all(
      images.map(async (image) => {
        const { data } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(cheminObjet(organizationId, image.id), DUREE, {
            transform: {
              width: VIGNETTE.largeur,
              quality: VIGNETTE.qualite,
              resize: "cover",
            },
          });
        return { id: image.id, url: data?.signedUrl ?? null };
      }),
    ),
    videos.length > 0
      ? supabase.storage
          .from(BUCKET)
          .createSignedUrls(
            videos.map((video) => cheminPoster(organizationId, video.id)),
            DUREE,
          )
      : Promise.resolve({ data: [] }),
  ]);

  const liens: Record<string, string> = {};

  for (const signature of signatures) {
    if (signature.url) liens[signature.id] = signature.url;
  }

  for (const [rang, signe] of (posters.data ?? []).entries()) {
    const video = videos[rang];
    // Une vidéo sans couverture — déposée avant que l'outil sache en faire —
    // n'a simplement pas de vignette.
    if (!video || signe.error || !signe.signedUrl) continue;
    liens[video.id] = signe.signedUrl;
  }

  return liens;
}

/** Aperçu grand format d'une image, pour la fiche. */
export async function apercuImage(
  supabase: Supabase,
  organizationId: string,
  fileId: string,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(cheminObjet(organizationId, fileId), DUREE, {
      transform: { width: 1600, quality: 80, resize: "contain" },
    });

  return data?.signedUrl ?? null;
}

/** L'original, tel quel : lecture vidéo, PDF, ou téléchargement. */
export async function lienOriginal(
  supabase: Supabase,
  organizationId: string,
  fileId: string,
  nomTelechargement?: string,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(
      cheminObjet(organizationId, fileId),
      DUREE,
      nomTelechargement ? { download: nomTelechargement } : undefined,
    );

  return data?.signedUrl ?? null;
}
