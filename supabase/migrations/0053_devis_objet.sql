-- ===========================================================================
-- 0053 — L'objet du devis
--
-- Décidé à l'appel de Louis avec Peggy du 07/10/2026 : la closeuse écrit,
-- à partir de ses notes, l'objet du devis de la cliente (sa situation, ce
-- qu'elle veut). Il s'imprime en tête du devis, avant l'offre. Les devis
-- d'avant n'en ont pas (null) et ne changent pas.
-- ===========================================================================

alter table public.devis
  add column objet text check (char_length(objet) <= 2000);

comment on column public.devis.objet is
  'L''objet du devis, écrit par la closeuse à partir de ses notes (0053, 07/10/2026). Null pour les devis d''avant.';
