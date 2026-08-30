-- ===========================================================================
-- 0013 — Sas : les compteurs des boîtes
--
-- La page des boîtes affiche, pour chacune, combien d'idées actives elle
-- porte et quand la dernière est tombée. Trois façons de l'obtenir, une
-- seule qui tienne :
--
-- Une requête de comptage par boîte, c'est autant d'allers-retours que de
-- boîtes. Rapatrier toutes les notes pour les compter dans l'application,
-- c'est faire voyager des milliers de lignes pour n'en afficher que trente —
-- et un vide-tête accumule, par construction. Reste l'agrégat, fait là où
-- sont les données, qui rend une ligne par boîte.
--
-- `security invoker` (le défaut, comme `stats_fichiers`) : la fonction voit
-- ce que voit celui qui l'appelle. La RLS de `sas_notes` s'applique, donc
-- l'outil coupé rend des compteurs vides, et un membre d'une autre
-- organisation ne compte rien. Un `security definer` ici aurait fait fuiter
-- le volume d'activité d'un client à un autre — pas son contenu, mais assez
-- pour savoir qu'il en a.
-- ===========================================================================

create or replace function public.sas_compteurs(org uuid)
returns table (
  box_id   uuid,          -- null = Perso ou « À ranger », selon `realm`
  realm    public.sas_realm,
  notes    bigint,
  derniere timestamptz
)
language sql stable set search_path = public as $fn$
  select n.box_id, n.realm, count(*)::bigint, max(n.captured_at)
    from public.sas_notes n
   where n.organization_id = org
     and not n.is_archived
   group by n.box_id, n.realm;
$fn$;

-- Règle CLAUDE.md §7 : sans ce revoke, la fonction est appelable sans session.
revoke execute on function public.sas_compteurs(uuid) from public, anon;
grant execute on function public.sas_compteurs(uuid) to authenticated;
