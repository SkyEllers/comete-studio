-- ===========================================================================
-- 0050 — Le devis signé en ligne (P16)
--
-- Décidé par Louis le 28/09/2026 : remplacer Yousign par un outil de Comète.
-- Après le diagnostic, la closeuse (ou le client) envoie le devis depuis la
-- fiche du rendez-vous ; la cliente le reçoit par mail, l'ouvre sur le site du
-- client, le signe en un clic ; un rappel part chaque jour tant qu'il n'est
-- pas signé et encore valable ; signé, la vente s'inscrit seule dans Radar, le
-- PDF signé part aux deux, puis le lien de paiement Stripe.
--
-- Les décisions de ce fichier.
--
-- 1. Un devis vit à côté d'un rendez-vous de Radar (`booking_id`), dans
--    l'organisation du client. Plusieurs devis possibles sur un rendez-vous
--    (un devis corrigé remplace le précédent : l'ancien passe « annule »).
--
-- 2. La cliente n'a pas de compte : elle ouvre le devis par un lien personnel
--    (64 caractères hexadécimaux, après le « # » de l'adresse). La base n'en
--    garde que l'empreinte (`jeton_hash`), comme l'outil de réservation.
--
-- 3. Qui voit les devis dans le hub : ceux qui peuvent saisir sur le
--    rendez-vous (`radar_peut_saisir`, 0036). Toutes les écritures passent par
--    le serveur (service role) : la création vérifie les droits dans l'app,
--    la signature vient d'une personne sans compte.
--
-- 4. La preuve (Code civil 1366-1367 ; signature électronique simple) : chaque
--    geste de la cliente est journalisé dans `devis_evenements` (heure, adresse
--    IP, navigateur), le contenu signé porte une empreinte SHA-256, et le PDF
--    signé est gardé dans un bucket privé. Conservation : 10 ans pour un
--    contrat de plus de 120 € conclu en ligne (Code de la consommation L213-1,
--    D213-1) ; aucune purge ici.
-- ===========================================================================

create table public.devis (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  booking_id             uuid references public.radar_bookings(id) on delete set null,
  closeuse_id            uuid references public.profiles(id) on delete set null,
  cree_par               uuid references public.profiles(id) on delete set null,
  jeton_hash             text not null unique check (jeton_hash ~ '^[0-9a-f]{64}$'),

  prenom                 text not null check (char_length(prenom) between 1 and 100),
  nom                    text check (char_length(nom) <= 100),
  email                  text not null check (char_length(email) between 3 and 254),
  telephone              text check (char_length(telephone) <= 40),
  adresse                text check (char_length(adresse) <= 400),

  duree_mois             smallint not null check (duree_mois between 1 and 24),
  paiement               text not null check (paiement in ('une_fois', 'plusieurs')),
  investigation_cents    int not null check (investigation_cents >= 0),
  mensualite_cents       int not null check (mensualite_cents >= 0),
  remise_une_fois_cents  int not null default 0 check (remise_une_fois_cents >= 0),
  total_cents            int not null check (total_cents > 0),
  devise                 text not null default 'EUR' check (devise ~ '^[A-Z]{3}$'),
  /* L'entreprise qui vend, telle qu'imprimée sur le devis au moment de l'envoi. */
  vendeur                jsonb not null check (jsonb_typeof(vendeur) = 'object'),
  version_texte          text not null check (char_length(version_texte) <= 40),

  valide_jusqu_au        date not null,
  statut                 text not null default 'envoye'
                         check (statut in ('envoye', 'signe', 'expire', 'annule')),
  envoye_le              timestamptz not null default now(),
  ouvert_le              timestamptz,
  relance_le             timestamptz,
  relances               smallint not null default 0,

  signe_le               timestamptz,
  demarrage_immediat     boolean,
  signature_ip           text check (char_length(signature_ip) <= 64),
  signature_agent        text check (char_length(signature_agent) <= 400),
  /* SHA-256 du contenu signé (texte et montants), écrit dans le PDF. */
  empreinte_contenu      text check (empreinte_contenu ~ '^[0-9a-f]{64}$'),
  /* SHA-256 du PDF signé tel que rangé dans le bucket. */
  empreinte_pdf          text check (empreinte_pdf ~ '^[0-9a-f]{64}$'),
  pdf_chemin             text check (char_length(pdf_chemin) <= 300),

  paiement_lien_le       timestamptz,
  stripe_session         text check (char_length(stripe_session) <= 200),
  paye_le                timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint devis_signe_complet check (
    statut <> 'signe'
    or (signe_le is not null and empreinte_contenu is not null and adresse is not null)
  )
);

comment on table public.devis is
  'Les devis envoyés aux clientes et signés en ligne (P16, 28/09/2026). Remplace Yousign.';

create index devis_org_idx on public.devis(organization_id, created_at desc);
create index devis_booking_idx on public.devis(booking_id);
create index devis_a_relancer_idx on public.devis(valide_jusqu_au) where statut = 'envoye';

alter table public.devis enable row level security;

create policy "devis_select" on public.devis
  for select to authenticated
  using (
    public.is_admin()
    or (booking_id is not null and exists (
          select 1 from public.radar_bookings b
           where b.id = booking_id
             and public.radar_peut_saisir(b.organization_id, b.closeuse_id)))
  );

create trigger devis_updated_at
  before update on public.devis
  for each row execute function public.set_updated_at();

-- ------------------------------ Le lien ------------------------------------

/*
 * Le lien personnel en clair, pour que le hub puisse demander au site le mail
 * du rappel quotidien. À part, sans aucune politique : seul le serveur
 * (service role) le lit ; ni la closeuse ni le client ne le voient.
 */
create table public.devis_liens (
  devis_id uuid primary key references public.devis(id) on delete cascade,
  lien     text not null check (lien ~ '^[0-9a-f]{64}$')
);

alter table public.devis_liens enable row level security;

-- ------------------------------ Le journal ---------------------------------

create table public.devis_evenements (
  id        bigint generated always as identity primary key,
  devis_id  uuid not null references public.devis(id) on delete cascade,
  genre     text not null check (genre in (
              'cree', 'envoye', 'ouvert', 'relance', 'signe', 'pdf', 'paiement_lien', 'paye', 'expire', 'annule')),
  le        timestamptz not null default now(),
  ip        text check (char_length(ip) <= 64),
  agent     text check (char_length(agent) <= 400),
  details   jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);

comment on table public.devis_evenements is
  'Le dossier de preuve d''un devis : chaque geste, avec son heure, son adresse IP et son navigateur.';

create index devis_evenements_devis_idx on public.devis_evenements(devis_id, le);

alter table public.devis_evenements enable row level security;

create policy "devis_evenements_select" on public.devis_evenements
  for select to authenticated
  using (exists (select 1 from public.devis d where d.id = devis_id));

-- ------------------------------ Le PDF -------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('devis', 'devis', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Aucune politique sur storage.objects pour ce bucket : seul le serveur
-- (service role) y lit et y écrit. Le PDF se télécharge par une route du hub
-- qui vérifie les droits.

-- ------------------------------ Vers Radar ---------------------------------

/*
 * Le devis est signé : la vente s'inscrit sur le rendez-vous, sans personne
 * connectée (la cliente signe sans compte). Appelée par le serveur seulement.
 * Même garde-fous que `radar_set_sale` : pas de vente sur une séance annulée
 * ou manquée, ni dans un mois dont le relevé est clôturé ; dans ces cas, rien
 * n'est écrit et la fonction rend faux (le devis reste signé, la fiche le
 * montre).
 */
create or replace function public.devis_vers_radar(devis uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  d        public.devis%rowtype;
  rdv      public.radar_bookings%rowtype;
  le_jour  date := (now() at time zone 'Europe/Paris')::date;
  fois     int;
  premier  int;
begin
  select * into d from public.devis where id = devis;
  if not found or d.statut <> 'signe' or d.booking_id is null then
    return false;
  end if;

  select * into rdv from public.radar_bookings where id = d.booking_id;
  if not found or rdv.status in ('annule', 'no_show') then
    return false;
  end if;

  if exists (
    select 1 from public.radar_statements s
     where s.organization_id = rdv.organization_id
       and s.month in (date_trunc('month', rdv.sale_date)::date, date_trunc('month', le_jour)::date)
  ) then
    return false;
  end if;

  fois := case when d.paiement = 'plusieurs' then least(d.duree_mois + 1, 24) else 1 end;
  premier := case when fois > 1 and d.investigation_cents > 0 and d.investigation_cents < d.total_cents
                  then d.investigation_cents else null end;

  update public.radar_bookings
     set sale_amount_cents  = d.total_cents,
         sale_date          = greatest(le_jour, (rdv.scheduled_start at time zone 'Europe/Paris')::date),
         sale_note          = 'Devis signé en ligne',
         sale_recorded_by   = coalesce(d.closeuse_id, d.cree_par),
         sale_recorded_at   = now(),
         sale_fois          = fois,
         sale_premier_cents = premier,
         updated_at         = now()
   where id = rdv.id;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (rdv.id, rdv.organization_id, coalesce(d.closeuse_id, d.cree_par),
     case when rdv.sale_amount_cents is null then 'sale.recorded' else 'sale.updated' end,
     jsonb_build_object('montant_cents', d.total_cents, 'date', le_jour, 'note_presente', true,
                        'montant_precedent', rdv.sale_amount_cents, 'date_precedente', rdv.sale_date,
                        'source', 'devis', 'devis', d.id, 'fois', fois, 'premier_cents', premier));

  return true;
end;
$fn$;

revoke execute on function public.devis_vers_radar(uuid) from public, anon, authenticated;
grant execute on function public.devis_vers_radar(uuid) to service_role;
