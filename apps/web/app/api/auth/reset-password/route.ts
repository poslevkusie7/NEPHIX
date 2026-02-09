import argon2 from 'argon2';
import { NextResponse } from 'next/server';
import {
  consumePasswordResetTokenAndSetPassword,
  getPasswordResetTokenByHash,
  hashOpaqueToken,
} from '@nephix/db';
import { resetPasswordRequestSchema } from '@nephix/contracts';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { jsonError, parseJsonBody } from '@/lib/http';

export async function POST(request: Request) {
  const allowed = checkRateLimit(request, 'auth_reset_password', 10);
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'Too many reset attempts. Try again shortly.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(allowed.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  try {
    const payload = await parseJsonBody(request, resetPasswordRequestSchema);
    const tokenHash = hashOpaqueToken(payload.token);
    const token = await getPasswordResetTokenByHash(tokenHash);
    const now = Date.now();

    if (!token || token.usedAt || token.expiresAt.getTime() <= now) {
      return jsonError('Reset token is invalid or expired.', 400);
    }

    const passwordHash = await argon2.hash(payload.password);
    await consumePasswordResetTokenAndSetPassword(token.id, token.userId, passwordHash);

    return NextResponse.json({ ok: true, message: 'Password has been reset.' });
  } catch (error) {
    if (error instanceof Error) {
      return jsonError(error.message, 400);
    }
    return jsonError('Invalid request.', 400);
  }
}
