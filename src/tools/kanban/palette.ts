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

export const PALETTE: Record<BoardColor, { label: string; hex: string }> = {
  ember: { label: "Ember", hex: "#ff6b35" },
  sun: { label: "Soleil", hex: "#fbbf24" },
  mint: { label: "Menthe", hex: "#4ade80" },
  sky: { label: "Ciel", hex: "#38bdf8" },
  violet: { label: "Violet", hex: "#a78bfa" },
  rose: { label: "Rose", hex: "#fb7185" },
  sand: { label: "Sable", hex: "#d6bfa3" },
  stone: { label: "Pierre", hex: "#9a9a96" },
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
