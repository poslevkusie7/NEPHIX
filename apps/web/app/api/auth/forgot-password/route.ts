import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createPasswordResetToken, getUserByEmail, hashOpaqueToken } from '@nephix/db';
import { forgotPasswordRequestSchema } from '@nephix/contracts';
import { getPasswordResetTokenTtlMinutes } from '@/lib/env';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { jsonError, parseJsonBody } from '@/lib/http';

function computePasswordResetExpiry(): Date {
  const ttlMinutes = getPasswordResetTokenTtlMinutes();
  return new Date(Date.now() + ttlMinutes * 60 * 1000);
}

function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export async function POST(request: Request) {
  const allowed = checkRateLimit(request, 'auth_forgot_password', 6);
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'Too many reset requests. Try again shortly.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(allowed.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  try {
    const payload = await parseJsonBody(request, forgotPasswordRequestSchema);
    const user = await getUserByEmail(payload.email.toLowerCase());

    if (!user) {
      return NextResponse.json({
        ok: true,
        message: 'If the account exists, reset instructions were generated.',
      });
    }

    const resetToken = generateResetToken();
    await createPasswordResetToken(user.id, hashOpaqueToken(resetToken), computePasswordResetExpiry());

    // MVP fallback until transactional email provider is integrated.
    return NextResponse.json({
      ok: true,
      message: 'Reset token generated. Use it to set a new password.',
      resetToken,
    });
  } catch (error) {
    if (error instanceof Error) {
      return jsonError(error.message, 400);
    }
    return jsonError('Invalid request.', 400);
  }
}
