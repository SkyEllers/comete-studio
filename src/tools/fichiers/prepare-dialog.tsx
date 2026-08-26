"use client";

import { Folder, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { listerDossiers } from "./actions";
import { IconeFichier } from "./file-icon";
import { tailleLisible } from "./format";
import { useEnvois } from "./upload-context";

/**
 * Le dialog de préparation.
 *
 * Rien ne part avant d'être passé par là : on nomme, on choisit où ça va, puis
 * on envoie. C'est le moment où les noms de la pellicule — `IMG_4821.HEIC` —
 * deviennent quelque chose qui se retrouve.
 *
 * Le lot vit dans le contexte, pas ici : ce composant ne fait qu'afficher et
 * rappeler. Déposer d'autres fichiers pendant qu'on nomme les premiers les
 * ajoute au lot sans rien effacer.
 */
export function PrepareDialog({ orgSlug }: { orgSlug: string }) {
  const {
    preparation,
    renommerPreparation,
    retirerDePreparation,
    changerDestination,
    appliquerNomCommun,
    annulerPreparation,
    envoyer,
  } = useEnvois();

  const [dossiers, setDossiers] = useState<{ id: string; name: string }[]>([]);

  // Les champs de nom, pour qu'Entrée passe au suivant.
  const champs = useRef(new Map<string, HTMLInputElement>());

  const ouvert = preparation !== null;

  useEffect(() => {
    if (!ouvert) return;

    let vivant = true;
    void listerDossiers(orgSlug).then((result) => {
      if (vivant && result.ok) setDossiers(result.data);
    });

    return () => {
      vivant = false;
    };
  }, [ouvert, orgSlug]);

  if (!preparation) return null;

  const valides = preparation.entrees.filter((entree) => !entree.refus);
  const nomDestination =
    preparation.folderId === null
      ? "Hors dossier"
      : (dossiers.find((d) => d.id === preparation.folderId)?.name ?? "Dossier");

  /**
   * Entrée passe au champ suivant ; au dernier, elle envoie. Depuis le nom
   * commun (rang -1), elle descend sur le premier fichier.
   */
  const auSuivant = (rang: number) => {
    const suivante = valides[rang + 1];
    if (!suivante) {
      if (valides.length > 0) envoyer();
      return;
    }
    const champ = champs.current.get(suivante.cle);
    champ?.focus();
    champ?.select();
  };

  return (
    <Dialog open onOpenChange={(valeur) => !valeur && annulerPreparation()}>
      <DialogContent className="max-h-[88svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="p-4 pb-3 sm:p-6 sm:pb-4">
          <DialogTitle>
            {preparation.entrees.length === 1
              ? "Déposer un fichier"
              : `Déposer ${preparation.entrees.length} fichiers`}
          </DialogTitle>
          <DialogDescription>
            Donne-leur un nom qui se retrouve, choisis où les ranger, puis
            envoie.
          </DialogDescription>
        </DialogHeader>

        {/*
          Le nom commun est une commande de lot : chaque frappe renomme toute
          la liste, sous les yeux. On le met en haut parce qu'on s'en sert
          d'abord, et qu'on retouche à la main ensuite.
        */}
        <div className="border-line space-y-2 border-t px-4 py-3 sm:px-6">
          <Label htmlFor="nom-commun" className="text-muted-foreground">
            Nom commun pour tout le lot
          </Label>
          <Input
            id="nom-commun"
            value={preparation.nomCommun}
            onChange={(event) => appliquerNomCommun(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              auSuivant(-1);
            }}
            placeholder="Tournage octobre"
            maxLength={180}
            className="h-8"
          />
          <p className="text-muted-foreground font-mono text-xs">
            Optionnel — chaque fichier prend ce nom suivi de son numéro.
          </p>
        </div>

        <div className="border-line flex items-center gap-2 border-y px-4 py-3 sm:px-6">
          <span className="text-muted-foreground text-sm">Destination</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Folder aria-hidden="true" />
                {nomDestination}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-64 w-56 overflow-y-auto"
            >
              <DropdownMenuLabel>Ranger dans</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => changerDestination(null)}>
                Hors dossier
              </DropdownMenuItem>
              {dossiers.map((dossier) => (
                <DropdownMenuItem
                  key={dossier.id}
                  onSelect={() => changerDestination(dossier.id)}
                >
                  {dossier.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ul className="divide-line max-h-[45svh] divide-y overflow-y-auto">
          {preparation.entrees.map((entree) => {
            const rang = valides.indexOf(entree);

            return (
              <li
                key={entree.cle}
                className="flex items-center gap-3 px-4 py-3 sm:px-6"
              >
                <IconeFichier
                  mimeType={entree.fichier.type}
                  className="text-muted-foreground size-5 shrink-0"
                />

                <div className="min-w-0 flex-1">
                  {entree.refus ? (
                    <p className="truncate text-sm line-through">
                      {entree.fichier.name}
                    </p>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        ref={(element) => {
                          if (element) champs.current.set(entree.cle, element);
                          else champs.current.delete(entree.cle);
                        }}
                        value={entree.base}
                        onChange={(event) =>
                          renommerPreparation(entree.cle, event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          auSuivant(rang);
                        }}
                        maxLength={200}
                        aria-label={`Nom de ${entree.fichier.name}`}
                        className="h-8 min-w-0 flex-1"
                      />
                      {/* L'extension est montrée, jamais modifiable : c'est ce
                          qui garantit qu'on ne la perd pas en renommant. */}
                      {entree.extension ? (
                        <span className="text-muted-foreground shrink-0 font-mono text-xs">
                          {entree.extension}
                        </span>
                      ) : null}
                    </div>
                  )}

                  <p
                    className={cn(
                      "text-muted-foreground mt-1 font-mono text-xs",
                      entree.refus && "text-danger",
                    )}
                  >
                    {entree.refus
                      ? `${entree.refus} · ne sera pas envoyé`
                      : tailleLisible(entree.fichier.size)}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Retirer ${entree.fichier.name} du lot`}
                  onClick={() => retirerDePreparation(entree.cle)}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>

        <DialogFooter className="border-line border-t p-4 sm:p-6">
          <Button variant="ghost" onClick={annulerPreparation}>
            Annuler
          </Button>
          <Button onClick={envoyer} disabled={valides.length === 0}>
            <Upload aria-hidden="true" />
            {valides.length === 1
              ? "Envoyer 1 fichier"
              : `Envoyer ${valides.length} fichiers`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
