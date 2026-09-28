"use client";

import { Check, Download, FileText, Loader2, Receipt } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  accepterMaFacture,
  enregistrerFacturation,
  lireFacturesClient,
  lireMesFactures,
  marquerFacturePayee,
  type FacturesCloseuse,
  type FactureVue,
} from "./factures-actions";

/**
 * Les factures des closeuses (P16, 0051) : la closeuse n'a plus rien à
 * recopier. Une fois : son identité et le mandat. Chaque mois : « J'accepte ».
 * Côté client : ce qu'il doit, et « Payée » après le virement.
 */

const euros = (cents: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100).replace(/ | /g, " ")} €`;
const moisEnMots = (mois: string) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mois}T12:00:00Z`));

function useCharge<T>(lire: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [version, setVersion] = useState(0);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let actif = true;
    lire().then((r) => {
      if (actif && r.ok) setDonnees(r.data);
    });
    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return { donnees, recharger };
}

function Mandat({ orgSlug, mandat, onFini }: { orgSlug: string; mandat: FacturesCloseuse["mandat"]; onFini: () => void }) {
  const [enCours, demarrer] = useTransition();
  const [nomLegal, setNomLegal] = useState("");
  const [siren, setSiren] = useState("");
  const [adresse, setAdresse] = useState("");
  const [accepte, setAccepte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <form
      className="border-line bg-surface-1 space-y-3 rounded-lg border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setErreur(null);
        demarrer(async () => {
          const r = await enregistrerFacturation(orgSlug, { nomLegal, siren, adresse, accepte });
          if (!r.ok) return setErreur(r.error);
          toast.success("C'est enregistré : tes factures se feront toutes seules.");
          onFini();
        });
      }}
    >
      <p className="font-medium">Tes factures se font toutes seules</p>
      <p className="text-muted-foreground text-sm">
        Une seule fois : tes informations de facturation, et ton accord pour que l&apos;entreprise de Peggy fasse tes factures à ta
        place. Ensuite, chaque mois, tu n&apos;as qu&apos;à cliquer sur « J&apos;accepte ».
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1 text-xs" htmlFor="fac-nom">
            Ton nom d&apos;entreprise (avec EI)
          </Label>
          <Input id="fac-nom" value={nomLegal} onChange={(e) => setNomLegal(e.target.value)} placeholder="Prénom Nom EI" required />
        </div>
        <div>
          <Label className="mb-1 text-xs" htmlFor="fac-siren">
            Ton numéro SIREN
          </Label>
          <Input id="fac-siren" value={siren} onChange={(e) => setSiren(e.target.value)} inputMode="numeric" placeholder="9 chiffres" required />
        </div>
      </div>
      <div>
        <Label className="mb-1 text-xs" htmlFor="fac-adresse">
          Ton adresse
        </Label>
        <Input id="fac-adresse" value={adresse} onChange={(e) => setAdresse(e.target.value)} required />
      </div>
      <div className="border-line text-muted-foreground max-h-48 space-y-2 overflow-y-auto rounded-md border p-3 text-xs">
        {mandat.map((b) => (
          <div key={b.titre ?? "m"} className="space-y-1.5">
            {b.titre ? <p className="text-foreground font-medium">{b.titre}</p> : null}
            {(b.paragraphes ?? []).map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        ))}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="accent-ember mt-1" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} />
        J&apos;accepte ce mandat de facturation.
      </label>
      {erreur ? <p className="text-destructive text-sm">{erreur}</p> : null}
      <Button type="submit" size="sm" disabled={enCours || !accepte}>
        {enCours ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
        Enregistrer
      </Button>
    </form>
  );
}

