-- ===========================================================================
-- 0008 — Radar (phase 4, chantier 1)
--
-- Le socle de l'outil qui rend la commission incontestable : les rendez-vous
-- reçus de Calendly, leur canal d'origine, leur statut, et le relevé mensuel
-- que le client valide.
--
-- Deux principes portent tout le fichier.
--
-- Zéro donnée personnelle. Ni nom, ni email, ni téléphone, ni payload brut.
-- Une personne n'est qu'une `invitee_key` — un HMAC de son email avec un sel
-- propre au client. Le client recoupe avec son Calendly par date et heure, et
-- avec son Stripe par la référence de paiement. Il n'y a rien à voler ici.
--
-- Le statut « honoré » ne se stocke pas, il se calcule. Une séance passée que
-- personne n'a contestée est honorée : le figer en base obligerait à une tâche
-- de fond qui repasserait sur chaque ligne à minuit, et créerait une fenêtre où
-- la base dit une chose et la réalité une autre. La vue le calcule à la lecture.
-- ===========================================================================

create type public.radar_attribution as enum ('utm', 'recurrence', 'direct', 'manuel');
create type public.radar_status as enum ('confirme', 'honore', 'annule', 'no_show');
create type public.radar_status_origin as enum ('calendly', 'auto', 'client', 'admin');
create type public.radar_statement_status as enum ('cloture', 'conteste', 'valide', 'paye');

-- ------------------------------- Tables ------------------------------------

create table public.radar_settings (
  organization_id      uuid primary key references public.organizations(id) on delete cascade,
  commission_rate      numeric(5,2) not null default 20.00 check (commission_rate between 0 and 100),
  window_days          int not null default 90 check (window_days between 0 and 365),
  currency             text not null default 'EUR',
  calendly_user_uri    text,
  calendly_org_uri     text,
  calendly_webhook_uri text,
  connected_at         timestamptz,
  last_webhook_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.radar_channels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- google_ads, meta, seo, direct, bouche_a_oreille, newsletter, autre
  key             text not null,
  label           text not null,
  is_comete       boolean not null default false,
  -- { "sources": ["google"], "mediums": ["cpc"], "click_ids": ["gclid"], "declared": ["Google"] }
  rules           jsonb not null default '{}',
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  unique (organization_id, key)
);

create table public.radar_bookings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  -- L'URI de l'invité fait l'idempotence : Calendly rejoue ses webhooks, et
  -- deux livraisons du même message ne doivent pas faire deux rendez-vous.
  invitee_uri         text not null unique,
  event_uri           text not null,
  -- HMAC de l'email, jamais l'email.
  invitee_key         text not null,
  scheduled_start     timestamptz not null,
  scheduled_end       timestamptz not null,
  event_type_name     text not null,
  event_type_uri      text,
  -- Uniquement les `utm_*` et les identifiants de clic : rien d'autre du
  -- `tracking` de Calendly n'entre ici.
  utm                 jsonb not null default '{}',
  declared_source     text,
  channel_id          uuid references public.radar_channels(id) on delete set null,
  attribution         public.radar_attribution not null default 'direct',
  attribution_note    text,
  status              public.radar_status not null default 'confirme',
  status_origin       public.radar_status_origin not null default 'calendly',
  status_note         text,
  amount_cents        int not null default 0 check (amount_cents >= 0),
  currency            text not null default 'EUR',
  payment_ok          boolean not null default false,
  -- Identifiant Stripe : c'est ce qui permet au client de recouper, et ce
  -- n'est pas une donnée personnelle.
  payment_ref         text,
  rescheduled_from    uuid references public.radar_bookings(id) on delete set null,
  canceled_at         timestamptz,
  statement_id        uuid,   -- posé à la clôture ; la référence est ajoutée plus bas
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Le mois d'un client, et la recherche de récurrence : les deux seules
-- questions que l'outil pose vraiment à cette table.
create index radar_bookings_org_month_idx on public.radar_bookings(organization_id, scheduled_start);
create index radar_bookings_key_idx on public.radar_bookings(organization_id, invitee_key, scheduled_start desc);
-- Les colonnes de référence : sans index, chaque suppression de canal, de
-- relevé ou de profil balaie la table entière.
create index radar_bookings_channel_idx on public.radar_bookings(channel_id);
create index radar_bookings_statement_idx on public.radar_bookings(statement_id);
create index radar_bookings_rescheduled_idx on public.radar_bookings(rescheduled_from);

