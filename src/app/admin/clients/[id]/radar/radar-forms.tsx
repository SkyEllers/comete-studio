"use client";

import { Link2Off, PlugZap, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  connecterCalendly,
  corrigerCanal,
  corrigerStatut,
  deconnecterCalendly,
  deplacerCanal,
  enregistrerCanal,
  enregistrerReglages,
  testerCalendly,
} from "@/app/admin/clients/[id]/radar/actions";
import { Reordonner } from "@/components/admin/reordonner";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import {
  AlertDialog,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";

/** Les quatre statuts, tels que Louis les voit. */
const STATUTS = [
  { valeur: "confirme", libelle: "Confirmé" },
  { valeur: "honore", libelle: "Honoré" },
  { valeur: "no_show", libelle: "Non venu" },
  { valeur: "annule", libelle: "Annulé" },
] as const;

// ---------------------------- Connexion Calendly ---------------------------

export function ConnexionCalendly({
  organizationId,
  connecte,
}: {
  organizationId: string;
  connecte: boolean;
}) {
  const [state, formAction, pending] = useActionState(connecterCalendly, null);
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      toast.success("Calendly connecté");
      router.refresh();
    }
  }, [state, router]);

  const tester = () =>
    startTransition(async () => {
      const resultat = await testerCalendly(organizationId);
      if (resultat.ok) toast.success(resultat.data.message);
      else toast.error(resultat.error);
    });

  const deconnecter = () =>
    startTransition(async () => {
      const resultat = await deconnecterCalendly(organizationId);
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      if (resultat.data.avertissement) toast.warning(resultat.data.avertissement);
      else toast.success("Calendly déconnecté");
      router.refresh();
    });

  if (connecte) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={tester} disabled={enCours}>
          <Stethoscope aria-hidden="true" />
          Tester la connexion
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={enCours}>
              <Link2Off aria-hidden="true" />
              Déconnecter
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Déconnecter Calendly ?</AlertDialogTitle>
              <AlertDialogDescription>
                L&apos;abonnement est supprimé chez Calendly et les secrets de ce
                client sont effacés. Les rendez-vous déjà reçus restent, mais
                plus aucun nouveau n&apos;arrivera.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <Button variant="destructive" onClick={deconnecter} disabled={enCours}>
                Déconnecter
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-xl space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Label htmlFor="calendly-token">Jeton d&apos;accès personnel du client</Label>
      <div className="flex items-start gap-2">
        <Input
          id="calendly-token"
          name="token"
          type="password"
          required
          autoComplete="off"
          placeholder="eyJraWQiOiIxY2UxZTEz…"
          aria-invalid={hasFieldError(state, "token")}
          aria-describedby="calendly-token-error"
        />
        <Button type="submit" disabled={pending}>
          <PlugZap aria-hidden="true" />
          {pending ? "Connexion…" : "Connecter"}
        </Button>
      </div>
      <p className="text-muted-foreground font-mono text-xs">
        Calendly → Intégrations → API &amp; Webhooks → jeton d&apos;accès personnel.
      </p>
      <FieldError state={state} field="token" id="calendly-token-error" />
      <FieldError state={state} id="calendly-form-error" />
    </form>
  );
}

// -------------------------------- Réglages ---------------------------------

