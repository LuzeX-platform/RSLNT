# LuzeX RSLNT

Persoonlijke trainings- en herstel-app: full body schema A/B loggen in de sportschool, met een
voorstel voor de volgende training (dubbele progressie, met kniepijn als vangrail).
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
| 1 | Loggen en progressie: schema A/B, sets, vorige keer, voorstel, lichaamsgewicht | **gebouwd** |
| 2 | Dashboard: gewichtstrend vs. doel, e1RM per oefening, sets per spiergroep, herstelcheck | — |
| 3 | Garmin: HRV, rusthartslag, slaap, Body Battery (7 vs. 60 dagen) | — |
| 4 | AI-coach: Claude past het voorstel aan binnen vaste opties | — |

Een fase begint pas als de vorige in de sportschool werkt.

## Wat zit erin (fase 1)

- **Vandaag** — welke training aan de beurt is (A → B → A …), starten of verder gaan, gewicht
  invoeren met 7-daags gemiddelde, recente trainingen.
- **Training** — per oefening: wat je vorige keer deed, het voorstel met de reden, en per set
  gewicht, reps, RIR (0–4) en optioneel kniepijn (0–10). Grote +/−-knoppen, gewicht en reps
  staan al ingevuld. Notitie per training. Na het afronden: het voorstel voor de volgende keer.
- **Gewicht** — wegingen met het 7-daags gemiddelde per dag en het verschil met een week eerder.
- **Schema** — A en B aanpassen: oefeningen, volgorde, sets, minimum sets, rep-range, superset.
  Oefeningen toevoegen en per oefening de kleinste gewichtsstap instellen.
- **Offline** — valt het bereik weg, dan blijven opgeslagen sets op de telefoon staan en gaan
  ze vanzelf door zodra er weer verbinding is. Pagina's die je al open had blijven werken.

## De progressieregels

In `backend/src/progressie.ts`, pure functies met unittests. Per oefening, op basis van de
vorige keer dat je die oefening deed:

1. **Kniepijn gaat voor alles.** Hoogste kniepijn vorige keer **≥ 4**, of **stijgend** (≥ 2
   punten hoger dan de keer daarvoor, of drie trainingen op rij hoger) → **10% terug**, naar
   beneden afgerond op de gewichtsstap, minimaal één stap. Niet ingevulde kniepijn is onbekend,
   niet 0.
2. **Alle sets op de bovenkant van de range** (minstens "min. sets") → **één kleinste stap
   omhoog**. Nooit meer dan één stap per training, hoe ver je ook boven de range zat.
3. **Anders** → zelfde gewicht.

- Werkgewicht bij wisselende gewichten: het laagste.
- Het doel van nú telt: pas je de range aan, dan rekent de volgende training daarmee.
- Lichaamsgewicht-oefeningen (dead bug): alle sets op de bovenkant → "moeilijkere variant".
- Eerste keer: geen voorstel, je kiest zelf.
- RIR wordt gelogd en getoond, maar telt (nog) niet mee in de regel. Fase 2 gebruikt het voor
  de geschatte 1RM, fase 4 voor de AI-coach.

Standaard gewichtsstappen: dumbbells 2 kg (per dumbbell), stang/trap bar, kabel en machine
2,5 kg. Aan te passen per oefening onder *Schema → Oefeningen*.

## Lokaal draaien

```bash
docker compose up -d                  # PostgreSQL 16 (of gebruik een eigen Postgres)
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run seed                          # ik@luzex.local / wijzig-dit-meteen + schema A/B
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

Web service *starter* ± $7 en database *basic-256mb* ± $6 per maand. In fase 3 komt er een
cron voor de Garmin-sync bij (± $1).
