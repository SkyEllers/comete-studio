"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { enregistrerReleve, supprimerReleve, type SaisieReleve } from "./actions";

/**
 * La saisie d'un relevé Horizon.
 *
 * Tout en texte, parce que c'est le plus rapide à remplir depuis le tri des
 * relevés bancaires : une ligne par poste, « Libellé ; montant ». La vie prend
 * un troisième morceau, le budget. Les montants sont en euros.
 */
export function ReleveForm({
  initial,
  releveId,
}: {
  initial: SaisieReleve;
  releveId: string | null;
}) {
  const router = useRouter();
  const [saisie, setSaisie] = useState(initial);
  const [erreur, setErreur] = useState<{ message: string; champ?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const champ = (nom: keyof SaisieReleve) => ({
    id: nom,
    name: nom,
    value: String(saisie[nom]),
    "aria-invalid": erreur?.champ === nom || undefined,
    onChange: (evenement: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setSaisie((avant) => ({ ...avant, [nom]: evenement.target.value })),
  });

  function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    startTransition(async () => {
      const resultat = await enregistrerReleve(saisie);
      if (!resultat.ok) {
        setErreur({ message: resultat.error, champ: resultat.field });
        toast.error(resultat.error);
        return;
      }
      toast.success(saisie.publie ? "Relevé publié" : "Brouillon enregistré");
      router.replace(`?mois=${resultat.data.mois}`);
      router.refresh();
    });
  }

  function supprimer() {
    if (!releveId) return;
    startTransition(async () => {
      const resultat = await supprimerReleve(saisie.organizationId, releveId);
      if (!resultat.ok) {
        toast.error(resultat.error);
        return;
      }
      toast.success("Relevé supprimé");
      router.replace("?");
      router.refresh();
    });
  }

  return (
    <form onSubmit={soumettre} className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div className="space-y-2">
          <Label htmlFor="mois">Mois</Label>
          <Input type="month" {...champ("mois")} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="resume">Le mois en une ou deux phrases</Label>
          <Textarea rows={2} {...champ("resume")} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Zone
          titre="Ce qui est entré"
          aide="Une ligne par source : « Virements de clientes ; 6900 »."
          {...champ("entrees")}
        />
        <Zone
          titre="Ce que l'entreprise a coûté"
          aide="Une ligne par charge : « Laetitia ; 1650 »."
          {...champ("charges")}
        />
        <Zone
          titre="Sa vie ce mois-ci"
          aide="« Poste ; dépensé ; budget » : « Courses ; 700 ; 650 »."
          {...champ("vie")}
        />
        <Zone
          titre="Ce qui va arriver"
          aide="Les mensualités à venir : « Octobre ; 4100 »."
          {...champ("aVenir")}
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="font-display text-base font-semibold">Le circuit et les poches</legend>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Montant libelle="Part pour les impôts (%)" {...champ("tauxImpots")} />
          <Montant libelle="Salaire versé (€)" {...champ("salaire")} />
          <Montant libelle="Poche Impôts (€)" {...champ("impots")} />
          <Montant libelle="Poche Bloqué (€)" {...champ("bloque")} />
          <Montant libelle="Fonds de roulement (€)" {...champ("fondsRoulement")} />
          <Montant libelle="Réserve (€)" {...champ("reserve")} />
          <Montant libelle="Première étape de la réserve (€)" {...champ("palierReserve")} />
          <Montant libelle="Objectif de la réserve (€)" {...champ("objectifReserve")} />
        </div>
      </fieldset>

      <div className="grid gap-6 lg:grid-cols-2">
        <Zone
          titre="L'écart du mois"
          aide="Un écart par ligne, trois au plus."
          lignes={3}
          {...champ("ecarts")}
        />
        <div className="space-y-2">
          <Label htmlFor="notionTitre">La notion du mois</Label>
          <Input placeholder="Titre" {...champ("notionTitre")} />
          <Textarea rows={4} placeholder="L'explication, en mots simples" {...champ("notionTexte")} />
        </div>
      </div>

      {erreur ? (
        <p role="alert" className="text-danger text-sm">
          {erreur.message}
        </p>
      ) : null}

      <div className="border-line flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <div className="flex items-center gap-3">
          <Switch
            id="publie"
            checked={saisie.publie}
            onCheckedChange={(publie) => setSaisie((avant) => ({ ...avant, publie }))}
          />
          <Label htmlFor="publie">
            {saisie.publie ? "Publié : le client le voit" : "Brouillon : le client ne le voit pas"}
          </Label>
        </div>

        <div className="flex gap-2">
          {releveId ? (
            <Button type="button" variant="ghost" onClick={supprimer} disabled={pending}>
              <Trash2 aria-hidden="true" />
              Supprimer
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>
    </form>
  );
}

type Controle = {
  id: string;
  name: string;
  value: string;
  "aria-invalid"?: boolean;
  onChange: (evenement: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

function Zone({ titre, aide, lignes = 7, ...controle }: Controle & { titre: string; aide: string; lignes?: number }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={controle.id}>{titre}</Label>
      <Textarea rows={lignes} className="font-mono text-sm" {...controle} />
      <p className="text-muted-foreground text-xs">{aide}</p>
    </div>
  );
}

function Montant({ libelle, ...controle }: Controle & { libelle: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={controle.id}>{libelle}</Label>
      <Input inputMode="decimal" {...controle} />
    </div>
  );
}
