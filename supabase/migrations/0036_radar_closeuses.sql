-- ===========================================================================
-- 0036 — Radar : la closeuse
--
-- Une closeuse tient les rendez-vous de vente d'un client à sa place. Elle
-- voit ses rendez-vous, et rien d'autre du client : ni ses chiffres, ni ses
-- autres outils, ni les rendez-vous du client lui-même.
--
-- Écrit par `scripts/generer-0036.py` : ne pas modifier ce fichier à la main,
-- modifier `scripts/0036-tete.sql`, `scripts/0036-queue.sql` ou le script.
--
-- Les décisions de ce fichier.
--
-- 1. Une closeuse n'est pas une « membre ». `is_member()` porte toute la
--    sécurité du hub (outils, Sonde, Horizon, fichiers, Radar) : l'exclure là
--    ferme tout d'un coup, sans policy à retoucher une par une. Elle n'entre
--    que par `is_closeuse()`, qui ne sert qu'aux policies écrites ici.
--
-- 2. Un rendez-vous appartient à une closeuse par son type de séance. Le
--    client ouvre un type à part dans son Calendly, sur les créneaux de la
--    closeuse ; Louis relie ce type à elle ; le webhook pose `closeuse_id` sur
--    chaque réservation de ce type. Louis peut aussi réattribuer à la main.
--
-- 3. Les réponses au formulaire de réservation sont gardées, pour ses
--    rendez-vous seulement. Radar ne les gardait pas, exprès : ce sont des
--    données de santé. La closeuse en a besoin pour préparer l'appel et pour
--    rappeler la personne. Elles vivent dans une table à part, lisible par
--    elle et par Louis seulement, effacée 90 jours après le rendez-vous, sauf
--    rappel promis encore à venir, et au plus tard au bout de 25 mois.
--
-- 4. La commission de la closeuse ne touche pas à celle de Comète. Les ventes
--    restent celles de Radar (une par rendez-vous) ; s'y ajoutent le nombre de
--    mensualités, les taux de la closeuse, et les incidents d'encaissement
--    (impayé, remboursement) que Louis note. Le calcul se fait dans l'app.
--
-- 5. Les cinq fonctions de saisie gardent leur code : seule leur garde change,
--    `radar_peut_saisir()` au lieu de `can_access_radar()`. Pour un membre ou
--    Louis, c'est exactement la même réponse qu'avant.
-- ===========================================================================

-- ------------------------------ Les droits ---------------------------------

create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = auth.uid()
                   and m.role <> 'closeuse');
$fn$;

create or replace function public.is_closeuse(org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = auth.uid()
                   and m.role = 'closeuse');
$fn$;

/*
 * Qui peut saisir sur un rendez-vous : ceux que Radar laissait déjà faire, plus
 * la closeuse à qui ce rendez-vous est attribué, et à elle seule.
 */
