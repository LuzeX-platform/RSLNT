import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";

// Zelfde opzet als ACCRD en CMMNTY: Argon2id voor het wachtwoord, een ondertekend JWT in een
// httpOnly-cookie als sessie. 90 dagen geldig: in de sportschool wil je niet inloggen.
export const SESSIE_TTL_SECONDEN = 90 * 24 * 60 * 60;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET ontbreekt");
  return secret;
}

export interface SessionPayload {
  gebruikerId: string;
  email: string;
  /** Moet gelijk zijn aan Gebruiker.sessieVersie; na een nieuw wachtwoord vervallen oudere sessies. */
  versie: number;
}

export async function hashWachtwoord(wachtwoord: string): Promise<string> {
  return argon2.hash(wachtwoord, { type: argon2.argon2id });
}

export async function verifieerWachtwoord(hash: string, wachtwoord: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, wachtwoord);
  } catch {
    return false;
  }
}

export function maakSessieToken(payload: SessionPayload): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: SESSIE_TTL_SECONDEN });
}

export function verifieerSessieToken(token: string): SessionPayload {
  const { gebruikerId, email, versie } = jwt.verify(token, jwtSecret()) as Partial<SessionPayload>;
  if (!gebruikerId || !email) throw new Error("Ongeldige sessie");
  // Sessies van vóór de sessieversie hebben er geen: die horen bij versie 0.
  return { gebruikerId, email, versie: versie ?? 0 };
}

// Eenmalige tokens voor de bevestigings- en resetmail, zoals CMMNTY: alleen de sha256-hash staat
// in de database, het ruwe token alleen in de mail.
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function maakEenmaligToken(): { ruweToken: string; tokenHash: string } {
  const ruweToken = crypto.randomBytes(32).toString("hex");
  return { ruweToken, tokenHash: hashToken(ruweToken) };
}
