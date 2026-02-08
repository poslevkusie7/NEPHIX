import { NextResponse } from 'next/server';
import { rotateSessionFromRefreshCookie } from '@/lib/auth/session';
import { setAccessCookie, setRefreshCookie } from '@/lib/auth/cookies';
import { getAccessTokenMaxAgeSeconds, getRefreshTokenMaxAgeSeconds } from '@/lib/auth/tokens';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { jsonError } from '@/lib/http';

export async function POST(request: Request) {
  const allowed = checkRateLimit(request, 'auth_refresh', 30);
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'Too many refresh attempts. Try again shortly.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(allowed.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  try {
    const result = await rotateSessionFromRefreshCookie(request);
    const response = NextResponse.json({ user: result.user });
    setAccessCookie(response, result.accessToken, getAccessTokenMaxAgeSeconds());
    setRefreshCookie(response, result.refreshToken, getRefreshTokenMaxAgeSeconds());
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Session refresh failed.', 401);
  }
}
