// Database rond de Pro-onderdelen: haalt op wat de pure modules (analyse.ts, belasting.ts,
// hybride.ts, pijnlogboek.ts) nodig hebben. Gedeeld door routes/pro.ts en de leeslink
// (routes/gedeeld.ts), zodat je trainer precies hetzelfde ziet als jij.

import { prisma } from "./db.js";
import { naarDatum, uitDatum, vandaag as vandaagDag, verschuifDag } from "./datum.js";
import { zevenDaagsGemiddelde } from "./gewicht.js";
import { besteE1rm, dagVan, fractioneleSets, setsVoorVolume } from "./voortgang.js";
import { isWerkset } from "./progressie.js";
import { ALLE_SPIER_LABELS, spierLabels } from "./spieren.js";
import { krachtNiveau, krachtTrend, NIVEAU_LABELS, repRecords, richtgewichten, VOLUME_ZONES, volumePerWeek } from "./analyse.js";
import { pijnOverzicht } from "./pijnlogboek.js";
import { PIJN_PLEKKEN } from "./pijn.js";

export async function lichaamsgewichtNu(gebruikerId: string, dag = vandaagDag()): Promise<number | null> {
  const wegingen = await prisma.lichaamsgewicht.findMany({
    where: { gebruikerId, datum: { gte: naarDatum(verschuifDag(dag, -27)), lte: naarDatum(dag) } },
    orderBy: { datum: "desc" },
  });
  const gemiddelde = zevenDaagsGemiddelde(wegingen.map((w) => ({ datum: uitDatum(w.datum), gewicht: w.gewicht })), dag);
  return gemiddelde ?? wegingen[0]?.gewicht ?? null;
}

async function alleTrainingen(gebruikerId: string, vanaf?: string) {
  return prisma.training.findMany({
    where: { gebruikerId, ...(vanaf ? { datum: { gte: naarDatum(vanaf) } } : {}) },
    orderBy: { datum: "asc" },
    include: { schema: { select: { code: true, naam: true } }, oefeningen: { orderBy: { volgorde: "asc" }, include: { oefening: true, sets: { orderBy: { nummer: "asc" } } } } },
  });
}

/** Krachttrend, records, richtgewichten en krachtniveau per oefening, plus volume in zones. */
export async function krachtAnalyse(gebruikerId: string) {
  const dag = vandaagDag();
  const [trainingen, profiel, lichaamsgewicht, programma] = await Promise.all([
    alleTrainingen(gebruikerId),
    prisma.profiel.findUnique({ where: { gebruikerId } }),
    lichaamsgewichtNu(gebruikerId, dag),
    prisma.programma.findFirst({ where: { gebruikerId, actief: true }, select: { bron: true } }),
  ]);

  type Rij = {
    id: string;
    naam: string;
    sleutel: string;
    stap: number;
    punten: { datum: string; e1rm: number }[];
    sets: { gewicht: number | null; reps: number; datum: string }[];
    laatst: number;
  };
  const perOefening = new Map<string, Rij>();
  for (const t of trainingen) {
    const d = dagVan(t.datum);
    for (const to of t.oefeningen) {
      if (to.oefening.gewichtsstap <= 0) continue;
      const werk = to.sets.filter(isWerkset);
      const beste = besteE1rm(werk);
      if (beste === null) continue;
      const rij = perOefening.get(to.oefeningId) ?? {
        id: to.oefeningId,
        naam: to.oefening.naam,
        sleutel: to.oefening.sleutel,
        stap: to.oefening.gewichtsstap,
        punten: [],
        sets: [],
        laatst: 0,
      };
      rij.punten.push({ datum: d, e1rm: beste });
      rij.sets.push(...werk.map((s) => ({ gewicht: s.gewicht, reps: s.reps, datum: d })));
      rij.laatst = t.datum.getTime();
      perOefening.set(to.oefeningId, rij);
    }
  }
  const geslacht = profiel?.geslacht ?? null;
  const oefeningen = [...perOefening.values()]
    .sort((a, b) => b.laatst - a.laatst || a.naam.localeCompare(b.naam))
    .map((r) => {
      // "Nu": het beste van je laatste drie trainingen, zodat één slechte dag het niet bepaalt.
      const nu = Math.max(...r.punten.slice(-3).map((p) => p.e1rm));
      const niveau = krachtNiveau(r.sleutel, nu, lichaamsgewicht, geslacht);
      return {
        id: r.id,
        naam: r.naam,
        e1rm: nu,
        trend: krachtTrend(r.punten, dag),
        records: repRecords(r.sets),
        richtgewichten: richtgewichten(nu, r.stap),
        niveau: niveau && {
          ...niveau,
          niveauLabel: NIVEAU_LABELS[niveau.niveau],
          volgende: niveau.volgende && { ...niveau.volgende, label: NIVEAU_LABELS[niveau.volgende.niveau] },
        },
      };
    });

  // Volume: 8 blokken van 7 dagen, het laatste eindigt vandaag.
  const AANTAL = 8;
  const blokken: { van: string; tot: string }[] = [];
  for (let i = AANTAL - 1; i >= 0; i--) {
    const tot = verschuifDag(dag, -7 * i);
    blokken.push({ van: verschuifDag(tot, -6), tot });
  }
  const perBlok = blokken.map(({ van, tot }) =>
    fractioneleSets(
      trainingen
        .filter((t) => {
          const d = dagVan(t.datum);
          return d >= van && d <= tot;
        })
        .flatMap((t) => t.oefeningen.map((to) => ({ ...to.oefening, sets: setsVoorVolume(to.sets) }))),
    ),
  );
  const eersteDag = trainingen[0] ? dagVan(trainingen[0].datum) : null;
  const telVanaf = eersteDag ? blokken.findIndex((b) => b.tot >= eersteDag) : AANTAL;
  const labels = spierLabels(programma?.bron ?? null);
  return {
    vandaag: dag,
    lichaamsgewicht,
    geslacht,
    oefeningen,
    volume: {
      blokken,
      zones: VOLUME_ZONES,
      telVanaf: telVanaf < 0 ? AANTAL : telVanaf,
      rijen: volumePerWeek(perBlok, telVanaf < 0 ? AANTAL : telVanaf).map((r) => ({
        ...r,
        label: labels[r.spier] ?? ALLE_SPIER_LABELS[r.spier] ?? r.spier,
      })),
    },
  };
}

