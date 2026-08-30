"use client";

import { FolderPlus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { creerBoite } from "@/app/app/[orgSlug]/(tools)/sas/actions";
import { LIMITE_NOM_BOITE } from "./types";

/**
 * Le champ de recherche, en haut des boîtes.
 *
 * La recherche vit dans l'URL (`?q=`) et non dans un état local : un résultat
 * se partage, se met en favori, et le bouton « précédent » du téléphone
 * ramène à la liste des boîtes au lieu de sortir de l'outil.
 *
 * Une pause de 300 ms avant de naviguer : sans elle, chaque lettre tapée
 * déclencherait un aller-retour serveur et la liste clignoterait.
 */
export function BarreBoites({
  orgSlug,
  recherche,
}: {
  orgSlug: string;
  recherche: string;
}) {
  const [valeur, setValeur] = useState(recherche);
  const router = useRouter();

  /*
   * Le champ mène l'URL, jamais l'inverse : `replace` ne crée pas d'entrée
   * d'historique, donc `recherche` finit toujours par rejoindre `valeur` et il
   * n'y a rien à resynchroniser. C'est ce qui permet de se passer d'un effet
   * qui recopierait la propriété dans l'état — et des rendus en cascade qui
   * vont avec.
   */
  useEffect(() => {
    if (valeur === recherche) return;

    const minuteur = setTimeout(() => {
      const cible = valeur.trim()
        ? `/app/${orgSlug}/sas/boites?q=${encodeURIComponent(valeur.trim())}`
        : `/app/${orgSlug}/sas/boites`;
      router.replace(cible, { scroll: false });
    }, 300);

    return () => clearTimeout(minuteur);
  }, [valeur, recherche, orgSlug, router]);

  return (
    <div className="mb-6 flex items-center gap-2">
      <div className="relative flex-1">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={valeur}
          onChange={(event) => setValeur(event.target.value)}
          placeholder="Chercher une idée…"
          aria-label="Chercher une idée"
          autoComplete="off"
          className="pl-8"
        />
        {valeur ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setValeur("")}
            aria-label="Effacer la recherche"
            className="absolute top-1/2 right-1 -translate-y-1/2"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <NouvelleBoite orgSlug={orgSlug} />
    </div>
  );
}

function NouvelleBoite({ orgSlug }: { orgSlug: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const creer = (event: React.FormEvent) => {
    event.preventDefault();
    setErreur(null);

    startTransition(async () => {
      const resultat = await creerBoite(orgSlug, nom);
      if (!resultat.ok) {
        setErreur(resultat.error);
        return;
      }
      setOuvert(false);
      setNom("");
      toast.success("Boîte créée");
      router.refresh();
    });
  };

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(valeur) => {
        setOuvert(valeur);
        if (!valeur) setErreur(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderPlus aria-hidden="true" />
          <span className="max-sm:sr-only">Nouvelle boîte</span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle boîte</DialogTitle>
        </DialogHeader>

        <form onSubmit={creer} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="nouvelle-boite">Nom de la boîte</Label>
            <Input
              id="nouvelle-boite"
              value={nom}
              onChange={(event) => setNom(event.target.value)}
              required
              autoFocus
              maxLength={LIMITE_NOM_BOITE}
              autoComplete="off"
              placeholder="Un prénom, un client, un sujet"
              aria-invalid={Boolean(erreur)}
            />
            {erreur ? (
              <p role="alert" className="text-danger text-sm">
                {erreur}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || nom.trim().length === 0}>
              {pending ? "Création…" : "Créer la boîte"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