create or replace function public.radar_peut_saisir(org uuid, closeuse uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.can_access_radar(org)
      or (closeuse is not null
          and closeuse = auth.uid()
          and public.is_closeuse(org));
$fn$;

revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_closeuse(uuid) from public, anon;
revoke execute on function public.radar_peut_saisir(uuid, uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_closeuse(uuid) to authenticated;
grant execute on function public.radar_peut_saisir(uuid, uuid) to authenticated;

-- Elle lit le nom de l'organisation (la barre du haut), et sa propre adhésion
-- (« Mes espaces »). Rien d'autre des tables du socle.
drop policy "organizations_select" on public.organizations;
create policy "organizations_select" on public.organizations
  for select to authenticated
  using (public.is_member(id) or public.is_closeuse(id) or (select public.is_admin()));

create policy "memberships_select_self" on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------ Les tables ---------------------------------

/*
 * Une closeuse chez un client, et sa grille. Les taux sont ceux validés par
 * Peggy le 23/09/2026 : 15 %, puis 18 % sur les ventes au-delà de la 5e du
 * mois (celles-là seulement).
 */
create table public.radar_closeuses (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  taux            numeric(5,2) not null default 15 check (taux >= 0 and taux <= 100),
  taux_palier     numeric(5,2) not null default 18 check (taux_palier >= 0 and taux_palier <= 100),
  palier_apres    smallint not null default 5 check (palier_apres >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.radar_closeuses enable row level security;

create policy "radar_closeuses_select" on public.radar_closeuses
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_access_radar(organization_id));
create policy "radar_closeuses_admin_write" on public.radar_closeuses
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create trigger radar_closeuses_updated_at before update on public.radar_closeuses
  for each row execute function public.set_updated_at();

alter table public.radar_event_filters
  add column closeuse_id uuid references public.profiles(id) on delete set null;

comment on column public.radar_event_filters.closeuse_id is
  'Les réservations de ce type sont attribuées à cette closeuse par le webhook.';

alter table public.radar_bookings
  add column closeuse_id uuid references public.profiles(id) on delete set null,
  add column sale_fois smallint not null default 1 check (sale_fois between 1 and 24);

comment on column public.radar_bookings.closeuse_id is
  'La closeuse qui tient ce rendez-vous, ou null quand c''est le client.';
comment on column public.radar_bookings.sale_fois is
  'Nombre de paiements de la vente : 1 en une fois, sinon le premier puis une mensualité par mois.';

create index radar_bookings_closeuse_idx
  on public.radar_bookings(closeuse_id, scheduled_start)
  where closeuse_id is not null;

create policy "radar_bookings_select_closeuse" on public.radar_bookings
  for select to authenticated
  using (closeuse_id = (select auth.uid()) and public.is_closeuse(organization_id));

create policy "radar_activities_select_closeuse" on public.radar_booking_activities
  for select to authenticated
  using (
    public.is_closeuse(organization_id)
    and exists (select 1 from public.radar_bookings b
                 where b.id = booking_id and b.closeuse_id = (select auth.uid()))
  );

/*
 * Les réponses au formulaire de réservation, pour les rendez-vous d'une
 * closeuse seulement. Écrites par le webhook (service role), lues par elle et
 * par Louis. Le client ne les lit pas ici : il les a déjà dans son Calendly.
 */
create table public.radar_booking_answers (
  booking_id      uuid primary key references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  answers         jsonb not null check (jsonb_typeof(answers) = 'array'),
  received_at     timestamptz not null default now()
);

alter table public.radar_booking_answers enable row level security;

create policy "radar_booking_answers_select" on public.radar_booking_answers
  for select to authenticated
  using (
    (select public.is_admin())
    or (public.is_closeuse(organization_id)
        and exists (select 1 from public.radar_bookings b
                     where b.id = booking_id and b.closeuse_id = (select auth.uid())))
  );
create policy "radar_booking_answers_admin_delete" on public.radar_booking_answers
  for delete to authenticated using ((select public.is_admin()));

/*
 * Ce que Louis note quand l'argent ne suit pas l'échéancier : une mensualité
 * impayée (pas de commission dessus), ou remboursée (sa commission se retire
 * du mois suivant). Sans ligne ici, une mensualité échue compte comme payée.
 */
create table public.radar_encaissement_incidents (
  booking_id      uuid not null references public.radar_bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  numero          smallint not null check (numero between 1 and 24),
  type            text not null check (type in ('impaye', 'rembourse')),
  note            text check (char_length(note) <= 200),
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  primary key (booking_id, numero)
);

alter table public.radar_encaissement_incidents enable row level security;

create policy "radar_encaissement_incidents_select" on public.radar_encaissement_incidents
  for select to authenticated
  using (
    public.can_access_radar(organization_id)
    or (public.is_closeuse(organization_id)
        and exists (select 1 from public.radar_bookings b
                     where b.id = booking_id and b.closeuse_id = (select auth.uid())))
  );
create policy "radar_encaissement_incidents_admin_write" on public.radar_encaissement_incidents
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------- La vue ------------------------------------

drop view if exists public.radar_bookings_effective;

create view public.radar_bookings_effective
  with (security_invoker = on) as
select b.*,
       e.effective_status,
       m.commission_basis,
       b.sale_amount_cents is not null as has_sale,
       case
         when n.prenom is not null and n.nom is not null
           then n.prenom || ' ' || left(n.nom, 1) || '.'
         when n.prenom is not null then n.prenom
         when n.nom is not null then n.nom
         else 'Invité·e'
       end as invitee_display,
       /*
        * La règle de facturation, et le seul endroit où elle est écrite.
        *
        * En `encaissement`, l'expression est celle de la 0009, caractère pour
        * caractère : c'est ce qui garantit qu'aucun relevé passé ne se
        * recalcule autrement aujourd'hui.
        *
        * En `ventes`, le paiement Calendly ne dit plus rien — le diagnostic
        * est offert. Ce qui compte, c'est qu'une vente ait été déclarée, que
        * le rendez-vous qui l'a amenée vienne d'un canal Comète, et que la
        * séance ait bien eu lieu. Une séance encore à venir peut porter une
        * vente : on vend parfois avant de recevoir.
        */
       case
         when m.commission_basis = 'ventes'
           then b.sale_amount_cents is not null
                and coalesce(c.is_comete, false)
                and e.effective_status not in ('annule', 'no_show')
         else e.effective_status = 'honore'
              and b.payment_ok
              and b.amount_cents > 0
              and coalesce(c.is_comete, false)
       end as counts_for_commission,
       public.radar_mois(b.scheduled_start) as mois,
       /*
        * `sale_date` est une date, pas un instant : elle n'a pas de fuseau à
        * convertir, et `radar_mois()` — qui en attend un — lui en inventerait
        * un. `date_trunc` sur la date elle-même est la traduction exacte de
        * « le mois où le client dit avoir vendu ».
        */
       case
         when m.commission_basis = 'ventes'
           then date_trunc('month', b.sale_date)::date
         else public.radar_mois(b.scheduled_start)
       end as commission_month
  from public.radar_bookings b
  left join public.radar_channels c on c.id = b.channel_id
  left join public.radar_settings s on s.organization_id = b.organization_id
  cross join lateral (
    select coalesce(s.commission_basis, 'encaissement'::public.radar_commission_basis)
             as commission_basis
  ) m
  cross join lateral (
    select nullif(btrim(b.invitee_first_name), '') as prenom,
           nullif(btrim(b.invitee_last_name), '')  as nom
  ) n
  cross join lateral (
    select case
             when b.status = 'confirme' and b.scheduled_end < now()
               then 'honore'::public.radar_status
             else b.status
           end as effective_status
  ) e;
-- ------------------------ Les fonctions de saisie --------------------------

-- radar_set_sale : recopiée de 0015_radar_identite_ventes.sql, seule la garde change.
create or replace function public.radar_set_sale(
  booking_id   uuid,
  amount_cents int  default null,
  sale_date    date default null,
  note         text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  cible      uuid := booking_id;
  montant    int  := amount_cents;
  le_jour    date := sale_date;
  propre     text := nullif(btrim(coalesce(note, '')), '');
  rdv        public.radar_bookings%rowtype;
  mois_avant date;
  mois_apres date;
  geste      text;
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  -- Montant sans date, ou l'inverse : la contrainte de la table le refuserait
  -- de toute façon, mais avec un message que personne ne peut lire.
  if (montant is null) <> (le_jour is null) then
    raise exception 'Une vente porte un montant et une date, ou ni l''un ni l''autre.';
  end if;

  -- Rien à retirer : on ne signe pas un geste qui n'a rien fait.
  if montant is null and rdv.sale_amount_cents is null then
    return;
  end if;

  /*
   * On ne vend pas une séance qui n'a pas eu lieu. Le pendant de cette règle
   * vit au chantier 3 : annuler un rendez-vous porteur d'une vente est refusé
   * plutôt que d'effacer la vente en silence.
   */
  if montant is not null and rdv.status in ('annule', 'no_show') then
    raise exception 'Cette séance est annulée ou n''a pas eu lieu : elle ne porte pas de vente.';
  end if;

  /*
   * La date, encadrée en base et pas seulement à l'écran. Une vente datée dans
   * le futur se rangerait dans un mois qu'aucun relevé n'a encore fermé —
   * c'est-à-dire hors de portée de la commission, indéfiniment. Une vente
   * antérieure au rendez-vous qui l'a produite ne veut rien dire.
   */
  if montant is not null then
    if le_jour > (now() at time zone 'Europe/Paris')::date then
      raise exception 'Une vente ne se date pas dans le futur.';
    end if;
    if le_jour < (rdv.scheduled_start at time zone 'Europe/Paris')::date then
      raise exception 'Une vente ne précède pas le rendez-vous qui l''a amenée.';
    end if;
  end if;

  /*
   * Le verrou. On regarde les deux mois : celui que la vente quitte et celui
   * qu'elle rejoint. Sans le premier, corriger la date d'une vente déjà
   * facturée la ferait sortir d'un relevé clôturé — et le total d'un relevé
   * signé changerait après signature.
   */
  mois_avant := date_trunc('month', rdv.sale_date)::date;
  mois_apres := date_trunc('month', le_jour)::date;

  if exists (
    select 1
      from public.radar_statements s
     where s.organization_id = rdv.organization_id
       and s.month in (mois_avant, mois_apres)
  ) then
    raise exception 'Le relevé du mois de cette vente est clôturé : elle ne change plus.';
  end if;

  geste := case
             when montant is null then 'sale.removed'
             when rdv.sale_amount_cents is null then 'sale.recorded'
             else 'sale.updated'
           end;

  update public.radar_bookings
     set sale_amount_cents = montant,
         sale_date         = le_jour,
         sale_note         = case when montant is null then null else propre end,
         sale_recorded_by  = case when montant is null then null else auth.uid() end,
         sale_recorded_at  = case when montant is null then null else now() end,
         updated_at        = now()
   where id = cible;

  /*
   * Le geste est signé, la note ne l'est pas.
   *
   * `sale_note` est du texte libre : rien n'empêche d'y écrire un nom. Les
   * activités, elles, ne sont pas touchées par la purge de l'identité — elles
   * vivent aussi longtemps que la ligne. Recopier la note ici, ce serait
   * ouvrir une porte à côté de celle qu'on vient de fermer. On note qu'il y en
   * avait une ; son contenu reste sur le rendez-vous, et part avec lui.
   */
  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (cible, rdv.organization_id, auth.uid(), geste,
     jsonb_build_object(
       'montant_cents', montant,
       'date', le_jour,
       'note_presente', propre is not null,
       'montant_precedent', rdv.sale_amount_cents,
       'date_precedente', rdv.sale_date
     ));
end;
$fn$;

-- radar_decline_sale : recopiée de 0016_radar_vente_gardes.sql, seule la garde change.
create or replace function public.radar_decline_sale(booking_id uuid)
returns boolean
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

  -- Une séance qui porte une vente n'est pas sans vente. Dire les deux serait
  -- se contredire, et l'écran ne le propose pas : la fonction le refuse quand
  -- même, parce qu'une fonction ne fait pas confiance à son écran.
  if rdv.sale_amount_cents is not null then
    raise exception 'Cette séance porte une vente. Retire-la d''abord.';
  end if;

  if exists (
    select 1
      from public.radar_booking_activities a
     where a.booking_id = cible
       and a.type = 'sale.declined'
  ) then
    return false;
  end if;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values (cible, rdv.organization_id, auth.uid(), 'sale.declined', '{}'::jsonb);

  return true;
end;
$fn$;

-- radar_client_set_status : recopiée de 0016_radar_vente_gardes.sql, seule la garde change.
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

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
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

  /*
   * Phase 7. Une séance qui n'a pas eu lieu ne porte pas de vente : les deux
   * ensemble donneraient un montant facturable accroché à un rendez-vous
   * annulé. On refuse plutôt que d'effacer la vente en cascade — c'est de
   * l'argent, et ça se retire à la main, en le voyant.
   */
  if new_status in ('annule', 'no_show') and rdv.sale_amount_cents is not null then
    raise exception 'Cette séance porte une vente. Retire-la d''abord.';
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

-- radar_note_non_vente : recopiée de 0031_radar_motif_pas_encore.sql, seule la garde change.
create or replace function public.radar_note_non_vente(
  booking_id uuid,
  motif text,
  recontacter date default null
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  cible    uuid := booking_id;
  rdv      public.radar_bookings%rowtype;
  ce_mois  date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  mois     date := date_trunc('month', recontacter)::date;
  voulu    jsonb;
  derniere jsonb;
  declaree boolean := false;
begin
  if motif is null
     or motif not in ('pas_encore', 'argent', 'moment', 'conjoint', 'pas_convaincue', 'autre') then
    raise exception 'Motif inconnu : pas encore répondu, l''argent, pas le bon moment, le conjoint, pas convaincue ou autre.';
  end if;

  if mois is not null and (mois < ce_mois or mois > (ce_mois + interval '24 months')::date) then
    raise exception 'Le mois à recontacter tombe entre ce mois-ci et dans deux ans.';
  end if;

  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  if rdv.sale_amount_cents is not null then
    raise exception 'Cette séance porte une vente. Retire-la d''abord.';
  end if;

  if rdv.status in ('annule', 'no_show') then
    raise exception 'Cette séance n''a pas eu lieu : il n''y a pas de vente à expliquer.';
  end if;

  if rdv.scheduled_start > now() then
    raise exception 'Cette séance n''a pas encore eu lieu.';
  end if;

  if not exists (
    select 1
      from public.radar_booking_activities a
     where a.booking_id = cible
       and a.type = 'sale.declined'
  ) then
    insert into public.radar_booking_activities
      (booking_id, organization_id, user_id, type, payload)
    values (cible, rdv.organization_id, auth.uid(), 'sale.declined', '{}'::jsonb);
    declaree := true;
  end if;

  voulu := jsonb_build_object('motif', motif, 'recontacter', mois);

  select a.payload into derniere
    from public.radar_booking_activities a
   where a.booking_id = cible
     and a.type = 'sale.reason'
   order by a.created_at desc
   limit 1;

  if derniere = voulu then
    return declaree;
  end if;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values (cible, rdv.organization_id, auth.uid(), 'sale.reason', voulu);

  return true;
end;
$fn$;

-- radar_recontact_fait : recopiée de 0024_radar_pas_de_vente_motif.sql, seule la garde change.
create or replace function public.radar_recontact_fait(booking_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  cible  uuid := booking_id;
  rdv    public.radar_bookings%rowtype;
  raison jsonb;
  notee  timestamptz;
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  select a.payload, a.created_at into raison, notee
    from public.radar_booking_activities a
   where a.booking_id = cible
     and a.type = 'sale.reason'
   order by a.created_at desc
   limit 1;

  if raison is null or raison->>'recontacter' is null then
    raise exception 'Personne n''est à recontacter sur ce rendez-vous.';
  end if;

  if exists (
    select 1
      from public.radar_booking_activities a
     where a.booking_id = cible
       and a.type = 'recontact.done'
       and a.created_at >= notee
  ) then
    return false;
  end if;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values (
    cible, rdv.organization_id, auth.uid(), 'recontact.done',
    jsonb_build_object('recontacter', raison->'recontacter')
  );

  return true;
end;
$fn$;


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
