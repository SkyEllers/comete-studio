-- ===========================================================================
-- 0032 — L'agent : il tient le lien entre la réservation et le rendez-vous
--
-- Chez Peggy, plus un diagnostic est loin, plus il tombe : 32 % d'annulations
-- à moins d'un jour, 66 % entre 7 et 14 jours (relevé Calendly du 22/09/2026,
-- 248 diagnostics). L'agent prend la main dès la réservation, écrit au nom du
-- client (WhatsApp, puis d'autres canaux), récolte la confirmation, propose
-- un autre créneau quand il le faut, et remplace l'appel de la veille.
--
-- Quatre décisions tiennent dans ce fichier.
--
-- 1. Un module à part, pas une extension de Radar. Radar ne garde ni
--    téléphone, ni email, ni réponse au formulaire (0008, 0015) : c'est son
--    contrat, et il ne change pas. L'agent a besoin des trois pour écrire à
--    quelqu'un. Ils vivent donc ici, dans des tables que seul Louis lit, et
--    la conversation se relie au rendez-vous de Radar par une clé, sans rien
--    lui recopier.
--
-- 2. Tout s'efface 30 jours après le rendez-vous (Louis, 25/09/2026).
--    Téléphone, réponses, messages, questions : la purge de nuit supprime la
--    conversation entière. Juste avant, elle en écrit un bilan sans nom ni
--    numéro (`agent_bilans`) : c'est lui qui dira, deux mois après le
--    lancement, si les annulations des rendez-vous lointains ont baissé.
--
-- 3. Le planning des messages ne se stocke pas, il se calcule. Un rendez-vous
--    déplacé, une confirmation, un STOP changent ce qui doit partir ; figer
--    des envois à l'avance obligerait à les défaire à chaque fois. L'horloge
--    demande au code « que faut-il envoyer maintenant ? », et c'est
--    `cle_envoi` qui garantit qu'un même envoi ne part jamais deux fois.
--
-- 4. Tout est réservé à l'administration. La cliente de Peggy n'a pas de
--    compte, Peggy n'a rien à faire : seul Louis lit ces tables. Aucune
--    politique d'écriture : ce sont le webhook, l'horloge et les actions
--    d'administration qui écrivent, avec la clé de service.
-- ===========================================================================

-- ------------------------------- Réglages ----------------------------------

create table public.agent_reglages (
  organization_id       uuid primary key references public.organizations(id) on delete cascade,
  -- Faux : les vraies réservations n'ouvrent aucune conversation. Seule la
  -- simulation tourne. Passe à vrai le jour du lancement, pas avant.
  actif                 boolean not null default false,
  canal                 text not null default 'simule'
                        check (canal in ('simule', 'whatsapp')),
  -- La voix et les règles du client vivent dans le code (relues, versionnées) :
  -- cette clé dit lesquelles prendre.
  profil                text not null,
  -- Les types de rendez-vous Calendly que l'agent suit. Vide = aucun.
  types_suivis          text[] not null default '{}',
  -- En dessous, l'agent ne prend pas la main (P12 : « plus de 24 h »).
  delai_minimum         interval not null default interval '24 hours',
  -- Le mail du matin : les rendez-vous du jour, trois lignes chacun.
  resume_actif          boolean not null default false,
  resume_destinataires  text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.agent_reglages is
  'Un réglage d''agent par client. Écrit par l''administration, lu par le webhook et l''horloge.';

create trigger agent_reglages_updated_at before update on public.agent_reglages
  for each row execute function public.set_updated_at();

-- ------------------------------ Conversations ------------------------------

create table public.agent_conversations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  -- Vrai : ouverte depuis le hub, Louis joue la cliente. Rien ne part vers
  -- personne, et rien ne s'écrit dans Calendly ni dans Radar.
  simulation          boolean not null default false,
  -- L'horloge d'une simulation : on avance jusqu'à la veille sans attendre.
  decalage            interval not null default interval '0',

  -- Le rendez-vous en cours. Un report le remplace : l'ancien invité passe
  -- dans `invites_precedents`, pour que son annulation soit reconnue.
  invitee_uri         text not null unique,
  event_uri           text,
  event_type_uri      text,
  invites_precedents  text[] not null default '{}',
  booking_id          uuid references public.radar_bookings(id) on delete set null,
  rdv_debut           timestamptz not null,
  rdv_fin             timestamptz not null,
  reserve_le          timestamptz not null,
  lien_visio          text,
  lien_report         text,
  lien_annulation     text,

  -- Qui elle est, pour lui écrire et pour réserver à sa place.
  prenom              text not null,
  nom                 text,
  email               text,
  telephone           text,               -- E.164 : +33612345678
  fuseau              text not null default 'Europe/Paris',
  -- Les réponses au formulaire, telles quelles : [{question, answer, position}].
  reponses            jsonb not null default '[]',
  -- Sa réponse à « comment tu fonctionnes quand tu décides de changer » : elle
  -- choisit le ton, pas qui on relance.
  facon_de_decider    text check (facon_de_decider in ('fonce', 'analyse', 'pas_a_pas', 'accompagnee')),

  etat                text not null default 'active'
                      check (etat in ('active', 'hors_champ', 'stop', 'annulee', 'terminee')),
  confirme_le         timestamptz,
  premiere_reponse_le timestamptz,
  -- Sa dernière parole : la fenêtre de 24 h où l'agent écrit librement part d'ici.
  derniere_entree_le  timestamptz,
  reports_agent       smallint not null default 0 check (reports_agent >= 0),
  -- L'agent vient de réserver un autre créneau à sa place : la réservation
  -- que Calendly va annoncer à cette heure-là est la sienne, pas une nouvelle
  -- cliente. Sans ça, le webhook ouvrirait une deuxième conversation.
  report_attendu      timestamptz,
  contenu_propose_le  timestamptz,
  sans_reponse_veille boolean not null default false,
  stop_le             timestamptz,

  efface_apres        timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.agent_conversations is
  'Une cliente, un rendez-vous, et tout ce que l''agent en sait. Données personnelles : lues par Louis seul, effacées 30 jours après le rendez-vous (efface_apres).';

comment on column public.agent_conversations.etat is
  'active : l''agent tient le lien. hors_champ : rendez-vous trop proche, l''agent n''écrit pas. stop : elle a dit STOP, plus rien ne part. annulee : annulé dans Calendly. terminee : le rendez-vous est passé.';

create index agent_conversations_org_rdv_idx on public.agent_conversations(organization_id, rdv_debut);
create index agent_conversations_actives_idx on public.agent_conversations(rdv_debut) where etat = 'active';
create index agent_conversations_booking_idx on public.agent_conversations(booking_id);
create index agent_conversations_efface_idx on public.agent_conversations(efface_apres);
-- Retrouver la conversation d'un invité déplacé, quand son annulation arrive.
create index agent_conversations_precedents_idx on public.agent_conversations using gin (invites_precedents);

create trigger agent_conversations_updated_at before update on public.agent_conversations
  for each row execute function public.set_updated_at();

-- -------------------------------- Messages ---------------------------------

create table public.agent_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.agent_conversations(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  sens             text not null check (sens in ('sortant', 'entrant')),
  -- modele : un des cinq messages validés par Meta. libre : écrit dans la
  -- fenêtre de 24 h. bouton : elle a touché un bouton d'un modèle.
  genre            text not null check (genre in ('modele', 'libre', 'bouton', 'texte')),
  modele           text check (modele in ('reservation', 'rappel', 'preparation', 'veille', 'matin')),
  -- « veille:2026-10-02 » : un même envoi ne part qu'une fois, même si
  -- l'horloge passe deux fois.
  cle_envoi        text,
  texte            text not null,
  boutons          text[] not null default '{}',
  -- Ce que l'agent a compris d'un message entrant (confirmation, report,
  -- STOP, santé…), pour relire ses décisions.
  -- (« analyse » est un mot réservé de Postgres.)
  comprehension    jsonb,
  canal            text not null check (canal in ('simule', 'whatsapp')),
  statut           text not null default 'envoye'
                   check (statut in ('envoye', 'recu', 'echec')),
  erreur           text,
  id_externe       text,
  created_at       timestamptz not null default now()
);

create index agent_messages_conversation_idx on public.agent_messages(conversation_id, created_at);
create index agent_messages_org_idx on public.agent_messages(organization_id);
create unique index agent_messages_cle_envoi_idx
  on public.agent_messages(conversation_id, cle_envoi) where cle_envoi is not null;

-- ------------------------- La file des questions ---------------------------

create table public.agent_questions (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.agent_conversations(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  message_id       uuid references public.agent_messages(id) on delete set null,
  -- incertain : l'agent n'est pas sûr, Louis décide. detresse : le 3114 est
  -- déjà parti, Louis est seulement prévenu.
  genre            text not null check (genre in ('incertain', 'detresse')),
  question         text not null,
  -- Ce que l'agent aurait répondu : Louis corrige plutôt qu'il n'écrit.
  brouillon        text,
  reponse          text,
  etat             text not null default 'ouverte'
                   check (etat in ('ouverte', 'envoyee', 'classee')),
  notifie_le       timestamptz,
  traitee_le       timestamptz,
  created_at       timestamptz not null default now()
);

create index agent_questions_file_idx on public.agent_questions(organization_id, created_at desc) where etat = 'ouverte';
create index agent_questions_conversation_idx on public.agent_questions(conversation_id);
create index agent_questions_message_idx on public.agent_questions(message_id);

-- Chaque réponse de Louis devient une réponse fixe pour la fois suivante
-- (P12). Rédigée sans nom : elle survit à la purge des conversations.
create table public.agent_reponses_fixes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  question            text not null,
  reponse             text not null,
  actif               boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index agent_reponses_fixes_org_idx on public.agent_reponses_fixes(organization_id) where actif;

create trigger agent_reponses_fixes_updated_at before update on public.agent_reponses_fixes
  for each row execute function public.set_updated_at();

-- ------------------------------- Les bilans --------------------------------

-- Ce qui reste d'une conversation effacée : de quoi mesurer, rien pour
-- retrouver quelqu'un. Ni nom, ni numéro, ni heure précise.
create table public.agent_bilans (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  simulation           boolean not null,
  mois                 date not null,             -- premier jour du mois du rendez-vous
  delai_jours          smallint not null,         -- de la réservation au rendez-vous, arrondi
  etat_final           text not null,
  a_repondu            boolean not null,
  confirme             boolean not null,
  reports_agent        smallint not null,
  sans_reponse_veille  boolean not null,
  stop                 boolean not null,
  modeles_envoyes      smallint not null,
  messages_libres      smallint not null,
  questions_montees    smallint not null,
  created_at           timestamptz not null default now()
);

create index agent_bilans_org_mois_idx on public.agent_bilans(organization_id, mois);

-- ---------------------------------- RLS ------------------------------------

alter table public.agent_reglages       enable row level security;
alter table public.agent_conversations  enable row level security;
alter table public.agent_messages       enable row level security;
alter table public.agent_questions      enable row level security;
alter table public.agent_reponses_fixes enable row level security;
alter table public.agent_bilans         enable row level security;

/*
 * Lecture réservée à Louis. Aucune politique d'écriture : le webhook,
 * l'horloge et les actions d'administration passent par la clé de service,
 * après avoir établi qui appelle.
 */
create policy "agent_reglages_admin_lecture" on public.agent_reglages
  for select to authenticated using ((select public.is_admin()));
create policy "agent_conversations_admin_lecture" on public.agent_conversations
  for select to authenticated using ((select public.is_admin()));
create policy "agent_messages_admin_lecture" on public.agent_messages
  for select to authenticated using ((select public.is_admin()));
create policy "agent_questions_admin_lecture" on public.agent_questions
  for select to authenticated using ((select public.is_admin()));
create policy "agent_reponses_fixes_admin_lecture" on public.agent_reponses_fixes
  for select to authenticated using ((select public.is_admin()));
create policy "agent_bilans_admin_lecture" on public.agent_bilans
  for select to authenticated using ((select public.is_admin()));

-- --------------------------------- Purge -----------------------------------

/*
 * Effacer les conversations 30 jours après leur rendez-vous, bilan d'abord.
 *
 * Le bilan et l'effacement se font dans la même transaction : une panne au
 * milieu ne laisse ni un bilan sans effacement (compté deux fois à la nuit
 * suivante) ni un effacement sans bilan (perdu pour la mesure).
 */
create or replace function public.agent_purger_conversations()
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  effaces integer;
begin
  with a_effacer as (
    select c.*
      from public.agent_conversations c
     where c.efface_apres < now()
     for update
  ), bilans as (
    insert into public.agent_bilans (
      organization_id, simulation, mois, delai_jours, etat_final, a_repondu,
      confirme, reports_agent, sans_reponse_veille, stop, modeles_envoyes,
      messages_libres, questions_montees
    )
    select
      c.organization_id,
      c.simulation,
      date_trunc('month', c.rdv_debut at time zone 'Europe/Paris')::date,
      least(round(extract(epoch from (c.rdv_debut - c.reserve_le)) / 86400), 32767)::smallint,
      c.etat,
      c.premiere_reponse_le is not null,
      c.confirme_le is not null,
      c.reports_agent,
      c.sans_reponse_veille,
      c.stop_le is not null,
      (select count(*) from public.agent_messages m
        where m.conversation_id = c.id and m.sens = 'sortant' and m.genre = 'modele')::smallint,
      (select count(*) from public.agent_messages m
        where m.conversation_id = c.id and m.sens = 'sortant' and m.genre = 'libre')::smallint,
      (select count(*) from public.agent_questions q
        where q.conversation_id = c.id)::smallint
    from a_effacer c
    returning 1
  )
  delete from public.agent_conversations c
   using a_effacer e
   where c.id = e.id;

  get diagnostics effaces = row_count;
  return effaces;
end;
$fn$;

revoke execute on function public.agent_purger_conversations() from public, anon, authenticated;
grant execute on function public.agent_purger_conversations() to service_role;

select cron.unschedule('agent-purge-conversations')
  from cron.job where jobname = 'agent-purge-conversations';

select cron.schedule(
  'agent-purge-conversations',
  '40 3 * * *',
  $cron$ select public.agent_purger_conversations() $cron$
);
