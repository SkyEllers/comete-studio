"""Écrit supabase/migrations/0036_radar_closeuses.sql.

Les cinq fonctions de saisie de Radar sont recopiées depuis leur dernière
définition, caractère pour caractère, avec une seule ligne changée : la garde
`can_access_radar` devient `radar_peut_saisir`, qui ouvre aussi le rendez-vous
à la closeuse qui le tient. Recopier à la main aurait laissé passer une
différence ; ce script échoue si la ligne n'est pas trouvée exactement une fois.

    python scripts/generer-0036.py
"""
import os
import re

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(RACINE, "supabase", "migrations")

FONCTIONS = [
    ("0015_radar_identite_ventes.sql", "radar_set_sale"),
    ("0016_radar_vente_gardes.sql", "radar_decline_sale"),
    ("0016_radar_vente_gardes.sql", "radar_client_set_status"),
    ("0031_radar_motif_pas_encore.sql", "radar_note_non_vente"),
    ("0024_radar_pas_de_vente_motif.sql", "radar_recontact_fait"),
]
ANCIENNE = "  if not public.can_access_radar(rdv.organization_id) then\n"
NOUVELLE = "  if not public.radar_peut_saisir(rdv.organization_id, rdv.closeuse_id) then\n"


def extraire(fichier, nom):
    texte = open(os.path.join(MIG, fichier), encoding="utf-8").read().replace("\r\n", "\n")
    debut = texte.index(f"create or replace function public.{nom}(")
    fin = texte.index("\n$fn$;\n", debut) + len("\n$fn$;\n")
    bloc = texte[debut:fin]
    assert bloc.count(ANCIENNE) == 1, f"{nom} : garde introuvable ou multiple"
    return bloc.replace(ANCIENNE, NOUVELLE)


def vue():
    """La vue de lecture, recopiée de la 0015 : `b.*` fige ses colonnes à la
    création, il faut la reconstruire pour qu'elle voie `closeuse_id`."""
    texte = open(os.path.join(MIG, "0015_radar_identite_ventes.sql"), encoding="utf-8").read().replace("\r\n", "\n")
    debut = texte.index("create view public.radar_bookings_effective")
    fin = texte.index("\n  ) e;\n", debut) + len("\n  ) e;\n")
    return "drop view if exists public.radar_bookings_effective;\n\n" + texte[debut:fin]


def main():
    tete = open(os.path.join(RACINE, "scripts", "0036-tete.sql"), encoding="utf-8").read()
    queue = open(os.path.join(RACINE, "scripts", "0036-queue.sql"), encoding="utf-8").read()
    assert tete.count("-- @@VUE@@\n") == 1
    tete = tete.replace("-- @@VUE@@\n", vue())
    blocs = []
    for fichier, nom in FONCTIONS:
        blocs.append(f"-- {nom} : recopiée de {fichier}, seule la garde change.\n" + extraire(fichier, nom))
    sortie = tete + "\n".join(blocs) + "\n" + queue
    assert sortie.count("radar_peut_saisir(rdv.organization_id, rdv.closeuse_id)") >= len(FONCTIONS)
    open(os.path.join(MIG, "0036_radar_closeuses.sql"), "w", encoding="utf-8", newline="\n").write(sortie)
    print("ok", len(sortie), "caractères")


if __name__ == "__main__":
    main()
