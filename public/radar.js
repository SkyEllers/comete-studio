/*!
 * radar.js — Comète Studio
 *
 * À poser sur la landing d'un client suivi par Radar :
 *
 *     <script src="https://cometestudio.fr/radar.js" defer></script>
 *
 * Ce que fait ce script, et rien d'autre : à l'arrivée du visiteur, il note
 * les paramètres de campagne présents dans l'adresse (utm_*, gclid, fbclid,
 * ttclid) et les rajoute aux liens de prise de rendez-vous Calendly. C'est
 * ainsi que Radar sait d'où vient une réservation.
 *
 * Ce qu'il ne fait pas : aucun cookie, aucune requête sortante, aucun
 * identifiant de personne. Tout vit dans le `sessionStorage` de l'onglet et
 * disparaît à sa fermeture — c'est pourquoi aucun bandeau de consentement
 * n'est nécessaire.
 *
 * Deux règles méritent d'être connues.
 *
 * Le premier contact gagne : si la visite a commencé par une annonce, elle
 * reste attribuée à cette annonce même si le visiteur revient ensuite par un
 * lien direct dans le même onglet.
 *
 * Un identifiant de clic seul est traduit en utm_*. Calendly ne relaie que les
 * `utm_*` dans ses webhooks : un `gclid` seul n'arriverait jamais jusqu'à
 * Radar. On pose donc les utm_* correspondants — mais jamais par-dessus ceux
 * qui sont déjà là : une campagne correctement taguée fait toujours foi.
 */
(function () {
  "use strict";

  var CLE = "comete:radar:utm";

  /** L'identifiant de clic d'une régie, et ce qu'il vaut en utm_*. */
  var REGIES = {
    gclid: ["google", "cpc"],
    fbclid: ["facebook", "paid"],
    ttclid: ["tiktok", "paid"],
  };

  /* Le stockage peut lever : navigation privée, réglages restrictifs. Ce n'est
     pas une raison pour casser la page du client. */
  function lire() {
    try {
      var brut = window.sessionStorage.getItem(CLE);
      return brut ? JSON.parse(brut) : null;
    } catch {
      return null;
    }
  }

  function ecrire(valeur) {
    try {
      window.sessionStorage.setItem(CLE, JSON.stringify(valeur));
    } catch {
      /* tant pis : la visite ne portera pas d'attribution */
    }
  }

  /** Ce que l'adresse d'arrivée porte de campagne. */
  function depuisAdresse() {
    var trouve = {};
    var params;

    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return trouve;
    }

    params.forEach(function (valeur, cle) {
      if (!valeur) return;
      if (cle.indexOf("utm_") === 0 || REGIES[cle]) {
        trouve[cle] = String(valeur).slice(0, 200);
      }
    });

    return trouve;
  }

  /** Un identifiant de clic devient une campagne, s'il n'y en a pas déjà une. */
  function traduire(params) {
    if (params.utm_source) return params;

    for (var cle in REGIES) {
      if (Object.prototype.hasOwnProperty.call(REGIES, cle) && params[cle]) {
        params.utm_source = REGIES[cle][0];
        params.utm_medium = REGIES[cle][1];
        return params;
      }
    }

    return params;
  }

  var memoire = lire();

  if (!memoire) {
    var arrivee = depuisAdresse();
    for (var premiere in arrivee) {
      if (Object.prototype.hasOwnProperty.call(arrivee, premiere)) {
        memoire = traduire(arrivee);
        ecrire(memoire);
        break;
      }
    }
  }

  // Aucune campagne à propager : le script s'arrête là, sans rien écouter.
  if (!memoire) return;

  /** L'adresse enrichie, ou `null` si ce n'est pas du Calendly ou si rien ne change. */
  function enrichir(adresse) {
    if (!adresse) return null;

    var url;
    try {
      url = new URL(adresse, window.location.href);
    } catch {
      return null;
    }

    if (!/(^|\.)calendly\.com$/i.test(url.hostname)) return null;

    var change = false;
    for (var cle in memoire) {
      if (
        Object.prototype.hasOwnProperty.call(memoire, cle) &&
        !url.searchParams.has(cle)
      ) {
        url.searchParams.set(cle, memoire[cle]);
        change = true;
      }
    }

    return change ? url.toString() : null;
  }

  /* Au clic, en phase de capture : on réécrit l'adresse du lien avant que le
     navigateur ne parte dessus. Vaut aussi pour les liens qui s'ouvrent dans
     un nouvel onglet. */
  document.addEventListener(
    "click",
    function (evenement) {
      var cible = evenement.target;
      var lien = cible && cible.closest ? cible.closest("a[href]") : null;
      if (!lien) return;

      var enrichi = enrichir(lien.getAttribute("href"));
      if (enrichi) lien.setAttribute("href", enrichi);
    },
    true,
  );

  /** Les embarqués Calendly, qui lisent leur adresse dans `data-url`. */
  function traiterEmbarques(racine) {
    if (!racine || !racine.querySelectorAll) return;

    var noeuds = racine.querySelectorAll("[data-url]");
    for (var i = 0; i < noeuds.length; i++) {
      var enrichi = enrichir(noeuds[i].getAttribute("data-url"));
      if (enrichi) noeuds[i].setAttribute("data-url", enrichi);
    }
  }

  /* Les fenêtres et badges Calendly reçoivent leur adresse en JavaScript, pas
     dans le HTML : on enveloppe leurs fonctions dès que leur script est là. */
  function envelopperCalendly() {
    var api = window.Calendly;
    if (!api || api.__radar) return;

    ["initInlineWidget", "initPopupWidget", "initBadgeWidget"].forEach(function (nom) {
      var original = api[nom];
      if (typeof original !== "function") return;

      api[nom] = function (options) {
        if (options && options.url) {
          var enrichi = enrichir(options.url);
          if (enrichi) options.url = enrichi;
        }
        return original.apply(this, arguments);
      };
    });

    api.__radar = true;
  }

  function passer() {
    traiterEmbarques(document);
    envelopperCalendly();
  }

  passer();
  document.addEventListener("DOMContentLoaded", passer);
  window.addEventListener("load", passer);

  /* Une landing qui monte ses blocs après coup — un constructeur de sites, un
     onglet qui s'ouvre — poserait ses embarqués trop tard pour les passages
     ci-dessus. */
  if (window.MutationObserver) {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var ajouts = mutations[i].addedNodes;
        for (var j = 0; j < ajouts.length; j++) {
          if (ajouts[j].nodeType === 1) traiterEmbarques(ajouts[j]);
        }
      }
      envelopperCalendly();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
