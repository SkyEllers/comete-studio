-- ===========================================================================
-- 0020 — Pulsar : plusieurs chronomètres en parallèle
--
-- 0019 posait un seul chronomètre en marche par personne, et démarrer
-- arrêtait le précédent. L'usage réel a tranché autrement : un appel client
-- pendant qu'un export tourne, une réunion où l'on règle aussi l'admin — deux
-- chronomètres sur le même créneau sont un choix, pas une faute. La journée
-- peut compter plus d'heures que l'horloge, et la vue Comète l'assume.
--
-- Il n'y a donc ni chevauchement interdit, ni avertissement. Il reste un
-- garde-fou : quatre chronomètres au plus, en même temps, pour une personne
-- dans un espace. Au-delà, ce n'est plus qu'on travaille sur cinq fronts,
-- c'est qu'on a oublié d'en arrêter un — et c'est ce que le refus dit.
-- ===========================================================================

drop index public.pulsar_one_running_idx;

/*
 * Ce que le plafond compte, et ce que l'écran Aujourd'hui lit : les
 * chronomètres en marche d'une personne dans un espace. Partiel, donc
 * minuscule — il ne porte jamais plus de quatre lignes par personne.
 */
create index pulsar_entries_en_cours_idx
  on public.pulsar_entries(created_by, organization_id) where ended_at is null;

/*
 * Quatre au plus.
 *
 * Par personne *et* par espace, là où l'ancien index ne regardait que la
 * personne : le plafond est un garde-fou contre l'oubli, et un oubli ne se
 * répare que s'il se voit. L'écran montre les chronomètres d'un espace ; le
 * refus doit compter exactement ceux-là, sinon il annoncerait quatre
 * chronomètres à quelqu'un qui n'en voit que trois.
 *
 * Un index ne sait pas compter jusqu'à quatre, d'où le trigger. Deux
 * précautions le rendent aussi sûr que l'index qu'il remplace :
 *
 * - le verrou consultatif, pris pour la personne et l'espace le temps de la
 *   transaction. Sans lui, deux démarrages simultanés — le téléphone et
 *   l'ordinateur — compteraient chacun trois chronomètres et passeraient tous
 *   les deux. Le second attend que le premier soit écrit, puis compte cinq.
 * - `security definer`, pour compter ce qui tourne même là où la RLS ne
 *   laisse plus rien voir : un chronomètre ne disparaît pas du compte parce
 *   que l'outil a été coupé puis rallumé entre-temps.
 *
 * Il se déclenche sur l'insertion, et sur toute mise à jour qui remettrait une
 * entrée en marche ou la déplacerait chez quelqu'un d'autre. Corriger le début
 * ou la note d'un chronomètre ne touche aucune de ces colonnes : il ne se
 * déclenche pas.
 *
 * Le message est écrit pour être lu tel quel : l'action le laisse passer,
 * comme les gardes du client interne.
 */
create or replace function public.pulsar_plafonner_chronos() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  en_marche integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('pulsar_chronos:' || new.created_by::text || ':' || new.organization_id::text, 0)
  );

  select count(*) into en_marche
    from public.pulsar_entries
   where created_by = new.created_by
     and organization_id = new.organization_id
     and ended_at is null
     and id <> new.id;

  if en_marche >= 4 then
    raise exception 'Quatre chronomètres tournent déjà. Arrête-en un d''abord.';
  end if;

  return new;
end;
$fn$;

/*
 * Une fonction de trigger ne s'appelle pas en RPC, et PostgreSQL ne vérifie
 * pas ce droit quand le trigger se déclenche : le retirer à tout le monde ne
 * coûte rien, et ferme la porte au lieu de compter sur la forme de son type
 * de retour.
 */
revoke execute on function public.pulsar_plafonner_chronos() from public, anon, authenticated;

create trigger pulsar_entries_plafond_chronos
  before insert or update of ended_at, created_by, organization_id on public.pulsar_entries
  for each row
  when (new.ended_at is null)
  execute function public.pulsar_plafonner_chronos();
