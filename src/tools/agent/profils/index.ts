import type { Profil } from "../profil.ts";
import { peggy } from "./peggy.ts";

const PROFILS: Record<string, Profil> = { peggy };

export const CLES_PROFILS = Object.keys(PROFILS);

export function profil(cle: string): Profil | null {
  return PROFILS[cle] ?? null;
}
