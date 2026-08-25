"use client";

import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { createBoard } from "./mutations";
import {
  BOARD_COLORS,
  DEFAULT_BOARD_COLOR,
  PALETTE,
  type BoardColor,
} from "./palette";

export function NewBoardDialog({
  organizationId,
  createdBy,
  orgSlug,
}: {
  organizationId: string;
  createdBy: string;
  orgSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<BoardColor>(DEFAULT_BOARD_COLOR);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const soumettre = (event: React.FormEvent) => {
    event.preventDefault();
    setErreur(null);

    startTransition(async () => {
      const result = await createBoard({
        organizationId,
        name,
        color,
        createdBy,
      });

      if (!result.ok) {
        setErreur(result.error);
        return;
      }

      toast.success("Tableau créé");
      setOpen(false);
      setName("");
      setColor(DEFAULT_BOARD_COLOR);
      router.push(`/app/${orgSlug}/kanban/${result.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          Nouveau tableau
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau tableau</DialogTitle>
          <DialogDescription>
            Il démarre avec trois listes — À faire, En cours, Terminé — que tu
            peux renommer ou supprimer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={soumettre} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="board-name">Nom du tableau</Label>
            <Input
              id="board-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
              maxLength={80}
              aria-invalid={Boolean(erreur)}
              aria-describedby="board-error"
            />
            {erreur ? (
              <p id="board-error" role="alert" className="text-danger text-sm">
                {erreur}
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Couleur</legend>
            <div className="flex flex-wrap gap-2">
              {BOARD_COLORS.map((valeur) => {
                const actif = valeur === color;
                return (
                  <button
                    key={valeur}
                    type="button"
                    onClick={() => setColor(valeur)}
                    aria-pressed={actif}
                    aria-label={PALETTE[valeur].label}
                    title={PALETTE[valeur].label}
                    className={cn(
                      "focus-visible:ring-ring flex size-8 items-center justify-center rounded-md transition-transform focus-visible:ring-2 focus-visible:outline-none",
                      actif ? "scale-110" : "hover:scale-105",
                    )}
                    style={{ backgroundColor: PALETTE[valeur].hex }}
                  >
                    {actif ? (
                      <Check
                        aria-hidden="true"
                        className="text-void size-4"
                        strokeWidth={3}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Création…" : "Créer le tableau"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
