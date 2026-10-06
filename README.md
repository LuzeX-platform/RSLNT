# LuzeX RSLNT

Persoonlijke trainings- en herstel-app: je programma (nu Benen / Push / Pull) loggen in de
sportschool, met een voorstel voor de volgende keer (dubbele progressie, met kniepijn als
vangrail), een gezondheidsmenu, een voortgangsdashboard, een herstelcheck, een
oefeningenbibliotheek, een schema op maat en een Wetenschap-pagina die per regel en formule
laat zien waar die vandaan komt.
Eén gebruiker, achter een login, gemaakt voor de iPhone (op het beginscherm als app).

Dezelfde stack en huisstijl als ACCRD en CMMNTY, maar **volledig los** daarvan: eigen database,
eigen deployment, eigen geheimen.

| Onderdeel   | Keuze (gelijk aan ACCRD en CMMNTY) |
|-------------|------------------------------------|
| Backend     | Node 22, Fastify 5, TypeScript |
| Database    | PostgreSQL 16 via Prisma 5 |
| Frontend    | Losse HTML/CSS/JS, geserveerd door dezelfde server (geen build-stap) |
| Inloggen    | E-mail + wachtwoord (Argon2id), sessie in een httpOnly-cookie (90 dagen) |
| Hosting     | Render (Blueprint in `render.yaml`), regio Frankfurt |

## Fases

| Fase | Wat | Status |
|------|-----|--------|
| 1 | Loggen en progressie: sets, vorige keer, voorstel, lichaamsgewicht | **gebouwd** |
| 1b | Programma's als JSON, A/B/C-rotatie, introfase, deload, stagnatieregel, doel-RIR, rusttimer, wisselen, Wetenschap-pagina | **gebouwd** |
| 2 | Gezondheidsmenu (lengte, vet%, BMI, FFMI, calorie- en eiwitdoel, tempo en doeldatum), dashboard (gewicht vs. doeltempo, e1RM, sets per spiergroep, volle trainingen), herstelcheck | **gebouwd** |
| 3 | Oefeningenbibliotheek (876 oefeningen, publiek domein) en personalisatiemenu met schemavoorstel | **gebouwd** |
| 4 | Garmin: HRV, rusthartslag, slaap, Body Battery (7 vs. 60 dagen) | — |
| 5 | AI-coach: Claude past het voorstel aan binnen vaste opties | — |

Een fase begint pas als de vorige in de sportschool werkt.

## Wat zit erin

- **Vandaag** — welke training aan de beurt is (A → B → C → A …, los van de weekdag), de duur,
  de fase van je programma (introfase, deload, week), een rustdag-advies, gewicht invoeren met
  7-daags gemiddelde, recente trainingen. Knop "Ik heb een deload nodig".
- **Training** — per oefening: doel (sets × reps, RIR, rusttijd), techniek-cue, wat je vorige keer
  deed, het voorstel met de reden en een link naar de onderbouwing. Per set gewicht, reps, RIR
  (0–4) en optioneel kniepijn (0–10). Na elke set loopt de **rusttimer** (met +30 s).
  **Wisselen** naar een alternatief uit je programma als een machine bezet is. Opwarmen bovenaan.
  Na het afronden: het voorstel voor de volgende keer.
- **Herstelcheck** (op Vandaag) — slaap, energie, spierpijn en kniepijn (1–5) vóór je training.
  Geen totaalscore: vier losse signalen naast je eigen gemiddelde. Twee keer in de laatste drie
  checks twee of meer "let op" → voorstel om een deload te overwegen.