export function ReglagesRadar({
  organizationId,
  commissionRate,
  windowDays,
  currency,
  commissionBasis,
}: {
  organizationId: string;
  commissionRate: number;
  windowDays: number;
  currency: string;
  commissionBasis: "encaissement" | "ventes";
}) {
  const [state, formAction, pending] = useActionState(enregistrerReglages, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      toast.success("Réglages enregistrés");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="space-y-2">
        <Label htmlFor="commission-rate">Taux de commission</Label>
        <div className="flex items-center gap-2">
          <Input
            id="commission-rate"
            name="commissionRate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            required
            defaultValue={commissionRate}
            className="w-28"
            aria-invalid={hasFieldError(state, "commissionRate")}
          />
          <span className="text-muted-foreground text-sm">%</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="window-days">Fenêtre de récurrence</Label>
        <div className="flex items-center gap-2">
          <Input
            id="window-days"
            name="windowDays"
            type="number"
            min="0"
            max="365"
            required
            defaultValue={windowDays}
            className="w-28"
            aria-invalid={hasFieldError(state, "windowDays")}
          />
          <span className="text-muted-foreground text-sm">jours</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="currency">Devise</Label>
        <Input
          id="currency"
          name="currency"
          required
          maxLength={3}
          defaultValue={currency}
          className="w-24 uppercase"
          aria-invalid={hasFieldError(state, "currency")}
        />
      </div>

      {/* La base de commission : le seul réglage qui change ce que le client
          paie, et le seul qui refuse de bouger tant qu'un relevé traîne. */}
      <div className="space-y-2">
        <Label htmlFor="commission-basis">Base de commission</Label>
        <select
          id="commission-basis"
          name="commissionBasis"
          defaultValue={commissionBasis}
          aria-invalid={hasFieldError(state, "commissionBasis")}
          className="border-line bg-surface-2 focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3"
        >
          <option value="encaissement">Encaissement Calendly</option>
          <option value="ventes">Ventes déclarées</option>
        </select>
      </div>

      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "…" : "Enregistrer"}
      </Button>

      <p className="text-muted-foreground w-full text-sm">
        <strong className="font-medium">Encaissement</strong> : la commission
        porte sur ce que Calendly a encaissé, séances honorées et payées venues
        des canaux Comète. <strong className="font-medium">Ventes déclarées</strong>{" "}
        : elle porte sur les ventes que le client saisit lui-même, rattachées au
        mois de la vente et non à celui de la séance. Ce choix ne peut pas
        changer tant qu&apos;un relevé n&apos;est pas réglé.
      </p>

      <div className="w-full">
        <FieldError state={state} field="commissionRate" id="rate-error" />
        <FieldError state={state} field="windowDays" id="window-error" />
        <FieldError state={state} field="currency" id="currency-error" />
        <FieldError state={state} field="commissionBasis" id="basis-error" />
        <FieldError state={state} id="reglages-error" />
      </div>
    </form>
  );
}

// --------------------------------- Canaux ----------------------------------

export type CanalAdmin = {
  id: string;
  key: string;
  label: string;
  is_comete: boolean;
  is_active: boolean;
  sort_order: number;
  rules: {
    sources?: string[];
    mediums?: string[];
    click_ids?: string[];
    declared?: string[];
  };
};

