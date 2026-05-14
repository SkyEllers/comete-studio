# cometestudio.fr

Site vitrine Comète Studio — product studio vertical pour thérapeutes-entrepreneuses.

## Stack

- Vanilla HTML / CSS / JS (zéro framework, zéro build)
- GSAP + ScrollTrigger (CDN) — compteurs animés et stagger reveals
- Vercel Analytics — événements via `window.va`
- Déploiement Vercel
- Polices Google Fonts (Space Grotesk, JetBrains Mono, Inter)

## Lancer en local

```bash
npx serve . -p 3000
```

Puis ouvrir http://localhost:3000

(Aucune build step, tout est statique.)

## Structure

```
/
├── index.html                          # Landing 1 page (12 sections)
├── style.css                           # Tous les styles
├── main.js                             # Blob · burger · sticky · GSAP · analytics
├── mentions-legales/index.html         # Mentions légales
├── confidentialite/index.html          # Politique de confidentialité V1
├── 404.html                            # Page 404 custom
├── favicon.svg                         # Favicon (accent #FF6B35)
├── robots.txt
├── sitemap.xml
├── vercel.json                         # Headers sécurité + cache + cleanUrls
├── site.webmanifest
├── package.json
└── assets/
    ├── images/
    │   ├── comete-studio-logo-slash.svg
    │   └── wordmark-comete-studio.svg
    └── cas/
        └── etude-de-cas-echo-peggy-girault.pdf   ← À PLACER
```

## Assets à produire avant déploiement

Le code référence les fichiers suivants — il faut les placer aux bons chemins :

| Asset | Chemin attendu | Statut |
|---|---|---|
| Étude de cas Écho (PDF) | `/assets/cas/etude-de-cas-echo-peggy-girault.pdf` | À placer (déjà existant côté Louis) |
| Favicon 32×32 | `/favicon-32.png` | À générer depuis `/favicon.svg` |
| Favicon 16×16 | `/favicon-16.png` | À générer depuis `/favicon.svg` |
| Apple touch icon 180×180 | `/apple-touch-icon.png` | À générer depuis `/favicon.svg` |
| OG image 1200×630 | `/assets/og-image.png` (48 KB) | Généré via `scripts/build-og-image.js` (Puppeteer + `scripts/og-template.html`) |
| Portrait Peggy Girault | `/assets/images/peggy-girault.webp` (156 KB) + `.jpg` fallback (335 KB) | Branché dans `.peggy-photo` (figure + `<picture>`, ratio 4:5 desktop & mobile) |

## À vérifier / remplacer avant mise en ligne

- **URL Cal.com** : `https://cal.eu/cometestudio/discovery` (instance européenne) — branchée dans `index.html` (CTA discovery + footer) et trackée dans `main.js`.
- **SIRET et adresse** : `944 952 688 00017` / `4 rue Léon Fabre, 69100 Villeurbanne` dans `mentions-legales/index.html` — vérifier qu'ils sont à jour.

## Déploiement Vercel

1. Pousser le repo sur GitHub
2. Importer le projet sur Vercel
3. Build command : *(vide)* — site statique
4. Output directory : *(vide / racine)*
5. Lier le domaine `cometestudio.fr` dans les paramètres du projet
6. Vercel Analytics : activer dans les paramètres → le script `/_vercel/insights/script.js` se charge automatiquement

## Charte

- **Couleurs** : `--void: #0A0A0A` / `--bone: #F2F2F0` / `--ember: #FF6B35`
- **Typos** : Space Grotesk (display 900) · JetBrains Mono (CLI/mono) · Inter (body)
- **Signatures** : grain SVG `feTurbulence`, blob curseur (desktop), compteurs animés GSAP

## Événements analytics suivis

- `Scroll Depth Home` — paliers 25/50/75/100%
- `CTA Discovery Click` — source : hero / cas / discovery / sticky-mobile
- `Outbound Click` — target : linkedin / cal.com
- `PDF Download` — fichier ciblé
- `FAQ Opened` — question ouverte