create table public.radar_booking_activities (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- null = le système (webhook, calcul), pas quelqu'un.
  user_id         uuid references public.profiles(id) on delete set null,
  -- booking.created, booking.canceled, booking.rescheduled, status.changed, channel.changed
  type            text not null,
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index radar_activities_booking_idx on public.radar_booking_activities(booking_id, created_at desc);
create index radar_activities_org_idx on public.radar_booking_activities(organization_id);
create index radar_activities_user_idx on public.radar_booking_activities(user_id);

create table public.radar_statements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  month            date not null,   -- premier jour du mois, en heure de Paris
  status           public.radar_statement_status not null default 'cloture',
  -- Le taux et la fenêtre sont recopiés : un relevé doit rester lisible même
  -- si le contrat change ensuite.
  commission_rate  numeric(5,2) not null,
  window_days      int not null,
  base_cents       int not null default 0,
  commission_cents int not null default 0,
  -- Instantané des lignes, sans `invitee_key` : c'est ce qui survit à la purge.
  lines            jsonb not null default '[]',
  closed_at        timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  review_comment   text,
  paid_at          timestamptz,
  unique (organization_id, month)
);
create index radar_statements_reviewed_by_idx on public.radar_statements(reviewed_by);

-- La ligne de rendez-vous pointe sur le relevé qui l'a figée ; si le relevé
-- disparaît, elle redevient libre plutôt que de pendre dans le vide.
alter table public.radar_bookings
  add constraint radar_bookings_statement_fkey
  foreign key (statement_id) references public.radar_statements(id) on delete set null;

create table public.radar_channel_entries (   -- Louis seul
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month           date not null,
  channel_id      uuid not null references public.radar_channels(id) on delete cascade,
  spend_cents     int not null default 0,
  visitors        int not null default 0,
  clicks          int not null default 0,
  note            text,
  unique (organization_id, month, channel_id)
);
create index radar_channel_entries_channel_idx on public.radar_channel_entries(channel_id);

create table public.radar_webhook_log (       -- Louis seul, purgé à 90 jours
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  received_at     timestamptz not null default now(),
  event_kind      text,
  invitee_key     text,
  -- accepted, duplicate, ignored, invalid_signature, invalid_payload, error
  outcome         text not null,
  message         text
);
create index radar_webhook_log_org_idx on public.radar_webhook_log(organization_id, received_at desc);
-- Le ménage de nuit balaie par date seule : l'index composite ci-dessus ne lui
-- sert à rien.
create index radar_webhook_log_received_idx on public.radar_webhook_log(received_at);

create trigger radar_settings_set_updated_at
  before update on public.radar_settings
  for each row execute function public.set_updated_at();

create trigger radar_bookings_set_updated_at
  before update on public.radar_bookings
  for each row execute function public.set_updated_at();

-- ------------------------------- Catalogue ---------------------------------

insert into public.tools (slug, name, description, kind, sort_order) values
  ('resultats', 'Radar', 'Tes rendez-vous, d''où ils viennent, et le relevé du mois.', 'internal', 30)
on conflict (slug) do nothing;

-- --------------------------------- Le mois ---------------------------------

/*
 * Le mois d'une séance, en heure de Paris.
 *
 * La base vit en UTC : une séance du 31 octobre à 23 h 30 heure de Paris y est
 * enregistrée au 31 octobre 22 h 30 UTC, mais une du 1er novembre à 00 h 30
 * heure de Paris s'y écrit au 31 octobre 23 h 30 — et tomberait en octobre si
 * l'on découpait naïvement. Un rendez-vous mal rangé, c'est une commission
 * facturée le mauvais mois, donc contestable.
 *
 * `stable` et non `immutable` : le découpage dépend de la base des fuseaux.
 * Tout ce qui parle de mois dans Radar passe par ici, pour qu'un client à
 * l'étranger ne demande qu'un seul changement.
 */
create or replace function public.radar_mois(quand timestamptz) returns date
language sql stable set search_path = public as $fn$
  select date_trunc('month', quand at time zone 'Europe/Paris')::date;
$fn$;

