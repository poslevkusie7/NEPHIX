import { NextResponse } from 'next/server';
import { listBookmarkedReadingUnitsForUser } from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

export async function GET(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bookmarks = await listBookmarkedReadingUnitsForUser(user.id);
  return NextResponse.json({ bookmarks });
}
