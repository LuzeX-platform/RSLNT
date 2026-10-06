# CLAUDE.md — LuzeX RSLNT

Zie README.md voor wat de app doet en hoe je hem draait. Hier de afspraken voor wie code schrijft.

## Stack en structuur (bewust gelijk aan ACCRD en CMMNTY)

```
backend/            Fastify 5 + Prisma 5 + PostgreSQL 16, TypeScript (ESM, NodeNext)
  src/app.ts          bouwApp(): plugins, CSP, CSRF-Origin-check, routes, statische frontend
  src/routes/         auth, schemas (+ oefeningen), programmas (import/activeren/deload),
                      trainingen (+ sets, wisselen, /api/vandaag), lichaamsgewicht,
                      lichaam (profiel, metingen, /api/lichaam), herstel, voortgang,
                      bibliotheek (zoeken, detail, favoriet, toevoegen), personalisatie (voorkeuren, voorstel)
  src/progressie.ts   pure logica: voorstel volgende keer (dubbele progressie, kniepijn, stagnatie, deload, RIR)
  src/fase.ts         pure logica: programmaweek, introfase, deload en het doel in die fase
  src/programmaImport.ts  programma-JSON (schema_version 1) valideren en inladen
  src/gewicht.ts      pure logica: 7-daags gemiddelde
  src/lichaam.ts      pure logica: BMI, taille/lengte, vet% (Navy), FFMI, BMR, verbruik, calorie- en
                      eiwitdoel, tempo (trendlijn), tempo-advies, doeldatum
  src/voortgang.ts    pure logica: e1RM (Epley + RIR), fractionele sets, weekstart, volle trainingen
  src/herstel.ts      pure logica: herstelsignalen en "deload overwegen"
  src/spieren.ts      spiergroeplabels en doelgewicht/-tempo uit de programma-JSON
  src/bibliotheekOmzetten.ts  pure vertaling Free Exercise DB → RSLNT (spieren, materiaal, patroon, knie)
  src/bibliotheekBouwen.ts    CLI: bouwt data/bibliotheek.json (npm run bibliotheek -- <exercises.json>)
  src/bibliotheek.ts  bibliotheek in het geheugen, zoeken (ook Nederlands), vergelijkbare oefeningen
  src/catalogus.ts    basislijst (84) met cues en blessurevlaggen; sleutels gelijk aan Benen / Push / Pull
  src/generator.ts    pure logica: voorkeuren → programmabestand (split, oefeningkeuze, sets, tijd, klachten)
data/               bibliotheek.json (876 oefeningen, vastgepinde bron) + licentie van de bron
  src/datum.ts        kalenderdagen in Europe/Amsterdam (de server draait in UTC)
  src/trainingData.ts database rond een training: geschiedenis ophalen, voorstel laten berekenen
programmas/         meegeleverde programma's (JSON); de seed laadt benen-push-pull.json in
  test/               node:test via tsx; api.test.ts draait alleen met TEST_DATABASE_URL
frontend/           losse HTML + één script per pagina, geen build-stap
  styles.css          design tokens 1-op-1 uit CMMNTY/ACCRD + RSLNT-componenten
  common.js           balk, tabbalk (Vandaag, Lichaam, Voortgang, Schema, Wetenschap), api(),
                      sessie, offline-wachtrij — door elke pagina geladen
  grafiek.js          SVG-grafieken zonder bibliotheek: tijdGrafiek (punten, lijn, band) en staafGrafiek
                      (met referentielijn of een doel per rij)
  bibliotheek.js      lijst (filters in de URL) en detail (?id=) van de oefeningenbibliotheek
  personaliseren.js   schema op maat: voorkeuren, voorstel, inladen via /api/programmas/import
  sw.js               service worker: netwerk eerst, cache als terugval
  wetenschap.html     openbare pagina: per regel het onderzoek, de zekerheid en de bron
```

## Afspraken

- **Nederlands** in UI, code-identifiers en commentaar, zoals in ACCRD en CMMNTY.
- **Geen inline scripts of event handlers** in HTML: de CSP staat alleen `script-src 'self'` toe.
- **Huisstijl**: tokens niet herdefiniëren. Wijzig je er één, doe het dan ook in ACCRD en CMMNTY.
- **Eén gebruiker**: trainingsdata hangt niet aan een Gebruiker. Het account is er alleen voor de login.
- **Pure logica los van de database** (progressie.ts, gewicht.ts), zodat die testbaar blijft.
- **Voorstellen worden niet opgeslagen** maar bij elke weergave berekend uit de geschiedenis vóór
  die training. Een training bewaart wel een momentopname van het schema (sets/range), zodat een
  schemawijziging de geschiedenis niet herschrijft.
- **De kniepijnregel en max één stap omhoog zijn harde regels.** De AI-coach (fase 5) mag het
  voorstel alleen binnen die grenzen aanpassen; bouw de vangrail in code ná de AI, niet in de prompt.
- **Schrijfacties tijdens een training gaan via de offline-wachtrij** (`verstuurViaWachtrij` in
  common.js) en moeten daarom idempotent zijn: sets via PUT op een vaste plek
  (training/oefening/setnummer), afronden mag twee keer binnenkomen.
- **Wetenschap-pagina bijwerken bij elke regelwijziging.** Elke regel in progressie.ts/fase.ts
  heeft daar een sectie (anker = `waaromAnker()` in training.js). Eerlijk over de zekerheid:
  preprints en praktijkregels heten zo.
- **Oefeningen hebben een vaste sleutel** (gelijk aan `exercise.id` in een programma-JSON). Een
  import werkt oefeningen op sleutel bij, zodat de geschiedenis blijft. Wissel nooit een sleutel.
- **Een training legt zijn fase vast** (intro/deload, aantal sets, doel-RIR) bij het starten.
- **Grafieken**: kleuren alleen via de `--grafiek-*`-tokens in styles.css (licht en donker apart
  gekozen en gecontroleerd op contrast). Eén y-as per grafiek, altijd een tooltip en een
  tabelweergave, een legenda vanaf twee reeksen.
- **Geen totaalscore voor herstel**: de vier signalen blijven los. De herstelcheck verandert het
  gewichtsvoorstel niet; hij stelt hooguit een deload voor.
- **Het schema op maat is gewoon een programmabestand.** De generator schrijft schema_version 1
  en de import doet de rest; bouw geen tweede weg naar de database. Een oefening die al bestaat
  (op sleutel, bibliotheek-id of naam) wordt hergebruikt met haar eigen gegevens, zodat een
  import niets overschrijft wat je zelf aanpaste. Elke combinatie van voorkeuren moet een geldig
  bestand opleveren: dat test generator.test.ts voor alle doelen, niveaus, dagen en opstellingen.
- **Bibliotheek is vastgepind** (BRON_COMMIT); afbeeldingen komen van raw.githubusercontent.com
  op die commit (staat in de CSP). De uitleg blijft Engels; schrijf geen vertalingen in de data.
- **Formules alleen in de backend** (lichaam.ts, voortgang.ts); de frontend toont wat de API
  teruggeeft. Elke formule heeft een sectie op de Wetenschap-pagina.
- **Mobiel eerst**: alles wat je tijdens een training aanraakt is minstens 44px hoog,
  invoervelden minstens 16px (anders zoomt iOS in).
- Sessiecookie is `SameSite=Lax` zoals CMMNTY; CSRF blijft gedekt door de Origin-check.

## Later

Fase 4 (Garmin via de Python-bibliotheek `garminconnect`,
als aparte Render-cron die in dezelfde database schrijft), fase 5 (AI-coach via de Anthropic SDK).