revoke execute on function public.radar_mois(timestamptz) from public, anon;
grant execute on function public.radar_mois(timestamptz) to authenticated;

-- ------------------------------ Les secrets --------------------------------

/*
 * Trois secrets par client, dans le Vault et nulle part ailleurs : le jeton
 * Calendly, la clé de signature du webhook, le sel de pseudonymisation.
 *
 * Ces fonctions ne sont exécutables que par `service_role`. Ce n'est pas une
 * précaution de plus, c'est la seule qui compte : le sel permet de retrouver
 * qui se cache derrière une `invitee_key` en testant des emails, et le jeton
 * ouvre le Calendly du client. Un membre connecté n'a aucune raison de les
 * approcher, et l'app n'y touche que depuis `admin.ts`.
 */
create or replace function public.radar_set_secret(org uuid, kind text, value text)
returns void
language plpgsql security definer set search_path = public, vault as $fn$
declare
  nom      text;
  existant uuid;
begin
  if kind is null or kind not in ('token', 'signing_key', 'salt') then
    raise exception 'Type de secret inconnu : %', kind;
  end if;

  if org is null or value is null or length(value) = 0 then
    raise exception 'Organisation ou valeur manquante.';
  end if;

  nom := 'radar:' || org::text || ':' || kind;

  select id into existant from vault.secrets where name = nom;

  if existant is null then
    perform vault.create_secret(value, nom, 'Radar — ' || kind);
  else
    perform vault.update_secret(existant, value, nom, 'Radar — ' || kind);
  end if;
end;
$fn$;

create or replace function public.radar_get_secret(org uuid, kind text)
returns text
language plpgsql security definer set search_path = public, vault as $fn$
declare
  valeur text;
begin
  if kind is null or kind not in ('token', 'signing_key', 'salt') then
    raise exception 'Type de secret inconnu : %', kind;
  end if;

  select decrypted_secret into valeur
    from vault.decrypted_secrets
   where name = 'radar:' || org::text || ':' || kind;

  return valeur;
end;
$fn$;

/*
 * Déconnecter un client, c'est effacer ses trois secrets. Sans cette fonction,
 * le bouton « Déconnecter » du chantier 3 laisserait le jeton et le sel dans
 * le Vault — et un sel qui traîne, c'est la pseudonymisation qui tombe.
 */
create or replace function public.radar_clear_secrets(org uuid)
returns int
language plpgsql security definer set search_path = public, vault as $fn$
declare
  effaces int;
begin
  delete from vault.secrets
   where name in (
     'radar:' || org::text || ':token',
     'radar:' || org::text || ':signing_key',
     'radar:' || org::text || ':salt'
   );
  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.radar_set_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.radar_get_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.radar_clear_secrets(uuid) from public, anon, authenticated;
grant execute on function public.radar_set_secret(uuid, text, text) to service_role;
grant execute on function public.radar_get_secret(uuid, text) to service_role;
grant execute on function public.radar_clear_secrets(uuid) to service_role;

-- ---------------------------- Porte d'entrée -------------------------------

/*
 * Membre de l'organisation ET outil activé pour elle. Louis passe partout.
 * Même forme que `can_access_board` et `can_access_files` : couper Radar pour
 * un client rend ses rendez-vous invisibles immédiatement, y compris par l'API.
 */
