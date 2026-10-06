import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireIngelogd } from "../plugins/requireAuth.js";
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
  weekStart,
  type SetSpieren,
} from "../voortgang.js";
import { ALLE_SPIER_LABELS, programmaDoel, spierLabels } from "../spieren.js";

export async function voortgangRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get<{ Querystring: { weken?: string } }>("/api/voortgang", async (request) => {
    const weken = Math.min(Math.max(Number(request.query.weken) || 12, 4), 104);
    const dag = vandaag();
    const vanaf = verschuifDag(dag, -(weken * 7 - 1));
    const [programma, profiel, wegingen, trainingen] = await Promise.all([
      prisma.programma.findFirst({
        where: { actief: true },
        include: {
          schemas: {
            where: { inRotatie: true },
            orderBy: { volgorde: "asc" },
            include: { oefeningen: { include: { oefening: true } } },
          },
        },
      }),
      prisma.profiel.findUnique({ where: { id: "ik" } }),
      prisma.lichaamsgewicht.findMany({ where: { datum: { gte: naarDatum(verschuifDag(vanaf, -6)) } }, orderBy: { datum: "asc" } }),
      prisma.training.findMany({
        orderBy: { datum: "asc" },
        include: { oefeningen: { include: { oefening: true, sets: true } } },
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
    // Gemiddeld per week over de gekozen periode, gerekend vanaf de week van je eerste training
    // daarin. De lopende week telt alleen mee als er nog geen volle week is: anders drukt een
    // halve week het gemiddelde.
    const dezeWeek = weekStart(dag);
    const perWeek = (begin: string) => {
      const eind = verschuifDag(begin, 6);
      const regels: SetSpieren[] = trainingen
        .filter((t) => {
          const d = dagVan(t.datum);
          return d >= begin && d <= eind;
        })
        .flatMap((t) =>
          t.oefeningen.map((to) => ({
            spierenPrimair: to.oefening.spierenPrimair,
            spierenSecundair: to.oefening.spierenSecundair,
            sets: to.sets.length,
          })),
        );
      return fractioneleSets(regels);
    };
    const eerste = trainingen.find((t) => dagVan(t.datum) >= vanaf);
    const weekStarts: string[] = [];
    for (let w = eerste ? weekStart(dagVan(eerste.datum)) : dezeWeek; w <= dezeWeek; w = verschuifDag(w, 7)) weekStarts.push(w);
    const telWeken = weekStarts.length > 1 ? weekStarts.slice(0, -1) : weekStarts;
    const setsPerWeek = telWeken.map(perWeek);
    const nu = perWeek(dezeWeek);
    const spieren = [...new Set([...setsPerWeek.flatMap((w) => Object.keys(w)), ...Object.keys(nu), ...Object.keys(labels)])];
    const volume = spieren
      .map((spier) => ({
        spier,
        label: label(spier),
        gemiddeld: Math.round((setsPerWeek.reduce((som, w) => som + (w[spier] ?? 0), 0) / setsPerWeek.length) * 10) / 10,
        dezeWeek: nu[spier] ?? 0,
      }))
      .sort((a, b) => b.gemiddeld - a.gemiddeld || b.dezeWeek - a.dezeWeek || a.label.localeCompare(b.label));

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
    const perOefening = new Map<string, { id: string; naam: string; punten: { datum: string; e1rm: number }[] }>();
    for (const t of trainingen) {
      for (const to of t.oefeningen) {
        if (to.oefening.gewichtsstap <= 0) continue;
        const beste = besteE1rm(to.sets);
        if (beste === null) continue;
        const rij = perOefening.get(to.oefeningId) ?? { id: to.oefeningId, naam: to.oefening.naam, punten: [] };
        rij.punten.push({ datum: dagVan(t.datum), e1rm: beste });
        perOefening.set(to.oefeningId, rij);
      }
    }
    const oefeningen = [...perOefening.values()]
      .map((o) => {
        const record = o.punten.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
        return { ...o, record };
      })
      .sort((a, b) => b.punten.length - a.punten.length || a.naam.localeCompare(b.naam));

    return {
      vandaag: dag,
      gewicht: { reeks, band, doelgewicht },
      volume: {
        weekStart: dezeWeek,
        weken: telWeken.length,
        vanafWeek: telWeken[0],
        referentie: SETS_PER_WEEK_REFERENTIE,
        rijen: volume,
      },
      perTraining: { grens: SETS_PER_TRAINING_GRENS, trainingen: perTraining },
      oefeningen,
    };
  });
}
