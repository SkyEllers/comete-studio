"use client";

import { KeyRound, MoreHorizontal, Pencil, Power, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Balise } from "@/tools/sonde/balise";
import type { SiteResume } from "@/tools/sonde/queries";

import { basculerSite, creerSite, modifierSite, regenererJeton } from "./actions";

/**
 * Les pages suivies d'un client.
 *
 * Trois choses par site, et rien de plus : la balise à coller, quand on a reçu
 * quelque chose pour la dernière fois, et de quoi l'éteindre. « Dernier
 * événement il y a… » est la seule information de diagnostic dont Louis a
 * besoin — une landing refondue qui a perdu sa balise se voit là, et nulle
 * part ailleurs.
 */
export function SondeSites({
  organizationId,
  sites,
  origine,
}: {
  organizationId: string;
  sites: SiteResume[];
  origine: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {sites.length === 0
            ? "Aucune page suivie pour ce client."
            : `${sites.length} page${sites.length > 1 ? "s" : ""} suivie${sites.length > 1 ? "s" : ""}.`}
        </p>
        <FormulaireSite organizationId={organizationId} />
      </div>

      <ul className="space-y-3">
        {sites.map((site) => (
          <Carte
            key={site.id}
            organizationId={organizationId}
            site={site}
            origine={origine}
          />
        ))}
      </ul>
    </div>
  );
}

function Carte({
  organizationId,
  site,
  origine,
}: {
  organizationId: string;
  site: SiteResume;
  origine: string;
}) {
  const [regeneration, setRegeneration] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const agir = (action: () => Promise<{ ok: boolean; error?: string }>, succes: string) =>
    startTransition(async () => {
      const resultat = await action();
      if (!resultat.ok) {
        toast.error(resultat.error ?? "Ça n'a pas marché.");
        return;
      }
      setRegeneration(false);
      toast.success(succes);
      router.refresh();
    });

  return (
    <li
      className={cn(
        "border-line bg-surface-1 space-y-3 rounded-lg border p-4",
        !site.is_active && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display font-semibold">{site.name}</p>
            {site.is_active ? null : <Badge variant="outline">Désactivé</Badge>}
          </div>
          <p className="text-muted-foreground font-mono text-xs break-all">
            {site.domains.join(" · ") || "aucun domaine déclaré"}
          </p>
          <p className="text-muted-foreground text-xs">
            {site.dernierLabel
              ? `Dernier événement ${site.dernierLabel}`
              : "Aucun événement reçu — la balise n'est probablement pas en place."}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={`Menu du site ${site.name}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <FormulaireSite
              organizationId={organizationId}
              site={site}
              declencheur={
                <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                  <Pencil aria-hidden="true" />
                  Modifier
                </DropdownMenuItem>
              }
            />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                agir(
                  () => basculerSite(organizationId, site.id, !site.is_active),
                  site.is_active ? "Site désactivé" : "Site réactivé",
                );
              }}
            >
              <Power aria-hidden="true" />
              {site.is_active ? "Désactiver" : "Réactiver"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={(event) => {
                event.preventDefault();
                setRegeneration(true);
              }}
            >
              <KeyRound aria-hidden="true" />
              Régénérer le jeton
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Balise jeton={site.token} origine={origine} />

      <AlertDialog open={regeneration} onOpenChange={setRegeneration}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Régénérer le jeton de « {site.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              L&apos;ancien jeton meurt à l&apos;instant. La balise déjà posée sur
              la page cessera d&apos;être reconnue et la page ne mesurera plus rien
              tant que la nouvelle balise n&apos;y sera pas collée. Les chiffres
              déjà enregistrés, eux, ne bougent pas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                agir(
                  () => regenererJeton(organizationId, site.id),
                  "Jeton régénéré — pense à recoller la balise",
                )
              }
            >
              {pending ? "Régénération…" : "Régénérer"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** Déclarer une page, ou corriger son nom et ses domaines. */
function FormulaireSite({
  organizationId,
  site,
  declencheur,
}: {
  organizationId: string;
  site?: SiteResume;
  declencheur?: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState(site?.name ?? "");
  const [domaines, setDomaines] = useState(site?.domains.join("\n") ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const soumettre = (event: React.FormEvent) => {
    event.preventDefault();
    setErreur(null);

    startTransition(async () => {
      const resultat = site
        ? await modifierSite(organizationId, site.id, nom, domaines)
        : await creerSite(organizationId, nom, domaines);

      if (!resultat.ok) {
        setErreur(resultat.error);
        return;
      }

      setOuvert(false);
      if (!site) {
        setNom("");
        setDomaines("");
      }
      toast.success(site ? "Site modifié" : "Site déclaré");
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
        {declencheur ?? (
          <Button variant="outline" size="sm">
            <Plus aria-hidden="true" />
            Déclarer une page
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{site ? "Modifier le site" : "Déclarer une page"}</DialogTitle>
          <DialogDescription>
            Les domaines autorisent l&apos;envoi : un événement venu d&apos;ailleurs
            est ignoré. Les sous-domaines sont admis.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={soumettre} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`nom-${site?.id ?? "nouveau"}`}>Nom</Label>
            <Input
              id={`nom-${site?.id ?? "nouveau"}`}
              value={nom}
              onChange={(event) => setNom(event.target.value)}
              required
              autoFocus
              maxLength={60}
              autoComplete="off"
              placeholder="Landing thérapie brève"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`domaines-${site?.id ?? "nouveau"}`}>
              Domaines autorisés
            </Label>
            <Textarea
              id={`domaines-${site?.id ?? "nouveau"}`}
              value={domaines}
              onChange={(event) => setDomaines(event.target.value)}
              rows={3}
              placeholder={"jonathan-cuinat.com\nwww.jonathan-cuinat.com"}
              aria-describedby={`aide-${site?.id ?? "nouveau"}`}
            />
            <p id={`aide-${site?.id ?? "nouveau"}`} className="text-muted-foreground text-xs">
              Un par ligne. Une URL complète fait l&apos;affaire, seul l&apos;hôte
              est retenu.
            </p>
          </div>

          {erreur ? (
            <p role="alert" className="text-danger text-sm">
              {erreur}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={pending || nom.trim().length === 0}>
              {pending ? "Enregistrement…" : site ? "Enregistrer" : "Déclarer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
