"use client";

import { Search, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { FieldError, hasFieldError } from "@/components/app/field-error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  aEnvoyer,
  attendValidation,
  estVivante,
  heure,
  libelleDemande,
  type Demande,
  type MessagePret,
} from "@/tools/prospection/demandes";

import { annulerDemande, demanderRecherche, retirerMessage, validerEnvoi } from "./actions";

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
            Ton PC cherche des praticiens à 4 ou 5 étoiles, rédige chaque message et le vérifie
            contre ses sources. Les messages prêts reviennent ici : rien ne part tant que tu
            n&apos;as pas cliqué « Envoyer ». S&apos;il en trouve moins que demandé, il s&apos;arrête
            et te le dit.
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

function Retrait({ id, slug, retire }: { id: string; slug: string; retire: boolean }) {
  const [state, action, pending] = useActionState(retirerMessage, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="retirer" value={retire ? "non" : "oui"} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {retire ? "Remettre" : "Ne pas envoyer"}
      </Button>
      {state && !state.ok ? (
        <span className="text-destructive ml-2 text-xs">{state.error}</span>
      ) : null}
    </form>
  );
}

function Message({ demande, m }: { demande: Demande; m: MessagePret }) {
  const retire = demande.envoi_exclus.includes(m.slug);
  const valide = Boolean(demande.envoi_valide_le);
  return (
    <details className={retire ? "opacity-50" : undefined}>
      <summary className="cursor-pointer text-sm">
        <span className="text-ember font-mono text-xs">{"★".repeat(m.note ?? 0)}</span>{" "}
        {m.nom}
        {m.ville ? <span className="text-muted-foreground"> · {m.ville}</span> : null}
        <span className="text-muted-foreground font-mono text-xs"> · {m.contact}</span>
        {retire ? <span className="text-muted-foreground text-xs"> · ne part pas</span> : null}
      </summary>
      <div className="border-line mt-2 space-y-3 border-l-2 pl-3">
        <p className="text-sm">
          <span className="text-muted-foreground text-xs">Objet : </span>
          {m.objet}
        </p>
        <p className="bg-surface-2 rounded-md p-3 text-sm whitespace-pre-wrap">{m.corps}</p>
        {m.sources.length ? (
          <ul className="space-y-1 text-xs">
            {m.sources.map((s, i) => (
              <li key={i}>
                <span>{s.affirmation}</span>
                {s.url ? (
                  <>
                    {" "}·{" "}
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-ember underline">
                      source
                    </a>
                  </>
                ) : null}
                {s.extrait ? <span className="text-muted-foreground"> : « {s.extrait} »</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!valide ? <Retrait id={demande.id} slug={m.slug} retire={retire} /> : null}
      </div>
    </details>
  );
}

function Envoyer({ demande }: { demande: Demande }) {
  const [pending, startTransition] = useTransition();
  const partants = aEnvoyer(demande);
  const envoyer = () =>
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", demande.id);
      formData.set("attendus", String(partants.length));
      const resultat = await validerEnvoi(null, formData);
      if (resultat.ok) toast.success("Envoi validé : ton PC les envoie les jours ouvrés à partir de 9h30");
      else toast.error(resultat.error);
    });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={pending}>
          <Send aria-hidden="true" />
          Envoyer les {partants.length} message{partants.length > 1 ? "s" : ""}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Envoyer {partants.length} message{partants.length > 1 ? "s" : ""} depuis louis@cometestudio.fr ?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {partants.map((m) => m.nom).join(", ")}. Ils partent les jours ouvrés à partir de 9h30,
            20 par jour au plus. Un mail parti ne se rattrape pas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Pas encore</AlertDialogCancel>
          <AlertDialogAction onClick={envoyer}>Envoyer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
            {d.messages.length && d.statut === "faite" ? (
              <details open={attendValidation(d)} className="text-sm">
                <summary className="text-muted-foreground cursor-pointer text-xs">
                  {d.envoi_valide_le
                    ? `Messages validés le ${heure(d.envoi_valide_le)}`
                    : `Messages prêts, à relire avant l'envoi (${aEnvoyer(d).length})`}
                </summary>
                <div className="mt-2 space-y-2">
                  {d.messages.map((m) => (
                    <Message key={m.slug} demande={d} m={m} />
                  ))}
                  {attendValidation(d) ? (
                    <div className="pt-1">
                      <Envoyer demande={d} />
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
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
