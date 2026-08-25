# cometestudio.fr — espace client Comète Studio

Hub privé des clients de Comète Studio : chaque client se connecte et n'y voit que
les outils que Louis lui a activés. La vitrine publique, elle, est sur louisgirault.fr.
Rien n'est indexable ici (`noindex` sur toutes les routes, `robots.txt` en `Disallow: /`).

Stack : Next.js (App Router, TypeScript), Tailwind CSS + shadcn/ui, Supabase
(Auth, Postgres + RLS, Realtime), hébergé sur Vercel.

```bash
npm run dev     # http://localhost:3000
npm run build   # doit passer avant tout commit
npm run lint
npm run types   # régénère les types Supabase (projet lié)
```

Conventions, charte et interdits : `CLAUDE.md`. Briefs d'exécution par phase : `docs/`.
