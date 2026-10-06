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
  const { gebruikerId, email } = jwt.verify(token, jwtSecret()) as SessionPayload;
  return { gebruikerId, email };
}
