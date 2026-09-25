"use client";

import {
  CalendarCheck2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  Megaphone,
  PenLine,
  Plus,
  RotateCcw,
  ShoppingBag,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Logo } from "@/components/app/logo";
import { PageHeader } from "@/components/app/page-header";
import { Tuile } from "@/tools/resultats/tuiles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * L'espace qu'aurait une closeuse de Peggy, en démo.
 *
 * Tout est faux et tout reste dans ce navigateur : les rendez-vous d'exemple
 * sont posés autour de la date du jour, ceux qu'on ajoute s'enregistrent dans
 * le `localStorage`, et « Remettre la démo à zéro » repart des exemples. Rien
 * ne touche Radar ni les chiffres de Peggy.
 *
 * La commission suit la grille validée par Peggy le 23/09/2026 : 15 % de
 * l'encaissé hors TVA, 18 % sur les ventes au-delà de la 5e du mois (celles-là
 * seulement), versée au fil des mensualités.
 */

const CLE = "comete-demo-closeuse-v2";
const DUREE_MIN = 45;
const TAUX = 0.15;
const TAUX_PALIER = 0.18;
const PALIER_APRES = 5;

type Resultat =
  | { type: "vente"; montant: number; fois: number }
  | { type: "pas-de-vente"; motif: string; recontacter?: string }
  | { type: "absente" };

type Rdv = {
  id: string;
  prenom: string;
  debut: string;
  reserveLe: string;
  /** Le formulaire Calendly, obligatoire. */
  reponses: { q: string; r: string }[];
  /** Le questionnaire de /merci-rdv, que toutes ne remplissent pas. */
  site?: { q: string; r: string }[];
  resultat?: Resultat;
};

type Encaissement = {
  rdv: Rdv;
  rang: number;
  taux: number;
  numero: number;
  fois: number;
  date: Date;
  montant: number;
  commission: number;
};

/* ------------------------------------------------------------------ Dates */

const jour = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const court = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
});
const heure = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});
const nomMois = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
});

