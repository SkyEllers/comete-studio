-- ===========================================================================
-- 0049 — Radar : l'enregistrement du diagnostic
--
-- Décidé par Louis le 28/09/2026. Après un diagnostic, la closeuse dépose sur
-- la fiche du rendez-vous l'enregistrement de l'appel (le .mp4 de Zoom, de
-- Meet…) ; la transcription se lance toute seule ; le client (Peggy) retrouve
-- la vidéo et le texte sur le rendez-vous de la personne, pour préparer son
-- dossier.
--
-- Les décisions de ce fichier.
--
-- 1. Un enregistrement par rendez-vous. Le remplacer (mauvais fichier) écrase
--    la ligne ; l'ancien fichier est retiré du Storage par l'app, avec le
--    chemin que rend la fonction.
--
-- 2. Qui voit, qui dépose : exactement ceux qui peuvent saisir sur le
--    rendez-vous (`radar_peut_saisir`, 0036) — le client qui a Radar, Louis,
--    et la closeuse à qui le rendez-vous est attribué, à elle seule. Une
--    closeuse ne voit jamais l'enregistrement d'une autre.
--
-- 3. L'oubli a une sortie : « Je n'ai pas d'enregistrement », avec un résumé
--    écrit obligatoire (le problème, ce qu'elle veut, ses freins, ce qui a été
--    proposé), pour que le client ait quand même de quoi préparer son dossier.
--    Aucun mail n'en part (Louis, 28/09) : l'oubli se voit sur la fiche.
--
-- 4. Les écritures passent par des fonctions, comme toute saisie de Radar.
--    La transcription, elle, est écrite par le serveur (service role) : c'est
--    lui qui parle au service de transcription.
--
-- 5. Le fichier vit dans un bucket privé à part, `diagnostics` : la RLS de
--    `fichiers` (Capsule) suit un autre outil et d'autres droits. Chemin :
--    `<organisation>/<rendez-vous>/<nom aléatoire>`. Les politiques lisent le
--    rendez-vous dans le chemin, pas un paramètre de l'app.
-- ===========================================================================

-- ------------------------------ La table -----------------------------------

create table public.radar_diagnostic_enregistrements (
  booking_id           uuid primary key references public.radar_bookings(id) on delete cascade,
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  chemin               text check (char_length(chemin) <= 300),
  nom_fichier          text check (char_length(nom_fichier) <= 255),
  taille               bigint check (taille >= 0),
  sans_enregistrement  boolean not null default false,
  /*
   * Le résumé écrit quand il n'y a pas d'enregistrement :
   * { probleme, objectif, freins, propose }, du texte, 2 000 caractères au plus
   * chacun (vérifié par `radar_diagnostic_sans`).
   */
  resume               jsonb check (resume is null or jsonb_typeof(resume) = 'object'),
  transcription_etat   text not null default 'aucune'
                       check (transcription_etat in ('aucune', 'en_cours', 'faite', 'echec')),
  transcription_id     text check (char_length(transcription_id) <= 100),
  /* [{ qui, debut, fin, texte }] : qui parle (A, B…), en millisecondes. */
  transcription        jsonb check (transcription is null or jsonb_typeof(transcription) = 'array'),
  transcription_erreur text check (char_length(transcription_erreur) <= 500),
  transcription_le     timestamptz,
  depose_par           uuid references public.profiles(id) on delete set null default auth.uid(),
  depose_le            timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint radar_diagnostic_video_ou_resume check (
    (chemin is not null and not sans_enregistrement)
    or (chemin is null and sans_enregistrement and resume is not null)
  )
);

comment on table public.radar_diagnostic_enregistrements is
  'L''enregistrement d''un diagnostic (vidéo et transcription), ou le résumé écrit quand il n''y en a pas.';

create index radar_diagnostic_enregistrements_org_idx
  on public.radar_diagnostic_enregistrements(organization_id);
create index radar_diagnostic_enregistrements_en_cours_idx
  on public.radar_diagnostic_enregistrements(transcription_etat)
  where transcription_etat = 'en_cours';

