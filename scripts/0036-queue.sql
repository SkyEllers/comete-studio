
-- --------------------------- Le nombre de fois ------------------------------

/*
 * En combien de fois la cliente paie une vente déjà déclarée. Séparé de
 * `radar_set_sale` pour ne pas toucher à sa signature, que l'app de Peggy
 * appelle déjà. Sans effet sur la commission de Comète : elle ne lit que le
 * montant et la date.
 */
create or replace function public.radar_set_sale_fois(booking_id uuid, fois int)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  cible uuid := booking_id;
  rdv   public.radar_bookings%rowtype;
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  if rdv.sale_amount_cents is null then
    raise exception 'Il n''y a pas de vente sur ce rendez-vous.';
  end if;

  if fois is null or fois < 1 or fois > 24 then
    raise exception 'Une vente se paie en 1 à 24 fois.';
  end if;

  if rdv.sale_fois = fois then
    return;
  end if;

  update public.radar_bookings
     set sale_fois = fois, updated_at = now()
   where id = cible;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (cible, rdv.organization_id, auth.uid(), 'sale.instalments',
     jsonb_build_object('fois', fois, 'fois_precedent', rdv.sale_fois));
end;
$fn$;

revoke execute on function public.radar_set_sale_fois(uuid, int) from public, anon;
grant execute on function public.radar_set_sale_fois(uuid, int) to authenticated;

-- ------------------------------- La purge -----------------------------------

/*
 * Les réponses d'un rendez-vous s'effacent 90 jours après lui. Sauf si la
 * personne a dit quand en reparler et que ce mois n'est pas encore passé
 * (la closeuse a besoin de son numéro pour la rappeler), et jamais au-delà
 * de 25 mois : c'est la limite du mois à recontacter (24 mois) plus un.
 */
create or replace function public.radar_purger_reponses(
  anciennete interval default interval '90 days'
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  effaces integer;
begin
  delete from public.radar_booking_answers a
   using public.radar_bookings b
   where b.id = a.booking_id
     and b.scheduled_end < now() - anciennete
     and (
       b.scheduled_end < now() - interval '25 months'
       or not exists (
         select 1
           from public.radar_booking_activities r
          where r.booking_id = b.id
            and r.type = 'sale.reason'
            and r.payload ? 'recontacter'
            and jsonb_typeof(r.payload -> 'recontacter') = 'string'
            and (r.payload ->> 'recontacter')::date
                  >= (date_trunc('month', now() at time zone 'Europe/Paris') - interval '1 month')::date
            and not exists (
              select 1
                from public.radar_booking_activities d
               where d.booking_id = b.id
                 and d.type = 'recontact.done'
                 and d.created_at > r.created_at
            )
       )
     );

  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.radar_purger_reponses(interval) from public, anon, authenticated;
grant execute on function public.radar_purger_reponses(interval) to service_role;

select cron.unschedule('radar-purge-reponses')
  from cron.job where jobname = 'radar-purge-reponses';

select cron.schedule(
  'radar-purge-reponses',
  '45 3 * * *',
  $cron$ select public.radar_purger_reponses() $cron$
);
