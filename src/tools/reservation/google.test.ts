import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deballer, emballer, memeEtat, nouvelEtat } from "./etat.ts";
import {
  adresseConsentement,
  agendaExiste,
  creerAgenda,
  corpsEvenement,
  creerEvenement,
  echangerCode,
  effacerEvenement,
  emailDuJeton,
  ErreurGoogle,
  idEvenement,
  jetonAcces,
  occupe,
  teinterConfie,
} from "./google.ts";

type Appel = { url: string; init?: RequestInit };

/** Un faux Google : chaque appel reçoit la réponse suivante de la liste. */
function faux(reponses: { status?: number; corps?: unknown }[]) {
  const appels: Appel[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    appels.push({ url: String(url), init });
    const r = reponses.shift() ?? { status: 500, corps: {} };
    return new Response(r.corps === undefined ? "" : JSON.stringify(r.corps), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, appels };
}

const ids = { clientId: "client.apps.googleusercontent.com", clientSecret: "GOCSPX-test" };
const jeton = (charge: object) => `x.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.y`;
const RDV = "0b8a1c2e-3f4d-4a5b-8c6d-7e8f9a0b1c2d";

describe("Google : connecter", () => {
  it("demande l'accès hors ligne, les quatre droits, et redonne le jeton à chaque fois", () => {
    const u = new URL(adresseConsentement({ clientId: "c", retour: "https://app.cometestudio.fr/r", etat: "e", email: "a@b.fr" }));
    assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(u.searchParams.get("access_type"), "offline");
    assert.equal(u.searchParams.get("prompt"), "consent");
    assert.equal(u.searchParams.get("state"), "e");
    assert.equal(u.searchParams.get("login_hint"), "a@b.fr");
    assert.deepEqual(u.searchParams.get("scope")?.split(" "), [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.app.created",
    ]);
  });

  it("la titulaire : le droit de modifier ses événements en plus (07/10/2026)", () => {
    const u = new URL(adresseConsentement({ clientId: "c", retour: "https://app.cometestudio.fr/r", etat: "e", modifier: true }));
    assert.deepEqual(u.searchParams.get("scope")?.split(" ").slice(-1), ["https://www.googleapis.com/auth/calendar.events"]);
  });

  it("échange le code, lit l'adresse et les droits accordés", async () => {
    const { f, appels } = faux([
      {
        corps: {
          refresh_token: "1//r",
          access_token: "ya29.a",
          scope: "openid https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.freebusy",
          id_token: jeton({ email: "closeuse@gmail.com" }),
        },
      },
    ]);
    const c = await echangerCode("code", "https://app.cometestudio.fr/r", ids, f);
    assert.deepEqual(c, { jetonRafraichissement: "1//r", jetonAcces: "ya29.a", email: "closeuse@gmail.com", droitsManquants: [] });
    const corps = new URLSearchParams(String(appels[0].init?.body));
    assert.equal(corps.get("grant_type"), "authorization_code");
    assert.equal(corps.get("redirect_uri"), "https://app.cometestudio.fr/r");
  });

  it("repère une case d'agenda décochée", async () => {
    const { f } = faux([{ corps: { refresh_token: "1//r", scope: "openid https://www.googleapis.com/auth/calendar.freebusy" } }]);
    const c = await echangerCode("code", "r", ids, f);
    assert.deepEqual(c.droitsManquants, ["https://www.googleapis.com/auth/calendar.app.created"]);
  });

  it("sans jeton de rafraîchissement, c'est une erreur", async () => {
    const { f } = faux([{ corps: { access_token: "a", scope: "" } }]);
    await assert.rejects(echangerCode("code", "r", ids, f), ErreurGoogle);
  });

  it("un jeton d'identité illisible ne donne pas d'adresse", () => {
    assert.equal(emailDuJeton("pas-un-jeton"), null);
    assert.equal(emailDuJeton(undefined), null);
  });

  it("un accès retiré se reconnaît (invalid_grant), avec la raison de Google", async () => {
    const { f } = faux([{ status: 400, corps: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
    await assert.rejects(jetonAcces("1//r", ids, f), (e: unknown) => {
      assert.ok(e instanceof ErreurGoogle);
      assert.equal(e.accesRetire, true);
      assert.match(e.message, /Token has been expired or revoked/);
      return true;
    });
  });
});

describe("Google : l'occupé", () => {
  it("rend les plages occupées en millisecondes", async () => {
    const { f, appels } = faux([
      {
        corps: {
          calendars: {
            primary: { busy: [{ start: "2026-10-05T07:00:00Z", end: "2026-10-05T08:00:00Z" }] },
          },
        },
      },
    ]);
    const r = await occupe("acces", "primary", Date.parse("2026-10-05T00:00:00Z"), Date.parse("2026-10-06T00:00:00Z"), f);
    assert.deepEqual(r, [{ debut: Date.parse("2026-10-05T07:00:00Z"), fin: Date.parse("2026-10-05T08:00:00Z") }]);
    assert.equal(appels[0].url, "https://www.googleapis.com/calendar/v3/freeBusy");
    assert.equal(new Headers(appels[0].init?.headers).get("authorization"), "Bearer acces");
  });

  it("un agenda que Google n'a pas pu lire n'est pas un agenda libre", async () => {
    const { f } = faux([{ corps: { calendars: { primary: { errors: [{ reason: "notFound" }] } } } }]);
    await assert.rejects(occupe("a", "primary", 0, 1, f), /notFound/);
  });
});

describe("Google : l'agenda « Diagnostics »", () => {
  it("se crée à son fuseau, et rend son identifiant", async () => {
    const { f, appels } = faux([{ corps: { id: "abc@group.calendar.google.com" } }]);
    assert.equal(await creerAgenda("a", "America/Montreal", f), "abc@group.calendar.google.com");
    assert.equal(appels[0].url, "https://www.googleapis.com/calendar/v3/calendars");
    const corps = JSON.parse(String(appels[0].init?.body));
    assert.equal(corps.summary, "Diagnostics");
    assert.equal(corps.timeZone, "America/Montreal");
  });

  it("supprimé de son côté : il n'existe plus, on en refera un", async () => {
    assert.equal(await agendaExiste("a", "x", faux([{ status: 404 }]).f), false);
    assert.equal(await agendaExiste("a", "x", faux([{ status: 403 }]).f), false);
    assert.equal(await agendaExiste("a", "x", faux([{ corps: { id: "x" } }]).f), true);
    await assert.rejects(agendaExiste("a", "x", faux([{ status: 500, corps: {} }]).f), ErreurGoogle);
  });
});

describe("Google : écrire le rendez-vous", () => {
  it("l'identifiant de l'événement est celui du rendez-vous, sans tirets", () => {
    assert.equal(idEvenement(RDV), "0b8a1c2e3f4d4a5b8c6d7e8f9a0b1c2d");
  });

  it("avec Meet : une demande de visio, sans invitée ni envoi de Google", () => {
    const c = corpsEvenement({
      id: "abc12", debut: "d", fin: "f", titre: "Diagnostic · Camille", description: "x",
      visio: { type: "meet", cle: RDV },
    });
    assert.deepEqual(c.conferenceData, {
      createRequest: { requestId: RDV, conferenceSolutionKey: { type: "hangoutsMeet" } },
    });
    assert.equal(c.attendees, undefined);
    assert.equal(c.location, undefined);
  });

  it("une notification 5 min avant, pour lancer l'enregistrement du diagnostic", () => {
    const c = corpsEvenement({
      id: "abc12", debut: "d", fin: "f", titre: "t", description: "x",
      visio: { type: "meet", cle: RDV },
    });
    const rappels = c.reminders as { useDefault: boolean; overrides: { method: string; minutes: number }[] };
    assert.equal(rappels.useDefault, false);
    assert.ok(rappels.overrides.some((r) => r.method === "popup" && r.minutes === 5));
  });

  it("avec un lien fixe : le lien en lieu et dans la description, pas de Meet", () => {
    const c = corpsEvenement({
      id: "abc12", debut: "d", fin: "f", titre: "t", description: "x",
      visio: { type: "lien", lien: "https://zoom.us/j/123" },
    });
    assert.equal(c.conferenceData, undefined);
    assert.equal(c.location, "https://zoom.us/j/123");
    assert.match(String(c.description), /Visio : https:\/\/zoom\.us\/j\/123/);
  });

  it("rend le lien Meet, et relit tant que Google ne l'a pas posé", async () => {
    const meet = { conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } };
    const { f, appels } = faux([{ corps: { id: "x" } }, { corps: {} }, { corps: meet }]);
    const r = await creerEvenement(
      "a", "primary",
      { id: idEvenement(RDV), debut: "d", fin: "f", titre: "t", description: "x", visio: { type: "meet", cle: RDV } },
      f, async () => undefined,
    );
    assert.deepEqual(r, { id: idEvenement(RDV), lienVisio: "https://meet.google.com/abc-defg-hij" });
    assert.match(appels[0].url, /conferenceDataVersion=1&sendUpdates=none$/);
    assert.equal(appels.length, 3);
  });

  it("déjà écrit (409) : on relit l'existant au lieu d'en créer un second", async () => {
    const meet = { conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/x" }] } };
    const { f, appels } = faux([{ status: 409, corps: { error: { message: "The requested identifier already exists." } } }, { corps: meet }]);
    const r = await creerEvenement(
      "a", "primary",
      { id: idEvenement(RDV), debut: "d", fin: "f", titre: "t", description: "x", visio: { type: "meet", cle: RDV } },
      f, async () => undefined,
    );
    assert.equal(r.lienVisio, "https://meet.google.com/x");
    assert.equal(appels.length, 2);
    assert.equal(appels[1].init?.method, undefined);
  });

  it("refuse un identifiant que Google n'accepterait pas", async () => {
    const { f } = faux([]);
    await assert.rejects(
      creerEvenement("a", "p", { id: "zz-pas-bon", debut: "d", fin: "f", titre: "t", description: "x", visio: { type: "meet", cle: "k" } }, f),
      /identifiant/,
    );
  });

  it("effacer un événement déjà parti n'est pas une erreur", async () => {
    const { f } = faux([{ status: 410 }]);
    await effacerEvenement("a", "primary", "abc12", f);
  });
});

describe("le témoin de connexion", () => {
  it("s'emballe et se déballe", () => {
    const e = nouvelEtat(RDV, "peggy");
    assert.deepEqual(deballer(emballer(e)), e);
    assert.equal(e.etat.length, 64);
  });

  it("refuse un cookie trafiqué", () => {
    const e = nouvelEtat(RDV, "peggy");
    assert.equal(deballer(`${e.etat}.${RDV}.peggy.encore`), null);
    assert.equal(deballer(`court.${RDV}.peggy`), null);
    assert.equal(deballer(`${e.etat}.pas-un-uuid.peggy`), null);
    assert.equal(deballer(`${e.etat}.${RDV}.Peggy Girault`), null);
    assert.equal(deballer(undefined), null);
  });

  it("compare le témoin reçu à celui du cookie", () => {
    const e = nouvelEtat(RDV, "peggy");
    assert.equal(memeEtat(e.etat, e.etat), true);
    assert.equal(memeEtat(nouvelEtat(RDV, "peggy").etat, e.etat), false);
    assert.equal(memeEtat(null, e.etat), false);
  });
});

describe("Google : un rendez-vous Calendly confié, en Tomate et Disponible (07/10/2026)", () => {
  const r = { debut: "2026-10-08T16:30:00Z", fin: "2026-10-08T17:15:00Z", email: "Sandrine@Exemple.fr" };

  it("retrouve l'événement (même début, la cliente invitée) et le passe en Tomate, sans prévenir personne", async () => {
    const { f, appels } = faux([
      {
        corps: {
          items: [
            { id: "autre", start: { dateTime: "2026-10-08T18:30:00+02:00" }, attendees: [{ email: "x@y.fr" }] },
            { id: "calendly1", start: { dateTime: "2026-10-08T18:30:00+02:00" }, attendees: [{ email: "girault.peggy@gmail.com" }, { email: "sandrine@exemple.fr" }] },
          ],
        },
      },
      { corps: { id: "calendly1" } },
    ]);
    assert.equal(await teinterConfie("ya29", r, f), "teinte");
    assert.match(appels[1].url, /\/calendars\/primary\/events\/calendly1\?sendUpdates=none$/);
    assert.equal(appels[1].init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(appels[1].init?.body)), { colorId: "11", transparency: "transparent" });
  });

  it("à défaut de l'adresse, retrouve l'événement par le nom dans le titre", async () => {
    const { f, appels } = faux([
      { corps: { items: [{ id: "cal2", summary: "Virginie Rouhaud et Peggy Girault", start: { dateTime: "2026-10-08T18:30:00+02:00" }, attendees: [{ email: "autre@x.fr" }] }] } },
      { corps: { id: "cal2" } },
    ]);
    assert.equal(await teinterConfie("ya29", { ...r, nom: "Virginie Rouhaud" }, f), "teinte");
    assert.match(appels[1].url, /events\/cal2\?/);
  });

  it("ne touche à rien si l'événement n'est pas trouvé", async () => {
    const { f, appels } = faux([{ corps: { items: [{ id: "a", start: { dateTime: "2026-10-08T18:30:00+02:00" }, attendees: [] }] } }]);
    assert.equal(await teinterConfie("ya29", r, f), "introuvable");
    assert.equal(appels.length, 1);
  });

  it("sans le droit de modifier : le dit, sans erreur", async () => {
    const { f } = faux([{ status: 403, corps: { error: { message: "insufficient" } } }]);
    assert.equal(await teinterConfie("ya29", r, f), "sans_droit");
  });
});
