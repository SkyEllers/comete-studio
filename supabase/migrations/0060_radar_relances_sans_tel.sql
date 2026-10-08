-- ===========================================================================
-- 0060 — « Pas de téléphone » dans les relances des closeuses (08/10/2026)
--
-- Demandé par Peggy Auger : certaines clientes ne laissent pas de numéro
-- (des réservations Calendly du 29/09 au 03/10 sont arrivées sans), et la
-- closeuse n'a alors aucune relance possible par SMS. Elle le note, pour que
-- Peggy et l'analyse le sachent.
-- ===========================================================================

alter table public.radar_relances drop constraint if exists radar_relances_etape_check;

alter table public.radar_relances
  add constraint radar_relances_etape_check
  check (etape in ('veille', 'jour', 'trente', 'pendant', 'confirme', 'sans_tel'));
