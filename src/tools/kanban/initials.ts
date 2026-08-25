/** Deux lettres pour un avatar : « Louis Girault » → LG, « peggy@ex.fr » → P. */
export function initiales(nom: string) {
  const morceaux = nom.split(/[\s@._-]+/).filter(Boolean);
  return ((morceaux[0]?.[0] ?? "?") + (morceaux[1]?.[0] ?? "")).toUpperCase();
}
