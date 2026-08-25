"use client";

import { LogOut, ShieldCheck, UserRound } from "lucide-react";
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

function initials(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

type UserMenuProps = {
  name: string;
  email: string;
  isAdmin: boolean;
};

export function UserMenu({ name, email, isAdmin }: UserMenuProps) {
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
