import { NextResponse } from 'next/server';
import {
  NotFoundError,
  UnauthorizedTransitionError,
  ValidationError,
  patchUnitStateForUser,
} from '@nephix/db';
import { patchUnitStateRequestSchema } from '@nephix/contracts';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { parseJsonBody } from '@/lib/http';

export async function PATCH(request: Request, context: { params: Promise<{ unitId: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const payload = await parseJsonBody(request, patchUnitStateRequestSchema);
    const state = await patchUnitStateForUser(user.id, params.unitId, payload);
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof ValidationError || error instanceof UnauthorizedTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to patch unit state.' }, { status: 500 });
  }
}
