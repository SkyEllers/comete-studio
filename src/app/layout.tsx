import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";

import "./globals.css";

/**
 * Polices auto-hébergées depuis public/fonts/ (jamais de CDN Google).
 *
 * Chaque famille est déclarée deux fois, comme sur la v1 : le fichier « latin »
 * couvre le français et se précharge ; le « latin-ext » porte son unicode-range
 * et n'est téléchargé que si un glyphe l'exige. Les deux noms sont empilés dans
 * `--stack-*` (globals.css), le navigateur choisit tout seul, glyphe par glyphe.
 *
 * Les plages unicode sont recopiées en clair dans chaque appel : next/font
 * n'accepte que des littéraux dans ses arguments, une constante partagée est
 * perdue à la compilation (le build échoue sur `missing field value`).
 */
const spaceGrotesk = localFont({
  src: "../../public/fonts/space-grotesk.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-space-grotesk",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const spaceGroteskExt = localFont({
  src: "../../public/fonts/space-grotesk-latin-ext.woff2",
  weight: "300 700",
  display: "swap",
  preload: false,
  variable: "--font-space-grotesk-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const inter = localFont({
  src: "../../public/fonts/inter.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const interExt = localFont({
  src: "../../public/fonts/inter-latin-ext.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  variable: "--font-inter-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const jetbrainsMono = localFont({
  src: "../../public/fonts/jetbrains-mono.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains-mono",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const jetbrainsMonoExt = localFont({
  src: "../../public/fonts/jetbrains-mono-latin-ext.woff2",
  weight: "100 800",
  display: "swap",
  preload: false,
  variable: "--font-jetbrains-mono-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const fontVariables = [
  spaceGrotesk.variable,
  spaceGroteskExt.variable,
  inter.variable,
  interExt.variable,
  jetbrainsMono.variable,
  jetbrainsMonoExt.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Comète Studio — Espace client",
  description: "Espace client de Comète Studio.",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`dark ${fontVariables} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster
          position="bottom-right"
          theme="dark"
          closeButton
          style={
            {
              "--normal-bg": "var(--card)",
              "--normal-text": "var(--foreground)",
              "--normal-border": "var(--border)",
            } as React.CSSProperties
          }
        />
      </body>
    </html>
  );
}
