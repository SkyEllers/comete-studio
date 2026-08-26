"use client";

import { FolderPlus } from "lucide-react";
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

import { createFolder } from "./actions";

export function NewFolderDialog({ orgSlug }: { orgSlug: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const soumettre = (event: React.FormEvent) => {
    event.preventDefault();
    setErreur(null);

    startTransition(async () => {
      const result = await createFolder(orgSlug, nom);

      if (!result.ok) {
        setErreur(result.error);
        return;
      }

      toast.success(`Dossier « ${nom.trim()} » créé`);
      setOuvert(false);
      setNom("");
      router.push(`/app/${orgSlug}/fichiers/${result.data.id}`);
    });
  };

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(valeur) => {
        setOuvert(valeur);
        if (!valeur) {
          setNom("");
          setErreur(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <FolderPlus aria-hidden="true" />
          Nouveau dossier
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau dossier</DialogTitle>
          <DialogDescription>
            Un rangement par lot : « Photos octobre », « Logos », « Factures ».
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={soumettre} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="nom-dossier">Nom du dossier</Label>
            <Input
              id="nom-dossier"
              value={nom}
              onChange={(event) => setNom(event.target.value)}
              required
              autoFocus
              maxLength={80}
              autoComplete="off"
              aria-invalid={Boolean(erreur)}
              aria-describedby="erreur-dossier"
            />
            {erreur ? (
              <p id="erreur-dossier" role="alert" className="text-danger text-sm">
                {erreur}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Création…" : "Créer le dossier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
