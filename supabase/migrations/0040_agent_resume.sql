-- ===========================================================================
-- 0040 — L'agent : le mail du matin part une fois par jour
--
-- Le résumé des diagnostics du jour (P12) part au premier passage de
-- l'horloge après 8h, heure de Paris. Cette colonne retient le dernier jour
-- envoyé : le passage qui l'écrit le premier est le seul à envoyer, les
-- suivants voient la journée déjà prise.
-- ===========================================================================

alter table public.agent_reglages
  add column resume_envoye_le date;

comment on column public.agent_reglages.resume_envoye_le is
  'Le dernier jour (heure de Paris) dont le mail du matin est parti, ou a été réservé par un passage de l''horloge.';

-- Les destinataires s'écrivent depuis l'administration : des adresses, rien d'autre.
alter table public.agent_reglages
  add constraint agent_reglages_resume_destinataires_check
  check (
    cardinality(resume_destinataires) <= 5
    and array_to_string(resume_destinataires, ' ') !~ '[<>,;]'
  );
