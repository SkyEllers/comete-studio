-- ===========================================================================
-- 0015 — Radar : le nom de l'invité, et la vente déclarée
--
-- Deux évolutions nées du premier client réel, qui vend en deux temps : un
-- diagnostic offert réservé sur Calendly, puis un accompagnement vendu pendant
-- ou après le rendez-vous, dont Calendly ne sait rien.
--
-- 1. Le rendez-vous porte enfin un nom. Trente séances par semaine sans nom,
--    l'outil est inutilisable : impossible de retrouver qui est qui, de
--    marquer la bonne personne « non venue », de rattacher une vente. Le nom
--    entre ; l'email et le téléphone restent dehors, définitivement.
--
-- 2. Une vente peut être déclarée sur un rendez-vous, et chaque client a
--    désormais une base de commission : `encaissement` (le paiement Calendly
--    fait foi — le comportement d'hier, inchangé au centime près) ou `ventes`
--    (les ventes déclarées font foi).
--
-- Ce que cette migration ne fait pas, et qu'il faut avoir en tête en la
-- lisant : elle n'affiche rien et ne change aucun écran. Elle pose la base,
-- la vue, la fonction d'écriture et l'oubli. Les chantiers 2 à 4 s'appuient
-- dessus.
--
-- Le point délicat est le troisième : faire entrer une donnée nominative dans
-- une base qui n'en contenait aucune. D'où une règle qui commande toute la
-- suite — le nom vit sur `radar_bookings`, il meurt avec la ligne, et il ne
-- se recopie nulle part : ni dans les relevés (conservés sans limite), ni
-- dans `radar_booking_activities`, ni dans `radar_webhook_log`, ni dans un
-- email, ni dans un export. Chaque fois qu'une écriture est ajoutée ci-
-- dessous, c'est cette règle qui décide de ce qu'elle a le droit de porter.
-- ===========================================================================

-- --------------------------- L'identité minimale ----------------------------

/*
 * `not null default ''` plutôt que `null` : les milliers de lignes déjà en
 * base n'ont pas de nom et n'en auront jamais — Calendly ne sera pas
 * réinterrogé. Une chaîne vide dit « pas de nom » aussi bien qu'un `null`,
 * et elle épargne à chaque lecture, à chaque `ilike` de la recherche et à la
 * purge d'avoir à distinguer les deux cas. La vue traduit le vide en
 * « Invité·e » une fois pour toutes.
 */
alter table public.radar_bookings
  add column invitee_first_name text not null default ''
    check (char_length(invitee_first_name) <= 80),
  add column invitee_last_name  text not null default ''
    check (char_length(invitee_last_name)  <= 80),
  add column sale_amount_cents  int
    check (sale_amount_cents is null or sale_amount_cents >= 0),
  add column sale_date          date,
  add column sale_note          text
    check (sale_note is null or char_length(sale_note) <= 200),
  add column sale_recorded_by   uuid references public.profiles(id) on delete set null,
  add column sale_recorded_at   timestamptz,
  /*
   * Montant et date vont ensemble, toujours. C'est ce qui permet à tout le
   * reste — la vue, le relevé, la purge — de lire « il y a une vente » sur la
   * seule présence du montant, sans jamais avoir à se demander dans quel mois
   * la ranger.
   */
  add constraint radar_sale_coherente check (
    (sale_amount_cents is null and sale_date is null)
    or (sale_amount_cents is not null and sale_date is not null)
  );

comment on column public.radar_bookings.invitee_first_name is
  'Prénom de l''invité, tel que Calendly l''annonce. Vidé par radar_purger_identite().';
comment on column public.radar_bookings.invitee_last_name is
  'Nom de l''invité. Jamais recopié dans un relevé, une activité ou le journal.';
comment on column public.radar_bookings.sale_date is
  'Date de la vente, qui décide de son mois de commission — pas celle du rendez-vous.';
comment on column public.radar_bookings.sale_recorded_by is
  'Qui a déclaré la vente. Null si son compte a disparu depuis.';

-- La recherche par nom (décision 7) est bornée à une organisation, et le mois
-- est presque toujours dans la question. L'index qui sert déjà cette paire
-- sert donc aussi le filtre par nom, qui s'applique ensuite sur quelques
-- centaines de lignes. Pas de `pg_trgm` tant qu'un client n'aura pas assez
-- d'historique pour que ça se voie.
create index radar_bookings_sale_recorded_by_idx
  on public.radar_bookings(sale_recorded_by);
-- Le mois d'une vente est une question qu'on posera à chaque clôture en mode
-- « ventes » ; sans index elle balaie tout l'historique du client.
create index radar_bookings_sale_month_idx
  on public.radar_bookings(organization_id, sale_date)
  where sale_amount_cents is not null;

-- -------------------------- La base de commission ---------------------------

/*
 * Deux modes, par client.
 *
 * `encaissement` : ce que Calendly a encaissé fait foi. C'est le comportement
 * des phases 4 à 6, et le défaut — aucun client existant ne change de règle du
 * fait de cette migration, ce que le banc vérifie au centime près.
 *
 * `ventes` : ce que le client déclare avoir vendu fait foi. C'est le cas d'un
 * diagnostic offert suivi d'un accompagnement payant, que Calendly ne voit
 * jamais passer.
 */
create type public.radar_commission_basis as enum ('encaissement', 'ventes');

alter table public.radar_settings
  add column commission_basis public.radar_commission_basis
    not null default 'encaissement';

comment on column public.radar_settings.commission_basis is
  'Ce qui fait foi pour la commission : l''encaissement Calendly, ou les ventes déclarées.';

-- --------------------------------- La vue -----------------------------------

/*
 * Reconstruite plutôt que remplacée, pour la raison apprise en 0010 : la vue
 * expose la table par `b.*`, et les sept nouvelles colonnes s'insèrent au
 * milieu de la liste. `create or replace` ne sait qu'ajouter en fin.
 *
 * Rien n'en dépend en base — ni vue, ni fonction ; seule l'application la lit.
 *
 * Elle gagne quatre colonnes calculées :
 *
 *   `invitee_display`    « Camille D. » — ce qui s'affiche dans une liste. Le
 *                        nom complet reste en colonne pour la fiche et pour la
 *                        recherche : afficher l'initiale est une politesse
 *                        d'écran, pas une pseudonymisation, et prétendre le
 *                        contraire serait malhonnête.
 *   `has_sale`           la présence d'une vente, lisible sans connaître la
 *                        contrainte de cohérence.
 *   `commission_basis`   le mode du client, remonté ici pour que le tableau de
 *                        bord n'ait pas à faire une requête de plus.
 *   `commission_month`   le mois qui facturera cette ligne. C'est la colonne
 *                        qui porte la décision 5 : un diagnostic du 28 août
 *                        vendu le 3 septembre est facturé en septembre.
 *
 * `security_invoker = on`, comme depuis la 0008 : la vue ne donne rien de plus
 * que ce que la RLS accorde déjà au lecteur. La jointure sur `radar_settings`
 * ne l'élargit pas — cette table s'ouvre exactement à qui `can_access_radar`
 * ouvre les rendez-vous. En `left join` malgré tout : un client dont la ligne
 * de réglages n'existerait pas encore verrait sinon tous ses rendez-vous
 * disparaître de l'écran, ce qui serait une drôle de façon d'apprendre qu'il
 * manque une ligne de configuration.
 */
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

-- ------------------------------- La vente -----------------------------------

/*
 * Déclarer, corriger ou retirer une vente. Le membre l'appelle, jamais une
 * écriture directe : `radar_bookings` ne s'ouvre en écriture qu'à Louis, et
 * ce qu'il faut vérifier ici — l'état du relevé, le statut du rendez-vous, la
 * cohérence de la date — n'est pas de ce qu'une politique RLS sait dire.
 *
 * Mêmes gardes et même forme que `radar_client_set_status`, y compris la copie
 * locale des paramètres : `amount_cents`, `sale_date` et `booking_id` sont
 * aussi des noms de colonnes, et l'ambiguïté ferait échouer les requêtes.
 *
 * Retirer une vente, c'est appeler avec un montant nul. Un seul chemin pour
 * les trois gestes, donc un seul endroit où le verrou du relevé est vérifié.
 */
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

  if not public.can_access_radar(rdv.organization_id) then
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

revoke execute on function public.radar_set_sale(uuid, int, date, text) from public, anon;
grant execute on function public.radar_set_sale(uuid, int, date, text) to authenticated;

-- --------------------------- L'oubli de l'identité --------------------------

/*
 * Le nom s'efface avant la ligne.
 *
 * La purge de la 0011 emporte les rendez-vous treize mois après la clôture du
 * relevé qui les a figés ; elle reste inchangée. Celle-ci est plus courte et
 * plus fine : elle vide les deux colonnes de nom — la ligne, ses montants et
 * son canal restent, parce que la commission déjà facturée doit rester
 * vérifiable.
 *
 * Six mois pour un rendez-vous sans vente : passé ce délai, plus personne ne
 * cherche « qui était Camille » sur un diagnostic sans suite. Treize mois pour
 * ceux qui ont donné une vente, le temps qu'un exercice comptable se clôture
 * et qu'un litige se règle.
 *
 * Le `case` dans le `where` fait les deux en une passe. La condition sur les
 * colonnes non vides n'est pas décorative : sans elle, la fonction rendrait
 * chaque mois le nombre de toutes les vieilles lignes, et un ménage qui
 * n'aurait rien effacé ressemblerait exactement à un ménage qui marche.
 *
 * `updated_at` n'est pas touché : il dit « quelqu'un a modifié ce rendez-vous »,
 * et un oubli programmé n'est pas quelqu'un.
 */
create or replace function public.radar_purger_identite(
  sans_vente interval default interval '6 months',
  avec_vente interval default interval '13 months'
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  vides integer;
begin
  update public.radar_bookings
     set invitee_first_name = '',
         invitee_last_name  = ''
   where (invitee_first_name <> '' or invitee_last_name <> '')
     and scheduled_start < now() - case
                                     when sale_amount_cents is null then sans_vente
                                     else avec_vente
                                   end;

  get diagnostics vides = row_count;
  return vides;
end;
$fn$;

revoke execute on function public.radar_purger_identite(interval, interval)
  from public, anon, authenticated;
grant execute on function public.radar_purger_identite(interval, interval) to service_role;

-- ------------------------------- La tâche -----------------------------------

-- Le 2 du mois, dix minutes après la purge des rendez-vous : les deux ménages
-- se suivent sans se marcher dessus, et celui-ci ne trouve plus les lignes que
-- l'autre vient d'emporter.
select cron.unschedule('radar-purge-identite')
  from cron.job where jobname = 'radar-purge-identite';

select cron.schedule(
  'radar-purge-identite',
  '10 3 2 * *',
  $cron$ select public.radar_purger_identite() $cron$
);
