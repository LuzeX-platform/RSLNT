import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSIE_TTL_SECONDEN, verifieerSessieToken, type SessionPayload } from "../auth.js";
import { prisma } from "../db.js";

export interface IngelogdeGebruiker {
  gebruikerId: string;
  email: string;
  rol: "lid" | "admin";
}

declare module "fastify" {
  interface FastifyRequest {
    gebruiker?: IngelogdeGebruiker;
  }
}

export const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "luzex_rslnt_sessie";

export function zetSessieCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    // "lax" zoals CMMNTY: een iPhone-app op het beginscherm opent soms via een link van buiten
    // (bijv. een herinnering), en met "strict" ben je dan schijnbaar uitgelogd. Schrijvende
    // requests blijven beschermd door de Origin-check in app.ts.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSIE_TTL_SECONDEN,
  });
}

export function wisSessieCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function leesSessie(request: FastifyRequest): SessionPayload | null {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return verifieerSessieToken(token);
  } catch {
    return null;
  }
}

/**
 * De sessie plus een controle in de database: bestaat het account nog, is het bevestigd en is de
 * sessie niet vervallen door een nieuw wachtwoord? Zo is een verwijderd account meteen uitgelogd.
 */
export async function geldigeSessie(request: FastifyRequest): Promise<IngelogdeGebruiker | null> {
  const sessie = leesSessie(request);
  if (!sessie) return null;
  const g = await prisma.gebruiker.findUnique({
    where: { id: sessie.gebruikerId },
    select: { id: true, email: true, rol: true, sessieVersie: true, emailBevestigdOp: true },
  });
  if (!g || g.sessieVersie !== sessie.versie || !g.emailBevestigdOp) return null;
  return { gebruikerId: g.id, email: g.email, rol: g.rol === "admin" ? "admin" : "lid" };
}

/** preHandler voor alles achter de login. */
export async function requireIngelogd(request: FastifyRequest, reply: FastifyReply) {
  const gebruiker = await geldigeSessie(request);
  if (!gebruiker) {
    if (request.cookies[COOKIE_NAME]) wisSessieCookie(reply);
    return reply.code(401).send({ errorCode: "NIET_INGELOGD" });
  }
  request.gebruiker = gebruiker;
}

/** preHandler voor admin-only routes. Altijd ná requireIngelogd, nooit los. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.gebruiker?.rol !== "admin") {
    return reply.code(403).send({ errorCode: "GEEN_TOEGANG" });
  }
}

/** Het account van dit verzoek. Alleen te gebruiken achter requireIngelogd. */
export function gid(request: FastifyRequest): string {
  const id = request.gebruiker?.gebruikerId;
  if (!id) throw new Error("gid() zonder requireIngelogd");
  return id;
}
