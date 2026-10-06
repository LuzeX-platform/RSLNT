// Integratietest over de echte API + database. Draait alleen met TEST_DATABASE_URL gezet
// (een lege, wegwerpbare database — de tabellen worden leeggemaakt!). Lokaal:
//   TEST_DATABASE_URL=postgresql://…/rslnt_test npx prisma migrate deploy
//   TEST_DATABASE_URL=postgresql://…/rslnt_test npm test
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe("API", { skip: !TEST_DB && "TEST_DATABASE_URL niet gezet" }, () => {
  process.env.DATABASE_URL = TEST_DB;
  process.env.JWT_SECRET ??= "test-geheim";

  let app: import("fastify").FastifyInstance;
  let prisma: import("@prisma/client").PrismaClient;
  let cookie = "";

  type Antwoord = { statusCode: number; json: () => any; headers: Record<string, unknown> };
  async function vraag(method: string, url: string, payload?: unknown): Promise<Antwoord> {
    return app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie } });
  }

  before(async () => {
    ({ prisma } = await import("../src/db.js"));
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Gebruiker", "Oefening", "Schema", "SchemaOefening", "Training", "TrainingOefening", "TrainingSet", "Lichaamsgewicht" CASCADE',
    );
    const { hashWachtwoord } = await import("../src/auth.js");
    await prisma.gebruiker.create({
      data: { email: "ik@test.nl", naam: "Ik", wachtwoordHash: await hashWachtwoord("goed-wachtwoord") },
    });
    // Het echte startschema, zodat de test ook de seed-data controleert.
    const { STANDAARD_OEFENINGEN, STANDAARD_SCHEMAS } = await import("../src/standaardSchema.js");
    const ids = new Map<string, string>();
    for (const o of STANDAARD_OEFENINGEN) {
      const rij = await prisma.oefening.create({
        data: { naam: o.naam, materiaal: o.materiaal, gewichtsstap: o.gewichtsstap, perKant: o.perKant ?? false },
      });
      ids.set(o.naam, rij.id);
    }
    for (const [volgorde, s] of STANDAARD_SCHEMAS.entries()) {
      await prisma.schema.create({
        data: {
          id: s.id,
          naam: s.naam,
          volgorde,
          oefeningen: {
            create: s.regels.map((r, i) => ({
              oefeningId: ids.get(r.oefening)!,
              volgorde: i,
              aantalSets: r.aantalSets,
              minSets: r.minSets,
              repsMin: r.repsMin,
              repsMax: r.repsMax,
              supersetGroep: r.supersetGroep ?? null,
            })),
          },
        },
      });
    }
    const { bouwApp } = await import("../src/app.js");
    app = await bouwApp({ logger: false });
  });

  after(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  test("zonder login geen toegang", async () => {
    assert.equal((await vraag("GET", "/api/vandaag")).statusCode, 401);
    assert.equal((await vraag("GET", "/api/gezondheid")).statusCode, 200);
  });

  test("inloggen: fout wachtwoord geweigerd, goed wachtwoord geeft een sessiecookie", async () => {
    const fout = await vraag("POST", "/api/auth/inloggen", { email: "ik@test.nl", wachtwoord: "fout" });
    assert.equal(fout.statusCode, 401);
    const goed = await vraag("POST", "/api/auth/inloggen", { email: "IK@test.nl", wachtwoord: "goed-wachtwoord" });
    assert.equal(goed.statusCode, 200);
    const header = goed.headers["set-cookie"];
    cookie = (Array.isArray(header) ? header[0] : String(header)).split(";")[0];
    const sessie = (await vraag("GET", "/api/auth/sessie")).json();
    assert.equal(sessie.gebruiker.email, "ik@test.nl");
  });

  test("schrijven met een vreemde Origin wordt geweigerd", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/trainingen",
      payload: { schemaId: "A" },
      headers: { cookie, origin: "https://kwaadaardig.example", host: "localhost:80" },
    });
    assert.equal(res.statusCode, 403);
  });

  let trainingId = "";

  test("eerste training: A is aan de beurt, nog geen voorstel", async () => {
    const vandaag = (await vraag("GET", "/api/vandaag")).json();
    assert.equal(vandaag.volgendeSchema.id, "A");
    assert.equal(vandaag.bezig, null);

    const start = await vraag("POST", "/api/trainingen", { schemaId: "A" });
    assert.equal(start.statusCode, 200);
    trainingId = start.json().id;

    const detail = (await vraag("GET", `/api/trainingen/${trainingId}`)).json();
    assert.equal(detail.oefeningen.length, 7);
    assert.equal(detail.oefeningen[0].naam, "Goblet squat");
    assert.equal(detail.oefeningen[0].voorstel.actie, "eerste_keer");
    assert.equal(detail.oefeningen[0].vorigeKeer, null);
  });

  test("een tweede training starten terwijl er een bezig is: 409 met het id", async () => {
    const res = await vraag("POST", "/api/trainingen", { schemaId: "B" });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().id, trainingId);
  });

  test("sets loggen is idempotent en valideert de invoer", async () => {
    const detail = (await vraag("GET", `/api/trainingen/${trainingId}`)).json();
    const goblet = detail.oefeningen[0];
    const squatUrl = (n: number) => `/api/trainingen/${trainingId}/oefeningen/${goblet.id}/sets/${n}`;

    for (const n of [1, 2, 3]) {
      const res = await vraag("PUT", squatUrl(n), { gewicht: 20, reps: 10, rir: 2, kniepijn: n === 3 ? 1 : null });
      assert.equal(res.statusCode, 200);
    }
    // Dezelfde set nog eens (offline-wachtrij): overschrijft, geen vierde set.
    await vraag("PUT", squatUrl(3), { gewicht: 20, reps: 10, rir: 1, kniepijn: 1 });

    assert.equal((await vraag("PUT", squatUrl(4), { gewicht: 20, reps: 10, rir: 9, kniepijn: null })).statusCode, 400);
    assert.equal((await vraag("PUT", squatUrl(4), { gewicht: 20, reps: 10, rir: 1, kniepijn: 11 })).statusCode, 400);

    // Bench: één set onder de bovenkant.
    const bench = detail.oefeningen[1];
    for (const [n, reps] of [[1, 10], [2, 10], [3, 9]]) {
      await vraag("PUT", `/api/trainingen/${trainingId}/oefeningen/${bench.id}/sets/${n}`, {
        gewicht: 24, reps, rir: 1, kniepijn: null,
      });
    }

    const na = (await vraag("GET", `/api/trainingen/${trainingId}`)).json();
    assert.equal(na.oefeningen[0].sets.length, 3);
    assert.equal(na.oefeningen[0].sets[2].rir, 1);

    // Een set van een andere training kan niet via deze training.
    const vreemd = await vraag("PUT", `/api/trainingen/onbekend/oefeningen/${goblet.id}/sets/1`, {
      gewicht: 1, reps: 1, rir: null, kniepijn: null,
    });
    assert.equal(vreemd.statusCode, 404);
  });

  test("afronden geeft het voorstel voor de volgende keer", async () => {
    await vraag("PATCH", `/api/trainingen/${trainingId}`, { notitie: "Knie voelde goed." });
    const res = await vraag("POST", `/api/trainingen/${trainingId}/afronden`);
    assert.equal(res.statusCode, 200);
    const detail = res.json();
    assert.equal(detail.training.status, "afgerond");
    assert.equal(detail.training.notitie, "Knie voelde goed.");
    assert.equal(detail.oefeningen[0].volgendeKeer.actie, "omhoog");
    assert.equal(detail.oefeningen[0].volgendeKeer.gewicht, 22);
    assert.equal(detail.oefeningen[1].volgendeKeer.actie, "gelijk");
    assert.equal(detail.oefeningen[1].volgendeKeer.gewicht, 24);
    // Overgeslagen oefening: nog steeds geen geschiedenis.
    assert.equal(detail.oefeningen[2].volgendeKeer.actie, "eerste_keer");
  });

  test("volgende training: B is aan de beurt; daarna A met het voorstel en de vorige keer", async () => {
    assert.equal((await vraag("GET", "/api/vandaag")).json().volgendeSchema.id, "B");

    const b = (await vraag("POST", "/api/trainingen", { schemaId: "B" })).json().id;
    const bDetail = (await vraag("GET", `/api/trainingen/${b}`)).json();
    assert.equal(bDetail.oefeningen.find((o: any) => o.naam === "Biceps curl").supersetGroep, "1");
    await vraag("POST", `/api/trainingen/${b}/afronden`);

    const a = (await vraag("POST", "/api/trainingen", { schemaId: "A" })).json().id;
    const detail = (await vraag("GET", `/api/trainingen/${a}`)).json();
    const goblet = detail.oefeningen[0];
    assert.equal(goblet.voorstel.actie, "omhoog");
    assert.equal(goblet.voorstel.gewicht, 22);
    assert.deepEqual(goblet.vorigeKeer.sets.map((s: any) => s.reps), [10, 10, 10]);

    // Kniepijn 5 in deze training → de keer daarna 10% terug, ook al zat alles op 10.
    for (const n of [1, 2, 3]) {
      await vraag("PUT", `/api/trainingen/${a}/oefeningen/${goblet.id}/sets/${n}`, {
        gewicht: 22, reps: 10, rir: 1, kniepijn: n === 2 ? 5 : 2,
      });
    }
    const na = (await vraag("POST", `/api/trainingen/${a}/afronden`)).json();
    assert.equal(na.oefeningen[0].volgendeKeer.actie, "terug");
    assert.equal(na.oefeningen[0].volgendeKeer.gewicht, 18); // 22 × 0,9 = 19,8 → 18 bij stappen van 2
    assert.equal(na.oefeningen[0].volgendeKeer.kniepijnRegel, true);
  });

  test("schema aanpassen raakt de geschiedenis niet", async () => {
    const { schemas } = (await vraag("GET", "/api/schemas")).json();
    const a = schemas.find((s: any) => s.id === "A");
    const regels = a.oefeningen.map((r: any) => ({
      oefeningId: r.oefeningId,
      aantalSets: r.aantalSets,
      minSets: r.minSets,
      repsMin: r.repsMin,
      repsMax: r.repsMax,
      supersetGroep: r.supersetGroep,
    }));
    regels[0].repsMax = 12;
    regels.pop(); // dead bug eruit
    assert.equal((await vraag("PUT", "/api/schemas/A", { oefeningen: regels })).statusCode, 200);

    const fout = await vraag("PUT", "/api/schemas/A", { oefeningen: [{ ...regels[0], repsMin: 12, repsMax: 8 }] });
    assert.equal(fout.statusCode, 400);
    const dubbel = await vraag("PUT", "/api/schemas/A", { oefeningen: [regels[0], regels[0]] });
    assert.equal(dubbel.statusCode, 400);

    const { trainingen } = (await vraag("GET", "/api/trainingen")).json();
    const eerste = (await vraag("GET", `/api/trainingen/${trainingen.at(-1).id}`)).json();
    assert.equal(eerste.oefeningen.length, 7);
    assert.equal(eerste.oefeningen[0].repsMax, 10);
  });

  test("oefening toevoegen en aanpassen", async () => {
    const nieuw = await vraag("POST", "/api/oefeningen", {
      naam: "Leg press", materiaal: "machine", gewichtsstap: 5, perKant: false,
    });
    assert.equal(nieuw.statusCode, 200);
    const id = nieuw.json().oefening.id;
    assert.equal((await vraag("POST", "/api/oefeningen", {
      naam: "Leg press", materiaal: "machine", gewichtsstap: 5, perKant: false,
    })).statusCode, 409);
    const gewijzigd = (await vraag("PATCH", `/api/oefeningen/${id}`, { materiaal: "lichaamsgewicht" })).json();
    assert.equal(gewijzigd.oefening.gewichtsstap, 0);
  });

  test("lichaamsgewicht met 7-daags gemiddelde", async () => {
    const { verschuifDag, vandaag } = await import("../src/datum.js");
    const dag = vandaag();
    await vraag("PUT", `/api/lichaamsgewicht/${verschuifDag(dag, -2)}`, { gewicht: 81 });
    await vraag("PUT", `/api/lichaamsgewicht/${dag}`, { gewicht: 81.4 });
    await vraag("PUT", `/api/lichaamsgewicht/${dag}`, { gewicht: 81.6 }); // overschrijft
    assert.equal((await vraag("PUT", `/api/lichaamsgewicht/${dag}`, { gewicht: 8 })).statusCode, 400);
    assert.equal((await vraag("PUT", "/api/lichaamsgewicht/2026-02-30", { gewicht: 81 })).statusCode, 400);

    const res = (await vraag("GET", "/api/lichaamsgewicht")).json();
    assert.equal(res.metingen.length, 2);
    assert.equal(res.gemiddelde7, 81.3);
    assert.equal((await vraag("GET", "/api/vandaag")).json().gewicht.gemiddelde7, 81.3);

    await vraag("DELETE", `/api/lichaamsgewicht/${dag}`);
    assert.equal((await vraag("GET", "/api/lichaamsgewicht")).json().metingen.length, 1);
  });
});
