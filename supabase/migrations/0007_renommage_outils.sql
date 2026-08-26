-- ===========================================================================
-- 0007 — Les outils prennent leur nom
--
-- Kanban devient « Orbite », Fichiers devient « Capsule ».
--
-- Les slugs ne bougent pas, et c'est délibéré : ils portent les routes
-- (`/app/<client>/kanban`), les chemins du Storage, les politiques RLS et les
-- gardes d'accès. Un slug est une adresse, un nom est une étiquette — seule
-- l'étiquette change ici. Les liens déjà envoyés continuent de fonctionner.
--
-- Cette table est la source de ce que le client lit : la grille des outils et
-- l'administration affichent `name` et `description` d'ici, jamais du registre
-- du code, qui ne fournit que l'icône et la route.
-- ===========================================================================

update public.tools
   set name = 'Orbite',
       description = 'Tes tableaux de suivi : listes, cartes, avancement à plusieurs.'
 where slug = 'kanban';

update public.tools
   set name = 'Capsule',
       description = 'Tes photos, vidéos et documents, conservés en qualité d''origine.'
 where slug = 'fichiers';
