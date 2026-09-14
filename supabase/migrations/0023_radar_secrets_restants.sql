-- ===========================================================================
-- 0023 — Compter ce qu'un client laisse dans le Vault
--
-- Supprimer un client depuis l'administration effaçait sa ligne, et la base
-- emportait tout le reste en cascade — sauf ce qui ne vit pas dans ses tables.
-- Les secrets de Radar sont de ceux-là : rangés dans `vault.secrets` sous le
-- nom `radar:<org_id>:<type>`, ils survivaient à leur client. Un sel orphelin,
-- c'est de quoi retrouver qui se cache derrière des clés d'invité ; un jeton
-- orphelin, c'est l'agenda d'un ancien client resté ouvert.
--
-- La suppression les efface désormais (`radar_clear_secrets`, 0008). Cette
-- fonction sert à vérifier qu'il n'en reste aucun — et elle compte par préfixe
-- plutôt que par les trois noms connus : c'est la question « qu'est-ce qui
-- reste de ce client ? », pas « ce que j'ai pensé à effacer a-t-il disparu ? ».
-- Le jour où un quatrième type de secret apparaîtrait sans que la suppression
-- suive, c'est ici que ça se verrait.
--
-- Réservée à la clé de service, comme les autres fonctions du Vault : elle ne
-- lit aucune valeur, mais savoir qu'un client a des secrets n'est l'affaire
-- d'aucun membre.
-- ===========================================================================

create or replace function public.radar_secrets_restants(org uuid)
returns integer
language sql stable security definer set search_path = public, vault as $fn$
  select count(*)::integer
    from vault.secrets
   where org is not null
     and name like 'radar:' || org::text || ':%';
$fn$;

revoke execute on function public.radar_secrets_restants(uuid) from public, anon, authenticated;
grant execute on function public.radar_secrets_restants(uuid) to service_role;
