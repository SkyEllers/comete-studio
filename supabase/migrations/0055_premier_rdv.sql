-- ===========================================================================
-- 0055 — Le premier rendez-vous avec Peggy, réservé après le paiement
--
-- Jusqu'ici, une cliente qui payait son devis tombait sur une page « l'équipe
-- de Peggy revient vers toi », et personne n'était prévenu (07/10/2026, vente
-- de Géraldine T.). Louis, le 07/10/2026 : la page merci propose de réserver
-- tout de suite le premier rendez-vous avec Peggy, dans l'outil de
-- réservation, avec les règles du diagnostic (préavis, pause, pas, fenêtre),
-- dans les mêmes plages de Peggy et le même maximum par jour ; 30 minutes,
-- 15 pour un bilan microbiote seul (ce que son devis promet).
--
-- Quatre décisions tiennent dans ce fichier.
--
-- 1. Un rendez-vous de l'outil a un genre : `diagnostic` (tous ceux d'avant)
--    ou `premier`. Le premier se rattache au devis payé (`devis_id`) ; un
--    seul confirmé par devis, garanti par la base. Un devis effacé (tests)
--    laisse son rendez-vous sans devis plutôt que d'échouer.
--
-- 2. La durée se choisit à la prise. `reservation_prendre` lit
--    `duree_minutes` dans les données quand elles en portent une (15 à 240),
--    sinon celle du client, comme avant. Le report garde la durée du
--    rendez-vous qu'il remplace, son genre et son devis.
--
-- 3. Le maximum par jour et la pause comptent tous les rendez-vous de la
--    personne, quel que soit leur genre : rien ne change ici.
--
-- 4. Les rappels : `rappel_le` (le mail de la veille d'un premier
--    rendez-vous) et `devis.premier_rappel_le` (le rappel à la cliente qui a
--    payé sans réserver, 24 h après), pour ne partir qu'une fois.
-- ===========================================================================

alter table public.reservation_rendez_vous
  add column genre text not null default 'diagnostic' check (genre in ('diagnostic', 'premier')),
  add column devis_id uuid references public.devis(id) on delete set null,
  add column rappel_le timestamptz;

comment on column public.reservation_rendez_vous.genre is
  'diagnostic : le diagnostic offert. premier : le premier rendez-vous avec la titulaire, après le paiement d''un devis (0055).';

create unique index reservation_un_premier_par_devis
  on public.reservation_rendez_vous(devis_id)
  where statut = 'confirme' and genre = 'premier';

alter table public.devis
  add column premier_rappel_le timestamptz;

/*
 * Prendre un rendez-vous : celle de la 0042, plus le genre, le devis et la
 * durée choisie à la prise. Même signature : les appels existants ne
 * changent pas.
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
  duree    int;
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

  duree := coalesce((donnees->>'duree_minutes')::int, r.duree_minutes);
  if duree < 15 or duree > 240 then
    raise exception 'duree_invalide';
  end if;

  la_fin  := debut + make_interval(mins => duree);
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
    reporte_de, genre, devis_id
  ) values (
    p.organization_id, p.id, debut, la_fin,
    la_fin + make_interval(mins => r.pause_minutes),
    coalesce(donnees->>'origine', 'page'),
    donnees->>'prenom', donnees->>'nom', donnees->>'email', donnees->>'telephone',
    coalesce(donnees->>'fuseau_cliente', 'Europe/Paris'),
    coalesce(donnees->'reponses', '[]'::jsonb),
    coalesce(donnees->'utm', '{}'::jsonb),
    donnees->>'jeton_hash',
    (donnees->>'reporte_de')::uuid,
    coalesce(donnees->>'genre', 'diagnostic'),
    (donnees->>'devis_id')::uuid
  )
  returning id into nouveau;

  return nouveau;
end;
$fn$;

/*
 * Reporter : celle de la 0042, qui garde en plus le genre, le devis et, pour
 * un premier rendez-vous, sa durée (un diagnostic reprend celle du client,
 * comme avant).
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
    'reporte_de', a.id,
    'genre', a.genre,
    'devis_id', a.devis_id,
    'duree_minutes', case when a.genre = 'premier'
                          then (extract(epoch from (a.fin - a.debut)) / 60)::int
                     end
  ));

  -- Le lien personnel suit le rendez-vous : il gère désormais le nouveau.
  update public.reservation_rendez_vous set jeton_hash = null where id = ancien;
  update public.reservation_rendez_vous set jeton_hash = a.jeton_hash where id = nouveau;

  return nouveau;
end;
$fn$;

revoke execute on function public.reservation_prendre(uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.reservation_reporter(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reservation_prendre(uuid, timestamptz, jsonb) to service_role;
grant execute on function public.reservation_reporter(uuid, uuid, timestamptz, text) to service_role;
