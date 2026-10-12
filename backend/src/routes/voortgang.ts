import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { metGemiddelde } from "../gewicht.js";
import { aanbevolenTempo } from "../lichaam.js";
import {
  besteE1rm,
  dagVan,
  fractioneleSets,
  SETS_PER_TRAINING_GRENS,
  SETS_PER_WEEK_REFERENTIE,
  teVolPerTraining,
  type SetSpieren,
} from "../voortgang.js";
import { ALLE_SPIER_LABELS, programmaDoel, spierLabels } from "../spieren.js";

export async function voortgangRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get<{ Querystring: { weken?: string } }>("/api/voortgang", async (request) => {
    const weken = Math.min(Math.max(Number(request.query.weken) || 12, 4), 104);
    const dag = vandaag();
    const vanaf = verschuifDag(dag, -(weken * 7 - 1));
    const g = gid(request);
    const [programma, profiel, wegingen, trainingen] = await Promise.all([
      prisma.programma.findFirst({
        where: { gebruikerId: g, actief: true },
        include: {
          schemas: {
            where: { inRotatie: true },
            orderBy: { volgorde: "asc" },
            include: { oefeningen: { include: { oefening: true } } },
          },
        },
      }),
      prisma.profiel.findUnique({ where: { gebruikerId: g } }),
      prisma.lichaamsgewicht.findMany({ where: { gebruikerId: g, datum: { gte: naarDatum(verschuifDag(vanaf, -6)) } }, orderBy: { datum: "asc" } }),
      prisma.training.findMany({
        where: { gebruikerId: g },
        orderBy: { datum: "asc" },
        include: { oefeningen: { orderBy: { volgorde: "asc" }, include: { oefening: true, sets: true } } },
      }),
    ]);
    const labels = spierLabels(programma?.bron ?? null);
    const label = (spier: string) => labels[spier] ?? ALLE_SPIER_LABELS[spier] ?? spier;

    // ---------- Gewicht met doelband ----------
    const metingen = wegingen.map((w) => ({ datum: uitDatum(w.datum), gewicht: w.gewicht }));
    const reeks = metGemiddelde(metingen)
      .filter((m) => m.datum >= vanaf)
      .reverse();
    const doelUitProgramma = programmaDoel(programma?.bron ?? null);
    const doelgewicht = profiel?.doelgewicht ?? doelUitProgramma.gewicht;
    const start = reeks[0];
    const standaard = start ? aanbevolenTempo(start.gemiddelde7) : null;
    const band = start
      ? {
          startDatum: start.datum,
          startGewicht: start.gemiddelde7,
          tempoMin: profiel?.tempoMin ?? doelUitProgramma.tempoMin ?? standaard!.min,
          tempoMax: profiel?.tempoMax ?? doelUitProgramma.tempoMax ?? standaard!.max,
        }
      : null;

    // ---------- Sets per spiergroep (gelogde sets) ----------
    // De staaf: je laatste 7 dagen, vandaag meegerekend. Die werkt na elke training bij en is op
    // maandag niet ineens leeg (een kalenderweek wel). Het streepje: gemiddeld per week over de
    // blokken van 7 dagen dáárvoor, binnen de gekozen periode en vanaf het blok van je eerste
    // training. Zo drukt een net begonnen week het gemiddelde niet, en telt een week zonder
    // training wel mee als 0.
    const setsTussen = (van: string, tot: string) =>
      fractioneleSets(
        trainingen
          .filter((t) => {
            const d = dagVan(t.datum);
            return d >= van && d <= tot;
          })
          .flatMap((t) =>
            t.oefeningen.map((to) => ({
              spierenPrimair: to.oefening.spierenPrimair,
              spierenSecundair: to.oefening.spierenSecundair,
              sets: to.sets.length,
            })),
          ),
      );
    const recentVan = verschuifDag(dag, -6);
    const recent = setsTussen(recentVan, dag);
    const eerste = trainingen.find((t) => dagVan(t.datum) >= vanaf);
    const blokken: { van: string; sets: Record<string, number> }[] = [];
    if (eerste) {
      const eersteDag = dagVan(eerste.datum);
      for (let tot = verschuifDag(recentVan, -1); tot >= eersteDag; tot = verschuifDag(tot, -7)) {
        const van = verschuifDag(tot, -6);
        blokken.push({ van, sets: setsTussen(van, tot) });
      }
    }
    const spieren = [...new Set([...Object.keys(recent), ...blokken.flatMap((b) => Object.keys(b.sets)), ...Object.keys(labels)])];
    const volume = spieren
      .map((spier) => ({
        spier,
        label: label(spier),
        recent: recent[spier] ?? 0,
        gemiddeld: blokken.length ? Math.round((blokken.reduce((som, b) => som + (b.sets[spier] ?? 0), 0) / blokken.length) * 10) / 10 : null,
      }))
      .sort((a, b) => b.recent - a.recent || (b.gemiddeld ?? 0) - (a.gemiddeld ?? 0) || a.label.localeCompare(b.label));

    // ---------- Gepland volume per training (uit het actieve programma) ----------
    const perTraining = (programma?.schemas ?? []).map((s) => {
      const regels = s.oefeningen.map((r) => ({
        spierenPrimair: r.oefening.spierenPrimair,
        spierenSecundair: r.oefening.spierenSecundair,
        sets: r.aantalSets,
      }));
      return {
        code: s.code,
        naam: s.naam,
        teVol: teVolPerTraining(regels).map((t) => ({ ...t, label: label(t.spier) })),
      };
    });

    // ---------- Geschatte 1RM per oefening, per training de beste set ----------
    // Volgorde: wat je het laatst deed eerst, binnen een training in de volgorde van je schema.
    // De grafiek opent op de eerste: na een training zie je dus meteen die training terug.
    type Kracht = { id: string; naam: string; punten: { datum: string; e1rm: number }[]; laatst: number; volgorde: number };
    const perOefening = new Map<string, Kracht>();
    for (const t of trainingen) {
      for (const to of t.oefeningen) {
        if (to.oefening.gewichtsstap <= 0) continue;
        const beste = besteE1rm(to.sets);
        if (beste === null) continue;
        const rij = perOefening.get(to.oefeningId) ?? { id: to.oefeningId, naam: to.oefening.naam, punten: [], laatst: 0, volgorde: 0 };
        rij.punten.push({ datum: dagVan(t.datum), e1rm: beste });
        rij.laatst = t.datum.getTime();
        rij.volgorde = to.volgorde;
        perOefening.set(to.oefeningId, rij);
      }
    }
    const oefeningen = [...perOefening.values()]
      .sort((a, b) => b.laatst - a.laatst || a.volgorde - b.volgorde || a.naam.localeCompare(b.naam))
      .map(({ laatst: _laatst, volgorde: _volgorde, ...o }) => ({ ...o, record: o.punten.reduce((a, b) => (b.e1rm > a.e1rm ? b : a)) }));

    return {
      vandaag: dag,
      gewicht: { reeks, band, doelgewicht },
      volume: {
        recentVan,
        /** Aantal weken (blokken van 7 dagen) vóór de laatste 7 dagen in het gemiddelde. */
        weken: blokken.length,
        vanaf: blokken.length ? blokken[blokken.length - 1].van : null,
        referentie: SETS_PER_WEEK_REFERENTIE,
        rijen: volume,
      },
      perTraining: { grens: SETS_PER_TRAINING_GRENS, trainingen: perTraining },
      oefeningen,
    };
  });
}
