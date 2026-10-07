-- ===========================================================================
-- 0054 — Le R2 avec la titulaire (Louis, 07/10/2026)
--
-- Une cliente veut parler à Peggy avant de décider (questions techniques, son
-- parcours, sa méthode). Le protocole R2 écrit par Peggy : la closeuse vérifie
-- que c'est un vrai R2 de décision, remplit la fiche, et Peggy rappelle.
--
-- 1. Dans « Noter le résultat », la closeuse choisit « R2 avec Peggy » et
--    remplit la fiche du protocole, avec quand joindre la cliente et son
--    numéro.
-- 2. Peggy reçoit la fiche par mail et la retrouve dans Radar ; elle appelle
--    quand elle veut, au téléphone (Louis : A). La cliente reçoit un mail :
--    Peggy va l'appeler.
-- 3. Après l'appel, Peggy note le résultat : elle veut démarrer, elle
--    réfléchit, ou non. La closeuse est prévenue ; si elle veut démarrer,
--    c'est la closeuse qui envoie le devis (Louis : A). La vente reste la
--    sienne.
--
-- Une ligne par rendez-vous. Écritures par le serveur (service role), après
-- contrôle de la session dans l'app. La fiche parle de santé : elle s'efface
-- 90 jours après la demande, comme les réponses au formulaire (0036).
-- ===========================================================================

create table public.radar_r2 (
  booking_id      uuid primary key references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  closeuse_id     uuid not null references public.profiles(id) on delete restrict,
  -- Les champs de la fiche du protocole, { cle: texte } (src/tools/r2/regles.ts).
  fiche           jsonb not null default '{}' check (jsonb_typeof(fiche) = 'object'),
  joindre         text not null check (char_length(joindre) between 1 and 500),
  telephone       text check (char_length(telephone) <= 40),
  demandee_le     timestamptz not null default now(),
  mail_titulaire  boolean not null default false,
  mail_cliente    boolean not null default false,
  resultat        text check (resultat in ('demarrer', 'reflechit', 'non')),
  note_titulaire  text check (char_length(note_titulaire) <= 2000),
  appelee_le      timestamptz,
  mail_closeuse   boolean not null default false,
  fiche_effacee_le timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.radar_r2 is
  'Les demandes de R2 avec la titulaire, et ce qu''il a donné (0054, 07/10/2026).';

create index radar_r2_organisation_idx on public.radar_r2 (organization_id, appelee_le);

alter table public.radar_r2 enable row level security;

create policy "radar_r2_select" on public.radar_r2
  for select to authenticated
  using (closeuse_id = (select auth.uid()) or public.can_access_radar(organization_id));

create trigger radar_r2_updated_at
  before update on public.radar_r2
  for each row execute function public.set_updated_at();

-- La fiche, 90 jours après la demande : vidée, la ligne reste (le résultat).
create or replace function public.radar_purger_r2(
  anciennete interval default interval '90 days'
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  effaces integer;
begin
  update public.radar_r2
     set fiche = '{}'::jsonb, telephone = null, joindre = '-', fiche_effacee_le = now()
   where demandee_le < now() - anciennete
     and fiche_effacee_le is null;
  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.radar_purger_r2(interval) from public, anon, authenticated;
grant execute on function public.radar_purger_r2(interval) to service_role;

select cron.unschedule('radar-purge-r2')
  from cron.job where jobname = 'radar-purge-r2';

select cron.schedule(
  'radar-purge-r2',
  '50 3 * * *',
  $cron$ select public.radar_purger_r2() $cron$
);
