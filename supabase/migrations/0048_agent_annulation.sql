-- ===========================================================================
-- 0048 — L'agent annule à la demande de la cliente, et garde pourquoi
--
-- Décidé par Louis le 28/09/2026 : quand elle écrit qu'elle veut annuler,
-- l'agent lui propose d'abord de décaler ; si elle maintient, il annule
-- lui-même (outil de réservation ou Calendly), puis lui demande pourquoi.
--
-- Ce qu'on garde, et combien de temps :
-- - ses mots exacts (`raison_annulation`), avec la conversation : effacés
--   30 jours après le rendez-vous, comme tout le reste (0032) ;
-- - une catégorie (`raison_categorie`), sans rien de personnel : recopiée
--   dans le bilan au moment de la purge, donc gardée pour la mesure.
--
-- Et le mail de la veille pour celles qui ont dit STOP (`veille_mail_le`) :
-- l'agent ne leur écrit plus, le site leur envoie un mail, une seule fois.
-- ===========================================================================

alter table public.agent_conversations
  add column annulation_demandee_le timestamptz,
  add column annulee_par_agent_le   timestamptz,
  add column raison_annulation      text check (char_length(raison_annulation) <= 500),
  add column raison_categorie       text check (raison_categorie in (
    'empechement', 'pas_le_moment', 'budget', 'plus_interessee', 'ailleurs', 'autre'
  )),
  add column veille_mail_le         timestamptz;

comment on column public.agent_conversations.annulation_demandee_le is
  'Elle a écrit qu''elle voulait annuler : l''agent lui a proposé de décaler plutôt.';
comment on column public.agent_conversations.annulee_par_agent_le is
  'L''agent a annulé le rendez-vous à sa demande. La conversation reste ouverte le temps qu''elle dise pourquoi (deux jours au plus), sans plus aucun rappel.';
comment on column public.agent_conversations.raison_annulation is
  'Pourquoi elle a annulé, avec ses mots. Donnée personnelle : effacée avec la conversation.';
comment on column public.agent_conversations.raison_categorie is
  'Pourquoi elle a annulé, rangé : empechement, pas_le_moment, budget, plus_interessee, ailleurs, autre. Recopiée dans agent_bilans.';
comment on column public.agent_conversations.veille_mail_le is
  'Le mail de la veille, envoyé par le site à celles qui ont dit STOP (rendez-vous de l''outil de réservation).';

alter table public.agent_bilans
  add column annulee_par_agent boolean not null default false,
  add column raison_categorie  text check (raison_categorie in (
    'empechement', 'pas_le_moment', 'budget', 'plus_interessee', 'ailleurs', 'autre'
  ));

-- La purge recopie les deux nouveaux champs dans le bilan (même transaction
-- que l'effacement, comme en 0032).
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
      messages_libres, questions_montees, annulee_par_agent, raison_categorie
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
        where q.conversation_id = c.id)::smallint,
      c.annulee_par_agent_le is not null,
      c.raison_categorie
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