- **Lichaam** — gemiddeld gewicht en je tempo (kg/week, lijn door 4 weken wegingen) naast je
  doeltempo, met bijsturing in kcal en een datum voor je doelgewicht. BMI, taille/lengte,
  vetpercentage (zelf ingevuld of geschat uit taille en nek), vetvrije massa en FFMI. Rust- en
  dagelijks verbruik, calorieën om aan te komen (+5–15%) en eiwit (1,6–2,2 g/kg). Metingen
  (vet%, taille, nek, heup, arm, borst, dij) en je profiel (lengte, geboortedatum, geslacht,
  activiteit, doelgewicht, doeltempo). Doel en tempo komen uit je programma tenzij je ze zelf
  instelt. Alle wegingen staan op een eigen pagina (`/gewicht.html`).
- **Voortgang** — per 4 weken tot 1 jaar: gewicht met 7-daags gemiddelde naast een doeltempoband,
  sets per spiergroep per week (fractioneel, met een lijn bij 10), trainingen die voor één spier
  boven ~11 sets uitkomen, geschatte 1RM per oefening en records. Grafieken zijn eigen SVG
  (geen bibliotheek), met tooltip, tabelweergave en een eigen donkere modus.
- **Schema** — de trainingen van het actieve programma aanpassen (oefeningen, volgorde, sets,
  min. sets, rep-range, RIR, rust, superset, cue). Oefeningen toevoegen met gewichtsstap en
  "knie-gevoelig". **Programma's** inladen als JSON (eerst gecontroleerd), activeren en terug
  downloaden.
- **Oefeningen** (via Schema) — 876 oefeningen uit Free Exercise DB met foto's en uitleg (Engels),
  zoeken ook in het Nederlands ("bankdrukken", "kuit"), filters op spiergroep, materiaal,
  beweging en knievriendelijk. Per oefening: spieren, materiaal, cue, favoriet of "niet voor
  mij", toevoegen aan een training en vergelijkbare oefeningen. In een training en in de
  schema-editor staat bij elke gekoppelde oefening een link naar de uitleg.
- **Schema op maat** (via Schema) — doel, ervaring, dagen per week, minuten per training,
  materiaal, klachten (knie, schouder, onderrug), extra aandacht en doelgewicht met datum. Je
  krijgt een voorstel met per training de oefeningen, sets, reps, RIR en rust, het weekvolume
  per spiergroep naast het doel, en wat er niet past. Downloaden als JSON, of inladen als
  programma "Op maat" (met of zonder activeren). Oefeningen die je al deed houden hun sleutel
  en dus hun geschiedenis. Hoe het werkt: Wetenschap → "Schema op maat".
- **Wetenschap** — per regel: wat het onderzoek zegt, wat RSLNT ermee doet, hoe zeker het is
  (meta-analyse, studie, consensus, preprint, praktijkregel) en de bron. Openbaar leesbaar.
- **Offline** — valt het bereik weg, dan blijven opgeslagen sets op de telefoon staan en gaan
  ze vanzelf door zodra er weer verbinding is. Pagina's die je al open had blijven werken.

## Programma's

Een programma is een JSON-bestand met `schema_version: 1`: zie
`backend/programmas/benen-push-pull.json` (het meegeleverde programma) en de uitleg op de
Wetenschap-pagina onder "Het programmabestand". De seed laadt dit bestand bij de eerste start in
en maakt het actief. Daarna beheer je programma's in de app.

- Zelfde `program.id` opnieuw inladen = bijwerken; oefeningen met hetzelfde `id` houden hun
  geschiedenis.
- Activeren begint het programma opnieuw bij week 1 (met de introfase).
- Regels uit het bestand die RSLNT anders of (nog) niet uitvoert, komen als waarschuwing terug.
  De kniepijnregel is altijd de afgesproken regel hieronder.

## De regels

In `backend/src/progressie.ts` en `backend/src/fase.ts`, pure functies met unittests. De
formules van het gezondheidsmenu en dashboard staan in `lichaam.ts`, `voortgang.ts` en
`herstel.ts`, de schemagenerator in `generator.ts` (met de basislijst in `catalogus.ts`), met
de bronnen op de Wetenschap-pagina. Per
oefening, op basis van de vorige keer(en) dat je die oefening deed:

