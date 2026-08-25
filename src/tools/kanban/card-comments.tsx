"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tempsRelatif } from "@/lib/dates";

import { phraseActivite } from "./card-activity";
import type { Activite, Commentaire } from "./card-mutations";
import { initiales } from "./initials";
import type { BoardLabel, BoardMember } from "./types";

function Pastille({ nom }: { nom: string }) {
  return (
    <span
      aria-hidden="true"
      className="bg-surface-2 border-line flex size-7 shrink-0 items-center justify-center rounded-full border text-[0.6rem] font-medium"
    >
      {initiales(nom)}
    </span>
  );
}

function CommentaireItem({
  commentaire,
  auteur,
  estAuteur,
  onUpdate,
  onDelete,
}: {
  commentaire: Commentaire;
  auteur: string;
  estAuteur: boolean;
  onUpdate: (body: string) => void;
  onDelete: () => void;
}) {
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState(commentaire.body);

  const ouvrir = () => {
    setTexte(commentaire.body);
    setEdition(true);
  };

  const valider = () => {
    const propre = texte.trim();
    setEdition(false);
    if (propre && propre !== commentaire.body) onUpdate(propre);
  };

  return (
    <li className="flex gap-2.5">
      <Pastille nom={auteur} />

      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{auteur}</span>
          <span className="text-muted-foreground font-mono text-xs">
            {tempsRelatif(commentaire.createdAt)}
            {commentaire.updatedAt !== commentaire.createdAt ? " · modifié" : ""}
          </span>
        </p>

        {edition ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={texte}
              onChange={(event) => setTexte(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  valider();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setEdition(false);
                }
              }}
              maxLength={5000}
              aria-label="Modifier le commentaire"
              className="min-h-16"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={valider}>
                Enregistrer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdition(false)}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {commentaire.body}
            </p>
            {estAuteur ? (
              <div className="flex gap-1">
                <Button variant="ghost" size="xs" onClick={ouvrir}>
                  Modifier
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive"
                  onClick={onDelete}
                >
                  Supprimer
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export function CardComments({
  comments,
  activities,
  labels,
  members,
  userId,
  onCreate,
  onUpdate,
  onDelete,
}: {
  comments: Commentaire[];
  activities: Activite[];
  labels: BoardLabel[];
  members: BoardMember[];
  userId: string;
  onCreate: (body: string) => Promise<boolean>;
  onUpdate: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
}) {
  const [brouillon, setBrouillon] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const nomDe = (id: string | null) =>
    members.find((m) => m.id === id)?.name ?? "Quelqu'un";

  const publier = async () => {
    const propre = brouillon.trim();
    if (!propre || envoi) return;
    setEnvoi(true);
    const publie = await onCreate(propre);
    setEnvoi(false);
    if (publie) setBrouillon("");
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold">Commentaires</h3>

        <div className="flex gap-2.5">
          <Pastille nom={nomDe(userId)} />
          <div className="min-w-0 flex-1 space-y-2">
            <Textarea
              value={brouillon}
              onChange={(event) => setBrouillon(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void publier();
                }
              }}
              placeholder="Écrire un commentaire"
              maxLength={5000}
              aria-label="Écrire un commentaire"
              className="min-h-16"
            />
            {brouillon.trim() ? (
              <Button size="sm" onClick={() => void publier()} disabled={envoi}>
                {envoi ? "Envoi…" : "Commenter"}
              </Button>
            ) : null}
          </div>
        </div>

        {comments.length > 0 ? (
          <ul className="space-y-4 pt-1">
            {comments.map((commentaire) => (
              <CommentaireItem
                key={commentaire.id}
                commentaire={commentaire}
                auteur={nomDe(commentaire.userId)}
                estAuteur={commentaire.userId === userId}
                onUpdate={(body) => onUpdate(commentaire.id, body)}
                onDelete={() => onDelete(commentaire.id)}
              />
            ))}
          </ul>
        ) : null}
      </section>

      {activities.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold">Activité</h3>
          <ul className="space-y-1.5">
            {activities.map((activite) => (
              <li
                key={activite.id}
                className="text-muted-foreground flex flex-wrap items-baseline gap-x-1.5 text-xs"
              >
                <span className="text-foreground">{nomDe(activite.userId)}</span>
                <span>{phraseActivite(activite, labels, members)}</span>
                <span className="font-mono">
                  · {tempsRelatif(activite.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
