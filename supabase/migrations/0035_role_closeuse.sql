-- ===========================================================================
-- 0035 — Un troisième rôle de membre : la closeuse
--
-- Seul dans son fichier : Postgres refuse qu'une valeur d'enum ajoutée soit
-- utilisée dans la transaction qui l'ajoute. La 0036 s'en sert.
-- ===========================================================================

alter type public.membership_role add value if not exists 'closeuse';
