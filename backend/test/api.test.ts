// Integratietest over de echte API + database. Draait alleen met TEST_DATABASE_URL gezet
// (een lege, wegwerpbare database — de tabellen worden leeggemaakt!). Lokaal:
//   TEST_DATABASE_URL=postgresql://…/rslnt_test npx prisma migrate deploy
//   TEST_DATABASE_URL=postgresql://…/rslnt_test npm test
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TEST_DB = process.env.TEST_DATABASE_URL;
const PROGRAMMA = JSON.parse(readFileSync(new URL("../programmas/benen-push-pull.json", import.meta.url), "utf8"));

describe("API", { skip: !TEST_DB && "TEST_DATABASE_URL niet gezet" }, () => {
  process.env.DATABASE_URL = TEST_DB;
  process.env.JWT_SECRET ??= "test-geheim";
  process.env.NODE_ENV ??= "test";
  delete process.env.SMTP_HOST; // mails gaan naar testPostvak in mailer.ts

  let app: import("fastify").FastifyInstance;
  let prisma: import("@prisma/client").PrismaClient;
  let cookie = "";
  let ikId = "";
  /** Een oefening van het eerste account, op sleutel. */
  const mijnOefening = (sleutel: string) => prisma.oefening.findUnique({ where: { gebruikerId_sleutel: { gebruikerId: ikId, sleutel } } });

  type Antwoord = { statusCode: number; json: () => any; headers: Record<string, unknown> };
  async function vraag(method: string, url: string, payload?: unknown): Promise<Antwoord> {
    return app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie } });
  }

  /** Logt sets voor één oefening in een training: [[gewicht, reps, rir, kniepijn], …]. */
  async function log(trainingId: string, toId: string, sets: [number | null, number, number | null, number | null][]) {
    for (const [i, [gewicht, reps, rir, kniepijn]] of sets.entries()) {
      const res = await vraag("PUT", `/api/trainingen/${trainingId}/oefeningen/${toId}/sets/${i + 1}`, { gewicht, reps, rir, kniepijn });
      assert.equal(res.statusCode, 200);
    }
  }

  before(async () => {
    ({ prisma } = await import("../src/db.js"));
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Gebruiker", "Programma", "Oefening", "Schema", "SchemaOefening", "Training", "TrainingOefening", "TrainingSet", "Lichaamsgewicht", "Profiel", "Lichaamsmeting", "Herstelcheck", "Voorkeuren" CASCADE',
    );
    const { hashWachtwoord } = await import("../src/auth.js");
    const eigenaar = await prisma.gebruiker.create({
      data: {
        email: "ik@test.nl",
        naam: "Ik",
        wachtwoordHash: await hashWachtwoord("goed-wachtwoord"),
        rol: "admin",
        emailBevestigdOp: new Date(),
      },
    });
    ikId = eigenaar.id;
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
    assert.equal((await vraag("GET", "/api/auth/sessie")).json().gebruiker.email, "ik@test.nl");
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

  test("zonder programma: niets aan de beurt", async () => {
    const vandaag = (await vraag("GET", "/api/vandaag")).json();
    assert.equal(vandaag.programma, null);
    assert.equal(vandaag.volgendeSchema, null);
  });

  test("programma-import: fouten worden benoemd, controle slaat niets op", async () => {
    const kapot = structuredClone(PROGRAMMA);
    kapot.workouts[0].exercises[0].exercise_id = "bestaat_niet";
    kapot.exercises[0].alternatives.push("ook_niet");
    const fout = await vraag("POST", "/api/programmas/import", { bestand: kapot });
    assert.equal(fout.statusCode, 400);
    assert.ok(fout.json().fouten.some((f: string) => f.includes("bestaat_niet")));
    assert.ok(fout.json().fouten.some((f: string) => f.includes("ook_niet")));

    const controle = await vraag("POST", "/api/programmas/import?controle=1", { bestand: PROGRAMMA });
    assert.equal(controle.statusCode, 200);
    assert.ok(controle.json().waarschuwingen.length > 0); // de kniepijnregel uit het bestand
    assert.equal(await prisma.programma.count(), 0);
  });

  test("programma-import: Benen / Push / Pull wordt actief, met introfase", async () => {
    const res = await vraag("POST", "/api/programmas/import", { bestand: PROGRAMMA, activeren: true });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().nieuw, true);

    const vandaag = (await vraag("GET", "/api/vandaag")).json();
    assert.equal(vandaag.programma.naam, "Benen / Push / Pull");
    assert.equal(vandaag.programma.fase.fase, "intro");
    assert.equal(vandaag.programma.fase.week, 1);
    assert.equal(vandaag.volgendeSchema.code, "A");
    assert.equal(vandaag.volgendeSchema.naam, "Benen");
    assert.deepEqual(vandaag.schemas.map((s: any) => s.code), ["A", "B", "C"]);

    const trapBar = await mijnOefening("trap_bar_deadlift");
    assert.equal(trapBar?.knieGevoelig, true);
    assert.equal(trapBar?.gewichtsstap, 5);
    assert.deepEqual(trapBar?.alternatieven, ["goblet_squat", "hack_squat"]);
    const bss = await mijnOefening("bulgarian_split_squat");
    assert.equal(bss?.perKant, true);
  });

  test("opnieuw importeren werkt het programma bij in plaats van een tweede te maken", async () => {
    const res = await vraag("POST", "/api/programmas/import", { bestand: PROGRAMMA, activeren: true });
    assert.equal(res.json().nieuw, false);
    assert.equal(await prisma.programma.count(), 1);
    assert.equal(await prisma.schema.count(), 3);
  });

  let benen = "";
  let trapBarRegel = "";

  test("training A in de introfase: 2 sets, RIR 3, rusttijd en cue", async () => {
    const vandaag = (await vraag("GET", "/api/vandaag")).json();
    benen = (await vraag("POST", "/api/trainingen", { schemaId: vandaag.volgendeSchema.id })).json().id;
    const detail = (await vraag("GET", `/api/trainingen/${benen}`)).json();
    assert.equal(detail.training.fase, "intro");
    assert.equal(detail.training.schemaCode, "A");
    assert.match(detail.training.opwarmen, /fietsen of roeien/);
    const trapBar = detail.oefeningen[0];
    trapBarRegel = trapBar.id;
    assert.equal(trapBar.naam, "Trap bar deadlift");
    assert.equal(trapBar.aantalSets, 2);
    assert.equal(trapBar.minSets, 2);
    assert.equal(trapBar.doelRir, 3);
    assert.equal(trapBar.rustSeconden, 180);
    assert.match(trapBar.cue, /3 sec zakken/);
    assert.equal(trapBar.knieGevoelig, true);
    assert.deepEqual(trapBar.alternatieven.map((a: any) => a.naam), ["Goblet squat", "Hack squat"]);
  });

  test("wisselen: alleen naar een alternatief, terug kan altijd, niet meer na een gelogde set", async () => {
    const alternatieven = (await vraag("GET", `/api/trainingen/${benen}`)).json().oefeningen[0].alternatieven;
    const goblet = alternatieven.find((a: any) => a.naam === "Goblet squat");
    const latPulldown = await mijnOefening("lat_pulldown");

    const ongeldig = await vraag("PATCH", `/api/trainingen/${benen}/oefeningen/${trapBarRegel}/wissel`, { oefeningId: latPulldown!.id });
    assert.equal(ongeldig.statusCode, 400);

    const gewisseld = (await vraag("PATCH", `/api/trainingen/${benen}/oefeningen/${trapBarRegel}/wissel`, { oefeningId: goblet.id })).json();
    assert.equal(gewisseld.oefeningen[0].naam, "Goblet squat");
    assert.equal(gewisseld.oefeningen[0].gewisseld.van, "Trap bar deadlift");
    assert.ok(gewisseld.oefeningen[0].alternatieven.some((a: any) => a.naam === "Trap bar deadlift"));

    const terug = (await vraag("PATCH", `/api/trainingen/${benen}/oefeningen/${trapBarRegel}/wissel`, { oefeningId: null })).json();
    assert.equal(terug.oefeningen[0].naam, "Trap bar deadlift");
    assert.equal(terug.oefeningen[0].gewisseld, null);

    await log(benen, trapBarRegel, [[80, 8, 3, 1]]);
    const teLaat = await vraag("PATCH", `/api/trainingen/${benen}/oefeningen/${trapBarRegel}/wissel`, { oefeningId: goblet.id });
    assert.equal(teLaat.statusCode, 409);
  });

  test("introtraining op de bovenkant met RIR 3: de volgende keer één stap (5 kg) omhoog", async () => {
    await log(benen, trapBarRegel, [[80, 8, 3, 1], [80, 8, 3, 1]]);
    const detail = (await vraag("POST", `/api/trainingen/${benen}/afronden`)).json();
    assert.equal(detail.oefeningen[0].volgendeKeer.actie, "omhoog");
    assert.equal(detail.oefeningen[0].volgendeKeer.gewicht, 85);
  });

  test("rotatie: na A komt B, daarna C", async () => {
    const b = (await vraag("GET", "/api/vandaag")).json().volgendeSchema;
    assert.equal(b.code, "B");
    const bId = (await vraag("POST", "/api/trainingen", { schemaId: b.id })).json().id;
    await vraag("POST", `/api/trainingen/${bId}/afronden`);
    assert.equal((await vraag("GET", "/api/vandaag")).json().volgendeSchema.code, "C");
  });

  test("nu deloaden: halve sets, zelfde gewicht als de laatste normale keer", async () => {
    const { programma } = (await vraag("GET", "/api/vandaag")).json();
    assert.equal((await vraag("POST", `/api/programmas/${programma.id}/deload`, { aan: true })).statusCode, 200);
    assert.equal((await vraag("GET", "/api/vandaag")).json().programma.fase.fase, "deload");

    const schemas = (await vraag("GET", "/api/vandaag")).json().schemas;
    const a = schemas.find((s: any) => s.code === "A");
    const deloadId = (await vraag("POST", "/api/trainingen", { schemaId: a.id })).json().id;
    const detail = (await vraag("GET", `/api/trainingen/${deloadId}`)).json();
    assert.equal(detail.training.fase, "deload");
    assert.equal(detail.oefeningen[0].aantalSets, 2); // 4 × 0,5
    assert.equal(detail.oefeningen[0].voorstel.actie, "deload");
    assert.equal(detail.oefeningen[0].voorstel.gewicht, 80);
    await vraag("DELETE", `/api/trainingen/${deloadId}`);

    await vraag("POST", `/api/programmas/${programma.id}/deload`, { aan: false });
    assert.equal((await vraag("GET", "/api/vandaag")).json().programma.fase.fase, "intro");
  });

  test("schema aanpassen (rust, RIR, cue) raakt de geschiedenis niet", async () => {
    const { schemas } = (await vraag("GET", "/api/schemas")).json();
    const a = schemas.find((s: any) => s.code === "A");
    const regels = a.oefeningen.map((r: any) => ({
      oefeningId: r.oefeningId,
      aantalSets: r.aantalSets,
      minSets: r.minSets,
      repsMin: r.repsMin,
      repsMax: r.repsMax,
      supersetGroep: r.supersetGroep,
      rustSeconden: r.rustSeconden,
      doelRir: r.doelRir,
      cue: r.cue,
    }));
    regels[0].rustSeconden = 240;
    regels[0].cue = "Nieuwe cue";
    assert.equal((await vraag("PUT", `/api/schemas/${a.id}`, { oefeningen: regels })).statusCode, 200);
    const fout = await vraag("PUT", `/api/schemas/${a.id}`, { oefeningen: [{ ...regels[0], repsMin: 12, repsMax: 8 }] });
    assert.equal(fout.statusCode, 400);

    const oud = (await vraag("GET", `/api/trainingen/${benen}`)).json();
    assert.equal(oud.oefeningen[0].rustSeconden, 180);
    assert.match(oud.oefeningen[0].cue, /3 sec zakken/);
  });

  test("oefening toevoegen krijgt een sleutel en kan knie-gevoelig zijn", async () => {
    const nieuw = await vraag("POST", "/api/oefeningen", {
      naam: "Belt squat", materiaal: "machine", gewichtsstap: 5, perKant: false, knieGevoelig: true,
    });
    assert.equal(nieuw.statusCode, 200);
    assert.equal(nieuw.json().oefening.sleutel, "belt_squat");
    assert.equal(nieuw.json().oefening.knieGevoelig, true);
    const dubbel = await vraag("POST", "/api/oefeningen", {
      naam: "Belt squat", materiaal: "machine", gewichtsstap: 5, perKant: false, knieGevoelig: true,
    });
    assert.equal(dubbel.statusCode, 409);
  });

  test("het programmabestand is terug te downloaden", async () => {
    const { programmas } = (await vraag("GET", "/api/programmas")).json();
    const res = await vraag("GET", `/api/programmas/${programmas[0].id}/bestand`);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-disposition"]), /split_legs_push_pull_v1\.json/);
    assert.equal(res.json().program.id, "split_legs_push_pull_v1");
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

  test("gezondheidsmenu: zonder profiel zie je wat er ontbreekt, het doel komt uit je programma", async () => {
    const lichaam = (await vraag("GET", "/api/lichaam")).json();
    assert.deepEqual(lichaam.ontbreekt, ["lengte", "geboortedatum", "geslacht"]);
    assert.equal(lichaam.doel.gewicht, 90);
    assert.equal(lichaam.doel.tempoMin, 0.25);
    assert.equal(lichaam.doel.tempoMax, 0.5);
    assert.equal(lichaam.doel.bron, "programma");
    assert.equal(lichaam.energie, null);
  });

  test("gezondheidsmenu: profiel en omtrekmaten geven BMI, vet%, FFMI en energie", async () => {
    assert.equal((await vraag("PUT", "/api/profiel", { lengteCm: 50 })).statusCode, 400);
    const profiel = await vraag("PUT", "/api/profiel", {
      lengteCm: 200, geslacht: "man", geboortedatum: "1995-01-01", activiteit: "licht",
    });
    assert.equal(profiel.statusCode, 200);

    let lichaam = (await vraag("GET", "/api/lichaam")).json();
    assert.deepEqual(lichaam.ontbreekt, []);
    assert.equal(lichaam.gewicht.gemiddelde7, 81);
    assert.deepEqual(lichaam.samenstelling.bmi, { waarde: 20.3, categorie: "gezond gewicht" });
    assert.equal(lichaam.energie.methode, "Mifflin-St Jeor");

    const { vandaag } = await import("../src/datum.js");
    assert.equal((await vraag("PUT", `/api/lichaamsmetingen/${vandaag()}`, { tailleCm: 85, nekCm: 39 })).statusCode, 200);
    lichaam = (await vraag("GET", "/api/lichaam")).json();
    assert.equal(lichaam.samenstelling.vet.waarde, 12.3);
    assert.equal(lichaam.samenstelling.vet.bron, "geschat");
    assert.equal(lichaam.samenstelling.ffmi.ffmi, 17.8);
    assert.equal(lichaam.samenstelling.tailleLengte.ratio, 0.43);
    assert.equal(lichaam.energie.methode, "Katch-McArdle");
    assert.equal(lichaam.energie.eiwit.min, 130);

    // Zelf gemeten vetpercentage gaat voor de schatting.
    await vraag("PUT", `/api/lichaamsmetingen/${vandaag()}`, { tailleCm: 85, nekCm: 39, vetpercentage: 15 });
    lichaam = (await vraag("GET", "/api/lichaam")).json();
    assert.deepEqual([lichaam.samenstelling.vet.waarde, lichaam.samenstelling.vet.bron], [15, "gemeten"]);

    // Eigen doel gaat voor het doel uit het programma.
    await vraag("PUT", "/api/profiel", { doelgewicht: 88, tempoMin: 0.2, tempoMax: 0.4 });
    lichaam = (await vraag("GET", "/api/lichaam")).json();
    assert.deepEqual([lichaam.doel.gewicht, lichaam.doel.bron], [88, "profiel"]);
  });

  test("herstelcheck: losse signalen, ook op het beginscherm", async () => {
    const { vandaag } = await import("../src/datum.js");
    assert.equal((await vraag("PUT", `/api/herstel/${vandaag()}`, { slaap: 6, spierpijn: 1, energie: 1, kniepijn: 1 })).statusCode, 400);
    const res = (await vraag("PUT", `/api/herstel/${vandaag()}`, { slaap: 2, spierpijn: 2, energie: 4, kniepijn: 1 })).json();
    assert.deepEqual(res.signalen.map((s: any) => s.status), ["let_op", "goed", "goed", "goed"]);
    const scherm = (await vraag("GET", "/api/vandaag")).json();
    assert.equal(scherm.herstel.check.slaap, 2);
    assert.equal(scherm.herstel.deloadOverwegen, false);
  });

  test("voortgang: gewicht met doelband, sets per spiergroep, e1RM en te volle trainingen", async () => {
    const v = (await vraag("GET", "/api/voortgang")).json();
    assert.ok(v.gewicht.reeks.length >= 1);
    assert.deepEqual([v.gewicht.band.tempoMin, v.gewicht.band.tempoMax], [0.2, 0.4]);
    assert.equal(v.gewicht.doelgewicht, 88);

    const trapBar = v.oefeningen.find((o: any) => o.naam === "Trap bar deadlift");
    assert.equal(trapBar.record.e1rm, 109.3); // 80 kg × (1 + (8 + 3) / 30)
    const quads = v.volume.rijen.find((r: any) => r.spier === "quads");
    assert.equal(quads.label, "Voorkant bovenbeen");
    assert.equal(quads.dezeWeek, 2); // twee gelogde sets trap bar, deze week
    assert.equal(v.volume.weken, 1);
    assert.equal(quads.gemiddeld, 2);
    assert.ok(v.volume.rijen.some((r: any) => r.spier === "abs" && r.gemiddeld === 0)); // ook spieren zonder sets

    const benen = v.perTraining.trainingen.find((t: any) => t.code === "A");
    assert.deepEqual(benen.teVol[0], { spier: "quads", sets: 13, label: "Voorkant bovenbeen" });
  });

  test("bibliotheek: zoeken in het Nederlands, gekoppeld aan je programma, foto's van de vastgepinde bron", async () => {
    const lijst = (await vraag("GET", "/api/bibliotheek?zoek=bankdrukken")).json();
    assert.ok(lijst.totaal > 5);
    assert.equal(lijst.oefeningen[0].basislijst, true);
    assert.match(lijst.oefeningen[0].afbeelding, /^https:\/\/raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\/[0-9a-f]{40}\//);
    assert.equal((await vraag("GET", "/api/bibliotheek?spier=quads&knie=vriendelijk")).json().oefeningen.some((o: any) => o.knieGevoelig), false);

    // De import heeft leg_press aan de bibliotheek gekoppeld (via de basislijst).
    const leg = (await vraag("GET", "/api/bibliotheek/Leg_Press")).json();
    assert.equal(leg.inDatabase.sleutel, "leg_press");
    assert.deepEqual(leg.inProgramma.map((s: any) => s.code), ["A"]);
    assert.equal(leg.oefening.knieGevoelig, true);
    assert.equal(leg.oefening.knieGeschat, false);
    assert.ok(leg.oefening.uitleg.length > 0 && leg.oefening.afbeeldingen.length === 2);
    assert.ok(leg.vergelijkbaar.every((o: any) => o.patroon === "knie_dominant"));
    assert.equal((await vraag("GET", "/api/bibliotheek/Bestaat_Niet")).statusCode, 404);

    // In een training zie je waar de uitleg staat.
    const { oefeningen } = (await vraag("GET", "/api/schemas")).json().schemas[0];
    assert.equal(oefeningen.find((r: any) => r.oefening.sleutel === "leg_press").oefening.bibliotheekId, "Leg_Press");
  });

  test("bibliotheek: favoriet, niet voor mij en toevoegen aan een training", async () => {
    assert.equal((await vraag("PUT", "/api/bibliotheek/Hack_Squat/status", { status: "favoriet" })).json().status, "favoriet");
    assert.equal((await vraag("PUT", "/api/bibliotheek/Leg_Press/status", { status: "uitgesloten" })).json().status, "uitgesloten");
    // Wisselen van favoriet naar uitgesloten haalt hem uit de andere lijst.
    await vraag("PUT", "/api/bibliotheek/Barbell_Squat/status", { status: "favoriet" });
    await vraag("PUT", "/api/bibliotheek/Barbell_Squat/status", { status: "uitgesloten" });
    let v = (await vraag("GET", "/api/voorkeuren")).json();
    assert.deepEqual(v.voorkeuren.favorieten, ["Hack_Squat"]);
    assert.deepEqual(v.voorkeuren.uitgesloten, ["Leg_Press", "Barbell_Squat"]);
    assert.equal((await vraag("GET", "/api/bibliotheek?lijst=favorieten")).json().totaal, 1);
    await vraag("PUT", "/api/bibliotheek/Barbell_Squat/status", { status: "geen" });
    v = (await vraag("GET", "/api/voorkeuren")).json();
    assert.deepEqual(v.voorkeuren.uitgesloten, ["Leg_Press"]);

    // Een oefening van buiten de basislijst toevoegen: krijgt een sleutel en de koppeling.
    const { schemas } = (await vraag("GET", "/api/schemas")).json();
    const b = schemas.find((s: any) => s.code === "B");
    const toe = await vraag("POST", "/api/bibliotheek/Barbell_Full_Squat/toevoegen", { schemaId: b.id });
    assert.equal(toe.statusCode, 200);
    assert.equal(toe.json().oefening.sleutel, "barbell_full_squat");
    assert.equal(toe.json().oefening.bibliotheekId, "Barbell_Full_Squat");
    assert.equal(toe.json().oefening.knieGevoelig, true);
    const nogEens = await vraag("POST", "/api/bibliotheek/Barbell_Full_Squat/toevoegen", { schemaId: b.id });
    assert.equal(nogEens.statusCode, 409);
    const na = (await vraag("GET", "/api/schemas")).json().schemas.find((s: any) => s.code === "B");
    assert.equal(na.oefeningen.at(-1).oefening.sleutel, "barbell_full_squat");
    assert.equal(na.oefeningen.at(-1).aantalSets, 3);
    // Uit de basislijst: de bestaande oefening wordt hergebruikt, geen tweede "Face pull".
    const c = schemas.find((s: any) => s.code === "C");
    const dubbel = await vraag("POST", "/api/bibliotheek/Face_Pull/toevoegen", { schemaId: c.id });
    assert.equal(dubbel.statusCode, 409, "face pull staat al in Pull");
    const face = await vraag("POST", "/api/bibliotheek/Face_Pull/toevoegen", { schemaId: b.id });
    assert.equal(face.statusCode, 200);
    assert.equal(face.json().oefening.sleutel, "face_pull");
    assert.equal(await prisma.oefening.count({ where: { naam: { equals: "Face pull", mode: "insensitive" } } }), 1);
  });

  test("personaliseren: voorkeuren, haalbaarheid en een voorstel dat je geschiedenis behoudt", async () => {
    assert.equal((await vraag("PUT", "/api/voorkeuren", { doel: "spiermassa", ervaring: "gevorderd", dagenPerWeek: 9, minutenPerTraining: 60, materiaal: [], blessures: [], focus: [] })).statusCode, 400);
    assert.equal((await vraag("PUT", "/api/voorkeuren", { doel: "spiermassa", ervaring: "gevorderd", dagenPerWeek: 3, minutenPerTraining: 60, materiaal: ["zwembad"], blessures: [], focus: [] })).statusCode, 400);
    const { vandaag, verschuifDag } = await import("../src/datum.js");
    const opslaan = await vraag("PUT", "/api/voorkeuren", {
      doel: "spiermassa",
      ervaring: "gevorderd",
      dagenPerWeek: 3,
      minutenPerTraining: 75,
      materiaal: ["dumbbell", "barbell", "trap_bar", "kabel", "machine", "stang"],
      blessures: ["knie"],
      focus: ["side_delts"],
      doelgewicht: 90,
      streefdatum: verschuifDag(vandaag(), 70),
    });
    assert.equal(opslaan.statusCode, 200);
    assert.equal(opslaan.json().lichaam.haalbaarheid.oordeel, "te_snel"); // 10 weken voor ~9 kg
    assert.equal((await vraag("GET", "/api/profiel")).json().profiel.streefdatum, verschuifDag(vandaag(), 70));

    const voorstel = (await vraag("POST", "/api/voorstel")).json();
    assert.equal(voorstel.controle.ok, true);
    assert.deepEqual(voorstel.controle.waarschuwingen, []);
    assert.equal(voorstel.sessies.length, 3);
    assert.equal(voorstel.bestand.program.id, "op_maat");
    assert.equal(voorstel.bestaatAl, null);
    const alle = voorstel.sessies.flatMap((s: any) => s.regels);
    assert.ok(alle.some((r: any) => r.sleutel === "hack_squat"), "favoriet");
    assert.ok(!alle.some((r: any) => r.sleutel === "leg_press"), "uitgesloten");
    for (const s of voorstel.sessies) assert.ok(s.regels.filter((r: any) => r.knieGevoelig).length <= 1);
    // Trap bar deadlift heeft geschiedenis: die gaat voor bij gelijke keuze.
    assert.ok(alle.some((r: any) => r.sleutel === "trap_bar_deadlift"));

    const voor = (await mijnOefening("trap_bar_deadlift"))!;
    const imp = await vraag("POST", "/api/programmas/import", { bestand: voorstel.bestand, activeren: true });
    assert.equal(imp.statusCode, 200, JSON.stringify(imp.json()));
    const scherm = (await vraag("GET", "/api/vandaag")).json();
    assert.match(scherm.programma.naam, /^Op maat/);
    assert.equal(scherm.volgendeSchema.code, "A");
    // Zelfde oefening, zelfde id: de opbouw loopt door.
    const na = (await mijnOefening("trap_bar_deadlift"))!;
    assert.equal(na.id, voor.id);
    assert.equal(na.gewichtsstap, voor.gewichtsstap);
    assert.equal((await vraag("POST", "/api/voorstel")).json().bestaatAl.actief, true);
  });

  // ---------- Accounts: registreren, isolatie, wachtwoord, export, verwijderen ----------

  let cookieB = "";
  const vraagAls = (c: string, method: string, url: string, payload?: unknown): Promise<Antwoord> =>
    app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie: c } });
  const sessieCookie = (res: Antwoord) => {
    const header = res.headers["set-cookie"];
    return (Array.isArray(header) ? header[0] : String(header)).split(";")[0];
  };
  const tokenUit = (tekst: string) => /token=([0-9a-f]+)/.exec(tekst)![1];

  test("registreren: toestemming verplicht, bevestigingsmail, pas inloggen na bevestigen", async () => {
    const { testPostvak } = await import("../src/mailer.js");
    const gegevens = { naam: "Bo", email: "Bo@Test.nl", wachtwoord: "bo-wachtwoord-1" };
    assert.equal((await vraagAls("", "POST", "/api/auth/registreren", gegevens)).statusCode, 400);
    assert.equal((await vraagAls("", "POST", "/api/auth/registreren", { ...gegevens, toestemming: false })).statusCode, 400);
    assert.equal((await vraagAls("", "POST", "/api/auth/registreren", { ...gegevens, toestemming: true })).statusCode, 200);
    const eerste = testPostvak.at(-1)!;
    assert.equal(eerste.naar, "bo@test.nl");
    assert.match(eerste.tekst, /\/bevestigen\.html\?token=[0-9a-f]{64}/);
    const g = await prisma.gebruiker.findUniqueOrThrow({ where: { email: "bo@test.nl" } });
    assert.equal(g.rol, "lid");
    assert.ok(g.toestemmingOp && g.privacyVersie);
    assert.equal(g.emailBevestigdOp, null);

    const vroeg = await vraagAls("", "POST", "/api/auth/inloggen", { email: "bo@test.nl", wachtwoord: "bo-wachtwoord-1" });
    assert.equal(vroeg.statusCode, 403);
    assert.equal(vroeg.json().errorCode, "EMAIL_NIET_BEVESTIGD");

    // Nog eens registreren: zelfde antwoord, nieuwe mail, de oude link vervalt.
    assert.equal((await vraagAls("", "POST", "/api/auth/registreren", { ...gegevens, toestemming: true })).statusCode, 200);
    const tweede = testPostvak.at(-1)!;
    assert.notEqual(tokenUit(tweede.tekst), tokenUit(eerste.tekst));
    assert.equal((await vraagAls("", "POST", "/api/auth/bevestigen", { token: tokenUit(eerste.tekst) })).statusCode, 400);
    const bevestigd = await vraagAls("", "POST", "/api/auth/bevestigen", { token: tokenUit(tweede.tekst) });
    assert.equal(bevestigd.statusCode, 200);
    cookieB = sessieCookie(bevestigd);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/auth/sessie")).json().gebruiker, { email: "bo@test.nl", naam: "Bo", rol: "lid", pro: false, proBron: null });
    // Pro rechtstreeks in de database zetten: zonder een echte Stripe-betaling is dit de enige
    // manier om B voorbij de paywall te krijgen, en de "twee accounts"-test hieronder test
    // isolatie, niet de paywall — die heeft zijn eigen test verderop.
    await prisma.gebruiker.update({ where: { email: "bo@test.nl" }, data: { pro: true } });

    // Een bestaand, bevestigd adres: zelfde antwoord, geen mail (niets te raden).
    const aantal = testPostvak.length;
    assert.equal((await vraagAls("", "POST", "/api/auth/registreren", { naam: "X", email: "ik@test.nl", wachtwoord: "iets-anders-1", toestemming: true })).statusCode, 200);
    assert.equal(testPostvak.length, aantal);
  });

  test("twee accounts: B ziet en wijzigt niets van A", async () => {
    const trainingA = await prisma.training.findFirstOrThrow({ where: { gebruikerId: ikId }, include: { oefeningen: true } });
    const toA = trainingA.oefeningen[0];
    const programmaA = await prisma.programma.findFirstOrThrow({ where: { gebruikerId: ikId, actief: true }, include: { schemas: true } });
    const schemaA = programmaA.schemas[0];
    const oefeningA = (await mijnOefening("leg_press"))!;
    const oefeningenA = await prisma.oefening.count({ where: { gebruikerId: ikId } });

    const scherm = (await vraagAls(cookieB, "GET", "/api/vandaag")).json();
    assert.equal(scherm.programma, null);
    assert.deepEqual(scherm.recent, []);
    assert.equal(scherm.gewicht.laatste, null);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/trainingen")).json().trainingen, []);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/programmas")).json().programmas, []);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/oefeningen")).json().oefeningen, []);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/herstel")).json().checks, []);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/voortgang")).json().oefeningen, []);
    assert.equal((await vraagAls(cookieB, "GET", "/api/profiel")).json().profiel.lengteCm, null);
    assert.equal((await vraagAls(cookieB, "GET", "/api/bibliotheek/Leg_Press")).json().inDatabase, null);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/voorkeuren")).json().voorkeuren.favorieten, []);

    // Alles van A is voor B "niet gevonden".
    const pogingen: [string, string, unknown?][] = [
      ["GET", `/api/trainingen/${trainingA.id}`],
      ["PATCH", `/api/trainingen/${trainingA.id}`, { notitie: "van B" }],
      ["POST", `/api/trainingen/${trainingA.id}/afronden`],
      ["POST", `/api/trainingen/${trainingA.id}/heropenen`],
      ["DELETE", `/api/trainingen/${trainingA.id}`],
      ["PUT", `/api/trainingen/${trainingA.id}/oefeningen/${toA.id}/sets/1`, { gewicht: 1, reps: 1, rir: null, kniepijn: null }],
      ["DELETE", `/api/trainingen/${trainingA.id}/oefeningen/${toA.id}/sets/1`],
      ["PATCH", `/api/trainingen/${trainingA.id}/oefeningen/${toA.id}/wissel`, { oefeningId: null }],
      ["PATCH", `/api/oefeningen/${oefeningA.id}`, { naam: "Gekaapt" }],
      ["PUT", `/api/schemas/${schemaA.id}`, { oefeningen: [] }],
      ["POST", "/api/trainingen", { schemaId: schemaA.id }],
      ["POST", `/api/programmas/${programmaA.id}/activeren`],
      ["POST", `/api/programmas/${programmaA.id}/deload`, { aan: true }],
      ["GET", `/api/programmas/${programmaA.id}/bestand`],
      ["POST", "/api/bibliotheek/Face_Pull/toevoegen", { schemaId: schemaA.id }],
    ];
    for (const [methode, url, body] of pogingen) {
      assert.equal((await vraagAls(cookieB, methode, url, body)).statusCode, 404, `${methode} ${url}`);
    }

    // Eigen gewicht en herstelcheck op dezelfde dag als A: twee aparte rijen.
    const { vandaag } = await import("../src/datum.js");
    const gewichtA = await prisma.lichaamsgewicht.findFirst({ where: { gebruikerId: ikId }, orderBy: { datum: "desc" } });
    assert.equal((await vraagAls(cookieB, "PUT", `/api/lichaamsgewicht/${vandaag()}`, { gewicht: 70 })).statusCode, 200);
    assert.equal((await vraagAls(cookieB, "PUT", `/api/herstel/${vandaag()}`, { slaap: 5, spierpijn: 1, energie: 5, kniepijn: 1 })).statusCode, 200);
    assert.deepEqual((await vraagAls(cookieB, "GET", "/api/lichaamsgewicht")).json().metingen.map((m: any) => m.gewicht), [70]);
    const gewichtANa = await prisma.lichaamsgewicht.findFirst({ where: { gebruikerId: ikId }, orderBy: { datum: "desc" } });
    assert.deepEqual(gewichtANa, gewichtA);
    assert.equal((await vraag("GET", "/api/herstel")).json().checks[0].slaap, 2, "A's herstelcheck blijft");

    // B laadt hetzelfde programma in: eigen oefeningen met dezelfde sleutels, A blijft actief.
    const imp = await vraagAls(cookieB, "POST", "/api/programmas/import", { bestand: PROGRAMMA, activeren: true });
    assert.equal(imp.statusCode, 200, JSON.stringify(imp.json()));
    const legB = await prisma.oefening.findFirstOrThrow({ where: { sleutel: "leg_press", NOT: { gebruikerId: ikId } } });
    assert.notEqual(legB.id, oefeningA.id);
    assert.equal(await prisma.oefening.count({ where: { gebruikerId: ikId } }), oefeningenA);
    assert.equal((await prisma.programma.findUniqueOrThrow({ where: { id: programmaA.id } })).actief, true);
    assert.match((await vraagAls(cookieB, "GET", "/api/vandaag")).json().programma.naam, /Benen/);
    assert.notEqual((await vraag("GET", "/api/vandaag")).json().programma.id, (await vraagAls(cookieB, "GET", "/api/vandaag")).json().programma.id);
  });

  test("wachtwoord vergeten: resetmail, nieuw wachtwoord, oude sessies vervallen", async () => {
    const { testPostvak } = await import("../src/mailer.js");
    const aantal = testPostvak.length;
    assert.equal((await vraagAls("", "POST", "/api/auth/wachtwoord-vergeten", { email: "niemand@test.nl" })).statusCode, 200);
    assert.equal(testPostvak.length, aantal, "geen mail naar een onbekend adres");
    assert.equal((await vraagAls("", "POST", "/api/auth/wachtwoord-vergeten", { email: "bo@test.nl" })).statusCode, 200);
    const mail = testPostvak.at(-1)!;
    assert.match(mail.tekst, /wachtwoord-resetten\.html\?token=/);
    const kort = await vraagAls("", "POST", "/api/auth/wachtwoord-resetten", { token: tokenUit(mail.tekst), wachtwoord: "kort" });
    assert.equal(kort.statusCode, 400);
    const reset = await vraagAls("", "POST", "/api/auth/wachtwoord-resetten", { token: tokenUit(mail.tekst), wachtwoord: "bo-nieuw-wachtwoord" });
    assert.equal(reset.statusCode, 200);
    assert.equal((await vraagAls(cookieB, "GET", "/api/vandaag")).statusCode, 401, "oude sessie vervallen");
    cookieB = sessieCookie(reset);
    assert.equal((await vraagAls(cookieB, "GET", "/api/vandaag")).statusCode, 200);
    assert.equal((await vraagAls("", "POST", "/api/auth/wachtwoord-resetten", { token: tokenUit(mail.tekst), wachtwoord: "nog-een-keer-1" })).statusCode, 400);
    assert.equal((await vraagAls("", "POST", "/api/auth/inloggen", { email: "bo@test.nl", wachtwoord: "bo-wachtwoord-1" })).statusCode, 401);
  });

  test("wachtwoord wijzigen: andere apparaten uitgelogd, dit apparaat niet", async () => {
    const telefoon = sessieCookie(await vraagAls("", "POST", "/api/auth/inloggen", { email: "bo@test.nl", wachtwoord: "bo-nieuw-wachtwoord" }));
    const laptop = sessieCookie(await vraagAls("", "POST", "/api/auth/inloggen", { email: "bo@test.nl", wachtwoord: "bo-nieuw-wachtwoord" }));
    const res = await vraagAls(telefoon, "POST", "/api/auth/wachtwoord", { huidig: "bo-nieuw-wachtwoord", nieuw: "bo-derde-wachtwoord" });
    assert.equal(res.statusCode, 200);
    assert.equal((await vraagAls(laptop, "GET", "/api/vandaag")).statusCode, 401);
    cookieB = sessieCookie(res);
    assert.equal((await vraagAls(cookieB, "GET", "/api/vandaag")).statusCode, 200);
  });

  test("Pro-paywall: bibliotheek en schema op maat alleen voor Pro-leden", async () => {
    const { hashWachtwoord } = await import("../src/auth.js");
    const cas = await prisma.gebruiker.create({
      data: {
        email: "cas@test.nl",
        naam: "Cas",
        wachtwoordHash: await hashWachtwoord("cas-wachtwoord-1"),
        rol: "lid",
        emailBevestigdOp: new Date(),
      },
    });
    const ingelogd = await vraagAls("", "POST", "/api/auth/inloggen", { email: "cas@test.nl", wachtwoord: "cas-wachtwoord-1" });
    const cookieCas = sessieCookie(ingelogd);

    // Zonder Pro: 402 op de bibliotheek en het schema op maat, maar voorkeuren instellen mag wel.
    const zonderPro = await vraagAls(cookieCas, "GET", "/api/bibliotheek");
    assert.equal(zonderPro.statusCode, 402);
    assert.equal(zonderPro.json().errorCode, "PRO_VEREIST");
    assert.equal((await vraagAls(cookieCas, "GET", "/api/bibliotheek/Leg_Press")).statusCode, 402);
    assert.equal((await vraagAls(cookieCas, "POST", "/api/bibliotheek/Leg_Press/toevoegen", { schemaId: "iets" })).statusCode, 402);
    assert.equal((await vraagAls(cookieCas, "POST", "/api/voorstel")).statusCode, 402);
    assert.equal((await vraagAls(cookieCas, "GET", "/api/voorkeuren")).statusCode, 200);

    // Pro wordt alleen door de Stripe-webhook gezet (zie entitlementsPro.ts) — hier direct in de
    // database, want er is geen echte Stripe-omgeving in deze test.
    await prisma.gebruiker.update({ where: { id: cas.id }, data: { pro: true } });
    assert.equal((await vraagAls(cookieCas, "GET", "/api/bibliotheek")).statusCode, 200);
    assert.equal((await vraagAls(cookieCas, "POST", "/api/voorstel")).statusCode, 200);

    // Het eigenaarsaccount (A, admin) is altijd Pro, zonder dat er ooit `pro: true` voor staat.
    assert.equal((await prisma.gebruiker.findUniqueOrThrow({ where: { id: ikId } })).pro, false);
    assert.equal((await vraag("GET", "/api/bibliotheek")).statusCode, 200);
    assert.equal((await vraag("GET", "/api/auth/sessie")).json().gebruiker.pro, true);

    await prisma.gebruiker.delete({ where: { id: cas.id } });
  });

  test("kruisproduct-Pro: een actief ACCRD-account geeft gratis Pro bij bevestigen", async () => {
    // Nep-ACCRD: antwoordt "actief" voor daan@test.nl, "niet actief" voor ieder ander adres.
    const http = await import("node:http");
    const nepAccrd = http.createServer((req, res) => {
      const url = new URL(req.url!, "http://nep");
      const juisteSleutel = req.headers["x-luzex-intern-sleutel"] === "test-sleutel";
      const actief = juisteSleutel && url.searchParams.get("email") === "daan@test.nl";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ actief }));
    });
    await new Promise<void>((resolve) => nepAccrd.listen(0, resolve));
    const poort = (nepAccrd.address() as import("node:net").AddressInfo).port;
    process.env.ACCRD_INTERN_URL = `http://127.0.0.1:${poort}`;
    process.env.LUZEX_INTERN_SLEUTEL = "test-sleutel";

    try {
      const { testPostvak } = await import("../src/mailer.js");
      await vraagAls("", "POST", "/api/auth/registreren", {
        naam: "Daan",
        email: "Daan@Test.nl",
        wachtwoord: "daan-wachtwoord-1",
        toestemming: true,
      });
      const mail = testPostvak.at(-1)!;
      const bevestig = await vraagAls("", "POST", "/api/auth/bevestigen", { token: tokenUit(mail.tekst) });
      assert.equal(bevestig.statusCode, 200);
      const cookieDaan = sessieCookie(bevestig);

      const sessie = (await vraagAls(cookieDaan, "GET", "/api/auth/sessie")).json().gebruiker;
      assert.equal(sessie.pro, true);
      assert.equal(sessie.proBron, "accrd");
      assert.equal((await vraagAls(cookieDaan, "GET", "/api/bibliotheek")).statusCode, 200);

      const daan = await prisma.gebruiker.findUniqueOrThrow({ where: { email: "daan@test.nl" } });
      assert.equal(daan.proBron, "accrd");
      await prisma.gebruiker.delete({ where: { id: daan.id } });
    } finally {
      delete process.env.ACCRD_INTERN_URL;
      delete process.env.LUZEX_INTERN_SLEUTEL;
      await new Promise((resolve) => nepAccrd.close(resolve));
    }
  });

  test("account: gegevens downloaden en verwijderen met alles erop en eraan", async () => {
    // B traint eerst, zodat er trainingen, sets en oefeningen zijn om te verwijderen.
    const scherm = (await vraagAls(cookieB, "GET", "/api/vandaag")).json();
    const start = (await vraagAls(cookieB, "POST", "/api/trainingen", { schemaId: scherm.volgendeSchema.id })).json();
    const detail = (await vraagAls(cookieB, "GET", `/api/trainingen/${start.id}`)).json();
    assert.equal((await vraagAls(cookieB, "PUT", `/api/trainingen/${start.id}/oefeningen/${detail.oefeningen[0].id}/sets/1`, { gewicht: 40, reps: 8, rir: 2, kniepijn: null })).statusCode, 200);

    const exp = await vraagAls(cookieB, "GET", "/api/account/export");
    assert.equal(exp.statusCode, 200);
    assert.match(String(exp.headers["content-disposition"]), /attachment; filename="rslnt-gegevens-/);
    const gegevens = exp.json();
    assert.equal(gegevens.account.email, "bo@test.nl");
    assert.equal(gegevens.trainingen.length, 1);
    assert.equal(gegevens.trainingen[0].oefeningen[0].sets[0].gewicht, 40);
    assert.deepEqual(gegevens.lichaamsgewicht.map((g: any) => g.gewicht), [70]);
    assert.ok(!JSON.stringify(gegevens).includes("wachtwoordHash"));
    assert.ok(!JSON.stringify(gegevens).includes("ik@test.nl"));

    assert.equal((await vraag("DELETE", "/api/account", { wachtwoord: "goed-wachtwoord" })).json().errorCode, "ADMIN_NIET_VERWIJDERBAAR");
    assert.equal((await vraagAls(cookieB, "DELETE", "/api/account", { wachtwoord: "fout-wachtwoord" })).statusCode, 400);
    const bId = (await prisma.gebruiker.findUniqueOrThrow({ where: { email: "bo@test.nl" } })).id;
    assert.equal((await vraagAls(cookieB, "DELETE", "/api/account", { wachtwoord: "bo-derde-wachtwoord" })).statusCode, 200);
    for (const tabel of ["training", "programma", "oefening", "lichaamsgewicht", "herstelcheck", "profiel", "voorkeuren"] as const) {
      assert.equal(await (prisma[tabel] as any).count({ where: { gebruikerId: bId } }), 0, tabel);
    }
    assert.equal(await prisma.gebruiker.count({ where: { id: bId } }), 0);
    assert.equal((await vraagAls(cookieB, "GET", "/api/vandaag")).statusCode, 401);
    // A merkt er niets van.
    assert.match((await vraag("GET", "/api/vandaag")).json().programma.naam, /Op maat|Benen/);
    assert.ok((await prisma.training.count({ where: { gebruikerId: ikId } })) > 0);
  });
});

