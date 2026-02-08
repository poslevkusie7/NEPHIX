import { NextResponse } from 'next/server';
import { NotFoundError, getAssignmentDetailById } from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

export async function GET(request: Request, context: { params: { id: string } }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const assignment = await getAssignmentDetailById(context.params.id);
    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to load assignment.' }, { status: 500 });
  }
}
