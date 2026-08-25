"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { createOrganization } from "@/app/admin/clients/actions";
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
import { slugify } from "@/lib/slug";

export function NewClientDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Tant que Louis n'a pas touché au slug, il suit le nom.
  const [slugTouched, setSlugTouched] = useState(false);
  const router = useRouter();
  // Les effets de bord (toast, fermeture, navigation) vivent dans cette
  // enveloppe côté client : les faire depuis un effet déclenche des rendus en
  // cascade, et React 19 le refuse.
  const [state, formAction, pending] = useActionState(
    async (
      previous: ActionResult<{ id: string }> | null,
      formData: FormData,
    ) => {
      const result = await createOrganization(previous, formData);
      if (result.ok) {
        toast.success("Client créé");
        setOpen(false);
        setName("");
        setSlug("");
        setSlugTouched(false);
        router.push(`/admin/clients/${result.data.id}`);
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
          Nouveau client
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau client</DialogTitle>
          <DialogDescription>
            L&apos;identifiant se retrouve dans l&apos;adresse de son espace. Il
            ne pourra plus changer ensuite.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Nom du client</Label>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
              aria-invalid={hasFieldError(state, "name")}
              aria-describedby="name-error"
            />
            <FieldError state={state} field="name" id="name-error" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Identifiant</Label>
            <Input
              id="slug"
              name="slug"
              required
              className="font-mono"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(slugify(event.target.value));
              }}
              aria-invalid={hasFieldError(state, "slug")}
              aria-describedby="slug-error"
            />
            <p className="text-muted-foreground text-xs">
              Son espace sera à l&apos;adresse{" "}
              <span className="font-mono">/app/{slug || "…"}</span>
            </p>
            <FieldError state={state} field="slug" id="slug-error" />
          </div>

          <FieldError state={state} id="form-error" />

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Création…" : "Créer le client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
