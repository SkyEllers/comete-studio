/*!
 * sonde.js — Comète Studio
 *
 *     <script src="https://cometestudio.fr/sonde.js" data-site="JETON" defer></script>
 *
 * Deux événements, pas un de plus : une page vue à l'arrivée, un clic quand le
 * visiteur part vers Calendly.
 *
 * Aucun cookie, aucun stockage, aucun identifiant : il ne garde rien entre
 * deux pages et ne peut pas savoir qui vous êtes. Les visiteurs uniques se
 * comptent sur le serveur, avec une empreinte qui change chaque nuit et que
 * personne ne conserve — d'où l'absence de bandeau à accepter.
 *
 * Il envoie le chemin de la page (jamais ce qui suit le « ? »), l'hôte du
 * référent (jamais l'adresse), les paramètres de campagne, et le type
 * d'événement. Rien d'autre, et jamais au prix d'une erreur dans la console.
 */
(function () {
  "use strict";

  /* `currentScript` est juste avec `defer` ; le repli sert aux intégrations
     qui recopient la balise. */
  var balise = document.currentScript;
  if (!balise && document.querySelectorAll) {
    var trouvees = document.querySelectorAll("script[data-site]");
    balise = trouvees.length ? trouvees[trouvees.length - 1] : null;
  }

  var jeton = balise && balise.getAttribute ? balise.getAttribute("data-site") : null;

  // Sans jeton, rien à dire : le script ne s'accroche à rien.
  if (!jeton) return;

  /* Le point de collecte se déduit de l'adresse du script : une préproduction
     mesure dans sa base sans qu'on touche à la balise. */
  var origine = "https://cometestudio.fr";
  try {
    if (balise.src) origine = new URL(balise.src).origin;
  } catch {
    /* on garde l'origine par défaut */
  }
  var POINT = origine + "/api/sonde/" + encodeURIComponent(jeton);

  /** Les identifiants de clic des régies, retenus comme les `utm_*`. */
  var REGIES = { gclid: 1, fbclid: 1, ttclid: 1 };

  function campagne() {
    var trouve = {};
    try {
      new URLSearchParams(window.location.search).forEach(function (valeur, cle) {
        if (!valeur) return;
        // `hasOwnProperty` : sans lui, `?constructor=1` passerait pour une régie.
        if (cle.indexOf("utm_") === 0 || Object.prototype.hasOwnProperty.call(REGIES, cle)) {
          trouve[cle] = String(valeur).slice(0, 200);
        }
      });
    } catch {
      /* pas de campagne lisible : ce n'est pas une raison de ne rien envoyer */
    }
    return trouve;
  }

  /** L'hôte du référent, jamais l'adresse : la recherche ne nous regarde pas. */
  function referent() {
    try {
      if (!document.referrer) return null;
      return new URL(document.referrer).hostname.toLowerCase() || null;
    } catch {
      return null;
    }
  }

  /*
   * `sendBeacon` d'abord : il survit à la navigation, ce qui compte pour un
   * clic qui emmène ailleurs. Une chaîne plutôt qu'un `Blob` — la spécification
   * lui donne alors le type `text/plain`, celui qui évite un prévol CORS.
   *
   * Il rend `false` quand sa file est pleine et lève dans quelques navigateurs
   * bridés : les deux cas retombent sur `fetch` en `keepalive`. Si celui-là
   * échoue aussi, on se tait — mesurer une page ne vaut pas d'y faire
   * apparaître une erreur.
   */
  function envoyer(type) {
    var corps;
    try {
      corps = JSON.stringify({
        e: type,
        p: window.location.pathname,
        r: referent(),
        u: campagne(),
      });
    } catch {
      return;
    }

    try {
      if (window.navigator && window.navigator.sendBeacon) {
        if (window.navigator.sendBeacon(POINT, corps)) return;
      }
    } catch {
      /* on tente le repli */
    }

    try {
      window
        .fetch(POINT, {
          method: "POST",
          body: corps,
          keepalive: true,
          mode: "cors",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
        })
        .catch(function () {});
    } catch {
      /* silence */
    }
  }

  var vue = false;
  var clic = false;

  function pageVue() {
    if (vue) return;
    vue = true;
    envoyer("pageview");
  }

  // Un seul clic par page affichée : qui hésite et clique trois fois n'a pas
  // eu trois intentions.
  function reserver() {
    if (clic) return;
    clic = true;
    envoyer("cta");
  }

  function versCalendly(adresse) {
    if (!adresse) return false;
    try {
      return /(^|\.)calendly\.com$/i.test(new URL(adresse, window.location.href).hostname);
    } catch {
      return false;
    }
  }

  pageVue();

  /* Un retour par « précédent » ne relance pas la page : le navigateur la
     ressort de son cache. C'est pourtant une nouvelle vue — et le clic repart
     aussi, sans quoi qui revient de Calendly pour prendre un autre créneau ne
     serait jamais compté. */
  window.addEventListener("pageshow", function (evenement) {
    if (!evenement || !evenement.persisted) return;
    vue = false;
    clic = false;
    pageVue();
  });

  /* En capture, sur le document : les liens montés après coup par un
     constructeur de sites sont couverts sans rien réobserver. */
  document.addEventListener(
    "click",
    function (evenement) {
      var cible = evenement && evenement.target;
      if (!cible || !cible.closest) return;

      // Le repère posé à la main, quand le bouton n'est pas un lien.
      if (cible.closest('[data-sonde="cta"]')) return reserver();

      var lien = cible.closest("a[href]");
      if (lien && versCalendly(lien.getAttribute("href"))) reserver();
    },
    true,
  );

  /*
   * Les fenêtres Calendly s'ouvrent en JavaScript, sans lien à cliquer. On
   * n'enveloppe que celles qui ouvrent quelque chose : radar.js enveloppe
   * aussi `initInlineWidget`, mais un agenda embarqué s'initialise au
   * chargement, et le compter donnerait à toute landing un taux de clic de
   * cent pour cent.
   *
   * `__sonde` marque le passage comme `__radar` chez le voisin : les deux
   * scripts enveloppent les mêmes fonctions, chacun appelle celle qu'il a
   * trouvée, et l'ordre de chargement ne change rien.
   */
  function envelopperCalendly() {
    var api = window.Calendly;
    if (!api || api.__sonde) return;

    ["initPopupWidget", "showPopupWidget"].forEach(function (nom) {
      var original = api[nom];
      if (typeof original !== "function") return;

      api[nom] = function () {
        reserver();
        return original.apply(this, arguments);
      };
    });

    api.__sonde = true;
  }

  envelopperCalendly();
  document.addEventListener("DOMContentLoaded", envelopperCalendly);
  window.addEventListener("load", envelopperCalendly);

  /* Le script de Calendly peut arriver après le nôtre. */
  if (window.MutationObserver) {
    new MutationObserver(envelopperCalendly).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
