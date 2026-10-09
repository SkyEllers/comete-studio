-- ===========================================================================
-- 0061 — Le bilan de purge compte ce qui est parti, pas les lignes
--
-- Demandé par Louis le 09/10/2026. Depuis 0032, `modeles_envoyes` et
-- `messages_libres` comptaient toutes les lignes sortantes de la
-- conversation. Or certaines lignes ne partent jamais, et restent notées en
-- `echec` :
-- - un créneau de contenu sauté (article récent, catalogue épuisé, articles
--   refusés) ;
-- - la ligne « rien envoyé » d'une question qui rejoint celle qui attend
--   déjà (09/10/2026) ;
-- - un envoi refusé pour de bon par Meta.
-- Sur le scénario du banc `qa:agent` : 7 modèles comptés pour 6 partis, 2
-- messages libres pour 1.
--
-- Désormais, seules les lignes qui ne sont pas en `echec` comptent
-- (`envoye`, `distribue`, `lu`). Les bilans déjà écrits ne se corrigent pas :
-- leurs conversations sont effacées.
-- ===========================================================================

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
        where m.conversation_id = c.id and m.sens = 'sortant' and m.genre = 'modele'
          and m.statut <> 'echec')::smallint,
      (select count(*) from public.agent_messages m
        where m.conversation_id = c.id and m.sens = 'sortant' and m.genre = 'libre'
          and m.statut <> 'echec')::smallint,
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

comment on column public.agent_bilans.modeles_envoyes is
  'Modèles vraiment partis (statut autre que echec), depuis 0061. Avant : toutes les lignes, créneaux sautés compris.';
comment on column public.agent_bilans.messages_libres is
  'Messages libres vraiment partis (statut autre que echec), depuis 0061. Avant : toutes les lignes, « rien envoyé » compris.';
