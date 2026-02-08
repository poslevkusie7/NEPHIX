import { NextResponse } from 'next/server';
import { revokeSessionFromRequest } from '@/lib/auth/session';

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  await revokeSessionFromRequest(request, response);
  return response;
}
