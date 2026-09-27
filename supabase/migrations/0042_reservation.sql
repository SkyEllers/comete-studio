-- ===========================================================================
-- 0042 — La réservation : le moteur
--
-- Un outil de réservation à nous, qui remplacera chez Peggy le lien Calendly
-- « RDV diagnostic offert 45 min » (décidé par Louis le 27/09/2026). La page
-- vivra sur le site du client ; le moteur vit ici : qui prend les
-- diagnostics, quand, et les rendez-vous pris.
--
-- Cinq décisions tiennent dans ce fichier.
--
-- 1. Une « personne » est quelqu'un qui tient des diagnostics chez un client :
--    la titulaire (Peggy) ou une closeuse. Chacune règle ses horaires
--    habituels, ses absences, son maximum par jour et sa visio. Rien d'autre :
--    la durée, la pause, la fenêtre sont les mêmes pour tout le monde et
--    vivent dans les réglages du client, que Louis seul écrit.
--
-- 2. Pas de double réservation, garanti par la base. Une contrainte
--    d'exclusion refuse deux rendez-vous confirmés qui se chevauchent pour la
--    même personne, pause comprise (`bloque_jusqu_a` = fin + pause). Deux
--    réservations lancées au même instant sur le même créneau : une seule
--    passe, quoi que fasse le code.
--
-- 3. Le maximum par jour est vérifié sous verrou. `reservation_prendre` prend
--    un verrou par personne et par jour (dans son fuseau) avant de compter :
--    deux réservations simultanées sur deux créneaux du même jour ne peuvent
--    pas dépasser le maximum ensemble.
--
-- 4. Les réponses au formulaire parlent de santé et de poids. Elles sont lues
--    par la personne qui tient le rendez-vous, par le client (Peggy) et par
--    Louis ; pas par les autres closeuses. Nom, email, téléphone et réponses
--    s'effacent 6 mois après le rendez-vous (Louis, 27/09/2026) ; la ligne
--    reste, sans rien de personnel, pour les comptes.
--
-- 5. Personne n'écrit un rendez-vous en direct. La page de réservation, le
--    setter et l'administration passent par le serveur (clé de service) et
--    par les fonctions de ce fichier. Une personne écrit ses propres
--    réglages, et seulement ceux-là.
-- ===========================================================================

create extension if not exists btree_gist with schema extensions;

-- ------------------------------- Réglages ----------------------------------

create table public.reservation_reglages (
  organization_id      uuid primary key references public.organizations(id) on delete cascade,
  -- Faux : la page ne propose rien. Passe à vrai le jour de la bascule.
  actif                boolean not null default false,
  duree_minutes        smallint not null default 45 check (duree_minutes between 15 and 240),
  -- Entre deux diagnostics d'une même personne, pour tout le monde.
  pause_minutes        smallint not null default 15 check (pause_minutes between 0 and 120),
  -- Les créneaux commencent au quart d'heure, comme chez Calendly.
  pas_minutes          smallint not null default 15 check (pas_minutes in (5, 10, 15, 20, 30, 60)),
  -- Pas de créneau qui commence dans moins de ce délai.
  preavis_minutes      int not null default 120 check (preavis_minutes between 0 and 10080),
  -- La fenêtre : 4 jours, puis 6, 8… tant qu'il n'y a rien, jusqu'à 21.
  fenetre_jours        smallint not null default 4 check (fenetre_jours between 1 and 60),
  fenetre_pas_jours    smallint not null default 2 check (fenetre_pas_jours between 1 and 30),
  fenetre_max_jours    smallint not null default 21 check (fenetre_max_jours between 1 and 60),
  -- Une closeuse sous ce nombre de rendez-vous honorés est une débutante :
  -- elle passe en premier, à tour de rôle avec les autres.
  seuil_debutante      smallint not null default 10 check (seuil_debutante between 0 and 1000),
  -- Le taux de vente se lit sur cette période.
  periode_taux_jours   smallint not null default 60 check (periode_taux_jours between 7 and 365),
  -- Le fuseau du client : celui des « jours » de la fenêtre.
  fuseau               text not null default 'Europe/Paris',
  -- Rempli quand la page dit « complet » ; sert à ne prévenir Louis qu'une fois.
  complet_depuis       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (fenetre_max_jours >= fenetre_jours)
);

comment on table public.reservation_reglages is
  'Les règles de réservation d''un client, les mêmes pour toutes les personnes. Écrites par Louis.';

