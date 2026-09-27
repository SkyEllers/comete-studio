/**
 * Palette du kanban : huit couleurs, pour les tableaux comme pour les
 * étiquettes.
 *
 * La base ne stocke que la clé (`ember`, `sun`, …), jamais un hex : une
 * retouche de teinte se fait ici, sans migration, et une valeur inconnue en
 * base ne casse rien — `boardColor()` retombe sur `ember`.
 *
 * Les teintes sont posées en clair plutôt qu'en classes Tailwind : elles sont
 * choisies par la donnée, donc Tailwind ne pourrait pas les générer.
 */
export const BOARD_COLORS = [
  "ember",
  "sun",
  "mint",
  "sky",
  "violet",
  "rose",
  "sand",
  "stone",
] as const;

export type BoardColor = (typeof BOARD_COLORS)[number];

/* Teintes reprises le 27/09/2026 pour le papier de la charte « Carnet de
   bord » : l'encre tient 4,5 sur chacune (texte des étiquettes). Les clés ne
   bougent pas, la base n'a rien à migrer. */
export const PALETTE: Record<BoardColor, { label: string; hex: string }> = {
  ember: { label: "Braise", hex: "#ee7c55" },
  sun: { label: "Soleil", hex: "#f6d365" },
  mint: { label: "Menthe", hex: "#7fc29b" },
  sky: { label: "Ciel", hex: "#8ec5e0" },
  violet: { label: "Violet", hex: "#b9a5e3" },
  rose: { label: "Rose", hex: "#f29aa8" },
  sand: { label: "Sable", hex: "#d9c3a5" },
  stone: { label: "Pierre", hex: "#b3ada2" },
};

export const DEFAULT_BOARD_COLOR: BoardColor = "ember";

/** Toute valeur inattendue venue de la base retombe sur la couleur par défaut. */
export function boardColor(value: string | null | undefined): BoardColor {
  return value && value in PALETTE
    ? (value as BoardColor)
    : DEFAULT_BOARD_COLOR;
}

export function colorHex(value: string | null | undefined): string {
  return PALETTE[boardColor(value)].hex;
}
