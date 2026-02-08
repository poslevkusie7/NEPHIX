import type { NextResponse } from 'next/server';

export const ACCESS_COOKIE = 'nephix_access';
export const REFRESH_COOKIE = 'nephix_refresh';

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export function setAccessCookie(response: NextResponse, token: string, maxAgeSeconds: number): void {
  response.cookies.set(ACCESS_COOKIE, token, {
    ...baseCookieOptions,
    maxAge: maxAgeSeconds,
  });
}

export function setRefreshCookie(response: NextResponse, token: string, maxAgeSeconds: number): void {
  response.cookies.set(REFRESH_COOKIE, token, {
    ...baseCookieOptions,
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, '', {
    ...baseCookieOptions,
    maxAge: 0,
  });
  response.cookies.set(REFRESH_COOKIE, '', {
    ...baseCookieOptions,
    maxAge: 0,
  });
}
