import { NextResponse } from 'next/server';
import { NotFoundError, getAssignmentStateForUser } from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const state = await getAssignmentStateForUser(user.id, params.id);
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to load assignment state.' }, { status: 500 });
  }
}