1. **Kniepijn gaat voor alles** (alleen bij knie-gevoelige oefeningen). Hoogste kniepijn vorige
   keer **≥ 4**, of **stijgend** (≥ 2 punten hoger dan de keer daarvoor, of drie trainingen op
   rij hoger) → **10% terug**, naar beneden afgerond op de gewichtsstap, minimaal één stap.
2. **Deloadweek** → zelfde gewicht, halve sets (naar boven afgerond). Automatisch elke 8e week
   van het programma, of op verzoek voor 7 dagen.
3. **Stagnatie**: twee trainingen op rij meer dan de helft van de sets onder de onderkant van de
   range → 10% terug en opnieuw opbouwen.
4. **Alle sets op de bovenkant van de range** (minstens het geplande minimum) **met minstens de
   doel-RIR over** → **één kleinste stap omhoog**. Nooit meer dan één stap per training.
5. **Anders** → zelfde gewicht.

- **Introfase**: de eerste 2 weken van een programma 2 sets per oefening en RIR 3.
- Werkgewicht bij wisselende gewichten: het laagste.
- De rep-range van nú telt; aantal sets en doel-RIR komen van de dag zelf (intro/deload).
- Deloadtrainingen tellen niet mee voor stagnatie en progressie, wel voor de kniepijnregel.
- Niet ingevulde RIR of kniepijn is onbekend, niet 0.
- Zonder gewichtsstap (dead bug): alle sets op de bovenkant → "moeilijkere variant".
- Eerste keer: geen voorstel, je kiest zelf.

## Oefeningenbibliotheek bijwerken

`backend/data/bibliotheek.json` is een omgezette, vastgepinde versie van
[Free Exercise DB](https://github.com/yuhonas/free-exercise-db) (publiek domein, licentie in
`backend/data/bibliotheek-LICENSE.md`). Alleen nodig als je de bron wilt bijwerken: zet de nieuwe
commit in `BRON_COMMIT` (`backend/src/bibliotheekOmzetten.ts`), en dan

```bash
curl -o /tmp/fedb.json https://raw.githubusercontent.com/yuhonas/free-exercise-db/<commit>/dist/exercises.json
cd backend && npm run bibliotheek -- /tmp/fedb.json && npm test
```

## Lokaal draaien

```bash
docker compose up -d                  # PostgreSQL 16 (of gebruik een eigen Postgres)
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run seed                          # ik@luzex.local / wijzig-dit-meteen + Benen / Push / Pull
npm run dev                           # http://localhost:4200
```

## Tests

```bash
cd backend
npm run typecheck
npm test                              # unit tests
# Plus integratietests (maken de tabellen leeg — gebruik een aparte database!):
TEST_DATABASE_URL=postgresql://…/rslnt_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://…/rslnt_test npm test
```

GitHub Actions draait beide bij elke push (`.github/workflows/test.yml`).

## Naar Render

1. Render → **New + → Blueprint** → kies deze repository → **Apply**.
2. Vul bij het aanmaken in: `SEED_EMAIL`, `SEED_WACHTWOORD` (minimaal 10 tekens) en `SEED_NAAM`.
   Het account wordt bij de eerste start aangemaakt; het wachtwoord wijzig je daarna in de app
   onder *Account*.
3. Eigen domein: in Render *Settings → Custom Domains* `rslnt.luzex.nl` toevoegen en bij Vimexx
   een CNAME `rslnt` → `luzex-rslnt.onrender.com.` aanmaken.
4. Op de iPhone: open het adres in Safari → deelknop → **Zet op beginscherm**, en log daar één
   keer in (de app op het beginscherm heeft eigen cookies).

Render bouwt bij elke push naar `main` automatisch opnieuw.

### Kosten (Render, indicatief)

Web service *starter* ± $7 en database *basic-256mb* ± $6 per maand. In fase 4 komt er een
cron voor de Garmin-sync bij (± $1).
