"use client";

import { ChevronRight, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { restoreBoard } from "./mutations";
import { colorHex } from "./palette";

type BoardArchive = {
  id: string;
  name: string;
  color: string;
  cardCount: number;
  updatedLabel: string;
};

export function ArchivedBoards({ boards }: { boards: BoardArchive[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (boards.length === 0) return null;

  const restaurer = (board: BoardArchive) =>
    startTransition(async () => {
      const result = await restoreBoard(board.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`« ${board.name} » restauré`);
      router.refresh();
    });

  return (
    <section className="mt-10">
      <button
        type="button"
        onClick={() => setOuvert((valeur) => !valeur)}
        aria-expanded={ouvert}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-sm text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("size-4 transition-transform", ouvert && "rotate-90")}
        />
        Tableaux archivés ({boards.length})
      </button>

      {ouvert ? (
        <ul className="border-line divide-line mt-4 divide-y rounded-lg border">
          {boards.map((board) => (
            <li
              key={board.id}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: colorHex(board.color) }}
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">{board.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {board.cardCount} carte{board.cardCount > 1 ? "s" : ""} ·
                    modifié {board.updatedLabel}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => restaurer(board)}
                disabled={pending}
              >
                <RotateCcw aria-hidden="true" />
                Restaurer
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
