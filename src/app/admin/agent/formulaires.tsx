"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { creerReglages, nouvelleSimulation, reglerResume, testerResume } from "./actions";

const selectClasses =
  "border-line bg-background h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ember";

function Erreur({ message }: { message?: string }) {
  return message ? <p className="text-destructive mt-2 text-xs">{message}</p> : null;
}

export function FormulaireReglages({
  organisations,
  profils,
}: {
  organisations: { id: string; nom: string }[];
  profils: string[];
}) {
  const [etat, action, enCours] = useActionState(creerReglages, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-40 flex-1">
        <Label htmlFor="organization_id" className="mb-1 text-xs">
          Client
        </Label>
        <select id="organization_id" name="organization_id" className={selectClasses} required>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nom}
            </option>
          ))}
        </select>
      </div>
      <div className="w-32">
        <Label htmlFor="profil" className="mb-1 text-xs">
          Profil
        </Label>
        <select id="profil" name="profil" className={selectClasses}>
          {profils.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outline" disabled={enCours}>
        Régler l&apos;agent
      </Button>
      <Erreur message={etat && !etat.ok ? etat.error : undefined} />
    </form>
  );
}

type Client = {
  id: string;
  nom: string;
  formulaire: { question: string; exemple: string; choix?: string[] }[];
};

/** Dans huit jours à 14h, heure de Paris : assez loin pour faire tourner tout le rythme. */
function rdvParDefaut(): string {
  const jour = new Date(Date.now() + 8 * 86_400_000);
  const iso = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(jour);
  return `${iso}T14:00`;
}

export function FormulaireSimulation({ clients }: { clients: Client[] }) {
  const [etat, action, enCours] = useActionState(nouvelleSimulation, null);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const client = clients.find((c) => c.id === clientId) ?? clients[0];

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="sim-client" className="mb-1 text-xs">
            Client
          </Label>
          <select
            id="sim-client"
            name="organization_id"
            className={selectClasses}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sim-prenom" className="mb-1 text-xs">
            Prénom de la cliente
          </Label>
          <Input id="sim-prenom" name="prenom" defaultValue="Camille" required />
        </div>
        <div>
          <Label htmlFor="sim-rdv" className="mb-1 text-xs">
            Rendez-vous (heure de Paris)
          </Label>
          <Input id="sim-rdv" name="rdv" type="datetime-local" defaultValue={rdvParDefaut()} required />
        </div>
      </div>

      <details className="border-line rounded-md border px-3 py-2">
        <summary className="text-muted-foreground cursor-pointer text-sm">
          Ses réponses au formulaire de réservation
        </summary>
        <div className="mt-3 space-y-3" key={client?.id}>
          {client?.formulaire.map((q, i) => (
            <div key={q.question}>
              <Label htmlFor={`sim-q${i}`} className="mb-1 text-xs">
                {q.question}
              </Label>
              {q.choix ? (
                <select id={`sim-q${i}`} name="reponse" defaultValue={q.exemple} className={selectClasses}>
                  {q.choix.map((choix) => (
                    <option key={choix}>{choix}</option>
                  ))}
                </select>
              ) : (
                <Textarea id={`sim-q${i}`} name="reponse" defaultValue={q.exemple} rows={2} />
              )}
            </div>
          ))}
        </div>
      </details>

      <Button type="submit" disabled={enCours}>
        Réserver et recevoir le premier message
      </Button>
      <Erreur message={etat && !etat.ok ? etat.error : undefined} />
    </form>
  );
}

/**
 * Le mail du matin d'un client : qui le reçoit, s'il part, et un envoi de
 * test chez Louis seul pour un jour choisi (simulations comprises).
 */
export function FormulaireResume({
  organisationId,
  actif,
  destinataires,
  aujourdhui,
}: {
  organisationId: string;
  actif: boolean;
  destinataires: string[];
  aujourdhui: string;
}) {
  const [etat, action, enCours] = useActionState(reglerResume, null);
  const [etatTest, actionTest, testEnCours] = useActionState(testerResume, null);
  return (
    <div className="border-line mt-2 space-y-3 rounded-md border p-3">
      <form action={action} className="space-y-2">
        <input type="hidden" name="organization_id" value={organisationId} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="resume_actif" defaultChecked={actif} className="accent-ember" />
          Mail du matin (8h) : les diagnostics du jour
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Label htmlFor={`dest-${organisationId}`} className="mb-1 text-xs">
              Destinataires (séparés par une virgule)
            </Label>
            <Input
              id={`dest-${organisationId}`}
              name="resume_destinataires"
              defaultValue={destinataires.join(", ")}
            />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={enCours}>
            Enregistrer
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Ne part que si l&apos;agent suit les vraies réservations de ce client.
        </p>
        <Erreur message={etat && !etat.ok ? etat.error : undefined} />
        {etat?.ok ? <p className="mt-2 text-xs text-emerald-400">Enregistré.</p> : null}
      </form>

      <form action={actionTest} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="organization_id" value={organisationId} />
        <div>
          <Label htmlFor={`jour-${organisationId}`} className="mb-1 text-xs">
            M&apos;envoyer celui du
          </Label>
          <Input id={`jour-${organisationId}`} name="jour" type="date" defaultValue={aujourdhui} />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={testEnCours}>
          Envoyer le test
        </Button>
        <Erreur message={etatTest && !etatTest.ok ? etatTest.error : undefined} />
        {etatTest?.ok ? <p className="mt-2 text-xs text-emerald-400">Parti vers ta boîte.</p> : null}
      </form>
    </div>
  );
}
