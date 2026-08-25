import type { Metadata } from "next";
import Link from "next/link";

import { LegalSection, LegalShell } from "@/components/app/legal-shell";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Politique de confidentialité — Comète Studio",
};

/** Passage que Louis doit trancher ou faire valider avant la mise en ligne. */
function AValider({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <mark
      className={cn(
        "bg-warning/15 text-warning border-warning/30 rounded-sm border px-1.5 py-0.5",
        className,
      )}
    >
      [À VALIDER PAR LOUIS] {children}
    </mark>
  );
}

export default function ConfidentialitePage() {
  return (
    <LegalShell title="Politique de confidentialité" updatedAt="août 2026">
      <LegalSection title="Responsable du traitement">
        <p>
          Louis Girault, micro-entreprise, 4 rue Léon Fabre, 69100 Villeurbanne,
          France. SIRET 944 952 688 00017.
        </p>
        <p>
          Pour toute question sur tes données, ou pour exercer tes droits :{" "}
          <a
            href="mailto:louis@cometestudio.fr"
            className="text-foreground underline underline-offset-4"
          >
            louis@cometestudio.fr
          </a>
          . Louis est l&apos;interlocuteur unique.
        </p>
      </LegalSection>

      <LegalSection title="Périmètre">
        <p>
          Cette politique couvre l&apos;espace client{" "}
          <span className="font-mono text-xs">cometestudio.fr</span> : la
          connexion, ton compte, et les outils qui te sont ouverts.
        </p>
        <p>
          Elle ne couvre pas les applications livrées dans le cadre des
          partenariats, en particulier l&apos;app Foyer, qui traite des données
          de santé relevant de l&apos;article 9 du RGPD. Ces traitements auront
          leur propre politique, rédigée avec un cabinet spécialisé, publiée
          avant tout déploiement chez une cliente.
        </p>
      </LegalSection>

      <LegalSection title="Données traitées">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-foreground font-medium">
              Ton identité :
            </strong>{" "}
            prénom et nom, tels que tu les renseignes.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Ton adresse email :
            </strong>{" "}
            elle sert d&apos;identifiant de connexion et de canal pour
            l&apos;invitation et la réinitialisation du mot de passe.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Ton mot de passe :
            </strong>{" "}
            jamais stocké en clair. Il est haché par Supabase Auth, et personne —
            Louis compris — ne peut le lire.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Les contenus que tu crées dans les outils :
            </strong>{" "}
            textes, titres, commentaires, fichiers, et les dates associées.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Des données techniques :
            </strong>{" "}
            journaux serveur (adresse IP, horodatage, page appelée) et un cookie
            de session, strictement nécessaires au fonctionnement et à la
            sécurité.
          </li>
        </ul>
        <p>
          Il n&apos;y a ni traceur publicitaire, ni revente, ni profilage,
          ni décision automatisée.
        </p>
      </LegalSection>

      <LegalSection title="Finalités et base légale">
        <p>
          Toutes ces données sont traitées pour une seule raison : te donner
          accès à ton espace et faire fonctionner les outils convenus. La base
          légale est l&apos;<strong className="text-foreground font-medium">exécution
          du contrat</strong> qui nous lie (article 6.1.b du RGPD).
        </p>
        <p>
          Les journaux serveur reposent sur l&apos;intérêt légitime à maintenir
          le service en état de marche et à en assurer la sécurité (article
          6.1.f).
        </p>
      </LegalSection>

      <LegalSection title="Durée de conservation">
        <p>
          Ton compte et tes contenus sont conservés pendant toute la durée de la
          relation, puis <AValider>trois ans</AValider> après sa fin, avant
          suppression.
        </p>
        <p>
          Tu peux demander la suppression de ton compte à tout moment : elle est
          effectuée sous 30 jours, sous réserve des obligations légales de
          conservation (comptabilité, notamment).
        </p>
        <p>
          <AValider>
            Les journaux techniques sont conservés selon la politique de Vercel
            et de Supabase, de l&apos;ordre de 30 jours ; à confirmer auprès des
            deux prestataires avant publication.
          </AValider>
        </p>
      </LegalSection>

      <LegalSection title="Sous-traitants">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-foreground font-medium">
              Vercel Inc.
            </strong>{" "}
            (États-Unis) — hébergement de l&apos;application et journaux
            serveur.
          </li>
          <li>
            <strong className="text-foreground font-medium">Supabase</strong> —
            base de données, comptes et fichiers, hébergés en Irlande (Union
            européenne), région{" "}
            <span className="font-mono text-xs">eu-west-1</span>.
          </li>
          <li>
            <strong className="text-foreground font-medium">
              Un prestataire d&apos;envoi d&apos;emails
            </strong>{" "}
            — uniquement pour les emails d&apos;invitation et de
            réinitialisation de mot de passe.{" "}
            <AValider>
              Prestataire à arrêter (Resend ou Brevo) et à nommer ici, avec son
              pays d&apos;hébergement.
            </AValider>
          </li>
        </ul>
        <p>
          Chacun n&apos;accède qu&apos;à ce qui lui est nécessaire, et
          uniquement pour faire fonctionner le service.
        </p>
      </LegalSection>

      <LegalSection title="Transferts hors Union européenne">
        <p>
          Les données de ton espace (compte, contenus) sont hébergées dans
          l&apos;Union européenne.
        </p>
        <p>
          <AValider>
            Vercel, hébergeur de l&apos;application, est une société
            états-unienne : le traitement des journaux serveur peut impliquer un
            transfert hors UE, encadré par les clauses contractuelles types de
            la Commission européenne. Formulation à faire relire avant
            publication.
          </AValider>
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Cet espace ne dépose qu&apos;un cookie : celui qui maintient ta
          session ouverte. Il est strictement nécessaire au service, donc exempt
          de consentement. Pas de mesure d&apos;audience, pas de traceur tiers.
        </p>
      </LegalSection>

      <LegalSection title="Tes droits">
        <p>
          Tu disposes des droits d&apos;accès, de rectification,
          d&apos;effacement, de limitation, de portabilité et
          d&apos;opposition, prévus aux articles 15 à 22 du RGPD. Écris à{" "}
          <a
            href="mailto:louis@cometestudio.fr"
            className="text-foreground underline underline-offset-4"
          >
            louis@cometestudio.fr
          </a>{" "}
          : réponse sous un mois.
        </p>
        <p>
          Si la réponse ne te convient pas, tu peux saisir la CNIL —{" "}
          <span className="font-mono text-xs">cnil.fr</span>.
        </p>
      </LegalSection>

      <LegalSection title="Sécurité">
        <p>
          L&apos;accès à un espace est nominatif. Les règles de cloisonnement
          sont appliquées par la base de données elle-même, en plus de
          l&apos;application : un client ne peut pas lire les données d&apos;un
          autre, même en s&apos;adressant directement à l&apos;API. Les échanges
          sont chiffrés (HTTPS), et le site n&apos;est pas indexable.
        </p>
      </LegalSection>

      <LegalSection title="Modification">
        <p>
          Cette politique peut évoluer (nouveau sous-traitant, nouvelle
          finalité, nouvelle durée). La version en ligne fait foi ; en cas de
          changement important, tu en seras informé par email.
        </p>
        <p>
          Les mentions légales sont{" "}
          <Link
            href="/mentions-legales"
            className="text-foreground underline underline-offset-4"
          >
            sur cette page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
