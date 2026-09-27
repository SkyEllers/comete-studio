import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lien plus valable",
  robots: { index: false, follow: false },
};

export default function AccordInvalidePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-10 text-[15px] leading-relaxed">
      <h1 className="text-xl font-semibold">Ce lien n&apos;est plus valable</h1>
      <p className="text-muted-foreground">
        Le rendez-vous est peut-être passé, ou le lien a été mal copié. Rien n&apos;a changé pour ton rendez-vous.
      </p>
    </main>
  );
}