create trigger reservation_reglages_updated_at before update on public.reservation_reglages
  for each row execute function public.set_updated_at();

-- ------------------------------- Personnes ---------------------------------

create table public.reservation_personnes (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  user_id              uuid not null references public.profiles(id) on delete cascade,
  -- Les closeuses d'abord ; la titulaire prend ce qu'elles ne peuvent pas prendre.
  role                 text not null check (role in ('closeuse', 'titulaire')),
  -- Faux : plus aucun nouveau rendez-vous pour elle. Ses rendez-vous restent.
  actif                boolean not null default true,
  -- Le fuseau de ses horaires habituels.
  fuseau               text not null default 'Europe/Paris',
  max_par_jour         smallint not null default 4 check (max_par_jour between 1 and 20),
  -- Google Meet créé tout seul, ou son lien fixe (Zoom, Teams…).
  visio                text not null default 'meet' check (visio in ('meet', 'lien')),
  lien_visio           text check (lien_visio is null or (lien_visio ~ '^https://' and char_length(lien_visio) <= 500)),
  -- Son Google Agenda : le jeton vit dans le Vault, pas ici.
  google_email         text,
  google_agenda        text not null default 'primary',
  google_connecte_le   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, user_id),
  -- La clé composée que les tables filles référencent : une plage ou un
  -- rendez-vous ne peut pas pointer une personne d'un autre client.
  unique (id, organization_id),
  check (visio = 'meet' or lien_visio is not null)
);

comment on table public.reservation_personnes is
  'Qui tient les diagnostics d''un client : la titulaire et ses closeuses, et leurs réglages.';

-- Une seule titulaire par client.
create unique index reservation_personnes_titulaire_idx
  on public.reservation_personnes(organization_id) where role = 'titulaire';

create trigger reservation_personnes_updated_at before update on public.reservation_personnes
  for each row execute function public.set_updated_at();

/* La personne de l'utilisateur connecté, chez ce client. */
create or replace function public.reservation_est_a_moi(personne uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.reservation_personnes p
     where p.id = personne
       and p.user_id = auth.uid()
       and (public.is_member(p.organization_id) or public.is_closeuse(p.organization_id))
  );
$fn$;

revoke execute on function public.reservation_est_a_moi(uuid) from public, anon;
grant execute on function public.reservation_est_a_moi(uuid) to authenticated;

-- --------------------------- Horaires, absences ----------------------------

/* Ses horaires habituels : une ou plusieurs plages par jour de la semaine. */
create table public.reservation_horaires (
  id               uuid primary key default gen_random_uuid(),
  personne_id      uuid not null,
  organization_id  uuid not null,
  -- 1 = lundi … 7 = dimanche (ISO).
  jour             smallint not null check (jour between 1 and 7),
  debut            time not null,
  fin              time not null,
  created_at       timestamptz not null default now(),
  check (fin > debut),
  foreign key (personne_id, organization_id)
    references public.reservation_personnes(id, organization_id) on delete cascade
);

create index reservation_horaires_personne_idx on public.reservation_horaires(personne_id, jour);

/* Ses absences : un jour ou une période, bornes comprises, dans son fuseau. */
create table public.reservation_absences (
  id               uuid primary key default gen_random_uuid(),
  personne_id      uuid not null,
  organization_id  uuid not null,
  du               date not null,
  au               date not null,
  created_at       timestamptz not null default now(),
  check (au >= du),
  foreign key (personne_id, organization_id)
    references public.reservation_personnes(id, organization_id) on delete cascade
);

create index reservation_absences_personne_idx on public.reservation_absences(personne_id, au);

-- ------------------------------ Rendez-vous --------------------------------

