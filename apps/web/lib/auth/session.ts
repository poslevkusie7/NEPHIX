import { NextResponse } from 'next/server';
import {
  createRefreshToken,
  getRefreshTokenByHash,
  hashOpaqueToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from '@nephix/db';
import { getRefreshTokenTtlDays } from '../env';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, setAccessCookie, setRefreshCookie } from './cookies';
import {
  generateOpaqueRefreshToken,
  getAccessTokenMaxAgeSeconds,
  getRefreshTokenMaxAgeSeconds,
  signAccessToken,
} from './tokens';

function computeRefreshExpiry(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + getRefreshTokenTtlDays());
  return expires;
}

export async function issueSession(response: NextResponse, user: { id: string; email: string }) {
  const accessToken = await signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = generateOpaqueRefreshToken();
  const refreshHash = hashOpaqueToken(refreshToken);

  await createRefreshToken(user.id, refreshHash, computeRefreshExpiry());

  setAccessCookie(response, accessToken, getAccessTokenMaxAgeSeconds());
  setRefreshCookie(response, refreshToken, getRefreshTokenMaxAgeSeconds());
}

export async function rotateSessionFromRefreshCookie(request: Request) {
  const refreshToken = request.headers
    .get('cookie')
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${REFRESH_COOKIE}=`))
    ?.split('=')
    .slice(1)
    .join('=');

  if (!refreshToken) {
    throw new Error('Missing refresh token cookie.');
  }

  const tokenHash = hashOpaqueToken(refreshToken);
  const found = await getRefreshTokenByHash(tokenHash);
  if (!found || found.revokedAt || found.expiresAt.getTime() <= Date.now()) {
    throw new Error('Refresh token is invalid or expired.');
  }

  const nextRefreshToken = generateOpaqueRefreshToken();
  const nextRefreshHash = hashOpaqueToken(nextRefreshToken);
  await rotateRefreshToken(found.id, found.userId, nextRefreshHash, computeRefreshExpiry());

  const accessToken = await signAccessToken({ sub: found.user.id, email: found.user.email });

  return {
    user: {
      id: found.user.id,
      email: found.user.email,
    },
    accessToken,
    refreshToken: nextRefreshToken,
  };
}

export async function revokeSessionFromRequest(request: Request, response: NextResponse) {
  const refreshToken = request.headers
    .get('cookie')
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${REFRESH_COOKIE}=`))
    ?.split('=')
    .slice(1)
    .join('=');

  if (refreshToken) {
    const tokenHash = hashOpaqueToken(refreshToken);
    const found = await getRefreshTokenByHash(tokenHash);
    if (found && !found.revokedAt) {
      await revokeRefreshToken(found.id);
    }
  }

  clearSessionCookies(response);
}

export function removeSessionCookies(response: NextResponse) {
  clearSessionCookies(response);
}

export function readAccessTokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    return null;
  }

  const accessToken = cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${ACCESS_COOKIE}=`))
    ?.split('=')
    .slice(1)
    .join('=');

  return accessToken ?? null;
}
