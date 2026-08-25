import type { Metadata } from "next";
import Link from "next/link";

import { LegalSection, LegalShell } from "@/components/app/legal-shell";

export const metadata: Metadata = {
  title: "Mentions légales — Comète Studio",
};

export default function MentionsLegalesPage() {
  return (
    <LegalShell title="Mentions légales" updatedAt="août 2026">
      <LegalSection title="Éditeur">
        <p>
          Ce site est édité par Louis Girault, fondateur de Comète Studio.
          <br />
          Statut juridique : micro-entreprise (Louis Girault en nom propre).
          <br />
          Siège social : 4 rue Léon Fabre, 69100 Villeurbanne, France.
          <br />
          SIRET : 944 952 688 00017.
          <br />
          TVA : non applicable, article 293 B du CGI.
          <br />
          Directeur de la publication : Louis Girault.
        </p>
        <p>
          Contact, et interlocuteur unique pour exercer tes droits RGPD :{" "}
          <a
            href="mailto:louis@cometestudio.fr"
            className="text-foreground underline underline-offset-4"
          >
            louis@cometestudio.fr
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Ce qu'est ce site">
        <p>
          <span className="font-mono text-xs">cometestudio.fr</span> est
          l&apos;espace client de Comète Studio : un accès privé, réservé aux
          personnes que Louis y a invitées, depuis lequel chaque client retrouve
          les outils qui lui sont ouverts. Il n&apos;est ni public, ni
          référençable.
        </p>
        <p>
          La présentation publique de l&apos;activité se trouve sur{" "}
          <span className="font-mono text-xs">louisgirault.fr</span>, qui a ses
          propres mentions légales.
        </p>
      </LegalSection>

      <LegalSection title="Hébergement">
        <p>
          <strong className="text-foreground font-medium">
            Application :
          </strong>{" "}
          Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis —{" "}
          <span className="font-mono text-xs">vercel.com</span>.
        </p>
        <p>
          <strong className="text-foreground font-medium">
            Base de données, comptes et fichiers :
          </strong>{" "}
          Supabase, hébergement dans l&apos;Union européenne, région{" "}
          <span className="font-mono text-xs">eu-west-1</span> (Irlande) —{" "}
          <span className="font-mono text-xs">supabase.com</span>. C&apos;est là
          que vivent les comptes, les organisations et les contenus créés dans
          les outils.
        </p>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          L&apos;ensemble du contenu de ce site (textes, visuels, code, charte
          graphique, dénominations Comète Studio, Orbite, Écho, Vigie, Foyer)
          est la propriété exclusive de Louis Girault, sauf mention contraire.
          Toute reproduction, représentation ou diffusion sans autorisation
          préalable est interdite.
        </p>
        <p>
          Les contenus que tu déposes dans les outils de ton espace restent les
          tiens.
        </p>
      </LegalSection>

      <LegalSection title="Données personnelles">
        <p>
          Cet espace traite des données personnelles : identité, adresse email,
          et ce que tu crées dans les outils. Le détail (finalités, durées,
          sous-traitants, droits) est dans la{" "}
          <Link
            href="/confidentialite"
            className="text-foreground underline underline-offset-4"
          >
            politique de confidentialité
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Périmètre">
        <p>
          Les présentes mentions couvrent exclusivement l&apos;espace client{" "}
          <span className="font-mono text-xs">cometestudio.fr</span>.
        </p>
        <p>
          Les applications livrées aux clientes de Comète Studio dans le cadre
          des partenariats — notamment l&apos;app Foyer, qui traite des données
          de santé relevant de l&apos;article 9 du RGPD — font l&apos;objet
          d&apos;une politique de confidentialité distincte, en cours de
          production avec un cabinet juridique spécialisé RGPD / santé. Elle sera
          publiée avant toute mise en production chez une cliente externe.
        </p>
      </LegalSection>

      <LegalSection title="Droit applicable">
        <p>
          Le présent site et ses mentions sont soumis au droit français. En cas
          de litige, les tribunaux français sont seuls compétents.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