create or replace function public.can_access_radar(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select org is not null
     and (public.is_admin()
          or (public.is_member(org) and public.has_tool(org, 'resultats')));
$fn$;

revoke execute on function public.can_access_radar(uuid) from public, anon;
grant execute on function public.can_access_radar(uuid) to authenticated;

-- ---------------------------- La vue de lecture ----------------------------

/*
 * Toute lecture de l'app passe par ici.
 *
 * `security_invoker` : sans lui, une vue s'exécute avec les droits de son
 * propriétaire et contourne la RLS des tables qu'elle lit — elle deviendrait
 * exactement le trou que les politiques ci-dessous s'appliquent à fermer.
 *
 * `effective_status` : une séance passée et toujours « confirmée » est honorée.
 * `counts_for_commission` : ce qui entre dans la base de commission — honorée,
 * payée, non gratuite, et venue d'un canal Comète. Une séance découverte à 0 €
 * est suivie mais ne compte pas.
 */
create view public.radar_bookings_effective
  with (security_invoker = on) as
select b.*,
       e.effective_status,
       e.effective_status = 'honore'
         and b.payment_ok
         and b.amount_cents > 0
         and coalesce(c.is_comete, false) as counts_for_commission
  from public.radar_bookings b
  left join public.radar_channels c on c.id = b.channel_id
  cross join lateral (
    select case
             when b.status = 'confirme' and b.scheduled_end < now()
               then 'honore'::public.radar_status
             else b.status
           end as effective_status
  ) e;

-- --------------------------- Les deux actions ------------------------------

/*
 * Le client corrige un statut.
 *
 * `security definer` parce que l'écriture sur `radar_bookings` est réservée à
 * Louis : c'est cette fonction, et elle seule, qui ouvre une porte au membre —
 * étroite, et refermée dès que le relevé du mois est clôturé.
 */
create or replace function public.radar_client_set_status(
  booking_id uuid,
  new_status public.radar_status,
  note text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  -- Copie locale : `booking_id` est aussi une colonne de la table d'activités,
  -- et l'ambiguïté ferait échouer l'insertion.
  cible  uuid := booking_id;
  rdv    public.radar_bookings%rowtype;
  propre text := nullif(btrim(coalesce(note, '')), '');
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.can_access_radar(rdv.organization_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  -- « Honoré » se calcule, il ne se pose pas : le client n'a pas à le
  -- contredire, et ne circule qu'entre ces trois-là.
  if new_status not in ('confirme', 'no_show', 'annule')
     or rdv.status not in ('confirme', 'no_show', 'annule') then
    raise exception 'Ce changement de statut n''est pas permis.';
  end if;

  -- Une annulation venue de Calendly fait foi. La rouvrir ici créerait une
  -- séance que l'agenda dit annulée — et une commission indéfendable.
  if rdv.status = 'annule' and rdv.status_origin = 'calendly' then
    raise exception 'Cette séance a été annulée dans Calendly : elle ne se rouvre pas ici.';
  end if;

  if exists (
    select 1
      from public.radar_statements s
     where s.organization_id = rdv.organization_id
       and s.month = public.radar_mois(rdv.scheduled_start)
  ) then
    raise exception 'Le relevé de ce mois est clôturé : ce rendez-vous ne change plus.';
  end if;

  update public.radar_bookings
     set status = new_status,
         status_origin = 'client',
         status_note = propre,
         updated_at = now()
   where id = cible;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (cible, rdv.organization_id, auth.uid(), 'status.changed',
     jsonb_build_object(
       'from', rdv.status,
       'to', new_status,
       'origin', 'client',
       'note', propre
     ));
end;
$fn$;

/*
 * Le client répond à un relevé : il le valide, ou il le conteste en disant
 * pourquoi. Une seule fois, et seulement tant qu'il est `cloture` — après,
 * c'est à Louis de corriger et de re-clôturer.
 */
create or replace function public.radar_review_statement(
  statement_id uuid,
  decision public.radar_statement_status,
  comment text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  cible  uuid := statement_id;
  releve public.radar_statements%rowtype;
  propre text := nullif(btrim(coalesce(comment, '')), '');
begin
  select * into releve from public.radar_statements where id = cible;
  if not found then
    raise exception 'Ce relevé n''existe pas.';
  end if;

  if not public.can_access_radar(releve.organization_id) then
    raise exception 'Ce relevé ne t''est pas accessible.';
  end if;

  if decision not in ('valide', 'conteste') then
    raise exception 'Décision inconnue.';
  end if;

  if releve.status <> 'cloture' then
    raise exception 'Ce relevé n''attend plus ta réponse.';
  end if;

  -- Contester sans dire quoi ne serait pas contester : Louis ne saurait pas
  -- quoi corriger.
  if decision = 'conteste' and propre is null then
    raise exception 'Dis en quelques mots ce qui te semble faux.';
  end if;

  update public.radar_statements
     set status = decision,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         review_comment = propre
   where id = cible;
end;
$fn$;

revoke execute on function public.radar_client_set_status(uuid, public.radar_status, text) from public, anon;
grant execute on function public.radar_client_set_status(uuid, public.radar_status, text) to authenticated;

revoke execute on function public.radar_review_statement(uuid, public.radar_statement_status, text) from public, anon;
grant execute on function public.radar_review_statement(uuid, public.radar_statement_status, text) to authenticated;

-- --------------------------------- RLS -------------------------------------

alter table public.radar_settings enable row level security;
alter table public.radar_channels enable row level security;
alter table public.radar_bookings enable row level security;
alter table public.radar_booking_activities enable row level security;
alter table public.radar_statements enable row level security;
alter table public.radar_channel_entries enable row level security;
alter table public.radar_webhook_log enable row level security;

/*
 * Cinq tables que le client lit et que Louis seul écrit. Le membre ne passe
 * jamais par une écriture directe : il a `radar_client_set_status` et
 * `radar_review_statement`, qui vérifient ce qu'une politique ne saurait dire
 * — l'état du relevé, le statut de départ, l'origine de l'annulation.
 */
create policy "radar_settings_select" on public.radar_settings
  for select to authenticated using (public.can_access_radar(organization_id));
create policy "radar_settings_insert" on public.radar_settings
  for insert to authenticated with check ((select public.is_admin()));
create policy "radar_settings_update" on public.radar_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "radar_settings_delete" on public.radar_settings
  for delete to authenticated using ((select public.is_admin()));

create policy "radar_channels_select" on public.radar_channels
  for select to authenticated using (public.can_access_radar(organization_id));
create policy "radar_channels_insert" on public.radar_channels
  for insert to authenticated with check ((select public.is_admin()));
create policy "radar_channels_update" on public.radar_channels
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "radar_channels_delete" on public.radar_channels
  for delete to authenticated using ((select public.is_admin()));

create policy "radar_bookings_select" on public.radar_bookings
  for select to authenticated using (public.can_access_radar(organization_id));
create policy "radar_bookings_insert" on public.radar_bookings
  for insert to authenticated with check ((select public.is_admin()));
create policy "radar_bookings_update" on public.radar_bookings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "radar_bookings_delete" on public.radar_bookings
  for delete to authenticated using ((select public.is_admin()));

create policy "radar_activities_select" on public.radar_booking_activities
  for select to authenticated using (public.can_access_radar(organization_id));
create policy "radar_activities_insert" on public.radar_booking_activities
  for insert to authenticated with check ((select public.is_admin()));
create policy "radar_activities_update" on public.radar_booking_activities
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "radar_activities_delete" on public.radar_booking_activities
  for delete to authenticated using ((select public.is_admin()));

create policy "radar_statements_select" on public.radar_statements
  for select to authenticated using (public.can_access_radar(organization_id));
create policy "radar_statements_insert" on public.radar_statements
  for insert to authenticated with check ((select public.is_admin()));
create policy "radar_statements_update" on public.radar_statements
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "radar_statements_delete" on public.radar_statements
  for delete to authenticated using ((select public.is_admin()));

/*
 * Deux tables que le client ne voit pas du tout. Les dépenses, les visiteurs
 * et les clics sont l'affaire de Louis : les montrer, ce serait lui montrer sa
 * marge. Et le journal des webhooks porte des `invitee_key` de tout le monde.
 */
create policy "radar_channel_entries_all" on public.radar_channel_entries
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "radar_webhook_log_all" on public.radar_webhook_log
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- --------------------------------- Purge -----------------------------------

/*
 * Deux ménages. Les lignes de rendez-vous partent treize mois après la clôture
 * du relevé qui les a figées : le relevé, lui, reste — il est agrégé et ne
 * porte aucune clé. Le journal des webhooks vit quatre-vingt-dix jours.
 *
 * Les tâches sont posées par nom, et l'ancienne est décrochée d'abord : rejouer
 * cette migration ne les empile pas.
 */
select cron.unschedule('radar-purge-bookings')
  from cron.job where jobname = 'radar-purge-bookings';

select cron.unschedule('radar-purge-webhook-log')
  from cron.job where jobname = 'radar-purge-webhook-log';

select cron.schedule('radar-purge-bookings', '0 3 2 * *', $cron$
  delete from public.radar_bookings b
   using public.radar_statements s
   where b.statement_id = s.id
     and s.status in ('paye', 'valide')
     and s.closed_at < now() - interval '13 months'
$cron$);

select cron.schedule('radar-purge-webhook-log', '30 3 * * *', $cron$
  delete from public.radar_webhook_log
   where received_at < now() - interval '90 days'
$cron$);
