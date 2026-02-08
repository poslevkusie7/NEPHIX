import argon2 from 'argon2';
import { NextResponse } from 'next/server';
import { getAuthUserById, getUserByEmail } from '@nephix/db';
import { loginRequestSchema } from '@nephix/contracts';
import { issueSession } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { jsonError, parseJsonBody } from '@/lib/http';

export async function POST(request: Request) {
  const allowed = checkRateLimit(request, 'auth_login', 12);
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again shortly.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(allowed.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  try {
    const payload = await parseJsonBody(request, loginRequestSchema);
    const user = await getUserByEmail(payload.email.toLowerCase());
    if (!user) {
      return jsonError('Invalid email or password.', 401);
    }

    const isValid = await argon2.verify(user.passwordHash, payload.password);
    if (!isValid) {
      return jsonError('Invalid email or password.', 401);
    }

    const authUser = await getAuthUserById(user.id);
    if (!authUser) {
      return jsonError('User account not found.', 404);
    }

    const response = NextResponse.json({ user: authUser });
    await issueSession(response, { id: authUser.id, email: authUser.email });
    return response;
  } catch (error) {
    if (error instanceof Error) {
      return jsonError(error.message, 400);
    }
    return jsonError('Invalid request.', 400);
  }
}
