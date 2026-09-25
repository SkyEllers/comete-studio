/**
 * La marque de l'agent sur un rendez-vous de Radar (0041), telle que Louis
 * et la closeuse la lisent.
 */

export type AgentSuivi = "en_cours" | "confirme" | "sans_reponse_veille" | "stop";

export const LIBELLES_SUIVI: Record<AgentSuivi, string> = {
  en_cours: "Assistante : pas encore confirmé",
  confirme: "Assistante : confirmé",
  sans_reponse_veille: "Assistante : sans réponse à la veille",
  stop: "Assistante : ne veut plus de messages",
};

export function libelleSuivi(valeur: string | null | undefined): string | null {
  return valeur && valeur in LIBELLES_SUIVI ? LIBELLES_SUIVI[valeur as AgentSuivi] : null;
}
