"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createExternalTool,
  setToolActive,
  updateTool,
} from "@/app/admin/outils/actions";
import { FieldError, hasFieldError } from "@/components/app/field-error";
import type { ActionResult } from "@/lib/actions";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { slugify } from "@/lib/slug";

export function ToolActiveSwitch({
  toolId,
  toolName,
  defaultActive,
}: {
  toolId: string;
  toolName: string;
  defaultActive: boolean;
}) {
  const [active, setActive] = useState(defaultActive);
  const [pending, startTransition] = useTransition();

  const change = (next: boolean) => {
    setActive(next);
    startTransition(async () => {
      const result = await setToolActive({ toolId, isActive: next });
      if (!result.ok) {
        setActive(!next);
        toast.error(result.error);
        return;
      }
      toast.success(
        next
          ? `${toolName} est de nouveau au catalogue`
          : `${toolName} retiré de tous les espaces`,
      );
    });
  };

  return (
    <Switch
      checked={active}
      onCheckedChange={change}
      disabled={pending}
      aria-label={`Garder ${toolName} au catalogue`}
    />
  );
}

export function EditToolDialog({
  toolId,
  name,
  description,
}: {
  toolId: string;
  name: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Les effets de bord (toast, fermeture, rafraîchissement) vivent dans cette
  // enveloppe côté client : les faire depuis un effet déclenche des rendus en
  // cascade, et React 19 le refuse.
  const [state, formAction, pending] = useActionState(
    async (previous: ActionResult | null, formData: FormData) => {
      const result = await updateTool(previous, formData);
      if (result.ok) {
        toast.success("Outil mis à jour");
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil aria-hidden="true" />
          <span className="sr-only">Modifier {name}</span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier {name}</DialogTitle>
          <DialogDescription>
            Le nom et la description sont ceux que voient les clients.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-5">
          <input type="hidden" name="toolId" value={toolId} />

          <div className="space-y-2">
            <Label htmlFor={`name-${toolId}`}>Nom</Label>
            <Input
              id={`name-${toolId}`}
              name="name"
              required
              defaultValue={name}
              aria-invalid={hasFieldError(state, "name")}
            />
            <FieldError state={state} field="name" />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`description-${toolId}`}>Description</Label>
            <Textarea
              id={`description-${toolId}`}
              name="description"
              rows={2}
              defaultValue={description}
              aria-invalid={hasFieldError(state, "description")}
            />
            <FieldError state={state} field="description" />
          </div>

          <FieldError state={state} />

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewExternalToolDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const router = useRouter();
  // Les effets de bord (toast, fermeture, rafraîchissement) vivent dans cette
  // enveloppe côté client : les faire depuis un effet déclenche des rendus en
  // cascade, et React 19 le refuse.
  const [state, formAction, pending] = useActionState(
    async (previous: ActionResult | null, formData: FormData) => {
      const result = await createExternalTool(previous, formData);
      if (result.ok) {
        toast.success("Outil externe ajouté");
        setOpen(false);
        setName("");
        setSlug("");
        setSlugTouched(false);
        router.refresh();
      }
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          Outil externe
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel outil externe</DialogTitle>
          <DialogDescription>
            Une tuile qui ouvre un service tiers dans un nouvel onglet. Les
            outils internes, eux, viennent du code.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="tool-name">Nom</Label>
            <Input
              id="tool-name"
              name="name"
              required
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
              aria-invalid={hasFieldError(state, "name")}
            />
            <FieldError state={state} field="name" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-slug">Identifiant</Label>
            <Input
              id="tool-slug"
              name="slug"
              required
              className="font-mono"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(slugify(event.target.value));
              }}
              aria-invalid={hasFieldError(state, "slug")}
            />
            <FieldError state={state} field="slug" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-href">Adresse</Label>
            <Input
              id="tool-href"
              name="href"
              type="url"
              required
              placeholder="https://exemple.fr"
              aria-invalid={hasFieldError(state, "href")}
            />
            <p className="text-muted-foreground text-xs">
              Obligatoire : sans adresse, la tuile ne mènerait nulle part.
            </p>
            <FieldError state={state} field="href" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-description">Description</Label>
            <Textarea
              id="tool-description"
              name="description"
              rows={2}
              aria-invalid={hasFieldError(state, "description")}
            />
            <FieldError state={state} field="description" />
          </div>

          <FieldError state={state} />

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Création…" : "Ajouter l'outil"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