alter table public.radar_diagnostic_enregistrements enable row level security;

create policy "radar_diagnostic_enregistrements_select" on public.radar_diagnostic_enregistrements
  for select to authenticated
  using (
    exists (select 1 from public.radar_bookings b
             where b.id = booking_id
               and public.radar_peut_saisir(b.organization_id, b.closeuse_id))
  );

create trigger radar_diagnostic_enregistrements_updated_at
  before update on public.radar_diagnostic_enregistrements
  for each row execute function public.set_updated_at();

-- ------------------------------ Le chemin ----------------------------------

/*
 * Ce chemin du bucket `diagnostics` est-il accessible à qui appelle ?
 * `<organisation>/<rendez-vous>/<fichier>` : le rendez-vous doit exister, être
 * à cette organisation, et qui appelle doit pouvoir y saisir.
 */
create or replace function public.radar_diagnostic_chemin_ok(chemin text)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  morceaux text[] := string_to_array(chemin, '/');
  org      uuid;
  cible    uuid;
  uuid_re  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if chemin is null or array_length(morceaux, 1) <> 3
     or morceaux[1] !~ uuid_re or morceaux[2] !~ uuid_re or morceaux[3] = '' then
    return false;
  end if;
  org := morceaux[1]::uuid;
  cible := morceaux[2]::uuid;

  return exists (
    select 1 from public.radar_bookings b
     where b.id = cible
       and b.organization_id = org
       and public.radar_peut_saisir(b.organization_id, b.closeuse_id)
  );
end;
$fn$;

revoke execute on function public.radar_diagnostic_chemin_ok(text) from public, anon;
grant execute on function public.radar_diagnostic_chemin_ok(text) to authenticated;

-- ------------------------------ Les fonctions ------------------------------

/*
 * Déposer (ou remplacer) l'enregistrement. Rend le chemin de l'ancien fichier
 * quand il y en avait un, pour que l'app le retire du Storage.
 */
create or replace function public.radar_diagnostic_deposer(
  booking_id uuid,
  chemin     text,
  nom        text,
  taille     bigint
) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  cible   uuid := booking_id;
  rdv     public.radar_bookings%rowtype;
  ancien  text;
  propre  text := left(nullif(btrim(coalesce(nom, '')), ''), 255);
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  if chemin is null
     or not starts_with(chemin, rdv.organization_id::text || '/' || cible::text || '/')
     or not public.radar_diagnostic_chemin_ok(chemin) then
    raise exception 'Ce fichier n''est pas rangé au bon endroit.';
  end if;

  if not exists (select 1 from storage.objects o where o.bucket_id = 'diagnostics' and o.name = chemin) then
    raise exception 'Le fichier n''est pas arrivé : relance l''envoi.';
  end if;

  select e.chemin into ancien
    from public.radar_diagnostic_enregistrements e
   where e.booking_id = cible;

  insert into public.radar_diagnostic_enregistrements as e
    (booking_id, organization_id, chemin, nom_fichier, taille, sans_enregistrement,
     transcription_etat, transcription_id, transcription, transcription_erreur, transcription_le,
     depose_par, depose_le)
  values
    (cible, rdv.organization_id, chemin, propre, taille, false,
     'aucune', null, null, null, null,
     auth.uid(), now())
  on conflict on constraint radar_diagnostic_enregistrements_pkey do update
     set chemin = excluded.chemin,
         nom_fichier = excluded.nom_fichier,
         taille = excluded.taille,
         sans_enregistrement = false,
         transcription_etat = 'aucune',
         transcription_id = null,
         transcription = null,
         transcription_erreur = null,
         transcription_le = null,
         depose_par = excluded.depose_par,
         depose_le = excluded.depose_le;

  insert into public.radar_booking_activities
    (booking_id, organization_id, user_id, type, payload)
  values
    (cible, rdv.organization_id, auth.uid(),
     case when ancien is null then 'recording.added' else 'recording.replaced' end,
     jsonb_build_object('taille', taille));

  return case when ancien is distinct from chemin then ancien else null end;
end;
$fn$;

