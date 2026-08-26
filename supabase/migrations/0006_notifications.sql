-- ===========================================================================
-- 0006 — Notification des dépôts et compteurs (phase 3, chantier 5)
--
-- Deux choses indépendantes, mais du même chantier :
--
-- 1. `notification_batches` : la mémoire des emails déjà envoyés, qui sert à
--    ne pas prévenir Louis deux fois pour un même dépôt étalé en plusieurs
--    lots. La table n'a aucune politique RLS, volontairement — voir plus bas.
--
-- 2. `stats_fichiers()` : le compte et le poids des fichiers, pour la fiche
--    client et pour la page d'administration. Fonction `security invoker`,
--    donc soumise à la RLS de qui l'appelle.
-- ===========================================================================

-- --------------------------- Retenue des envois -----------------------------

create table public.notification_batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- `null` = dépôt à la racine de la médiathèque.
  folder_id       uuid references public.folders(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  sent_at         timestamptz not null default now()
);

-- La retenue pose toujours la même question — « cette personne a-t-elle déjà
-- fait prévenir pour ce dossier il y a moins de cinq minutes ? » — et prend la
-- plus récente. L'index est taillé pour celle-là.
create index notification_batches_retenue_idx
  on public.notification_batches(organization_id, user_id, folder_id, sent_at desc);

/*
 * RLS activée, aucune politique : personne ne lit ni n'écrit cette table avec
 * une session. Ce n'est pas un oubli.
 *
 * C'est le registre des notifications de Louis, pas une donnée du client. Y
 * laisser écrire un membre lui donnerait de quoi étouffer les emails en
 * insérant des lignes de retenue à la chaîne. Seule la Server Action y touche,
 * avec la clé secrète, et après avoir vérifié la session.
 */
alter table public.notification_batches enable row level security;

-- ------------------------------- Compteurs ---------------------------------

/*
 * Compte et poids des fichiers, pour une organisation ou pour toutes.
 *
 * `security invoker` (le défaut) : la fonction voit exactement ce que voit
 * l'appelant. Louis, admin, totalise tous les clients ; un membre ne totalise
 * que le sien. Aucune garde à écrire ici, c'est la RLS de `files` qui tranche.
 *
 * Les fichiers `uploading` sont exclus : un envoi en cours n'occupe pas encore
 * la place qu'il annonce, et un envoi abandonné ne l'occupera jamais.
 */
create or replace function public.stats_fichiers(org uuid default null)
returns table (fichiers bigint, octets bigint)
language sql stable set search_path = public as $fn$
  select count(*)::bigint,
         coalesce(sum(size_bytes), 0)::bigint
    from public.files
   where status = 'ready'
     and (org is null or organization_id = org);
$fn$;

-- Règle CLAUDE.md §7 : sans ce revoke, la fonction est appelable sans session.
revoke execute on function public.stats_fichiers(uuid) from public, anon;
grant execute on function public.stats_fichiers(uuid) to authenticated;