create table public.reservation_rendez_vous (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  personne_id       uuid not null,
  debut             timestamptz not null,
  fin               timestamptz not null,
  -- Fin + pause : c'est ce qui est interdit aux autres rendez-vous.
  bloque_jusqu_a    timestamptz not null,
  statut            text not null default 'confirme' check (statut in ('confirme', 'annule')),
  annule_le         timestamptz,
  annule_par        text check (annule_par in ('cliente', 'agent', 'personne', 'admin')),
  -- Un report crée un nouveau rendez-vous qui pointe l'ancien.
  reporte_de        uuid references public.reservation_rendez_vous(id) on delete set null,
  origine           text not null check (origine in ('page', 'agent', 'admin', 'essai')),

  -- Qui elle est. Effacé 6 mois après le rendez-vous (`efface_le`).
  prenom            text check (char_length(prenom) <= 100),
  nom               text check (char_length(nom) <= 100),
  email             text check (char_length(email) <= 320),
  telephone         text check (char_length(telephone) <= 30),
  fuseau_cliente    text not null default 'Europe/Paris',
  -- [{question, reponse}] : les questions du formulaire, dans l'ordre.
  reponses          jsonb not null default '[]' check (jsonb_typeof(reponses) = 'array'),
  -- Les `utm_*` et identifiants de clic, comme Radar.
  utm               jsonb not null default '{}' check (jsonb_typeof(utm) = 'object'),
  -- SHA-256 du lien personnel pour annuler ou reporter. Jamais le lien.
  jeton_hash        text unique,

  google_event_id   text,
  lien_visio        text,
  radar_booking_id  uuid references public.radar_bookings(id) on delete set null,
  efface_le         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (fin > debut),
  check (bloque_jusqu_a >= fin),
  check ((statut = 'annule') = (annule_le is not null)),
  -- Retirer une personne qui a des rendez-vous est refusé : on la passe
  -- inactive, et ses rendez-vous restent. « no action » plutôt que
  -- « restrict » : le contrôle se fait en fin d'instruction, ce qui laisse la
  -- suppression d'un client entier emporter personnes et rendez-vous ensemble.
  foreign key (personne_id, organization_id)
    references public.reservation_personnes(id, organization_id) on delete no action,
  foreign key (organization_id) references public.organizations(id) on delete cascade,

  -- La règle qui ne dépend pas du code : jamais deux rendez-vous confirmés
  -- qui se chevauchent pour la même personne, pause comprise.
  constraint reservation_pas_de_double exclude using gist (
    personne_id with =,
    tstzrange(debut, bloque_jusqu_a, '[)') with &&
  ) where (statut = 'confirme')
);

comment on table public.reservation_rendez_vous is
  'Les rendez-vous pris par l''outil. Données personnelles : lues par la personne du rendez-vous, le client et Louis ; effacées 6 mois après (efface_le).';

create index reservation_rdv_org_debut_idx on public.reservation_rendez_vous(organization_id, debut);
create index reservation_rdv_personne_idx on public.reservation_rendez_vous(personne_id, debut);
create index reservation_rdv_reporte_idx on public.reservation_rendez_vous(reporte_de);
create index reservation_rdv_radar_idx on public.reservation_rendez_vous(radar_booking_id);
create index reservation_rdv_a_effacer_idx on public.reservation_rendez_vous(fin) where efface_le is null;

create trigger reservation_rendez_vous_updated_at before update on public.reservation_rendez_vous
  for each row execute function public.set_updated_at();

-- ------------------------------ Les droits ---------------------------------

alter table public.reservation_reglages enable row level security;
alter table public.reservation_personnes enable row level security;
alter table public.reservation_horaires enable row level security;
alter table public.reservation_absences enable row level security;
alter table public.reservation_rendez_vous enable row level security;

create policy "reservation_reglages_select" on public.reservation_reglages
  for select to authenticated
  using ((select public.is_admin()) or public.is_member(organization_id) or public.is_closeuse(organization_id));

create policy "reservation_personnes_select" on public.reservation_personnes
  for select to authenticated
  using ((select public.is_admin()) or public.reservation_est_a_moi(id));

-- Une personne ne change que son maximum et sa visio : les colonnes ouvertes
-- en écriture sont listées ici, les autres restent à l'administration.
create policy "reservation_personnes_update_soi" on public.reservation_personnes
  for update to authenticated
  using (public.reservation_est_a_moi(id))
  with check (public.reservation_est_a_moi(id));

revoke insert, update, delete, truncate on public.reservation_personnes from anon, authenticated;
grant update (max_par_jour, visio, lien_visio) on public.reservation_personnes to authenticated;

create policy "reservation_horaires_select" on public.reservation_horaires
  for select to authenticated
  using ((select public.is_admin()) or public.reservation_est_a_moi(personne_id));
create policy "reservation_horaires_ecriture_soi" on public.reservation_horaires
  for all to authenticated
  using (public.reservation_est_a_moi(personne_id))
  with check (public.reservation_est_a_moi(personne_id));

create policy "reservation_absences_select" on public.reservation_absences
  for select to authenticated
  using ((select public.is_admin()) or public.reservation_est_a_moi(personne_id));
create policy "reservation_absences_ecriture_soi" on public.reservation_absences
  for all to authenticated
  using (public.reservation_est_a_moi(personne_id))
  with check (public.reservation_est_a_moi(personne_id));

