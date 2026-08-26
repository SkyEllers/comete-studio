-- ===========================================================================
-- 0010 — D'où vient la récurrence
--
-- Une attribution par récurrence dit « ce rendez-vous garde le canal du
-- précédent ». Encore faut-il pouvoir montrer lequel : c'est ce qui rend
-- l'attribution vérifiable par le client, et donc la commission défendable.
--
-- Sans cette colonne, la fiche ne pourrait dire que « par récurrence », ce qui
-- demande de croire sur parole. Avec elle, elle dit « via récurrence : séance
-- du 12 mars », et le client la retrouve dans son propre agenda.
--
-- Nulle pour les rendez-vous reçus avant cette migration : la fiche retombe
-- alors sur la formule courte.
-- ===========================================================================

alter table public.radar_bookings
  add column attribution_source_id uuid
  references public.radar_bookings(id) on delete set null;

comment on column public.radar_bookings.attribution_source_id is
  'Le rendez-vous qui a transmis son canal, quand attribution = recurrence.';

create index radar_bookings_attribution_source_idx
  on public.radar_bookings(attribution_source_id);

/*
 * La vue expose toutes les colonnes de la table par `b.*`, et la nouvelle
 * s'insère au milieu. `create or replace` ne sait qu'ajouter des colonnes en
 * fin de liste : il faut donc la reconstruire. Rien n'en dépend en base — ni
 * vue, ni fonction — seule l'application la lit.
 */
drop view if exists public.radar_bookings_effective;

create view public.radar_bookings_effective
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
