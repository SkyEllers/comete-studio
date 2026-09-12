import { SelecteurMois } from "@/components/app/selecteur-mois";
import { requireMembership } from "@/lib/access";
import { ajouterJours, jourParis } from "@/lib/dates";
import {
  moisAOffrir,
  moisDemande,
  moisPrecedent,
  moisSuivant,
  nomDuMois,
} from "@/lib/mois";
import { ecart, ecartPourcentage, vueComete } from "@/tools/pulsar/comete";
import { formatDuree } from "@/tools/pulsar/duree";
import {
  getClients,
  getEntreesDuMois,
  getMoisConnus,
  getReglages,
} from "@/tools/pulsar/queries";
import { ExportPulsar, Reglages } from "@/tools/pulsar/reglages";
import { euros, tauxLisible } from "@/tools/pulsar/revenus";
import { libelleProfil } from "@/tools/pulsar/types";

/**
 * La vue Comète : le mois du studio, et non plus celui d'un client.
 *
 * Une seule question la commande — quelle part de mon temps se vend ? — et
 * chaque bloc y répond d'un angle : le partage facturable / non facturable, ce
 * que rapporte en moyenne une heure vendue, à quels profils va le temps, et ce
 * que coûte la recherche de travail.
 *
 * Sous chaque bloc, la comparaison avec le mois d'avant, en toutes lettres et
 * en petit. Un chiffre seul ne dit pas s'il est bon ; deux chiffres, si.
 */
