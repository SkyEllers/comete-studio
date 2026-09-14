-- ===========================================================================
-- 0022 — Radar : l'appel de la veille
--
-- Certains clients appellent chaque personne la veille de son rendez-vous
-- pour qu'elle le valide. Chez Peggy, un appel sans réponse faisait sauter le
-- rendez-vous : 103 annulations sur 111 entre juin et septembre 2026. Pour
-- savoir combien de ces personnes seraient venues, elle garde désormais le
-- rendez-vous, et note pour chacun ce que l'appel a donné.
--
-- Trois décisions tiennent dans ce fichier.
--
-- 1. Un réglage par client, éteint par défaut. Un client qui n'appelle pas n'a
--    pas à voir la question : elle encombrerait chaque fiche pour rien.
--
-- 2. La réponse vit dans les activités, pas dans une colonne. C'est le chemin
--    de « pas de vente » (0016) : une réponse qui peut changer, dont on garde
--    la trace, et que la dernière activité suffit à lire. Une colonne sur
--    `radar_bookings` aurait aussi obligé à reconstruire la vue
--    `radar_bookings_effective`, qui fige ses colonnes à sa création.
--
-- 3. Aucun verrou de relevé, aucune condition de statut. L'appel ne touche ni
--    la commission ni le statut : on peut le noter avant la séance, juste après
--    avoir raccroché, comme sur une séance annulée ou passée.
-- ===========================================================================

alter table public.radar_settings
  add column suivi_appel_veille boolean not null default false;

comment on column public.radar_settings.suivi_appel_veille is
  'Vrai : chaque rendez-vous demande « Appel de la veille : a confirmé / sans réponse ». Réglé par Louis.';

/*
 * Noter ce que l'appel de la veille a donné.
 *
 * Rend `true` si la réponse est nouvelle ou change, `false` si c'était déjà
 * celle-là — comme `radar_decline_sale`, pour que deux clics n'écrivent pas
 * deux fois la même chose.
 */
create or replace function public.radar_note_appel(booking_id uuid, reponse text)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  -- Copie locale : `booking_id` est aussi une colonne de la table d'activités.
  cible     uuid := booking_id;
  rdv       public.radar_bookings%rowtype;
  suivi     boolean;
  voulu     text;
  derniere  text;
begin
  if reponse is null or reponse not in ('confirme', 'sans_reponse') then
    raise exception 'Réponse inconnue : « a confirmé » ou « sans réponse ».';
  end if;

  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.can_access_radar(rdv.organization_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  select s.suivi_appel_veille into suivi
    from public.radar_settings s
   where s.organization_id = rdv.organization_id;

  if not coalesce(suivi, false) then
    raise exception 'L''appel de la veille n''est pas suivi dans cet espace.';
  end if;

  voulu := case reponse when 'confirme' then 'call.confirmed' else 'call.no_answer' end;

  select a.type into derniere
    from public.radar_booking_activities a
   where a.booking_id = cible
     and a.type in ('call.confirmed', 'call.no_answer')
   order by a.created_at desc
   limit 1;

  if derniere = voulu then
    return false;
  end if;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values (cible, rdv.organization_id, auth.uid(), voulu, '{}'::jsonb);

  return true;
end;
$fn$;

revoke execute on function public.radar_note_appel(uuid, text) from public, anon;
grant execute on function public.radar_note_appel(uuid, text) to authenticated;

-- Relire la dernière réponse d'un rendez-vous : c'est la question que posent
-- la fiche, le bloc « À vérifier » et le bilan du test.
create index if not exists radar_activities_appel_idx
  on public.radar_booking_activities(booking_id, created_at desc)
  where type in ('call.confirmed', 'call.no_answer');
