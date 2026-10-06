import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSIE_TTL_SECONDEN, verifieerSessieToken, type SessionPayload } from "../auth.js";

declare module "fastify" {
  interface FastifyRequest {
    gebruiker?: SessionPayload;
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

/** preHandler voor alles achter de login. */
export async function requireIngelogd(request: FastifyRequest, reply: FastifyReply) {
  const sessie = leesSessie(request);
  if (!sessie) return reply.code(401).send({ errorCode: "NIET_INGELOGD" });
  request.gebruiker = sessie;
}
