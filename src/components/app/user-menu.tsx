"use client";

import { Building2, Check, LayoutGrid, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";

import { signOut } from "@/components/app/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Espace } from "@/lib/access";

function initials(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

type UserMenuProps = {
  name: string;
  email: string;
  isAdmin: boolean;
  /** Les organisations dont l'utilisateur est membre, par ordre alphabétique. */
  espaces?: Espace[];
  /** L'espace ouvert en ce moment, coché dans la liste. */
  orgSlug?: string;
};

export function UserMenu({
  name,
  email,
  isAdmin,
  espaces = [],
  orgSlug,
}: UserMenuProps) {
  /*
   * Un client qui n'a qu'un espace n'a nulle part où aller : lui montrer une
   * liste d'un seul élément, coché, n'ajouterait qu'une ligne à lire. Louis,
   * lui, voit toujours la section — c'est par là qu'il passe d'un client à
   * l'autre, et « Tous les clients » y a sa place même s'il n'est membre de
   * rien.
   */
  const montrerEspaces = isAdmin || espaces.length >= 2;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-2"
          aria-label="Ouvrir le menu du compte"
        >
          <Avatar className="size-6">
            <AvatarFallback className="bg-surface-2 text-[0.6rem] font-medium">
              {initials(name, email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm sm:inline">
            {name || email}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm">{name || "Ton compte"}</span>
          <span className="text-muted-foreground block truncate font-mono text-xs">
            {email}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {montrerEspaces ? (
          <>
            {espaces.length > 0 ? (
              <>
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                  Mes espaces
                </DropdownMenuLabel>

                {espaces.map((espace) => {
                  const courant = espace.slug === orgSlug;

                  return (
                    <DropdownMenuItem key={espace.id} asChild>
                      <Link
                        href={`/app/${espace.slug}`}
                        prefetch
                        aria-current={courant ? "page" : undefined}
                      >
                        <Building2 aria-hidden="true" />
                        <span className="truncate">{espace.name}</span>
                        {courant ? (
                          <Check aria-hidden="true" className="ml-auto shrink-0" />
                        ) : null}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </>
            ) : null}

            {isAdmin ? (
              <DropdownMenuItem asChild>
                <Link href="/app" prefetch>
                  <LayoutGrid aria-hidden="true" />
                  Tous les clients
                </Link>
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem asChild>
          <Link href="/app/profil" prefetch>
            <UserRound aria-hidden="true" />
            Profil
          </Link>
        </DropdownMenuItem>

        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin" prefetch>
              <ShieldCheck aria-hidden="true" />
              Administration
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        {/* `display: contents` sur le formulaire : c'est le bouton qui reçoit
            la mise en page de l'item, donc l'icône et le libellé s'alignent
            comme les autres entrées du menu. */}
        <form action={signOut} className="contents">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden="true" />
              Déconnexion
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
