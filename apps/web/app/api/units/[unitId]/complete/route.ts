import { NextResponse } from 'next/server';
import {
  NotFoundError,
  UnauthorizedTransitionError,
  ValidationError,
  completeUnitForUser,
} from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

export async function POST(request: Request, context: { params: { unitId: string } }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await completeUnitForUser(user.id, context.params.unitId);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof ValidationError || error instanceof UnauthorizedTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to complete unit.' }, { status: 500 });
  }
}
