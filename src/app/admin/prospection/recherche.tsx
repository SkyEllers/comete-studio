"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldError, hasFieldError } from "@/components/app/field-error";
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
import type { ActionResult } from "@/lib/actions";
import { MarkdownText } from "@/tools/kanban/markdown";
import {
  NOMBRE_MAX,
  NOMBRE_MIN,
  estVivante,
  heure,
  libelleDemande,
  type Demande,
} from "@/tools/prospection/demandes";

import { annulerDemande, demanderRecherche } from "./actions";

/**
 * Le bouton « Trouver des prospects » et ce que le PC en a fait.
 *
 * La page se rafraîchit seule toutes les minutes tant qu'une demande vit :
 * une recherche dure plus d'une heure, et Louis doit pouvoir laisser l'onglet
 * ouvert sur son téléphone sans recharger.
 */

const RAFRAICHIR_MS = 60_000;

export function BoutonRecherche({ vivante }: { vivante: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (precedent: ActionResult | null, formData: FormData) => {
      const resultat = await demanderRecherche(precedent, formData);
      if (resultat.ok) {
        toast.success("Demande envoyée à ton PC");
        setOpen(false);
      }
      return resultat;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={vivante} title={vivante ? "Une recherche est déjà en attente ou en cours" : undefined}>
          <Search aria-hidden="true" />
          Trouver des prospects
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trouver des prospects</DialogTitle>
          <DialogDescription>
            Ton PC cherche des praticiens à 4 ou 5 étoiles, vérifie chaque message contre ses
            sources, puis l&apos;envoie depuis ta boîte, les jours ouvrés à partir de 9h30, 20 par
            jour au plus. S&apos;il en trouve moins que demandé, il s&apos;arrête et te le dit.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="nombre">Combien de prospects ?</Label>
            <Input
              id="nombre"
              name="nombre"
              type="number"
              inputMode="numeric"
              min={NOMBRE_MIN}
              max={NOMBRE_MAX}
              defaultValue={10}
              required
              autoFocus
              className="w-28 font-mono"
              aria-invalid={hasFieldError(state, "nombre")}
              aria-describedby="nombre-aide nombre-error"
            />
            <p id="nombre-aide" className="text-muted-foreground text-xs">
              De {NOMBRE_MIN} à {NOMBRE_MAX}. Compte environ 1 h 30 pour 10. Ton PC doit être allumé.
            </p>
            <FieldError state={state} field="nombre" id="nombre-error" />
          </div>

          <FieldError state={state} id="recherche-error" />

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Envoi…" : "Lancer la recherche"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Annuler({ id }: { id: string }) {
  const [state, action, pending] = useActionState(annulerDemande, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Annuler
      </Button>
      {state && !state.ok ? (
        <span className="text-destructive ml-2 text-xs">{state.error}</span>
      ) : null}
    </form>
  );
}

export function Demandes({ demandes }: { demandes: Demande[] }) {
  const router = useRouter();
  const vivante = demandes.some(estVivante);
  const [maintenant, setMaintenant] = useState(() => new Date());

  useEffect(() => {
    if (!vivante) return;
    const minuteur = setInterval(() => {
      setMaintenant(new Date());
      router.refresh();
    }, RAFRAICHIR_MS);
    return () => clearInterval(minuteur);
  }, [vivante, router]);

  if (demandes.length === 0) return null;

  return (
    <section aria-labelledby="demandes-titre" className="border-line bg-surface-1 mb-6 rounded-md border">
      <h2 id="demandes-titre" className="border-line border-b px-3 py-2 text-sm">
        Recherches demandées
      </h2>
      <ul className="divide-line divide-y">
        {demandes.map((d) => (
          <li key={d.id} className="space-y-1.5 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm">
                <span className="text-muted-foreground font-mono text-xs">
                  {heure(d.demandee_le)} · {d.nombre} demandés
                </span>{" "}
                {libelleDemande(d, maintenant)}
              </p>
              {d.statut === "en_attente" ? <Annuler id={d.id} /> : null}
            </div>
            {d.compte_rendu ? (
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer text-xs">
                  Compte rendu
                </summary>
                <div className="mt-2">
                  <MarkdownText>{d.compte_rendu}</MarkdownText>
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