-- Le client (Peggy) voit tous les rendez-vous ; une closeuse, les siens.
create policy "reservation_rendez_vous_select" on public.reservation_rendez_vous
  for select to authenticated
  using (
    (select public.is_admin())
    or public.is_member(organization_id)
    or (public.is_closeuse(organization_id) and public.reservation_est_a_moi(personne_id))
  );

revoke insert, update, delete, truncate on public.reservation_rendez_vous from anon, authenticated;
revoke insert, update, delete, truncate on public.reservation_reglages from anon, authenticated;

-- --------------------------- Prendre, annuler ------------------------------

/*
 * Prendre un rendez-vous pour une personne. Le code a déjà calculé que le
 * créneau est libre et choisi la personne ; la base revérifie ce qui ne se
 * vérifie bien qu'ici, sous verrou :
 * - la personne est active, le créneau n'est pas passé ;
 * - la fin se déduit de la durée du client, la pause s'ajoute derrière ;
 * - le maximum par jour de la personne, compté dans son fuseau ;
 * - le chevauchement : la contrainte d'exclusion (erreur 23P01).
 *
 * Les erreurs portent un mot-clé que le code lit : personne_indisponible,
 * creneau_passe, maximum_atteint.
 */
create or replace function public.reservation_prendre(
  personne uuid,
  debut    timestamptz,
  donnees  jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  p        public.reservation_personnes%rowtype;
  r        public.reservation_reglages%rowtype;
  la_fin   timestamptz;
  le_jour  date;
  deja     int;
  nouveau  uuid;
begin
  select * into p from public.reservation_personnes where id = personne;
  if not found or not p.actif then
    raise exception 'personne_indisponible';
  end if;

  select * into r from public.reservation_reglages where organization_id = p.organization_id;
  if not found then
    raise exception 'personne_indisponible';
  end if;

  if debut <= now() then
    raise exception 'creneau_passe';
  end if;

  la_fin  := debut + make_interval(mins => r.duree_minutes);
  le_jour := (debut at time zone p.fuseau)::date;

  perform pg_advisory_xact_lock(hashtextextended('reservation:' || p.id::text || ':' || le_jour::text, 0));

  select count(*) into deja
    from public.reservation_rendez_vous v
   where v.personne_id = p.id
     and v.statut = 'confirme'
     and (v.debut at time zone p.fuseau)::date = le_jour;

  if deja >= p.max_par_jour then
    raise exception 'maximum_atteint';
  end if;

  insert into public.reservation_rendez_vous (
    organization_id, personne_id, debut, fin, bloque_jusqu_a, origine,
    prenom, nom, email, telephone, fuseau_cliente, reponses, utm, jeton_hash,
    reporte_de
  ) values (
    p.organization_id, p.id, debut, la_fin,
    la_fin + make_interval(mins => r.pause_minutes),
    coalesce(donnees->>'origine', 'page'),
    donnees->>'prenom', donnees->>'nom', donnees->>'email', donnees->>'telephone',
    coalesce(donnees->>'fuseau_cliente', 'Europe/Paris'),
    coalesce(donnees->'reponses', '[]'::jsonb),
    coalesce(donnees->'utm', '{}'::jsonb),
    donnees->>'jeton_hash',
    (donnees->>'reporte_de')::uuid
  )
  returning id into nouveau;

  return nouveau;
end;
$fn$;

/* Annuler un rendez-vous confirmé. Vrai s'il l'était, faux s'il l'était déjà. */
create or replace function public.reservation_annuler(rendez_vous uuid, par text)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  touches int;
begin
  if par is null or par not in ('cliente', 'agent', 'personne', 'admin') then
    raise exception 'Qui annule : cliente, agent, personne ou admin.';
  end if;

  update public.reservation_rendez_vous
     set statut = 'annule', annule_le = now(), annule_par = par
   where id = rendez_vous and statut = 'confirme';

  get diagnostics touches = row_count;
  return touches = 1;
end;
$fn$;

/*
 * Reporter : l'ancien s'annule et le nouveau se prend dans la même
 * transaction. L'ancien libère sa place d'abord (déplacer de 15 minutes
 * chez la même personne doit marcher) ; si le nouveau échoue, rien ne bouge.
 */
create or replace function public.reservation_reporter(
  ancien   uuid,
  personne uuid,
  debut    timestamptz,
  par      text
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  a        public.reservation_rendez_vous%rowtype;
  nouveau  uuid;
begin
  select * into a from public.reservation_rendez_vous where id = ancien for update;
  if not found or a.statut <> 'confirme' then
    raise exception 'rendez_vous_introuvable';
  end if;

  perform public.reservation_annuler(ancien, par);

  nouveau := public.reservation_prendre(personne, debut, jsonb_build_object(
    'origine', a.origine,
    'prenom', a.prenom, 'nom', a.nom, 'email', a.email, 'telephone', a.telephone,
    'fuseau_cliente', a.fuseau_cliente, 'reponses', a.reponses, 'utm', a.utm,
    'reporte_de', a.id
  ));

  -- Le lien personnel suit le rendez-vous : il gère désormais le nouveau.
  update public.reservation_rendez_vous set jeton_hash = null where id = ancien;
  update public.reservation_rendez_vous set jeton_hash = a.jeton_hash where id = nouveau;

  return nouveau;
end;
$fn$;

revoke execute on function public.reservation_prendre(uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.reservation_annuler(uuid, text) from public, anon, authenticated;
revoke execute on function public.reservation_reporter(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reservation_prendre(uuid, timestamptz, jsonb) to service_role;
grant execute on function public.reservation_annuler(uuid, text) to service_role;
grant execute on function public.reservation_reporter(uuid, uuid, timestamptz, text) to service_role;

-- -------------------------- Les jetons Google ------------------------------

/*
 * Le jeton de son Google Agenda, dans le Vault, comme ceux de l'agent (0033).
 * Nom `reservation:<personne>:google_refresh_token`, réservé au serveur.
 */
create or replace function public.reservation_set_secret(personne uuid, kind text, value text)
returns void
language plpgsql security definer set search_path = public, vault as $fn$
declare
  nom      text;
  existant uuid;
begin
  if kind is null or kind not in ('google_refresh_token') then
    raise exception 'Type de secret inconnu : %', kind;
  end if;
  if personne is null or value is null or length(value) = 0 then
    raise exception 'Personne ou valeur manquante.';
  end if;

  nom := 'reservation:' || personne::text || ':' || kind;
  select id into existant from vault.secrets where name = nom;

  if existant is null then
    perform vault.create_secret(value, nom, 'Réservation — ' || kind);
  else
    perform vault.update_secret(existant, value, nom, 'Réservation — ' || kind);
  end if;
end;
$fn$;

create or replace function public.reservation_get_secret(personne uuid, kind text)
returns text
language plpgsql security definer set search_path = public, vault as $fn$
declare
  valeur text;
begin
  if kind is null or kind not in ('google_refresh_token') then
    raise exception 'Type de secret inconnu : %', kind;
  end if;

  select decrypted_secret into valeur
    from vault.decrypted_secrets
   where name = 'reservation:' || personne::text || ':' || kind;

  return valeur;
end;
$fn$;

create or replace function public.reservation_clear_secrets(personne uuid)
returns int
language plpgsql security definer set search_path = public, vault as $fn$
declare
  effaces int;
begin
  delete from vault.secrets
   where name = 'reservation:' || personne::text || ':google_refresh_token';
  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.reservation_set_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.reservation_get_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.reservation_clear_secrets(uuid) from public, anon, authenticated;
grant execute on function public.reservation_set_secret(uuid, text, text) to service_role;
grant execute on function public.reservation_get_secret(uuid, text) to service_role;
grant execute on function public.reservation_clear_secrets(uuid) to service_role;

-- --------------------------------- Purge -----------------------------------

/*
 * Six mois après le rendez-vous, tout ce qui dit qui elle est s'efface :
 * nom, email, téléphone, réponses, lien personnel. La ligne reste (personne,
 * heure, statut, origine) pour les comptes et le tour de rôle.
 */
create or replace function public.reservation_purger(
  anciennete interval default interval '6 months'
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  effaces integer;
begin
  update public.reservation_rendez_vous
     set prenom = null, nom = null, email = null, telephone = null,
         reponses = '[]'::jsonb, jeton_hash = null, efface_le = now()
   where efface_le is null
     and fin < now() - anciennete;

  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.reservation_purger(interval) from public, anon, authenticated;
grant execute on function public.reservation_purger(interval) to service_role;

select cron.unschedule('reservation-purge')
  from cron.job where jobname = 'reservation-purge';

select cron.schedule(
  'reservation-purge',
  '50 3 * * *',
  $cron$ select public.reservation_purger() $cron$
);
