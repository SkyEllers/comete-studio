-- ===========================================================================
-- 0003 — `has_tool` ne répond plus sur les organisations dont on n'est pas membre
--
-- Constat du test à deux comptes exigé par CLAUDE.md §7 : has_tool(org, slug)
-- était la seule des quatre fonctions d'accès à ne pas dépendre de auth.uid().
-- Un compte authentifié quelconque, connaissant l'identifiant d'une autre
-- organisation, apprenait donc quels outils y sont activés — vérifié : le
-- compte B recevait `true` pour has_tool(org de A, 'kanban').
--
-- La fonction porte désormais la même règle que la couche applicative
-- (requireToolAccess) : membre de l'organisation, ou Louis. Un admin garde donc
-- l'accès aux espaces clients, et reste soumis à l'activation de l'outil.
--
-- Note : avec la clé secrète (service role), auth.uid() est nul, donc cette
-- fonction renvoie false. Les Server Actions d'administration lisent
-- organization_tools directement, elles ne passent pas par has_tool.
-- ===========================================================================

create or replace function public.has_tool(org uuid, tool_slug text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select (public.is_member(org) or public.is_admin())
     and exists (select 1 from public.organization_tools ot
                 join public.tools t on t.id = ot.tool_id
                 where ot.organization_id = org and t.slug = tool_slug
                   and ot.enabled and t.is_active);
$fn$;

-- CREATE OR REPLACE conserve les privilèges, on les réaffirme par sécurité.
revoke execute on function public.has_tool(uuid, text) from public;
revoke execute on function public.has_tool(uuid, text) from anon;
grant execute on function public.has_tool(uuid, text) to authenticated;
