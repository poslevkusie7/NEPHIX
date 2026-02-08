import { NextResponse } from 'next/server';
import { listFeedForUser } from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

export async function GET(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const feed = await listFeedForUser(user.id);
  return NextResponse.json({ feed });
}
