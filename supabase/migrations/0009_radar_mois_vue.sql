-- ===========================================================================
-- 0009 — Le mois rejoint la vue de Radar
--
-- Le tableau de bord du client, sa liste de rendez-vous et le relevé mensuel
-- doivent découper les mois exactement de la même façon. Sinon ils se
-- contrediront, et c'est précisément ce qu'un outil de commission ne peut pas
-- se permettre : le client verrait une séance en novembre que le relevé
-- compterait en octobre.
--
-- Le découpage se fait déjà en heure de Paris dans `radar_mois()`. Le poser
-- sur la vue plutôt que de le refaire en JavaScript épargne à l'application
-- toute arithmétique de fuseau — celle qui, faite naïvement, range une séance
-- du 1er novembre à 00 h 30 dans le mois d'octobre.
--
-- `create or replace` : la colonne s'ajoute à la fin, les précédentes ne
-- bougent ni de nom, ni de type, ni de rang.
-- ===========================================================================

create or replace view public.radar_bookings_effective
  with (security_invoker = on) as
select b.*,
       e.effective_status,
       e.effective_status = 'honore'
         and b.payment_ok
         and b.amount_cents > 0
         and coalesce(c.is_comete, false) as counts_for_commission,
       public.radar_mois(b.scheduled_start) as mois
  from public.radar_bookings b
  left join public.radar_channels c on c.id = b.channel_id
  cross join lateral (
    select case
             when b.status = 'confirme' and b.scheduled_end < now()
               then 'honore'::public.radar_status
             else b.status
           end as effective_status
  ) e;
