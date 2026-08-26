import "server-only";

/**
 * L'envoi d'email, par l'API Resend.
 *
 * En appel direct plutôt qu'avec le paquet `resend` : une requête POST et un
 * jeton, ce n'est pas assez pour justifier une dépendance de plus.
 *
 * Deux règles tiennent tout ce fichier. La clé ne quitte jamais le serveur
 * (`import "server-only"` le garantit à la compilation). Et un email raté ne
 * casse rien : la fonction renvoie `false`, l'appelant continue. Prévenir
 * Louis est un service rendu, pas une étape du dépôt — un dépôt réussi dont
 * l'email tombe reste un dépôt réussi.
 */

const EXPEDITEUR = "Comète Studio <louis@cometestudio.fr>";
const DESTINATAIRE = "louis@cometestudio.fr";

export type Courriel = {
  sujet: string;
  texte: string;
  html: string;
};

export async function envoyer({
  sujet,
  texte,
  html,
}: Courriel): Promise<boolean> {
  const cle = process.env.RESEND_API_KEY;

  // En local sans clé, on ne tente pas : ce n'est pas une panne, c'est une
  // configuration absente. Le dépôt s'est bien passé, c'est tout ce qui compte.
  if (!cle) return false;

  try {
    const reponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cle}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EXPEDITEUR,
        to: [DESTINATAIRE],
        subject: sujet,
        text: texte,
        html,
      }),
    });

    if (!reponse.ok) {
      console.error(
        "Resend a refusé l'envoi :",
        reponse.status,
        await reponse.text(),
      );
      return false;
    }

    return true;
  } catch (erreur) {
    console.error("Resend est injoignable :", erreur);
    return false;
  }
}

/** Les caractères qui casseraient le HTML s'ils venaient d'un nom de fichier. */
export function echapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
