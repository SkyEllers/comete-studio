/**
 * L'enregistreur d'appel des closeuses (Louis, 09/10/2026) : règles sans
 * navigateur, testables seules.
 */

/**
 * Chrome ou Edge sur ordinateur : les seuls qui savent capter le son d'un
 * onglet (« Partager l'audio de l'onglet »). Ni Safari, ni Firefox, ni un
 * téléphone.
 */
export function navigateurCompatible(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return false;
  if (/firefox|fxios/.test(ua)) return false;
  return /chrome\/|edg\//.test(ua);
}

/** « 12:05 », « 1:02:30 » */
export function chrono(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Le nom du fichier déposé : la cliente et le jour, sans caractère gênant. */
export function nomFichierAppel(prenom: string, debutIso: string): string {
  const jour = debutIso.slice(0, 10);
  const propre =
    prenom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "cliente";
  return `appel-${propre}-${jour}.webm`;
}
