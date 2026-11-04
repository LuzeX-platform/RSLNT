// De leeslink (Pro): wat je trainer of fysio ziet zonder account. Het token komt in de body
// (de pagina leest het uit het #-deel van de URL), zodat het nooit in een serverlog of Referer
// staat. Alleen de onderdelen die je koos; nooit je notities, je lichaamsgegevens of je e-mail.
// Verlopen, ingetrokken, of heb je zelf geen Pro meer: dan werkt de link niet (fail-closed).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { heeftPro } from "../entitlementsPro.js";
import { vandaag } from "../datum.js";
import { duurLijst, krachtAnalyse, pijnLogboek, recenteTrainingen } from "../proData.js";
import { hashToken } from "./pro.js";
import { DUUR_SOORTEN, INTENSITEITEN } from "../hybride.js";

export async function gedeeldRoutes(app: FastifyInstance) {
  app.post(
    "/api/gedeeld",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const parsed = z.object({ token: z.string().min(20).max(100) }).safeParse(request.body);
      const ongeldigeLink = () => reply.code(404).send({ errorCode: "LINK_ONGELDIG", bericht: "Deze link is verlopen, ingetrokken of klopt niet." });
      if (!parsed.success) return ongeldigeLink();
      const link = await prisma.deellink.findUnique({
        where: { tokenHash: hashToken(parsed.data.token) },
        include: { gebruiker: { select: { naam: true } } },
      });
      if (!link || link.ingetrokkenOp || link.verlooptOp <= new Date() || !(await heeftPro(link.gebruikerId))) return ongeldigeLink();
      await prisma.deellink.update({ where: { id: link.id }, data: { laatstBekekenOp: new Date() } });

      const g = link.gebruikerId;
      const delen = new Set(link.onderdelen);
      const [trainingen, kracht, pijn, duur] = await Promise.all([
        delen.has("trainingen") ? recenteTrainingen(g, 20) : null,
        delen.has("kracht") ? krachtAnalyse(g) : null,
        delen.has("pijn") ? pijnLogboek(g, 12) : null,
        delen.has("duur") ? duurLijst(g, 90) : null,
      ]);
      return {
        // Alleen de voornaam: genoeg om te weten van wie het is, niet meer.
        van: link.gebruiker.naam.trim().split(/\s+/)[0],
        voor: link.naam,
        verlooptOp: link.verlooptOp,
        vandaag: vandaag(),
        onderdelen: link.onderdelen,
        trainingen,
        // Lichaamsgewicht en geslacht blijven privé; het krachtniveau (dat ze gebruikt) ook.
        kracht: kracht && {
          oefeningen: kracht.oefeningen.map(({ niveau: _niveau, ...o }) => o),
          volume: kracht.volume,
        },
        pijn,
        duur: duur && { lijst: duur, soorten: DUUR_SOORTEN, intensiteiten: INTENSITEITEN },
      };
    },
  );
}
