const relative = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

const PALIERS: {
  limite: number;
  unite: Intl.RelativeTimeFormatUnit;
  pas: number;
}[] = [
  { limite: 3600, unite: "minute", pas: 60 },
  { limite: 86400, unite: "hour", pas: 3600 },
  { limite: 604800, unite: "day", pas: 86400 },
  { limite: 2629800, unite: "week", pas: 604800 },
  { limite: 31557600, unite: "month", pas: 2629800 },
  { limite: Infinity, unite: "year", pas: 31557600 },
];

/**
 * « il y a 3 heures », « hier », « à l'instant ».
 *
 * À calculer côté serveur et à passer en texte aux composants clients : sinon
 * le rendu diverge entre le serveur et le navigateur.
 */
export function tempsRelatif(iso: string, maintenant = new Date()): string {
  const secondes = (new Date(iso).getTime() - maintenant.getTime()) / 1000;

  if (Math.abs(secondes) < 60) return "à l'instant";

  const palier =
    PALIERS.find((p) => Math.abs(secondes) < p.limite) ?? PALIERS.at(-1)!;
  return relative.format(Math.round(secondes / palier.pas), palier.unite);
}