export default async function CometePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/temps/comete">) {
  const { orgSlug } = await params;
  const { org } = await requireMembership(orgSlug);

  const mois = moisDemande((await searchParams).mois);
  const precedent = moisPrecedent(mois);
  const nomPrecedent = nomDuMois(precedent);

  const [clients, entrees, entreesAvant, reglages, moisConnus] = await Promise.all([
    getClients(org.id),
    getEntreesDuMois(org.id, mois),
    getEntreesDuMois(org.id, precedent),
    getReglages(org.id),
    getMoisConnus(org.id),
  ]);

  const vue = vueComete(clients, entrees, mois);
  const avant = vueComete(clients, entreesAvant, precedent);

  const total = vue.minutesFacturables + vue.minutesNonFacturables;

  /*
   * La période proposée à l'export : le mois affiché, jusqu'à son dernier jour
   * — ou jusqu'à aujourd'hui pour le mois en cours. Proposer une date à venir
   * inviterait à exporter du vide.
   */
  const aujourdhui = jourParis();
  const dernierJour = ajouterJours(moisSuivant(mois), -1);
  const jusquaParDefaut = dernierJour < aujourdhui ? dernierJour : aujourdhui;

  return (
    <div className="space-y-6">
      <SelecteurMois
        mois={mois}
        choix={moisAOffrir(moisConnus)}
        href={(valeur) => `/app/${orgSlug}/temps/comete?mois=${valeur}`}
      />

      {total === 0 ? (
        <div className="border-line bg-surface-1 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="font-display font-semibold">Rien de compté ce mois-ci</p>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Lance un chronomètre, et ce mois se remplira tout seul.
          </p>
        </div>
      ) : (
        <>
          <Bloc titre="Facturable et non facturable">
            <div className="grid gap-4 sm:grid-cols-2">
              <Chiffre
                label="Facturable"
                valeur={formatDuree(vue.minutesFacturables)}
                sous={ecart(
                  vue.minutesFacturables,
                  avant.minutesFacturables,
                  nomPrecedent,
                )}
              />
              <Chiffre
                label="Non facturable"
                valeur={`${formatDuree(vue.minutesNonFacturables)} · ${vue.partNonFacturable} %`}
                sous={ecartPourcentage(
                  vue.partNonFacturable,
                  avant.partNonFacturable,
                  nomPrecedent,
                )}
              />
            </div>

            <Barre part={vue.partNonFacturable} />
          </Bloc>

          <Bloc titre="Ce que rapporte une heure vendue">
            <div className="grid gap-4 sm:grid-cols-2">
              <Chiffre
                label="Taux horaire moyen"
                valeur={tauxLisible(vue.tauxMoyenCents)}
                sous={
                  avant.tauxMoyenCents === null
                    ? null
                    : `${tauxLisible(avant.tauxMoyenCents)} en ${nomPrecedent}`
                }
              />
              <Chiffre
                label="Encaissé du mois"
                valeur={euros(vue.encaisseCents)}
                sous={
                  avant.encaisseCents === 0
                    ? null
                    : `${euros(avant.encaisseCents)} en ${nomPrecedent}`
                }
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Encaissé du mois divisé par les seules heures facturables : le temps
              passé sur Comète ne dilue pas le taux, il se lit plus haut.
            </p>
          </Bloc>

          <Bloc titre="À qui va ton temps">
            <ul className="space-y-1">
              {vue.parProfil.map((part) => (
                <li key={part.profil ?? "sans"} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0">
                    {part.profil === null ? "Non renseigné" : libelleProfil(part.profil)}
                  </span>
                  <span className="bg-surface-2 h-2 flex-1 overflow-hidden rounded-full">
                    <span
                      className="bg-ember block h-full rounded-full"
                      style={{
                        width: `${
                          vue.minutesFacturables === 0
                            ? 0
                            : Math.round((part.minutes / vue.minutesFacturables) * 100)
                        }%`,
                      }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
                    {formatDuree(part.minutes)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              Sur les heures facturables. Les heures de Comète n&apos;ont pas de
              profil : elles ne servent personne d&apos;autre que le studio.
            </p>
          </Bloc>

          <Bloc titre="Chercher du travail">
            <Chiffre
              label="Prospection"
              valeur={formatDuree(vue.minutesProspection)}
              sous={ecart(vue.minutesProspection, avant.minutesProspection, nomPrecedent)}
            />
            <p className="text-muted-foreground text-xs">
              Tous clients confondus : une prospection pour un client existant
              compte ici comme celle qui part de zéro.
            </p>
          </Bloc>
        </>
      )}

      <Bloc titre="Réglages">
        <Reglages
          orgSlug={orgSlug}
          tauxAlerteEuros={Math.round(reglages.taux_alerte_cents / 100)}
          heuresPilotageAlerte={reglages.heures_pilotage_alerte}
        />
      </Bloc>

      <Bloc titre="Export">
        <ExportPulsar
          orgSlug={orgSlug}
          depuisParDefaut={mois}
          jusquaParDefaut={jusquaParDefaut}
        />
      </Bloc>
    </div>
  );
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="border-line bg-surface-1 space-y-4 rounded-lg border p-4">
      <h2 className="text-muted-foreground font-mono text-xs tracking-wide">
        {titre}
      </h2>
      {children}
    </section>
  );
}

function Chiffre({
  label,
  valeur,
  sous,
}: {
  label: string;
  valeur: string;
  sous?: string | null;
}) {
  return (
    <div>
      <p className="text-muted-foreground font-mono text-xs">{label}</p>
      <p className="mt-0.5 font-mono text-xl tabular-nums">{valeur}</p>
      {sous ? <p className="text-muted-foreground mt-0.5 text-xs">{sous}</p> : null}
    </div>
  );
}

/** Le partage du mois, d'un coup d'œil : l'ember porte le facturable. */
function Barre({ part }: { part: number }) {
  return (
    <div className="space-y-1">
      <div className="bg-surface-2 flex h-2 overflow-hidden rounded-full">
        <span className="bg-ember block h-full" style={{ width: `${100 - part}%` }} />
      </div>
      {/* Une seule expression : `{x} %` poserait deux nœuds de texte, que le
          rendu serveur sépare par un commentaire HTML. */}
      <p className="text-muted-foreground text-xs">
        {`${100 - part} % de ton mois s'est vendu.`}
      </p>
    </div>
  );
}