function LigneFacture({ orgSlug, f, onAccepte }: { orgSlug: string; f: FactureVue; onAccepte: () => void }) {
  const [enCours, demarrer] = useTransition();
  return (
    <li className="border-line flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">
          {moisEnMots(f.mois)} · {euros(f.totalCents)}
        </p>
        <p className="text-muted-foreground text-xs">N° {f.numero}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {f.statut === "a_accepter" ? (
          <Button
            size="sm"
            disabled={enCours}
            onClick={() =>
              demarrer(async () => {
                const r = await accepterMaFacture(orgSlug, f.id);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Facture acceptée.");
                  onAccepte();
                }
              })
            }
          >
            <Check aria-hidden="true" />
            J&apos;accepte
          </Button>
        ) : (
          <Badge variant={f.statut === "payee" ? "default" : "outline"}>{f.statut === "payee" ? "Payée" : "Acceptée, paiement à venir"}</Badge>
        )}
        <Button asChild variant="outline" size="sm">
          <a href={`/app/${orgSlug}/factures/${f.id}/pdf`} target="_blank" rel="noopener">
            <Download aria-hidden="true" />
            PDF
          </a>
        </Button>
      </div>
    </li>
  );
}

/** Dans « Ma commission » de la closeuse. */
export function BlocMesFactures({ orgSlug }: { orgSlug: string }) {
  const { donnees, recharger } = useCharge(() => lireMesFactures(orgSlug));
  if (!donnees) return null;
  if (!donnees.identite) return <Mandat orgSlug={orgSlug} mandat={donnees.mandat} onFini={recharger} />;
  return (
    <section className="border-line bg-surface-1 space-y-2 rounded-lg border p-5">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Receipt aria-hidden="true" className="size-4" />
        Mes factures
      </h3>
      {donnees.factures.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {donnees.acheteurPret
            ? "Ta première facture arrivera le 1er du mois, avec tes commissions du mois écoulé."
            : "Tes factures arriveront le 1er de chaque mois, dès que l'entreprise de Peggy aura son numéro SIREN."}
        </p>
      ) : (
        <ul>
          {donnees.factures.map((f) => (
            <LigneFacture key={f.id} orgSlug={orgSlug} f={f} onAccepte={recharger} />
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        {donnees.identite.nomLegal} · SIREN {donnees.identite.siren}. Tu n&apos;as plus de facture à faire toi-même.
      </p>
    </section>
  );
}

/** Dans Radar, côté client : ce qu'il doit à ses closeuses. Rien s'il n'y a aucune facture. */
export function BlocDuAuxCloseuses({ orgSlug }: { orgSlug: string }) {
  const { donnees, recharger } = useCharge(() => lireFacturesClient(orgSlug));
  const [enCours, demarrer] = useTransition();
  if (!donnees || donnees.length === 0) return null;
  const aPayer = donnees.filter((f) => f.statut === "acceptee");
  const enAttente = donnees.filter((f) => f.statut === "a_accepter");
  return (
    <section className="border-line bg-surface-1 space-y-3 rounded-lg border p-5">
      <h2 className="flex items-center gap-2 text-sm">
        <FileText aria-hidden="true" className="text-muted-foreground size-4" />
        Ce que tu dois à tes closeuses
      </h2>
      {aPayer.length === 0 ? (
        <p className="text-muted-foreground text-sm">Rien à payer pour l&apos;instant.</p>
      ) : (
        <ul>
          {aPayer.map((f) => (
            <li key={f.id} className="border-line flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0">
              <span className="text-sm">
                {f.nom} · {moisEnMots(f.mois)} · <span className="font-medium">{euros(f.totalCents)}</span>
              </span>
              <span className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={`/app/${orgSlug}/factures/${f.id}/pdf`} target="_blank" rel="noopener">
                    <Download aria-hidden="true" />
                    Facture
                  </a>
                </Button>
                <Button
                  size="sm"
                  disabled={enCours}
                  onClick={() =>
                    demarrer(async () => {
                      const r = await marquerFacturePayee(orgSlug, f.id);
                      if (!r.ok) toast.error(r.error);
                      else recharger();
                    })
                  }
                >
                  <Check aria-hidden="true" />
                  J&apos;ai payé
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {enAttente.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {enAttente.length === 1 ? "1 facture attend" : `${enAttente.length} factures attendent`} l&apos;accord de la closeuse avant d&apos;être à payer.
        </p>
      ) : null}
    </section>
  );
}
