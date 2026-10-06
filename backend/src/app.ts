import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/account.js";
import { schemaRoutes } from "./routes/schemas.js";
import { trainingRoutes } from "./routes/trainingen.js";
import { lichaamsgewichtRoutes } from "./routes/lichaamsgewicht.js";
import { programmaRoutes } from "./routes/programmas.js";
import { lichaamRoutes } from "./routes/lichaam.js";
import { herstelRoutes } from "./routes/herstel.js";
import { voortgangRoutes } from "./routes/voortgang.js";
import { bibliotheekRoutes } from "./routes/bibliotheek.js";
import { personalisatieRoutes } from "./routes/personalisatie.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Werkt vanuit zowel src/ (tsx) als dist/ (productie): beide liggen twee niveaus onder de repo.
const FRONTEND = path.join(__dirname, "..", "..", "frontend");

/** Bouwt de app zonder te luisteren, zodat tests hem via app.inject() kunnen aanroepen. */
export async function bouwApp(opties: { logger?: boolean } = {}): Promise<FastifyInstance> {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET ontbreekt. Zet deze omgevingsvariabele en start opnieuw.");
  }

  const app = Fastify({ logger: opties.logger ?? true, trustProxy: true });

  await app.register(fastifyCookie);

  // Zelfde strenge CSP als ACCRD en CMMNTY: geen inline scripts, alles van 'self'.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Foto's uit de oefeningenbibliotheek (Free Exercise DB, vastgepinde versie op GitHub).
        imgSrc: ["'self'", "data:", "https://raw.githubusercontent.com"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: process.env.NODE_ENV === "production" ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
    allowList: (request) => !request.url.startsWith("/api/"),
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      errorCode: "TE_VEEL_VERZOEKEN",
      bericht: `Te veel verzoeken. Probeer het over ${Math.ceil(context.ttl / 1000)} seconden opnieuw.`,
    }),
  });

  // CSRF-basis, overgenomen uit ACCRD: schrijvende requests met een vreemde Origin weigeren.
  app.addHook("onRequest", async (request, reply) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin) {
        let originHost: string;
        try {
          originHost = new URL(origin).host;
        } catch {
          return reply.code(403).send({ errorCode: "ONGELDIGE_OORSPRONG" });
        }
        if (originHost !== request.headers.host) {
          return reply.code(403).send({ errorCode: "ONGELDIGE_OORSPRONG" });
        }
      }
    }
  });

  // Voor de health check van Render: geen login, geen database.
  app.get("/api/gezondheid", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(schemaRoutes);
  await app.register(trainingRoutes);
  await app.register(lichaamsgewichtRoutes);
  await app.register(programmaRoutes);
  await app.register(lichaamRoutes);
  await app.register(herstelRoutes);
  await app.register(voortgangRoutes);
  await app.register(bibliotheekRoutes);
  await app.register(personalisatieRoutes);

  await app.register(fastifyStatic, { root: FRONTEND, prefix: "/", index: "index.html", redirect: true });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return reply.code(404).sendFile("404.html");
  });

  return app;
}
