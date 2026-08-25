-- ===========================================================================
-- 0002 — Réserver les fonctions d'accès au rôle `authenticated`
--
-- Le `revoke execute ... from public` de 0001 ne suffit pas : Supabase pose des
-- privilèges par défaut qui accordent EXECUTE *directement* à anon,
-- authenticated et service_role. Le revoke sur PUBLIC ne touche pas ces
-- grants-là. Vérifié : POST /rest/v1/rpc/is_admin avec la seule clé publique
-- répondait `false` au lieu d'être refusé.
--
-- Le vrai risque était `has_tool(org, slug)`, la seule des quatre fonctions qui
-- ne dépend pas de auth.uid() : un appelant anonyme connaissant l'identifiant
-- d'une organisation pouvait apprendre quels outils y sont activés.
--
-- À retenir pour les prochaines migrations : toute nouvelle fonction du schéma
-- public doit refaire ce revoke explicite pour anon.
-- ===========================================================================

revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_member(uuid) from anon;
revoke execute on function public.has_tool(uuid, text) from anon;
revoke execute on function public.shares_org_with(uuid) from anon;
