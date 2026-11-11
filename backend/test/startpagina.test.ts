// De hoofdpagina hangt af van wie er aanklopt: zonder sessie de startpagina,
// met sessie de app. Draait alleen met TEST_DATABASE_URL gezet.
//
// Deze test bestaat omdat de twee kanten elkaar makkelijk kunnen slopen. Na het
// inloggen doet auth.js location.href = "/", en welkom.js stuurt een ingelogde
// bezoeker juist naar "/". Zou "/" voor iedereen welkom.html worden, dan draaien
// die twee eindeloos rond. En zou "/" voor iedereen de app blijven, dan krijgt
// elke zoekmachine het lege "Vandaag"-scherm te zien. Allebei de kanten moeten
// dus kloppen, en allebei worden ze hier nagelopen.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe("hoofdpagina", { skip: !TEST_DB && "TEST_DATABASE_URL niet gezet" }, () => {
  process.env.DATABASE_URL = TEST_DB;
  process.env.JWT_SECRET ??= "test-geheim";
  process.env.NODE_ENV ??= "test";

  let app: import("fastify").FastifyInstance;
  let koekje = "";

  before(async () => {
    app = await (await import("../src/app.js")).bouwApp({ logger: false });

    // Registreren vraagt om toestemming en levert pas een sessie na het
    // bevestigen van het e-mailadres; het bevestigen zelf geeft de cookie.
    const { testPostvak } = await import("../src/mailer.js");
    const email = `start-${Date.now()}@test.nl`;
    await app.inject({
      method: "POST",
      url: "/api/auth/registreren",
      payload: { naam: "Tester", email, wachtwoord: "een-goed-wachtwoord-1", toestemming: true },
    });
    const token = /token=([0-9a-f]+)/.exec(testPostvak.at(-1)!.tekst)![1];
    const bevestigd = await app.inject({
      method: "POST",
      url: "/api/auth/bevestigen",
      payload: { token },
    });
    const gezet = bevestigd.headers["set-cookie"];
    koekje = (Array.isArray(gezet) ? gezet[0] : String(gezet ?? "")).split(";")[0];
  });

  after(async () => {
    await app.close();
  });

  test("zonder sessie levert / de startpagina", async () => {
    const r = await app.inject({ method: "GET", url: "/" });
    assert.equal(r.statusCode, 200);
    assert.ok(r.body.includes("Sterker worden, zonder giswerk."), "de startpagina ontbreekt");
    assert.ok(!r.body.includes('id="kop"'), "dit is het app-scherm, niet de startpagina");
  });

  test("de startpagina draagt canonical, deelplaatje en structuurgegevens", async () => {
    const r = await app.inject({ method: "GET", url: "/" });
    assert.match(r.body, /<link rel="canonical" href="https:\/\/rslnt\.luzex\.nl\/"/);
    assert.match(r.body, /<meta property="og:image" content="https:\/\/rslnt\.luzex\.nl\/assets\/og-image\.png"/);
    const ld = JSON.parse(r.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    assert.equal(ld["@type"], "SoftwareApplication");
    assert.equal(ld.name, "RSLNT");
    assert.equal(ld.offers.price, "0");
  });

  test("met sessie levert / de app", async () => {
    assert.ok(koekje, "inloggen in de voorbereiding is mislukt");
    const r = await app.inject({ method: "GET", url: "/", headers: { cookie: koekje } });
    assert.equal(r.statusCode, 200);
    assert.ok(r.body.includes('id="kop"'), "de app ontbreekt");
    assert.ok(!r.body.includes("Sterker worden, zonder giswerk."), "dit is de startpagina, niet de app");
  });

  test("robots.txt en sitemap.xml worden geserveerd", async () => {
    const rob = await app.inject({ method: "GET", url: "/robots.txt" });
    assert.equal(rob.statusCode, 200);
    assert.ok(rob.body.includes("Sitemap: https://rslnt.luzex.nl/sitemap.xml"));

    const kaart = await app.inject({ method: "GET", url: "/sitemap.xml" });
    assert.equal(kaart.statusCode, 200);
    assert.ok(kaart.body.includes("<loc>https://rslnt.luzex.nl/</loc>"));
  });
});
