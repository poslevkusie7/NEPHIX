import { NextResponse } from 'next/server';
import { collectWritingSectionsForAssignment, getAssignmentDetailById } from '@nephix/db';
import { buildRevisionIssues } from '@nephix/domain';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

export async function GET(request: Request, context: { params: { id: string } }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const assignment = await getAssignmentDetailById(context.params.id);
  const thesisUnit = assignment.units.find((unit) => unit.unitType === 'thesis');
  const payloadWordCount = thesisUnit?.payload.wordCount;
  const targetWordCount = typeof payloadWordCount === 'number' ? payloadWordCount : 1000;

  const sections = await collectWritingSectionsForAssignment(user.id, context.params.id);
  const issues = buildRevisionIssues(sections, targetWordCount);

  return NextResponse.json({ issues });
}
