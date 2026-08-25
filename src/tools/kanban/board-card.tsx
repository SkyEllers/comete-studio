"use client";

import { Archive, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { archiveBoard } from "./mutations";
import { colorHex } from "./palette";

export type BoardCardProps = {
  id: string;
  name: string;
  color: string;
  cardCount: number;
  updatedLabel: string;
  orgSlug: string;
};

export function BoardCard({
  id,
  name,
  color,
  cardCount,
  updatedLabel,
  orgSlug,
}: BoardCardProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const archiver = () =>
    startTransition(async () => {
      const result = await archiveBoard(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`« ${name} » archivé`);
      router.refresh();
    });

  return (
    <div className="group border-line bg-surface-1 hover:bg-surface-2 relative overflow-hidden rounded-lg border transition-colors">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: colorHex(color) }}
      />

      <Link
        href={`/app/${orgSlug}/kanban/${id}`}
        prefetch
        className="focus-visible:ring-ring block p-5 pt-6 focus-visible:ring-2 focus-visible:outline-none"
      >
        <p className="font-display truncate pr-8 font-semibold">{name}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {cardCount === 0
            ? "Aucune carte"
            : `${cardCount} carte${cardCount > 1 ? "s" : ""}`}
        </p>
        <p className="text-muted-foreground mt-3 font-mono text-xs">
          Modifié {updatedLabel}
        </p>
      </Link>

      <div className="absolute top-4 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              disabled={pending}
              aria-label={`Menu du tableau ${name}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={archiver}>
              <Archive aria-hidden="true" />
              Archiver
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
