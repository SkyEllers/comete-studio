-- ===========================================================================
-- 0018 — Le relevé apprend le mode, et les réglages tiennent un journal
--
-- Deux manques apparus en portant le mode `ventes` jusqu'à la clôture.
--
-- 1. Un relevé recopie déjà le taux et la fenêtre : « un relevé doit rester
--    lisible même si le contrat change ensuite » (0008). Il lui manquait la
--    règle elle-même. Sans elle, un relevé de septembre clôturé sur les ventes
--    se relirait l'an prochain avec les mots de l'encaissement — « séances
--    honorées et payées » — pour des lignes qui n'en sont pas.
--
-- 2. Changer la base de commission d'un client, c'est changer ce qu'il paie.
--    C'est le seul réglage de Radar dont il faut pouvoir dire quand il a
--    changé, et qui l'a changé. Les autres se lisent sur la ligne courante ;
--    celui-ci se défend.
-- ===========================================================================

-- --------------------- La règle, recopiée dans le relevé ---------------------

/*
 * `default 'encaissement'` : les relevés déjà clôturés l'ont tous été sous
 * cette règle, et c'est bien ce que la colonne doit dire d'eux. Aucun relevé
 * existant ne change de sens du fait de cette migration.
 */
alter table public.radar_statements
  add column commission_basis public.radar_commission_basis
    not null default 'encaissement';

comment on column public.radar_statements.commission_basis is
  'La règle sous laquelle ce relevé a été clôturé. Recopiée, comme le taux : un relevé se relit des années plus tard.';

-- ------------------------ Le journal des réglages ---------------------------

/*
 * Louis seul, comme `radar_channel_entries` et `radar_webhook_log`.
 *
 * On pourrait défendre l'inverse — le client a un intérêt légitime à savoir
 * quand la règle de sa commission a changé. Mais il le voit déjà là où ça
 * compte : ses réglages nomment la règle en cours en français, et chaque
 * relevé porte désormais la sienne. Ce journal-ci sert à Louis, quand un
 * client demande « depuis quand ? » — et il ne contient que des chiffres et
 * des noms de réglages, jamais une donnée de personne.
 */
create table public.radar_settings_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null = le système. En pratique c'est toujours Louis, mais un compte
  -- supprimé ne doit pas emporter la trace de ce qu'il a décidé.
  user_id         uuid references public.profiles(id) on delete set null,
  -- basis.changed, settings.changed
  type            text not null,
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index radar_settings_log_org_idx
  on public.radar_settings_log(organization_id, created_at desc);
create index radar_settings_log_user_idx on public.radar_settings_log(user_id);

alter table public.radar_settings_log enable row level security;

create policy "radar_settings_log_all" on public.radar_settings_log
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
