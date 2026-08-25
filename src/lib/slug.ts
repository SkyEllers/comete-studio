/**
 * « Le Petit Palais 69 » devient « le-petit-palais-69 ».
 *
 * Utilisé côté serveur pour valider, et côté navigateur pour montrer le slug
 * proposé pendant la frappe : d'où l'absence de `server-only` ici.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marques diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
