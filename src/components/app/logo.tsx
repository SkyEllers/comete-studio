import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Logo Comète Studio, comme dans la barre de la vitrine : le badge rond braise
 * (public/brand/comete-logo.svg, le fichier de la vitrine) et le nom en
 * Fraunces 600. Le badge est un dessin, pas du texte : il garde ses couleurs.
 */

type LogoProps = React.ComponentProps<"span"> & {
  /** `icon` n'affiche que le badge (écrans étroits). */
  variant?: "full" | "icon";
};

export function Logo({ variant = "full", className, ...props }: LogoProps) {
  return (
    <span
      className={cn("text-encre inline-flex items-center gap-2.5", className)}
      {...props}
    >
      <Image
        src="/brand/comete-logo.svg"
        alt=""
        width={30}
        height={30}
        unoptimized
        priority
        className="size-[30px] shrink-0"
      />
      {variant === "full" ? (
        <span
          aria-hidden="true"
          className="font-display text-[17px] font-semibold tracking-[-0.01em] whitespace-nowrap"
        >
          Comète Studio
        </span>
      ) : null}
      <span className="sr-only">Comète Studio</span>
    </span>
  );
}
