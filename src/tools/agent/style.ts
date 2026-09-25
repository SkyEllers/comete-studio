/**
 * Les tournures que les consignes interdisent, vérifiables sans juger le
 * style : de quoi mesurer, sur les bancs, combien de réponses y échappent.
 */
export const INTERDITS: { motif: RegExp; libelle: string }[] = [
  { motif: /—/, libelle: "tiret long" },
  { motif: /n'h[ée]site pas/i, libelle: "« N'hésite pas »" },
  { motif: /excellente question/i, libelle: "« Excellente question »" },
  { motif: /bien s[ûu]r\s*!/i, libelle: "« Bien sûr ! »" },
  { motif: /je comprends tout [àa] fait/i, libelle: "« Je comprends tout à fait »" },
  { motif: /j'esp[èe]re que/i, libelle: "« J'espère que »" },
  { motif: /(^|[^\p{L}])voici([^\p{L}]|$)/iu, libelle: "« Voici »" },
  { motif: /en tant qu'IA/i, libelle: "« En tant qu'IA »" },
  {
    motif: /(^|[^\p{L}])(essentiel|crucial|v[ée]ritable|incroyable|parcours|booster|potentiel)([^\p{L}]|$)/iu,
    libelle: "mot de la liste noire",
  },
];

export function tournuresInterdites(texte: string): string[] {
  return INTERDITS.filter((i) => i.motif.test(texte)).map((i) => i.libelle);
}
