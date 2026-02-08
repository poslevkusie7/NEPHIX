import { NextResponse } from 'next/server';
import { NotFoundError, setUnitBookmarkForUser } from '@nephix/db';
import { bookmarkUnitRequestSchema } from '@nephix/contracts';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { parseJsonBody } from '@/lib/http';

export async function POST(request: Request, context: { params: { unitId: string } }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = await parseJsonBody(request, bookmarkUnitRequestSchema);
    const state = await setUnitBookmarkForUser(user.id, context.params.unitId, payload);
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to update bookmark.' }, { status: 500 });
  }
}