/** Het pijnlogboek: overzicht per plek en je notities. */
export async function pijnLogboek(gebruikerId: string, weken = 12) {
  const dag = vandaagDag();
  const vanaf = verschuifDag(dag, -(weken * 7 - 1));
  const [sets, checks, notities] = await Promise.all([
    prisma.trainingSet.findMany({
      where: { pijn: { not: null }, trainingOefening: { training: { gebruikerId, datum: { gte: naarDatum(vanaf) } } } },
      include: { trainingOefening: { include: { oefening: { select: { naam: true } }, training: { select: { datum: true } } } } },
    }),
    prisma.herstelcheck.findMany({ where: { gebruikerId, datum: { gte: naarDatum(vanaf) } } }),
    prisma.pijnnotitie.findMany({ where: { gebruikerId }, orderBy: [{ datum: "desc" }, { aangemaaktOp: "desc" }] }),
  ]);
  const overzicht = pijnOverzicht(
    sets.map((s) => ({
      dag: dagVan(s.trainingOefening.training.datum),
      oefening: s.trainingOefening.oefening.naam,
      pijn: s.pijn as number,
      plek: s.pijnPlek,
    })),
    checks.map((c) => ({ dag: uitDatum(c.datum), pijn: c.pijn, plekken: c.pijnPlekken })),
    dag,
    weken,
  );
  return {
    vandaag: dag,
    vanaf,
    weken,
    plekken: overzicht,
    notities: notities.map((n) => ({
      id: n.id,
      datum: uitDatum(n.datum),
      plek: n.plek,
      plekLabel: PIJN_PLEKKEN[n.plek as keyof typeof PIJN_PLEKKEN] ?? n.plek,
      ernst: n.ernst,
      notitie: n.notitie,
      status: n.status,
      herstelOp: n.herstelOp ? uitDatum(n.herstelOp) : null,
    })),
  };
}

export async function duurLijst(gebruikerId: string, dagen = 90) {
  const vanaf = verschuifDag(vandaagDag(), -(dagen - 1));
  const rijen = await prisma.duurtraining.findMany({
    where: { gebruikerId, datum: { gte: naarDatum(vanaf) } },
    orderBy: [{ datum: "desc" }, { aangemaaktOp: "desc" }],
  });
  return rijen.map((d) => ({
    id: d.id,
    datum: uitDatum(d.datum),
    soort: d.soort,
    minuten: d.minuten,
    afstandMeter: d.afstandMeter,
    intensiteit: d.intensiteit,
    notitie: d.notitie,
  }));
}

/** Afgeronde trainingen met sets, nieuwste eerst (zonder notities: die blijven van jou). */
export async function recenteTrainingen(gebruikerId: string, aantal = 20) {
  const trainingen = await prisma.training.findMany({
    where: { gebruikerId, status: "afgerond" },
    orderBy: { datum: "desc" },
    take: aantal,
    include: {
      schema: { select: { code: true, naam: true } },
      oefeningen: {
        orderBy: { volgorde: "asc" },
        include: {
          oefening: { select: { naam: true } },
          sets: { orderBy: { nummer: "asc" }, select: { nummer: true, gewicht: true, reps: true, rir: true, pijn: true, pijnPlek: true, soort: true } },
        },
      },
    },
  });
  return trainingen.map((t) => ({
    datum: t.datum,
    schemaCode: t.schema.code,
    schemaNaam: t.schema.naam,
    fase: t.fase,
    blok: t.blok,
    oefeningen: t.oefeningen
      .filter((o) => o.sets.length > 0)
      .map((o) => ({ naam: o.oefening.naam, repsMin: o.repsMin, repsMax: o.repsMax, sets: o.sets })),
  })).filter((t) => t.oefeningen.length > 0);
}
