"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { retirerReponseFixe, traiterQuestion } from "../actions";

function Erreur({ message }: { message?: string }) {
  return message ? <p className="text-destructive mt-2 text-xs">{message}</p> : null;
}

/**
 * Trancher une question : corriger le brouillon de l'agent et l'envoyer, ou
 * classer sans rien envoyer. La détresse, elle, se classe seulement : le
 * 3114 est déjà parti.
 */
export function Traiter({
  id,
  genre,
  brouillon,
  question,
  peutEnvoyer,
}: {
  id: string;
  genre: "incertain" | "detresse";
  brouillon: string | null;
  question: string;
  peutEnvoyer: boolean;
}) {
  const [etat, action, enCours] = useActionState(traiterQuestion, null);

  if (genre === "detresse") {
    return (
      <form action={action} className="mt-3">
        <input type="hidden" name="id" value={id} />
        <Button type="submit" name="choix" value="classer" variant="outline" size="sm" disabled={enCours}>
          Vu, classer
        </Button>
        <Erreur message={etat && !etat.ok ? etat.error : undefined} />
      </form>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="id" value={id} />
      <div>
        <Label htmlFor={`texte-${id}`} className="mb-1 text-xs">
          Ce qu&apos;elle recevra {brouillon ? "(le brouillon de l'agent, à corriger)" : ""}
        </Label>
        <Textarea id={`texte-${id}`} name="texte" defaultValue={brouillon ?? ""} rows={4} />
      </div>
      <details className="text-sm" open={brouillon !== null}>
        <summary className="cursor-pointer">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="garder" defaultChecked={brouillon !== null} className="accent-ember" />
            Garder comme réponse fixe pour la fois suivante
          </label>
        </summary>
        <div className="mt-2">
          <Label htmlFor={`question-${id}`} className="mb-1 text-xs">
            La question type (son prénom sera retiré)
          </Label>
          <Input id={`question-${id}`} name="question_type" defaultValue={question} />
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="choix" value="envoyer" size="sm" disabled={enCours || !peutEnvoyer}>
          Envoyer
        </Button>
        <Button type="submit" name="choix" value="classer" variant="outline" size="sm" disabled={enCours}>
          Classer sans répondre
        </Button>
      </div>
      <Erreur message={etat && !etat.ok ? etat.error : undefined} />
    </form>
  );
}

export function Retirer({ id }: { id: string }) {
  const [etat, action, enCours] = useActionState(retirerReponseFixe, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={enCours}>
        Retirer
      </Button>
      <Erreur message={etat && !etat.ok ? etat.error : undefined} />
    </form>
  );
}
