"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Rendu markdown des descriptions de cartes.
 *
 * Sans `rehype-raw` : react-markdown ignore le HTML brut par défaut, et c'est
 * exactement ce qu'on veut (CLAUDE.md — markdown seulement, jamais de HTML).
 * Les liens s'ouvrent dans un nouvel onglet, sans céder le référent.
 */
const composants: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
};

export function MarkdownText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed break-words",
        "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5 [&_li>ul]:my-0.5 [&_li>ol]:my-0.5",
        "[&_h1]:font-display [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:font-display [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:font-display [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium",
        "[&_code]:bg-surface-2 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
        "[&_pre]:bg-surface-2 [&_pre]:border-line [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:border-line [&_blockquote]:text-muted-foreground [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
        "[&_hr]:border-line [&_hr]:my-3",
        "[&_table]:my-2 [&_table]:w-full [&_table]:text-left",
        "[&_th]:border-line [&_th]:border-b [&_th]:py-1 [&_th]:pr-3 [&_th]:font-medium",
        "[&_td]:border-line [&_td]:border-b [&_td]:py-1 [&_td]:pr-3",
        "[&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:align-middle",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={composants}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