/*
 * « Je n'ai pas d'enregistrement » : le résumé écrit remplace la vidéo. Les
 * quatre champs sont obligatoires ; un enregistrement déjà déposé ne se
 * remplace pas par un résumé.
 */
create or replace function public.radar_diagnostic_sans(
  booking_id uuid,
  resume     jsonb
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  cible   uuid := booking_id;
  rdv     public.radar_bookings%rowtype;
  champ   text;
  propre  jsonb := '{}'::jsonb;
  valeur  text;
begin
  select * into rdv from public.radar_bookings where id = cible;
  if not found then
    raise exception 'Ce rendez-vous n''existe pas.';
  end if;

  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then
    raise exception 'Ce rendez-vous ne t''est pas accessible.';
  end if;

  if exists (select 1 from public.radar_diagnostic_enregistrements e
              where e.booking_id = cible and e.chemin is not null) then
    raise exception 'Un enregistrement est déjà déposé pour ce rendez-vous.';
  end if;

  if resume is null or jsonb_typeof(resume) <> 'object' then
    raise exception 'Écris le résumé du diagnostic.';
  end if;

  foreach champ in array array['probleme', 'objectif', 'freins', 'propose'] loop
    valeur := btrim(coalesce(resume ->> champ, ''));
    if valeur = '' then
      raise exception 'Remplis les quatre parties du résumé.';
    end if;
    if char_length(valeur) > 2000 then
      raise exception 'Une partie du résumé dépasse 2 000 caractères.';
    end if;
    propre := propre || jsonb_build_object(champ, valeur);
  end loop;

  insert into public.radar_diagnostic_enregistrements as e
    (booking_id, organization_id, sans_enregistrement, resume, depose_par, depose_le)
  values
    (cible, rdv.organization_id, true, propre, auth.uid(), now())
  on conflict on constraint radar_diagnostic_enregistrements_pkey do update
     set sans_enregistrement = true,
         resume = excluded.resume,
         depose_par = excluded.depose_par,
         depose_le = excluded.depose_le;

  -- Le geste est signé ; le résumé, lui, reste sur sa ligne (données de santé).
  if not exists (select 1 from public.radar_booking_activities a
                  where a.booking_id = cible and a.type = 'recording.missing') then
    insert into public.radar_booking_activities
      (booking_id, organization_id, user_id, type, payload)
    values (cible, rdv.organization_id, auth.uid(), 'recording.missing', '{}'::jsonb);
  end if;
end;
$fn$;

revoke execute on function public.radar_diagnostic_deposer(uuid, text, text, bigint) from public, anon;
revoke execute on function public.radar_diagnostic_sans(uuid, jsonb) from public, anon;
grant execute on function public.radar_diagnostic_deposer(uuid, text, text, bigint) to authenticated;
grant execute on function public.radar_diagnostic_sans(uuid, jsonb) to authenticated;

-- ------------------------------ Bucket privé -------------------------------

/*
 * 5 Go, comme `fichiers` : un diagnostic de 45 min enregistré par Zoom pèse de
 * 100 Mo à 1 Go selon la résolution. Vidéo et audio seulement.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diagnostics', 'diagnostics', false, 5368709120, array['video/*', 'audio/*'])
on conflict (id) do nothing;

/*
 * Les envois TUS créent l'objet puis le complètent morceau par morceau : le
 * droit `update` leur est indispensable (voir 0005).
 */
create policy "diagnostics_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'diagnostics' and public.radar_diagnostic_chemin_ok(name));

create policy "diagnostics_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'diagnostics' and public.radar_diagnostic_chemin_ok(name));

create policy "diagnostics_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'diagnostics'
    and public.radar_diagnostic_chemin_ok(name)
    and public.est_auteur_objet(owner, owner_id)
  )
  with check (
    bucket_id = 'diagnostics'
    and public.radar_diagnostic_chemin_ok(name)
    and public.est_auteur_objet(owner, owner_id)
  );

create policy "diagnostics_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'diagnostics'
    and public.radar_diagnostic_chemin_ok(name)
    and (public.est_auteur_objet(owner, owner_id) or (select public.is_admin()))
  );