function cleMois(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function libelleMois(cle: string) {
  const [a, m] = cle.split("-").map(Number);
  return nomMois.format(new Date(a, m - 1, 1));
}

function decalerMois(cle: string, n: number) {
  const [a, m] = cle.split("-").map(Number);
  return cleMois(new Date(a, m - 1 + n, 1));
}

function plusMois(d: Date, n: number) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function majuscule(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function euros(v: number) {
  const decimales = Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(v);
}

/* ------------------------------------------------------------ Exemples */

/*
 * Les vraies questions de Peggy, mot pour mot : les six du formulaire Calendly
 * du « RDV diagnostic offert 45 min » (obligatoires), puis les quatre du
 * questionnaire facultatif de /merci-rdv. Les réponses, elles, sont inventées.
 */
const Q_TEL = "Quel est ton numéro de téléphone ?";
const Q_POURQUOI =
  "Qu'est-ce qui te pousse à vouloir perdre du poids aujourd'hui ? Et qu'as-tu déjà essayé qui n'a pas tenu ?";
const Q_AGE =
  "Quel est ton âge, ton poids actuel, et le poids que tu aimerais atteindre ?";
const Q_CHANGER =
  "Quand tu décides de changer quelque chose dans ta vie, comment ça se passe en général ? Tu fonces, tu analyses tout avant, tu avances pas à pas, ou tu as besoin d'être accompagnée ?";
const Q_CONNU = "Comment m'as-tu connue ?";
const Q_BUDGET =
  "Pour préparer notre échange : quel budget mensuel pourrais-tu consacrer à ta santé aujourd'hui ?";

const Q_OBSTACLE = "Ton obstacle principal";
const Q_DECISION = "Où tu en es dans ta décision";
const Q_INVEST = "Ta capacité d'investissement";
const Q_ATTENTE = "Ce que tu attends de ce RDV";

const BUDGETS = [
  "Moins de 100 €/mois",
  "Entre 100 et 150 €/mois",
  "Entre 150 et 250 €/mois",
  "Plus de 250 €/mois",
];

type Reponses = {
  tel: string;
  pourquoi: string;
  age: string;
  changer: string;
  connu: string;
  budget: string;
  site?: {
    obstacle: string;
    decision: string;
    invest: string;
    attente: string;
  };
};

function versReponses(r: Reponses): Pick<Rdv, "reponses" | "site"> {
  return {
    reponses: [
      { q: Q_TEL, r: r.tel },
      { q: Q_POURQUOI, r: r.pourquoi },
      { q: Q_AGE, r: r.age },
      { q: Q_CHANGER, r: r.changer },
      { q: Q_CONNU, r: r.connu },
      { q: Q_BUDGET, r: r.budget },
    ],
    site: r.site
      ? [
          { q: Q_OBSTACLE, r: r.site.obstacle },
          { q: Q_DECISION, r: r.site.decision },
          { q: Q_INVEST, r: r.site.invest },
          { q: Q_ATTENTE, r: r.site.attente || "—" },
        ]
      : undefined,
  };
}

function exemples(maintenant: Date): Rdv[] {
  // Le vendredi de la semaine en cours (ou le dernier passé) : les créneaux
  // de Mélanie sont le vendredi 9h-16h et le samedi 9h-13h.
  const vendredi = new Date(maintenant);
  vendredi.setHours(0, 0, 0, 0);
  vendredi.setDate(vendredi.getDate() - ((vendredi.getDay() - 5 + 7) % 7));

  const le = (decalage: number, h: number, m = 0) => {
    const d = new Date(vendredi);
    d.setDate(d.getDate() + decalage);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  const rdv = (
    prenom: string,
    debut: string,
    reponses: Reponses,
    resultat?: Resultat,
  ): Rdv => ({
    id: `${prenom}-${debut}`,
    prenom,
    debut,
    // Jamais réservé dans le futur : au plus tard la veille de qui regarde.
    reserveLe: new Date(
      Math.min(
        Date.parse(debut) - 4 * 86_400_000,
        maintenant.getTime() - 86_400_000,
      ),
    ).toISOString(),
    ...versReponses(reponses),
    resultat,
  });

  return [
    rdv(
      "Sandrine M.",
      le(-14, 9, 30),
      {
        tel: "06 •• •• •• 47",
        pourquoi:
          "Je ne me reconnais plus sur les photos et mon mariage est en juin. J'ai fait WW deux fois, les shakes, Comme j'aime… je reprends tout à chaque fois.",
        age: "44 ans, 82 kg, j'aimerais revenir à 68",
        changer: "J'analyse tout avant, et après j'y vais à fond",
        connu: "Instagram",
        budget: BUDGETS[2],
        site: {
          obstacle: "Le grignotage le soir quand les enfants sont couchés",
          decision: "Prête à m'engager si c'est le bon match",
          invest: "Prête à investir si ça me convient",
          attente: "Comprendre pourquoi je craque toujours au même moment",
        },
      },
      { type: "vente", montant: 1450, fois: 3 },
    ),
    rdv(
      "Nathalie B.",
      le(-14, 11),
      {
        tel: "06 •• •• •• 12",
        pourquoi:
          "La ménopause : 10 kg en deux ans sans rien changer. J'ai suivi une diététicienne, perdu 4 kg, tout repris.",
        age: "56 ans, 78 kg, objectif 68",
        changer: "J'avance pas à pas",
        connu: "Facebook",
        budget: BUDGETS[0],
      },
      { type: "pas-de-vente", motif: "Le prix", recontacter: le(10, 10) },
    ),
    rdv(
      "Céline R.",
      le(-13, 9),
      {
        tel: "07 •• •• •• 83",
        pourquoi:
          "Mon médecin m'a parlé de pré-diabète, ça m'a fait peur. J'ai essayé le jeûne intermittent, j'ai tenu trois semaines.",
        age: "39 ans, 91 kg, 75 kg",
        changer: "J'ai besoin d'être accompagnée",
        connu: "Instagram",
        budget: BUDGETS[1],
        site: {
          obstacle: "Le sucre, je ne peux pas m'en passer l'après-midi",
          decision: "Je me renseigne",
          invest: "J'en parle au RDV",
          attente: "",
        },
      },
      { type: "absente" },
    ),
    rdv(
      "Aurélie P.",
      le(-13, 10, 30),
      {
        tel: "06 •• •• •• 05",
        pourquoi:
          "Je mange mes émotions depuis l'adolescence. Dukan, keto, même une appli d'hypnose, rien n'a tenu.",
        age: "35 ans, 74 kg, 62 kg",
        changer: "Je fonce… et je lâche au bout de trois semaines",
        connu: "Instagram",
        budget: BUDGETS[3],
        site: {
          obstacle: "La faim émotionnelle dès que je suis stressée au travail",
          decision: "Je veux démarrer",
          invest: "C'est une priorité pour moi",
          attente: "Un vrai plan, pas encore un régime",
        },
      },
      { type: "vente", montant: 1450, fois: 1 },
    ),
    rdv(
      "Virginie L.",
      le(-7, 10),
      {
        tel: "06 •• •• •• 61",
        pourquoi:
          "Je cuisine pour toute la famille et je finis les assiettes. Je n'ai jamais rien essayé de sérieux.",
        age: "47 ans, 86 kg, 72 kg",
        changer: "J'analyse tout avant",
        connu: "Facebook",
        budget: BUDGETS[1],
        site: {
          obstacle: "Je m'occupe de tout le monde sauf de moi",
          decision: "Prête à m'engager si c'est le bon match",
          invest: "J'en parle au RDV",
          attente: "Savoir si l'hypnose peut marcher sur moi",
        },
      },
      {
        type: "pas-de-vente",
        motif: "En parler à son conjoint",
        recontacter: le(3, 10),
      },
    ),
    rdv(
      "Stéphanie G.",
      le(-7, 14),
      {
        tel: "07 •• •• •• 29",
        pourquoi:
          "Le chirurgien veut que je perde 12 kg avant l'opération du genou. Nutritionniste, salle de sport, arrêtée à cause du genou.",
        age: "51 ans, 95 kg, 83 kg",
        changer: "J'avance pas à pas",
        connu: "Facebook",
        budget: BUDGETS[2],
      },
      { type: "vente", montant: 1200, fois: 4 },
    ),
    rdv(
      "Laurence D.",
      le(-6, 11),
      {
        tel: "06 •• •• •• 90",
        pourquoi:
          "La masterclass m'a parlé sur le sucre. Deux cafés sucrés et des gâteaux au bureau tous les jours. Jamais fait de régime.",
        age: "42 ans, 70 kg, 63 kg",
        changer: "Je fonce",
        connu: "Instagram",
        budget: BUDGETS[0],
        site: {
          obstacle: "Le sucre au bureau",
          decision: "Je me renseigne",
          invest: "J'en parle au RDV",
          attente: "Des conseils pour arrêter le sucre",
        },
      },
      { type: "pas-de-vente", motif: "Pas le bon moment" },
    ),
    rdv("Karine T.", le(0, 9), {
      tel: "06 •• •• •• 38",
      pourquoi:
        "Deux grossesses rapprochées, 15 kg qui ne sont jamais repartis. WW après la première, ça marchait jusqu'à la deuxième.",
      age: "36 ans, 79 kg, 64 kg",
      changer: "J'ai besoin d'être accompagnée",
      connu: "Instagram",
      budget: BUDGETS[1],
      site: {
        obstacle: "Pas de temps pour moi, je mange ce qui reste",
        decision: "Prête à m'engager si c'est le bon match",
        invest: "Prête à investir si ça me convient",
        attente:
          "Un accompagnement qui tient compte de ma vie avec deux petits",
      },
    }),
    rdv("Delphine F.", le(0, 10, 30), {
      tel: "06 •• •• •• 74",
      pourquoi:
        "Je veux arrêter de me cacher en été. Régimes en boucle depuis mes 20 ans, le dernier avec une appli de calories.",
      age: "48 ans, 88 kg, 70 kg",
      changer: "J'analyse tout avant",
      connu: "Facebook",
      budget: BUDGETS[2],
    }),
    rdv("Isabelle C.", le(0, 14), {
      tel: "07 •• •• •• 16",
      pourquoi:
        "Mon fils se marie en mai et je veux être bien dans ma robe. Une cure de shakes : 6 kg perdus, tout repris en deux mois.",
      age: "58 ans, 84 kg, 72 kg",
      changer: "J'avance pas à pas",
      connu: "Facebook",
      budget: BUDGETS[3],
      site: {
        obstacle: "Je reprends toujours tout après",
        decision: "Je veux démarrer",
        invest: "C'est une priorité pour moi",
        attente: "Une méthode qui tienne dans la durée",
      },
    }),
    rdv("Émilie V.", le(0, 15), {
      tel: "06 •• •• •• 52",
      pourquoi:
        "J'ai arrêté de fumer il y a un an et pris 9 kg. Rien essayé, j'ai peur de reprendre la cigarette.",
      age: "41 ans, 71 kg, 62 kg",
      changer: "Je fonce",
      connu: "Instagram",
      budget: BUDGETS[1],
    }),
    rdv("Caroline N.", le(1, 9, 30), {
      tel: "06 •• •• •• 08",
      pourquoi:
        "Je grignote dès que je m'ennuie, surtout le week-end. Keto pendant quatre mois, craqué à Noël.",
      age: "33 ans, 68 kg, 58 kg",
      changer: "Je fonce",
      connu: "Instagram",
      budget: BUDGETS[0],
      site: {
        obstacle: "L'ennui et le grignotage",
        decision: "Je me renseigne",
        invest: "J'en parle au RDV",
        attente: "",
      },
    }),
    rdv("Sophie A.", le(1, 11), {
      tel: "07 •• •• •• 65",
      pourquoi:
        "Le stress au travail, je compense le soir. La sophrologie m'a aidée à dormir, pas à moins manger.",
      age: "45 ans, 83 kg, 70 kg",
      changer: "J'ai besoin d'être accompagnée",
      connu: "Facebook",
      budget: BUDGETS[2],
      site: {
        obstacle: "Le soir après le travail",
        decision: "Prête à m'engager si c'est le bon match",
        invest: "Prête à investir si ça me convient",
        attente: "Comprendre le lien entre mon stress et la nourriture",
      },
    }),
    rdv("Magali H.", le(7, 10), {
      tel: "06 •• •• •• 33",
      pourquoi:
        "Hypothyroïdie, j'ai l'impression que rien ne marche. Régimes, sport, compléments.",
      age: "50 ans, 90 kg, 75 kg",
      changer: "J'analyse tout avant",
      connu: "Facebook",
      budget: BUDGETS[1],
    }),
    rdv("Hélène J.", le(7, 13, 30), {
      tel: "06 •• •• •• 21",
      pourquoi:
        "Retrouver confiance en moi. Jamais fait de régime, mais je mange trop vite et trop.",
      age: "38 ans, 76 kg, 65 kg",
      changer: "J'avance pas à pas",
      connu: "Instagram",
      budget: BUDGETS[2],
      site: {
        obstacle: "Je mange trop vite, sans faim",
        decision: "Je veux démarrer",
        invest: "Prête à investir si ça me convient",
        attente: "Savoir par où commencer",
      },
    }),
    rdv("Julie K.", le(8, 10), {
      tel: "07 •• •• •• 49",
      pourquoi:
        "Mon médecin veut que je perde du poids pour ma tension. Comme j'aime : 8 kg perdus, 10 repris.",
      age: "53 ans, 97 kg, 80 kg",
      changer: "J'ai besoin d'être accompagnée",
      connu: "Facebook",
      budget: BUDGETS[0],
    }),
  ];
}

function lire(maintenant: Date): Rdv[] {
  try {
    const brut = window.localStorage.getItem(CLE);
    if (brut) {
      const donnees = JSON.parse(brut) as { rdvs?: Rdv[] };
      if (Array.isArray(donnees.rdvs)) return donnees.rdvs;
    }
  } catch {
    // Stockage indisponible : on repart des exemples.
  }
  return exemples(maintenant);
}

function ecrire(rdvs: Rdv[]) {
  try {
    window.localStorage.setItem(CLE, JSON.stringify({ rdvs }));
  } catch {
    // Pas grave : la démo tourne quand même, sans mémoire.
  }
}

/* ------------------------------------------------------------- Calculs */

function encaissements(rdvs: Rdv[]): Encaissement[] {
  const ventes = rdvs
    .filter((r) => r.resultat?.type === "vente")
    .sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut));

  // Le rang d'une vente dans son mois décide de son taux, une fois pour toutes.
  const parMois = new Map<string, number>();
  const lignes: Encaissement[] = [];

  for (const rdv of ventes) {
    const vente = rdv.resultat as Extract<Resultat, { type: "vente" }>;
    const debut = new Date(rdv.debut);
    const mois = cleMois(debut);
    const rang = (parMois.get(mois) ?? 0) + 1;
    parMois.set(mois, rang);
    const taux = rang > PALIER_APRES ? TAUX_PALIER : TAUX;

    const part = Math.floor((vente.montant / vente.fois) * 100) / 100;
    for (let i = 0; i < vente.fois; i++) {
      const montant =
        i === vente.fois - 1
          ? Math.round((vente.montant - part * (vente.fois - 1)) * 100) / 100
          : part;
      lignes.push({
        rdv,
        rang,
        taux,
        numero: i + 1,
        fois: vente.fois,
        date: plusMois(debut, i),
        montant,
        commission: Math.round(montant * taux * 100) / 100,
      });
    }
  }

  return lignes.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/* ------------------------------------------------------------ L'écran */

type Onglet = "rdv" | "ventes" | "commission" | "regles";

const ONGLETS: { id: Onglet; label: string }[] = [
  { id: "rdv", label: "Mes rendez-vous" },
  { id: "ventes", label: "Mes ventes" },
  { id: "commission", label: "Ma commission" },
  { id: "regles", label: "Comment ça marche" },
];

/**
 * Rendu seulement dans le navigateur (voir `charger.tsx`) : les exemples se
 * posent autour de l'heure de qui regarde, et le `localStorage` se lit dès le
 * premier rendu.
 */
export default function EspaceCloseuse() {
  const [rdvs, setRdvs] = useState<Rdv[]>(() => lire(new Date()));
  const [maintenant, setMaintenant] = useState<Date>(() => new Date());
  const [onglet, setOnglet] = useState<Onglet>("rdv");
  const [mois, setMois] = useState<string>(() => cleMois(new Date()));
  const [aNoter, setANoter] = useState<Rdv | null>(null);
  const [ajout, setAjout] = useState(0);
  const [facture, setFacture] = useState(false);

  useEffect(() => {
    const minute = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => window.clearInterval(minute);
  }, []);

  const changer = (suivant: Rdv[]) => {
    setRdvs(suivant);
    ecrire(suivant);
  };

  const lignes = useMemo(() => encaissements(rdvs), [rdvs]);

  const duMois = rdvs.filter((r) => cleMois(new Date(r.debut)) === mois);
  const tenus = duMois.filter(
    (r) => r.resultat && r.resultat.type !== "absente",
  );
  const ventesDuMois = duMois.filter((r) => r.resultat?.type === "vente");
  const encaisseDuMois = lignes.filter((l) => cleMois(l.date) === mois);
  const commissionDuMois = encaisseDuMois.reduce((s, l) => s + l.commission, 0);
  const encoreAEncaisser = encaisseDuMois
    .filter((l) => l.date > maintenant)
    .reduce((s, l) => s + l.commission, 0);
  const taux = tenus.length
    ? Math.round((ventesDuMois.length / tenus.length) * 100)
    : null;

  return (
    <Coquille>
      <PageHeader
        title="Bonjour Mélanie"
        description="Tes rendez-vous avec les futures clientes de Peggy, ce que tu as vendu, et ce que tu factures à la fin du mois."
        action={
          <Button onClick={() => setAjout((n) => n + 1)}>
            <Plus aria-hidden="true" />
            Ajouter un rendez-vous
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Mois précédent"
          onClick={() => setMois(decalerMois(mois, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium">
          {majuscule(libelleMois(mois))}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Mois suivant"
          onClick={() => setMois(decalerMois(mois, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tuile
          icon={CalendarCheck2}
          label="Rendez-vous tenus"
          valeur={String(tenus.length)}
          comparaison={`sur ${duMois.length} réservés dans le mois`}
        />
        <Tuile
          icon={ShoppingBag}
          label="Ventes"
          valeur={String(ventesDuMois.length)}
          comparaison={taux === null ? null : `${taux} % des rendez-vous tenus`}
        />
        <Tuile
          icon={Coins}
          label="Encaissé sur tes ventes"
          valeur={euros(encaisseDuMois.reduce((s, l) => s + l.montant, 0))}
          comparaison="hors TVA, mensualités comprises"
        />
        <Tuile
          icon={FileText}
          label="Ta commission du mois"
          valeur={euros(commissionDuMois)}
          comparaison={
            encoreAEncaisser > 0
              ? `dont ${euros(encoreAEncaisser)} sur des mensualités encore à venir ce mois-ci`
              : "à facturer à la fin du mois"
          }
        />
      </div>

      <div
        role="tablist"
        className="border-line mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b"
      >
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            role="tab"
            aria-selected={onglet === o.id}
            onClick={() => setOnglet(o.id)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              onglet === o.id
                ? "border-ember text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {onglet === "rdv" ? (
        <OngletRdv rdvs={rdvs} maintenant={maintenant} onNoter={setANoter} />
      ) : null}
      {onglet === "ventes" ? (
        <OngletVentes
          rdvs={rdvs}
          lignes={lignes}
          mois={mois}
          maintenant={maintenant}
        />
      ) : null}
      {onglet === "commission" ? (
        <OngletCommission
          lignes={encaisseDuMois}
          mois={mois}
          maintenant={maintenant}
          onFacture={() => setFacture(true)}
        />
      ) : null}
      {onglet === "regles" ? <OngletRegles /> : null}

      <div className="border-line mt-16 flex flex-col items-start gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs">
          Aperçu avec des données d&apos;exemple : les noms, les rendez-vous et
          les montants sont inventés.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const now = new Date();
            setMois(cleMois(now));
            changer(exemples(now));
          }}
        >
          <RotateCcw aria-hidden="true" />
          Remettre la démo à zéro
        </Button>
      </div>

      <Dialog
        open={aNoter !== null}
        onOpenChange={(o) => (o ? null : setANoter(null))}
      >
        <DialogContent>
          {aNoter ? (
            <FormResultat
              key={aNoter.id}
              rdv={aNoter}
              onClose={() => setANoter(null)}
              onSave={(resultat) => {
                changer(
                  rdvs.map((r) =>
                    r.id === aNoter.id ? { ...r, resultat } : r,
                  ),
                );
                setANoter(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={ajout > 0} onOpenChange={(o) => (o ? null : setAjout(0))}>
        <DialogContent>
          <FormAjout
            key={ajout}
            onClose={() => setAjout(0)}
            onSave={(rdv) => {
              changer([...rdvs, rdv]);
              setAjout(0);
              setOnglet("rdv");
            }}
          />
        </DialogContent>
      </Dialog>
      <DialogueFacture
        ouvert={facture}
        onClose={() => setFacture(false)}
        lignes={encaisseDuMois}
        mois={mois}
      />
    </Coquille>
  );
}

/* ------------------------------------------------------------ Coquille */

function Coquille({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-line bg-void/95 supports-[backdrop-filter]:bg-void/75 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <span
            aria-hidden="true"
            className="bg-line hidden h-5 w-px sm:block"
          />
          <span className="truncate text-sm font-medium">
            Peggy Girault · Espace closeuse
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              Mélanie
            </span>
            <span className="bg-ember text-void flex size-8 items-center justify-center rounded-full text-sm font-semibold">
              M
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}

/* ----------------------------------------------------- Mes rendez-vous */

function OngletRdv({
  rdvs,
  maintenant,
  onNoter,
}: {
  rdvs: Rdv[];
  maintenant: Date;
  onNoter: (rdv: Rdv) => void;
}) {
  const tries = [...rdvs].sort(
    (a, b) => Date.parse(a.debut) - Date.parse(b.debut),
  );
  const fin = (r: Rdv) => Date.parse(r.debut) + DUREE_MIN * 60_000;
  const aNoter = tries.filter(
    (r) => !r.resultat && fin(r) <= maintenant.getTime(),
  );
  const aVenir = tries.filter(
    (r) => !r.resultat && fin(r) > maintenant.getTime(),
  );
  const faits = tries.filter((r) => r.resultat).reverse();

  const recontacter = rdvs
    .filter(
      (r) => r.resultat?.type === "pas-de-vente" && r.resultat.recontacter,
    )
    .sort((a, b) => {
      const ra = (a.resultat as { recontacter: string }).recontacter;
      const rb = (b.resultat as { recontacter: string }).recontacter;
      return Date.parse(ra) - Date.parse(rb);
    });

  return (
    <div className="space-y-10">
      {aNoter.length ? (
        <Section
          titre="À noter"
          sousTitre="L'appel est passé : dis ce qui s'est passé, ça prend dix secondes."
        >
          {aNoter.map((r) => (
            <CarteRdv
              key={r.id}
              rdv={r}
              maintenant={maintenant}
              onNoter={onNoter}
              urgent
            />
          ))}
        </Section>
      ) : null}

      <Section
        titre="À venir"
        sousTitre="Réservés dans tes créneaux, depuis la pub de Peggy."
      >
        {aVenir.length ? (
          aVenir.map((r) => (
            <CarteRdv
              key={r.id}
              rdv={r}
              maintenant={maintenant}
              onNoter={onNoter}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            Aucun rendez-vous à venir pour l&apos;instant.
          </p>
        )}
      </Section>

      {recontacter.length ? (
        <Section
          titre="À recontacter"
          sousTitre="Celles qui n'ont pas pris, et ont dit quand en reparler."
        >
          <div className="border-line divide-line divide-y rounded-lg border">
            {recontacter.map((r) => {
              const res = r.resultat as Extract<
                Resultat,
                { type: "pas-de-vente" }
              >;
              return (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="font-medium">{r.prenom}</span>
                  <span className="text-muted-foreground">{res.motif}</span>
                  <Badge variant="secondary">
                    le {jour.format(new Date(res.recontacter as string))}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section titre="Déjà faits">
        <div className="border-line divide-line divide-y rounded-lg border">
          {faits.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground w-44 shrink-0">
                {majuscule(jour.format(new Date(r.debut)))},{" "}
                {heure.format(new Date(r.debut))}
              </span>
              <span className="w-32 shrink-0 font-medium">{r.prenom}</span>
              <BadgeResultat resultat={r.resultat as Resultat} />
              <button
                className="text-muted-foreground hover:text-foreground ml-auto text-xs underline-offset-4 hover:underline"
                onClick={() => onNoter(r)}
              >
                Modifier
              </button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({
  titre,
  sousTitre,
  children,
}: {
  titre: string;
  sousTitre?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg">{titre}</h2>
        {sousTitre ? (
          <p className="text-muted-foreground text-sm">{sousTitre}</p>
        ) : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function CarteRdv({
  rdv,
  maintenant,
  onNoter,
  urgent,
}: {
  rdv: Rdv;
  maintenant: Date;
  onNoter: (rdv: Rdv) => void;
  urgent?: boolean;
}) {
  const debut = new Date(rdv.debut);
  const dans = debut.getTime() - maintenant.getTime();
  const bientot = dans > -DUREE_MIN * 60_000 && dans < 15 * 60_000;
  const [ouvert, setOuvert] = useState(false);

  return (
    <div
      className={cn(
        "bg-surface-1 rounded-lg border p-4",
        urgent ? "border-warning/50" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">
            {majuscule(jour.format(debut))} · {heure.format(debut)} ·{" "}
            {DUREE_MIN} min en visio
          </p>
          <p className="mt-1 text-base font-medium">{rdv.prenom}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <Megaphone aria-hidden="true" />
            Pub Meta
          </Badge>
          {urgent ? (
            <Button size="sm" onClick={() => onNoter(rdv)}>
              <PenLine aria-hidden="true" />
              Noter le résultat
            </Button>
          ) : (
            <Button
              size="sm"
              variant={bientot ? "default" : "outline"}
              disabled={!bientot}
            >
              <Video aria-hidden="true" />
              {bientot ? "Rejoindre la visio" : "Visio"}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm">{rdv.reponses[1]?.r}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{rdv.reponses[2]?.r}</Badge>
        <Badge variant="secondary">{rdv.reponses[5]?.r}</Badge>
        {rdv.site ? <Badge variant="secondary">{rdv.site[1]?.r}</Badge> : null}
        <button
          className="text-ember ml-auto text-xs underline-offset-4 hover:underline"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
        >
          {ouvert ? "Masquer ses réponses" : "Voir toutes ses réponses"}
        </button>
      </div>
      {ouvert ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <BlocReponses
            titre="Sa réservation (Calendly)"
            reponses={rdv.reponses}
          />
          {rdv.site ? (
            <BlocReponses
              titre="Le questionnaire du site, après la réservation"
              reponses={rdv.site}
            />
          ) : (
            <div className="border-line text-muted-foreground rounded-md border border-dashed p-3 text-sm">
              Elle n&apos;a pas rempli le questionnaire du site (il est
              facultatif).
            </div>
          )}
        </div>
      ) : null}
      <p className="text-muted-foreground mt-3 text-xs">
        Réservé le {jour.format(new Date(rdv.reserveLe))}
      </p>
    </div>
  );
}

function BlocReponses({
  titre,
  reponses,
}: {
  titre: string;
  reponses: { q: string; r: string }[];
}) {
  return (
    <div className="border-line rounded-md border p-3">
      <p className="mb-2 text-xs font-medium">{titre}</p>
      <dl className="space-y-2.5 text-sm">
        {reponses.map((x) => (
          <div key={x.q}>
            <dt className="text-muted-foreground text-xs">{x.q}</dt>
            <dd>{x.r}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BadgeResultat({ resultat }: { resultat: Resultat }) {
  if (resultat.type === "vente") {
    return (
      <Badge className="bg-success/15 text-success">
        Vendu · {euros(resultat.montant)} HT
        {resultat.fois > 1 ? ` en ${resultat.fois} fois` : ""}
      </Badge>
    );
  }
  if (resultat.type === "absente") {
    return <Badge variant="destructive">Pas venue</Badge>;
  }
  return <Badge variant="secondary">Pas de vente · {resultat.motif}</Badge>;
}

/* ---------------------------------------------------------- Mes ventes */

function OngletVentes({
  rdvs,
  lignes,
  mois,
  maintenant,
}: {
  rdvs: Rdv[];
  lignes: Encaissement[];
  mois: string;
  maintenant: Date;
}) {
  const ventes = rdvs
    .filter(
      (r) =>
        r.resultat?.type === "vente" && cleMois(new Date(r.debut)) === mois,
    )
    .sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut));

  if (!ventes.length) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucune vente en {libelleMois(mois)}.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {ventes.map((r) => {
        const vente = r.resultat as Extract<Resultat, { type: "vente" }>;
        const siennes = lignes.filter((l) => l.rdv.id === r.id);
        const { rang, taux } = siennes[0];
        const gagne = siennes
          .filter((l) => l.date <= maintenant)
          .reduce((s, l) => s + l.commission, 0);
        const total = siennes.reduce((s, l) => s + l.commission, 0);

        return (
          <div
            key={r.id}
            className="border-line bg-surface-1 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-muted-foreground text-xs">
                  {rang === 1 ? "1re" : `${rang}e`} vente du mois ·{" "}
                  {majuscule(jour.format(new Date(r.debut)))}
                </p>
                <p className="mt-1 text-base font-medium">{r.prenom}</p>
                <p className="text-muted-foreground text-sm">
                  Le Programme · {euros(vente.montant)} HT
                  {vente.fois > 1
                    ? `, en ${vente.fois} fois (${euros(vente.montant / vente.fois)} par mois)`
                    : ", en une fois"}
                </p>
              </div>
              <div className="text-right">
                <Badge variant={taux === TAUX_PALIER ? "default" : "secondary"}>
                  {Math.round(taux * 100)} %
                  {taux === TAUX_PALIER ? " · palier" : ""}
                </Badge>
                <p className="font-display mt-2 text-xl font-semibold tabular-nums">
                  {euros(total)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {gagne < total
                    ? `${euros(gagne)} déjà gagnés, le reste au fil des mensualités`
                    : "tout est encaissé"}
                </p>
              </div>
            </div>
            <ol className="mt-4 flex flex-wrap gap-2">
              {siennes.map((l) => {
                const fait = l.date <= maintenant;
                return (
                  <li
                    key={l.numero}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      fait
                        ? "border-success/40 text-success"
                        : "border-line text-muted-foreground",
                    )}
                  >
                    {l.fois > 1 ? `${l.numero}/${l.fois} · ` : ""}
                    {court.format(l.date)} · {euros(l.commission)}
                    {fait ? " encaissé" : " prévu"}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- Ma commission */

function OngletCommission({
  lignes,
  mois,
  maintenant,
  onFacture,
}: {
  lignes: Encaissement[];
  mois: string;
  maintenant: Date;
  onFacture: () => void;
}) {
  const total = lignes.reduce((s, l) => s + l.commission, 0);
  const courant = cleMois(maintenant);
  const etat =
    mois < courant
      ? "Facturée et payée"
      : mois === courant
        ? "À facturer le dernier jour du mois"
        : "Prévue, si les mensualités sont payées";

  return (
    <div className="space-y-6">
      <div className="border-line bg-surface-1 flex flex-wrap items-end justify-between gap-4 rounded-lg border p-5">
        <div>
          <p className="text-muted-foreground text-sm">
            Ta commission de {libelleMois(mois)}
          </p>
          <p className="font-display mt-1 text-4xl font-semibold tabular-nums">
            {euros(total)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">{etat}</p>
        </div>
        {lignes.length ? (
          <Button onClick={onFacture}>
            <FileText aria-hidden="true" />
            Préparer ma facture
          </Button>
        ) : null}
      </div>

      {lignes.length ? (
        <div className="border-line overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr className="border-line border-b">
                <th className="px-4 py-2 font-normal">Date</th>
                <th className="px-4 py-2 font-normal">Cliente</th>
                <th className="px-4 py-2 font-normal">Paiement</th>
                <th className="px-4 py-2 text-right font-normal">
                  Encaissé HT
                </th>
                <th className="px-4 py-2 text-right font-normal">Taux</th>
                <th className="px-4 py-2 text-right font-normal">Ta part</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {lignes.map((l) => (
                <tr
                  key={`${l.rdv.id}-${l.numero}`}
                  className={l.date > maintenant ? "text-muted-foreground" : ""}
                >
                  <td className="px-4 py-2.5">{court.format(l.date)}</td>
                  <td className="px-4 py-2.5">{l.rdv.prenom}</td>
                  <td className="px-4 py-2.5">
                    {l.fois > 1
                      ? `Mensualité ${l.numero} sur ${l.fois}`
                      : "En une fois"}
                    {l.date > maintenant ? " · à venir" : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {euros(l.montant)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {Math.round(l.taux * 100)} %
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {euros(l.commission)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Rien d&apos;encaissé sur tes ventes en {libelleMois(mois)}.
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        Change de mois en haut de la page pour voir les mensualités des mois
        suivants.
      </p>
    </div>
  );
}

/* --------------------------------------------------- Comment ça marche */

function OngletRegles() {
  const regles = [
    {
      titre: "15 % de ce qui est encaissé",
      texte:
        "Sur chaque vente que tu conclus, hors TVA. Une vente à 1 450 € te rapporte environ 217 €.",
    },
    {
      titre: "18 % au-delà de la 5e vente du mois",
      texte:
        "La 6e vente du mois et les suivantes passent à 18 %. Les cinq premières restent à 15 %.",
    },
    {
      titre: "Paiement en plusieurs fois",
      texte:
        "Ta commission suit chaque mensualité encaissée. Si tu arrêtes un jour, tu la gardes jusqu'à la dernière.",
    },
    {
      titre: "Impayés et remboursements",
      texte:
        "Rien sur ce qui n'est pas encaissé. Un remboursement se retire du mois suivant.",
    },
    {
      titre: "Tes rendez-vous",
      texte:
        "Des personnes venues de la pub, qui réservent un appel dans tes créneaux : le vendredi de 9h à 16h, le samedi de 9h à 13h.",
    },
    {
      titre: "Ta facture",
      texte:
        "Tu es indépendante : à la fin du mois, tu factures ta commission. Le montant est prêt dans « Ma commission ».",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {regles.map((r) => (
        <div
          key={r.titre}
          className="border-line bg-surface-1 rounded-lg border p-4"
        >
          <p className="font-medium">{r.titre}</p>
          <p className="text-muted-foreground mt-1 text-sm">{r.texte}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Dialogues */

const MOTIFS = [
  "Le prix",
  "En parler à son conjoint",
  "Pas le bon moment",
  "Pas convaincue",
  "Autre",
];
const FOIS = [1, 2, 3, 4, 6, 10];

const champ =
  "border-input bg-input/30 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function FormResultat({
  rdv,
  onClose,
  onSave,
}: {
  rdv: Rdv;
  onClose: () => void;
  onSave: (r: Resultat) => void;
}) {
  const r = rdv.resultat;
  const [type, setType] = useState<Resultat["type"]>(r?.type ?? "vente");
  const [montant, setMontant] = useState(
    r?.type === "vente" ? String(r.montant) : "1450",
  );
  const [fois, setFois] = useState(r?.type === "vente" ? r.fois : 3);
  const [motif, setMotif] = useState(
    r?.type === "pas-de-vente" ? r.motif : MOTIFS[0],
  );
  const [recontacter, setRecontacter] = useState(
    r?.type === "pas-de-vente" && r.recontacter
      ? r.recontacter.slice(0, 10)
      : "",
  );

  const valeur = Number(montant.replace(",", "."));
  const valide = type !== "vente" || (Number.isFinite(valeur) && valeur > 0);

  const choix: { id: Resultat["type"]; label: string }[] = [
    { id: "vente", label: "Elle a acheté" },
    { id: "pas-de-vente", label: "Elle n'a pas acheté" },
    { id: "absente", label: "Elle n'est pas venue" },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Le rendez-vous avec {rdv.prenom}</DialogTitle>
        <DialogDescription>
          {majuscule(jour.format(new Date(rdv.debut)))},{" "}
          {heure.format(new Date(rdv.debut))}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-3 gap-2">
        {choix.map((c) => (
          <button
            key={c.id}
            onClick={() => setType(c.id)}
            className={cn(
              "rounded-lg border px-2 py-2.5 text-sm transition-colors",
              type === c.id
                ? "border-ember bg-ember/10"
                : "border-line hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {type === "vente" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="montant">Montant total HT (€)</Label>
            <Input
              id="montant"
              inputMode="decimal"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fois">Payé en</Label>
            <select
              id="fois"
              className={champ}
              value={fois}
              onChange={(e) => setFois(Number(e.target.value))}
            >
              {FOIS.map((f) => (
                <option key={f} value={f}>
                  {f === 1 ? "une fois" : `${f} fois`}
                </option>
              ))}
            </select>
          </div>
          {valide && valeur > 0 ? (
            <p className="text-muted-foreground col-span-2 text-sm">
              {fois > 1 ? `${euros(valeur / fois)} par mois. ` : ""}
              Ta commission : environ {euros(valeur * TAUX)} en tout, au fil des
              encaissements.
            </p>
          ) : null}
        </div>
      ) : null}

      {type === "pas-de-vente" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="motif">Pourquoi</Label>
            <select
              id="motif"
              className={champ}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            >
              {MOTIFS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recontacter">La recontacter le</Label>
            <Input
              id="recontacter"
              type="date"
              value={recontacter}
              onChange={(e) => setRecontacter(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button
          disabled={!valide}
          onClick={() => {
            if (type === "vente")
              onSave({ type, montant: Math.round(valeur * 100) / 100, fois });
            else if (type === "pas-de-vente")
              onSave({
                type,
                motif,
                recontacter: recontacter
                  ? new Date(`${recontacter}T10:00`).toISOString()
                  : undefined,
              });
            else onSave({ type });
          }}
        >
          Enregistrer
        </Button>
      </DialogFooter>
    </>
  );
}

function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function FormAjout({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (r: Rdv) => void;
}) {
  const [prenom, setPrenom] = useState("");
  const [date, setDate] = useState(aujourdhui);
  const [h, setH] = useState("10:00");
  const [motif, setMotif] = useState("");
  const [age, setAge] = useState("");
  const [budget, setBudget] = useState(BUDGETS[1]);

  const valide = prenom.trim() && date && h;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ajouter un rendez-vous</DialogTitle>
        <DialogDescription>
          Pour la démo. En vrai, les rendez-vous arrivent tout seuls quand
          quelqu&apos;un réserve.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="prenom">Prénom</Label>
          <Input
            id="prenom"
            value={prenom}
            onChange={(e) => setPrenom(e.target.value)}
            placeholder="Marion L."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="date">Jour</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="heure">Heure</Label>
            <Input
              id="heure"
              type="time"
              value={h}
              onChange={(e) => setH(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="motif-rdv">
            Ce qui la pousse à perdre du poids, et ce qu&apos;elle a déjà essayé
          </Label>
          <Textarea
            id="motif-rdv"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Je reprends tout après chaque régime…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="age-rdv">Âge, poids, poids visé</Label>
            <Input
              id="age-rdv"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="45 ans, 80 kg, 68 kg"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="budget-rdv">Budget mensuel</Label>
            <select
              id="budget-rdv"
              className={champ}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            >
              {BUDGETS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Annuler
        </Button>
        <Button
          disabled={!valide}
          onClick={() => {
            const debut = new Date(`${date}T${h}`);
            onSave({
              id: `${prenom}-${debut.toISOString()}-${Date.now()}`,
              prenom: prenom.trim(),
              debut: debut.toISOString(),
              reserveLe: new Date().toISOString(),
              ...versReponses({
                tel: "06 •• •• •• ••",
                pourquoi: motif.trim() || "—",
                age: age.trim() || "—",
                changer: "—",
                connu: "Instagram",
                budget,
              }),
            });
          }}
        >
          <CalendarClock aria-hidden="true" />
          Ajouter
        </Button>
      </DialogFooter>
    </>
  );
}

function DialogueFacture({
  ouvert,
  onClose,
  lignes,
  mois,
}: {
  ouvert: boolean;
  onClose: () => void;
  lignes: Encaissement[];
  mois: string;
}) {
  const total = lignes.reduce((s, l) => s + l.commission, 0);

  return (
    <Dialog open={ouvert} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ta facture de {libelleMois(mois)}</DialogTitle>
          <DialogDescription>
            Tout est prêt à recopier dans ton outil de facturation, ou à
            télécharger.
          </DialogDescription>
        </DialogHeader>
        <div className="border-line space-y-3 rounded-lg border p-4 text-sm">
          <div className="flex justify-between gap-4">
            <div>
              <p className="font-medium">
                Mélanie · entrepreneuse individuelle
              </p>
              <p className="text-muted-foreground text-xs">SIRET : le tien</p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground text-xs">Facturé à</p>
              <p className="font-medium">L&apos;entreprise de Peggy Girault</p>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Objet : commissions sur ventes, {libelleMois(mois)}
          </p>
          <div className="divide-line divide-y">
            {lignes.map((l) => (
              <div
                key={`${l.rdv.id}-${l.numero}`}
                className="flex justify-between gap-4 py-1.5"
              >
                <span>
                  {l.rdv.prenom}, {court.format(l.date)}
                  {l.fois > 1 ? ` (${l.numero}/${l.fois})` : ""} ·{" "}
                  {Math.round(l.taux * 100)} % de {euros(l.montant)}
                </span>
                <span className="tabular-nums">{euros(l.commission)}</span>
              </div>
            ))}
          </div>
          <div className="border-line flex justify-between border-t pt-2 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{euros(total)}</span>
          </div>
          <p className="text-muted-foreground text-xs">
            TVA non applicable, article 293 B du CGI.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={onClose}>Télécharger en PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
