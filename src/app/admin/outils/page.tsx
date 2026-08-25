import { TriangleAlert } from "lucide-react";
import { Suspense } from "react";

import {
  EditToolDialog,
  NewExternalToolDialog,
  ToolActiveSwitch,
} from "@/app/admin/outils/tools-admin";
import { PageHeader } from "@/components/app/page-header";
import { TableSkeleton } from "@/components/app/skeletons";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { getToolMeta } from "@/tools/registry";

/** Sous la garde du layout : peut passer en flux sans risque pour le statut. */
async function ToolsTable() {
  const supabase = await createClient();
  const { data: tools } = await supabase
    .from("tools")
    .select("id, slug, name, description, kind, href, is_active, sort_order")
    .order("sort_order")
    .order("name");

  return (
    <div className="border-line overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Outil</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Ordre</TableHead>
            <TableHead className="text-center">Au catalogue</TableHead>
            <TableHead className="text-right">Modifier</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tools ?? []).map((tool) => {
            const missingFromRegistry =
              tool.kind === "internal" && !getToolMeta(tool.slug);

            return (
              <TableRow key={tool.id}>
                <TableCell>
                  <p className="font-medium">
                    {tool.name}
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {tool.slug}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {tool.description}
                  </p>
                  {tool.kind === "external" && tool.href ? (
                    <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                      {tool.href}
                    </p>
                  ) : null}
                  {missingFromRegistry ? (
                    <p className="text-warning mt-1 flex items-center gap-1.5 text-xs">
                      <TriangleAlert
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                      />
                      Aucune page ne correspond à cet identifiant dans le code :
                      cet outil restera invisible côté client, même activé.
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={tool.kind === "external" ? "outline" : "secondary"}
                  >
                    {tool.kind === "external" ? "externe" : "interne"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {tool.sort_order}
                </TableCell>
                <TableCell className="text-center">
                  <ToolActiveSwitch
                    toolId={tool.id}
                    toolName={tool.name}
                    defaultActive={tool.is_active}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <EditToolDialog
                    toolId={tool.id}
                    name={tool.name}
                    description={tool.description}
                    sortOrder={tool.sort_order}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminOutilsPage() {
  return (
    <>
      <PageHeader
        title="Outils"
        description="Le catalogue. Ce qui est ici peut être activé chez un client ; ce qui n'y est plus disparaît de tous les espaces."
        action={<NewExternalToolDialog />}
      />

      <Suspense fallback={<TableSkeleton />}>
        <ToolsTable />
      </Suspense>
    </>
  );
}
