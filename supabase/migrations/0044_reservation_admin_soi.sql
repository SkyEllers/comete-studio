-- ===========================================================================
-- 0044 — Réservation : Louis règle sa propre fiche
--
-- `reservation_est_a_moi` (0042) ne reconnaissait sa fiche qu'à une membre
-- du client ou à une closeuse. Louis entre partout comme administrateur sans
-- être membre de rien : le 27/09/2026, sa fiche d'essai dans l'espace de
-- Comète refusait ses horaires et ses absences.
--
-- La fiche doit toujours être la sienne (`user_id = auth.uid()`) : être
-- administrateur ne donne pas la main sur la fiche de quelqu'un d'autre.
-- ===========================================================================

create or replace function public.reservation_est_a_moi(personne uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.reservation_personnes p
     where p.id = personne
       and p.user_id = auth.uid()
       and (public.is_member(p.organization_id)
            or public.is_closeuse(p.organization_id)
            or public.is_admin())
  );
$fn$;

revoke execute on function public.reservation_est_a_moi(uuid) from public, anon;
grant execute on function public.reservation_est_a_moi(uuid) to authenticated;
