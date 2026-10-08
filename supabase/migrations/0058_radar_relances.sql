-- ===========================================================================
-- 0058 — Les relances notées par les closeuses (Louis, 08/10/2026)
--
-- Une closeuse relance elle-même ses clientes avant le diagnostic (SMS la
-- veille, le jour même, 30 minutes avant, au début du rendez-vous) ; l'espace
-- ne montrait que ce qu'avait fait l'assistante WhatsApp. Demandé par les
-- closeuses après deux absentes chez Peggy Auger le 08/10.
--
-- Une ligne par case cochée : le rendez-vous, l'étape, qui l'a cochée et
-- quand. Décocher efface la ligne. Lisible par la closeuse du rendez-vous et
-- par qui voit Radar ; écritures par le serveur (service role), après
-- contrôle de la session dans l'app.
-- ===========================================================================

create table public.radar_relances (
  booking_id      uuid not null references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  etape           text not null check (etape in ('veille', 'jour', 'trente', 'pendant', 'confirme')),
  user_id         uuid references public.profiles(id) on delete set null,
  coche_le        timestamptz not null default now(),
  primary key (booking_id, etape)
);

comment on table public.radar_relances is
  'Les relances qu''une closeuse a faites avant un diagnostic, et sa confirmation (0058, 08/10/2026).';

create index radar_relances_organisation_idx on public.radar_relances (organization_id);

alter table public.radar_relances enable row level security;

create policy "radar_relances_select" on public.radar_relances
  for select to authenticated
  using (
    public.can_access_radar(organization_id)
    or (public.is_closeuse(organization_id)
        and exists (select 1 from public.radar_bookings b
                     where b.id = booking_id and b.closeuse_id = (select auth.uid())))
  );
