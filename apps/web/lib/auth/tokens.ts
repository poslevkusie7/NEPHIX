import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { getAccessTokenTtlMinutes, getJwtSecret, getRefreshTokenTtlDays } from '../env';

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

function secretKey() {
  return new TextEncoder().encode(getJwtSecret());
}

export function getAccessTokenMaxAgeSeconds(): number {
  return getAccessTokenTtlMinutes() * 60;
}

export function getRefreshTokenMaxAgeSeconds(): number {
  return getRefreshTokenTtlDays() * 24 * 60 * 60;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const maxAgeSeconds = getAccessTokenMaxAgeSeconds();
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const verified = await jwtVerify(token, secretKey());
    const subject = verified.payload.sub;
    const email = verified.payload.email;
    if (typeof subject !== 'string' || typeof email !== 'string') {
      return null;
    }

    return {
      sub: subject,
      email,
    };
  } catch {
    return null;
  }
}

export function generateOpaqueRefreshToken(): string {
  return randomBytes(48).toString('hex');
}