export function CanalForm({
  organizationId,
  canal,
  premier,
  dernier,
}: {
  organizationId: string;
  canal: CanalAdmin;
  /** Aux extrémités, la flèche correspondante n'a rien à proposer. */
  premier: boolean;
  dernier: boolean;
}) {
  const [state, formAction, pending] = useActionState(enregistrerCanal, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      toast.success(`${canal.label} enregistré`);
      router.refresh();
    }
  }, [state, router, canal.label]);

  const champ = (nom: string, libelle: string, valeurs: string[] | undefined, aide: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${canal.id}-${nom}`} className="text-muted-foreground text-xs">
        {libelle}
      </Label>
      <Input
        id={`${canal.id}-${nom}`}
        name={nom}
        defaultValue={(valeurs ?? []).join(", ")}
        placeholder={aide}
        className="h-8 font-mono text-xs"
      />
    </div>
  );

  return (
    <form action={formAction} className="border-line space-y-3 border-t p-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="channelId" value={canal.id} />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          name="label"
          required
          defaultValue={canal.label}
          className="h-8 max-w-48"
          aria-label={`Libellé de ${canal.label}`}
          aria-invalid={hasFieldError(state, "label")}
        />
        <span className="text-muted-foreground font-mono text-xs">{canal.key}</span>

        <label className="flex items-center gap-2 text-sm">
          <Switch name="isComete" defaultChecked={canal.is_comete} />
          Canal Comète
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Switch name="isActive" defaultChecked={canal.is_active} />
          Actif
        </label>

        <Button type="submit" size="sm" variant="outline" disabled={pending} className="ml-auto">
          {pending ? "…" : "Enregistrer"}
        </Button>

        {/* En bout de ligne : l'ordre d'interrogation du moteur d'attribution.
            Google Ads doit passer avant SEO, sinon `google/cpc` tombe dans le
            référencement naturel — ces deux flèches décident donc à qui seront
            attribuées les prochaines réservations. */}
        <Reordonner
          deplacer={deplacerCanal.bind(null, organizationId, canal.id)}
          premier={premier}
          dernier={dernier}
          quoi={canal.label}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {champ("sources", "utm_source", canal.rules.sources, "google, facebook")}
        {champ("mediums", "utm_medium", canal.rules.mediums, "cpc, organic")}
        {champ("clickIds", "Identifiants de clic", canal.rules.click_ids, "gclid, fbclid")}
        {champ("declared", "Réponses déclarées", canal.rules.declared, "Google, Recherche Google")}
      </div>

      <FieldError state={state} field="label" id={`${canal.id}-label-error`} />
      <FieldError state={state} id={`${canal.id}-error`} />
    </form>
  );
}

// --------------------- Corriger un rendez-vous (Louis) ---------------------

export function CorrigerRendezVous({
  organizationId,
  bookingId,
  channelId,
  statut,
  canaux,
}: {
  organizationId: string;
  bookingId: string;
  channelId: string | null;
  statut: string;
  canaux: { id: string; label: string }[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const [enCours, startTransition] = useTransition();
  const router = useRouter();

  const envoyerCanal = (formData: FormData) =>
    startTransition(async () => {
      const resultat = await corrigerCanal({
        organizationId,
        bookingId,
        channelId: formData.get("channelId"),
        motif: formData.get("motif"),
      });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("Canal corrigé");
      setOuvert(false);
      router.refresh();
    });

  const changerStatut = (valeur: string) =>
    startTransition(async () => {
      const resultat = await corrigerStatut({
        organizationId,
        bookingId,
        statut: valeur,
      });
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("Statut corrigé");
      router.refresh();
    });

  return (
    <div className="flex items-center justify-end gap-2">
      {/*
        Un menu plutôt qu'un `select` : c'est une commande immédiate, pas un
        champ de formulaire, et c'est ce que le reste du hub emploie pour ce
        geste-là.
      */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={enCours}>
            {STATUTS.find((option) => option.valeur === statut)?.libelle ?? statut}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Corriger le statut</DropdownMenuLabel>
          {STATUTS.map((option) => (
            <DropdownMenuItem
              key={option.valeur}
              disabled={option.valeur === statut}
              onSelect={() => changerStatut(option.valeur)}
            >
              {option.libelle}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={enCours}>
            Canal
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corriger le canal</DialogTitle>
          </DialogHeader>

          <form action={envoyerCanal} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${bookingId}-canal`}>Canal</Label>
              <select
                id={`${bookingId}-canal`}
                name="channelId"
                defaultValue={channelId ?? ""}
                required
                className="border-line bg-surface-1 h-9 w-full rounded-md border px-2 text-sm"
              >
                <option value="" disabled>
                  Choisis un canal
                </option>
                {canaux.map((canal) => (
                  <option key={canal.id} value={canal.id}>
                    {canal.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${bookingId}-motif`}>Motif</Label>
              <Input
                id={`${bookingId}-motif`}
                name="motif"
                required
                minLength={3}
                maxLength={200}
                placeholder="Campagne mal taguée le 12 octobre"
              />
              <p className="text-muted-foreground text-xs">
                Le client le verra : une correction qui change sa facture doit
                dire pourquoi.
              </p>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={enCours}>
                Corriger
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
