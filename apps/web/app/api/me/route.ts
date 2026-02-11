import { NextResponse } from 'next/server';
import { deleteUserById } from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { revokeSessionFromRequest } from '@/lib/auth/session';

export async function GET(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const response = NextResponse.json({ ok: true });
    await revokeSessionFromRequest(request, response);
    const deleted = await deleteUserById(user.id);
    if (!deleted) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    return response;
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to delete account.' }, { status: 500 });
  }
}
