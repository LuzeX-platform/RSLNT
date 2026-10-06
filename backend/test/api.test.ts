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

  let app: import("fastify").FastifyInstance;
  let prisma: import("@prisma/client").PrismaClient;
  let cookie = "";

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
    await prisma.gebruiker.create({
      data: { email: "ik@test.nl", naam: "Ik", wachtwoordHash: await hashWachtwoord("goed-wachtwoord") },
    });
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

    const trapBar = await prisma.oefening.findUnique({ where: { sleutel: "trap_bar_deadlift" } });
    assert.equal(trapBar?.knieGevoelig, true);
    assert.equal(trapBar?.gewichtsstap, 5);
    assert.deepEqual(trapBar?.alternatieven, ["goblet_squat", "hack_squat"]);
    const bss = await prisma.oefening.findUnique({ where: { sleutel: "bulgarian_split_squat" } });
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
    const latPulldown = await prisma.oefening.findUnique({ where: { sleutel: "lat_pulldown" } });

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

    const voor = await prisma.oefening.findUniqueOrThrow({ where: { sleutel: "trap_bar_deadlift" } });
    const imp = await vraag("POST", "/api/programmas/import", { bestand: voorstel.bestand, activeren: true });
    assert.equal(imp.statusCode, 200, JSON.stringify(imp.json()));
    const scherm = (await vraag("GET", "/api/vandaag")).json();
    assert.match(scherm.programma.naam, /^Op maat/);
    assert.equal(scherm.volgendeSchema.code, "A");
    // Zelfde oefening, zelfde id: de opbouw loopt door.
    const na = await prisma.oefening.findUniqueOrThrow({ where: { sleutel: "trap_bar_deadlift" } });
    assert.equal(na.id, voor.id);
    assert.equal(na.gewichtsstap, voor.gewichtsstap);
    assert.equal((await vraag("POST", "/api/voorstel")).json().bestaatAl.actief, true);
  });
});
