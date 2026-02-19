import { NextResponse } from 'next/server';
import { collectWritingSectionsForAssignment, getAssignmentDetailById, getAssignmentStateForUser } from '@nephix/db';
import { buildRevisionPasses } from '@nephix/domain';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issueActionKey(issue: { passId?: string; code: string; sectionTitle?: string }): string {
  return `${issue.passId ?? 'unknown'}::${issue.code}::${issue.sectionTitle ?? ''}`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const [assignment, assignmentState] = await Promise.all([
    getAssignmentDetailById(params.id),
    getAssignmentStateForUser(user.id, params.id),
  ]);
  const thesisUnit = assignment.units.find((unit) => unit.unitType === 'thesis');
  const payloadWordCount = thesisUnit?.payload.wordCount;
  const targetWordCount = typeof payloadWordCount === 'number' ? payloadWordCount : 1000;
  const thesisState = thesisUnit
    ? assignmentState.unitStates.find((state) => state.unitId === thesisUnit.id)
    : undefined;
  const thesisFromState =
    isRecord(thesisState?.content) && typeof thesisState.content.thesis === 'string'
      ? thesisState.content.thesis
      : undefined;
  const reviseUnit = assignment.units.find((unit) => unit.unitType === 'revise');
  const reviseState = reviseUnit
    ? assignmentState.unitStates.find((state) => state.unitId === reviseUnit.id)
    : undefined;
  const issueActionsRaw = isRecord(reviseState?.content) ? reviseState.content.issueActions : undefined;
  const issueActions = isRecord(issueActionsRaw) ? issueActionsRaw : {};

  const sections = await collectWritingSectionsForAssignment(user.id, params.id);
  const passes = buildRevisionPasses(sections, targetWordCount, {
    thesis: thesisFromState,
  }).map((pass) => ({
    ...pass,
    issues: pass.issues.map((issue) => {
      const key = issueActionKey(issue);
      const action = issueActions[key];
      const actionStatus =
        action === 'open' || action === 'postponed' || action === 'ignored' || action === 'resolved'
          ? action
          : issue.actionStatus ?? 'open';
      return {
        ...issue,
        actionStatus,
      };
    }),
  }));
  const issues = passes.flatMap((pass) => pass.issues);

  return NextResponse.json({ passes, issues });
}
