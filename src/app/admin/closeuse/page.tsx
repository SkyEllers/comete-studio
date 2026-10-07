import { Check, X } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { devisDuProfilTest, EMAIL_TEST, ESPACE_TEST, etatProfilTest } from "@/tools/closeuse/profil-test";
import { euros } from "@/tools/devis/regles";

import { BoutonCliente, BoutonDemos, BoutonPreparer } from "./boutons";

/**
 * Closeuse — le profil de test de Louis (06/10/2026).
 *
 * Un vrai compte closeuse dans l'espace d'essai, pour voir et cliquer tout ce
 * que voient les closeuses, sans toucher aux rendez-vous de Peggy. La page
 * prépare le compte, remet les rendez-vous démo à neuf, et dit comment y
 * entrer (une fenêtre privée : le compte admin ne peut pas être closeuse).
 */

export const metadata = { title: "Closeuse — Comète Studio" };

const DEMOS = [
  ["Céline", "À venir, demain : ses réponses, « Assistante : confirmé »"],
  ["Nadia", "À venir, dans trois jours : « Assistante : pas encore confirmé »"],
  ["Sophie", "À noter (l'appel vient de finir) : l'enregistrement, puis le résultat"],
  ["Martine", "À recontacter aujourd'hui : « Pas de vente · le conjoint », son téléphone, « C'est fait »"],
  ["Sandrine", "Déjà faits : vendu, 1 520 € en 6 fois, et dans « Mes ventes » ta commission"],
  ["Claire", "Déjà faits : pas venue"],
  ["Julie", "Déjà faits : annulé"],
] as const;

function Ligne({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="fait" />
      ) : (
        <X className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-label="pas encore" />
      )}
      <span className={cn(!ok && "text-muted-foreground")}>{children}</span>
    </li>
  );
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="border-line bg-card mb-6 rounded-lg border p-5">
      <h2 className="mb-3 text-lg">{titre}</h2>
      {children}
    </section>
  );
}

export default async function CloseusePage() {
  await requireAdmin();
  const [etat, devis] = await Promise.all([etatProfilTest(), devisDuProfilTest()]);
  const pret = Boolean(etat.compte && etat.closeuse && etat.reservation);

  return (
    <>
      <PageHeader
        title="Closeuse"
        description="Ton profil de closeuse de test : tu vois et tu cliques exactement ce que voient les closeuses, sans toucher aux rendez-vous de Peggy."
      />

      <Bloc titre="Ton profil">
        <ul className="mb-4 space-y-1.5">
          <Ligne ok={Boolean(etat.compte)}>
            Le compte <span className="font-mono text-xs">{EMAIL_TEST}</span>
            {etat.compte?.nom ? ` (${etat.compte.nom})` : ""}
          </Ligne>
          <Ligne ok={etat.closeuse}>
            Closeuse dans l&apos;espace d&apos;essai « {etat.organisation?.nom ?? ESPACE_TEST} »
          </Ligne>
          <Ligne ok={Boolean(etat.reservation)}>
            Sa fiche de réservation, hors roulement (aucune réservation d&apos;essai ne tombe chez toi)
          </Ligne>
          <Ligne ok={Boolean(etat.reservation?.agenda)}>
            Son agenda Google relié (à faire toi-même, dans « Mon agenda »)
          </Ligne>
          <Ligne ok={etat.demos > 0}>{etat.demos} rendez-vous démo</Ligne>
        </ul>
        <BoutonPreparer libelle={pret ? "Revérifier le profil" : "Préparer mon profil closeuse"} />
      </Bloc>

      <Bloc titre="Les rendez-vous démo">
        <p className="text-muted-foreground mb-3 text-sm">
          Un dans chaque état de l&apos;espace. Note, dépose, change ce que tu veux : le bouton remet tout à neuf.
          Seuls les rendez-vous démo de ce profil sont effacés, jamais ceux de Peggy.
        </p>
        <ul className="mb-4 space-y-1 text-sm">
          {DEMOS.map(([prenom, quoi]) => (
            <li key={prenom}>
              <span className="font-medium">{prenom}</span> — {quoi}
            </li>
          ))}
        </ul>
        {pret ? (
          <BoutonDemos libelle={etat.demos ? "Remettre les rendez-vous démo à neuf" : "Créer les rendez-vous démo"} />
        ) : (
          <p className="text-muted-foreground text-sm">Prépare d&apos;abord le profil.</p>
        )}
      </Bloc>

      <Bloc titre="Entrer dans ton profil">
        <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm">
          <li>
            Ouvre une <span className="font-medium">fenêtre de navigation privée</span> (Ctrl + Maj + N) : ton compte
            admin reste ouvert dans l&apos;autre.
          </li>
          <li>
            Va sur <span className="font-mono text-xs">app.cometestudio.fr</span> et connecte-toi avec{" "}
            <span className="font-mono text-xs">{EMAIL_TEST}</span>.
          </li>
          <li>
            {etat.jamaisConnecte ? "Première fois" : "Mot de passe oublié"} : « Mot de passe oublié ? », le lien arrive
            dans ta boîte Gmail (l&apos;adresse en « +closeuse » y arrive aussi).
          </li>
          <li>Tu arrives directement dans l&apos;espace closeuse, comme elles. « Mon agenda » est en haut à droite.</li>
        </ol>
        {etat.compte && etat.closeuse ? (
          <p className="text-sm">
            Ou, sans quitter ton compte :{" "}
            <Link
              href={`/app/${ESPACE_TEST}/closeuse?c=${etat.compte.id}`}
              className="text-primary underline underline-offset-4"
            >
              voir son espace comme elle
            </Link>{" "}
            <span className="text-muted-foreground">(lecture ; « Mon agenda » t&apos;y ouvre le tien).</span>
          </p>
        ) : null}
      </Bloc>

      <Bloc titre="Le devis, côté cliente (simulation)">
        <p className="text-muted-foreground mb-3 text-sm">
          Dans ton profil, « Envoyer le devis » marche comme chez Peggy, mais rien ne part : pas de mail, pas de
          Stripe. Ici, tu joues la cliente, et tu regardes ce que la closeuse voit changer dans le bloc « Le devis ». La vente n&apos;apparaît chez elle qu&apos;au paiement.
          Les devis s&apos;effacent avec les rendez-vous démo.
        </p>
        {devis.length ? (
          <ul className="space-y-2">
            {devis.map((d) => (
              <li key={d.id} className="border-line flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                <span className="font-medium">{d.prenom}</span>
                <span className="text-muted-foreground">
                  {euros(d.totalCents)}, {d.investigationSeule ? "investigation seule" : `${d.dureeMois} mois`} ·{" "}
                  {d.statut === "signe" ? (d.paye ? "signé et payé" : "signé, paiement en attente") : d.statut === "envoye" ? (d.ouvert ? "ouvert" : "envoyé") : d.statut}
                </span>
                <span className="ml-auto flex gap-2">
                  {d.statut === "envoye" && !d.ouvert ? <BoutonCliente devisId={d.id} geste="ouvrir" libelle="Elle l'ouvre" /> : null}
                  {d.statut === "envoye" ? <BoutonCliente devisId={d.id} geste="signer" libelle="Elle signe" /> : null}
                  {d.statut === "signe" && !d.paye ? <BoutonCliente devisId={d.id} geste="payer" libelle="Elle paie" /> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Aucun devis pour l&apos;instant : envoie-en un depuis ton profil (Sophie, « Noter le résultat »).
          </p>
        )}
      </Bloc>
    </>
  );
}
