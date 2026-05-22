import { createHmac, randomBytes } from "crypto";
import type { Request } from "express";

const SECRET =
  process.env["SESSION_SECRET"] || "forestbrawl-default-secret-change-me";

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return { hash, salt };
}

export function verifyPassword(
  password: string,
  hash: string,
  salt: string
): boolean {
  const test = createHmac("sha256", salt).update(password).digest("hex");
  return test === hash;
}

export interface TokenPayload {
  id: string;
  username: string;
  rankId: number;
  exp: number;
}

const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

export function createToken(
  payload: Omit<TokenPayload, "exp">
): string {
  const full: TokenPayload = { ...payload, exp: Date.now() + TOKEN_TTL };
  const encoded = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = createHmac("sha256", SECRET)
      .update(encoded)
      .digest("base64url");
    if (sig !== expectedSig) return null;
    const payload: TokenPayload = JSON.parse(
      Buffer.from(encoded, "base64url").toString()
    );
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const xauth = req.headers["x-auth-token"];
  if (typeof xauth === "string") return xauth;
  return null;
}
