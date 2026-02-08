import argon2 from 'argon2';
import { NextResponse } from 'next/server';
import { createUser, getUserByEmail } from '@nephix/db';
import { signupRequestSchema } from '@nephix/contracts';
import { issueSession } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { jsonError, parseJsonBody } from '@/lib/http';

export async function POST(request: Request) {
  const allowed = checkRateLimit(request, 'auth_signup', 8);
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'Too many signup attempts. Try again shortly.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(allowed.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  try {
    const payload = await parseJsonBody(request, signupRequestSchema);

    const existing = await getUserByEmail(payload.email.toLowerCase());
    if (existing) {
      return jsonError('Email is already registered.', 409);
    }

    const passwordHash = await argon2.hash(payload.password);
    const user = await createUser(payload.email.toLowerCase(), passwordHash);

    const response = NextResponse.json({ user }, { status: 201 });
    await issueSession(response, { id: user.id, email: user.email });
    return response;
  } catch (error) {
    if (error instanceof Error) {
      return jsonError(error.message, 400);
    }
    return jsonError('Invalid request.', 400);
  }
}
