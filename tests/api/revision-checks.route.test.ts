vi.mock('@/lib/auth/require-user', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('@nephix/db', () => ({
  getAssignmentDetailById: vi.fn(),
  getAssignmentStateForUser: vi.fn(),
  collectWritingSectionsForAssignment: vi.fn(),
}));

vi.mock('@nephix/domain', () => ({
  buildRevisionPasses: vi.fn(),
}));

import {
  collectWritingSectionsForAssignment,
  getAssignmentDetailById,
  getAssignmentStateForUser,
} from '@nephix/db';
import { buildRevisionPasses } from '@nephix/domain';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

async function loadRoute() {
  return import('../../apps/web/app/api/assignments/[id]/revision-checks/route');
}

describe('GET /api/assignments/:id/revision-checks', () => {
  it('returns pass-grouped response with backward-compatible issues list', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });
    vi.mocked(getAssignmentDetailById).mockResolvedValueOnce({
      id: 'a1',
      title: 'Essay',
      subject: 'Literature',
      taskType: 'essay',
      deadlineISO: new Date().toISOString(),
      units: [
        {
          id: 't1',
          assignmentId: 'a1',
          orderIndex: 0,
          unitType: 'thesis',
          title: 'Thesis',
          payload: { wordCount: 1000 },
          targetWords: null,
        },
      ],
    });
    vi.mocked(getAssignmentStateForUser).mockResolvedValueOnce({
      assignmentId: 'a1',
      status: 'in_progress',
      currentUnitId: 't1',
      unitStates: [
        {
          unitId: 't1',
          status: 'active',
          effectiveStatus: 'active',
          bookmarked: false,
          readinessWarnings: [],
          content: { thesis: 'Thesis text' },
          position: null,
          updatedAtISO: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(collectWritingSectionsForAssignment).mockResolvedValueOnce([
      {
        unitId: 'w1',
        title: 'Body 1',
        text: 'Draft text',
        targetWords: 200,
      },
    ]);
    vi.mocked(buildRevisionPasses).mockReturnValueOnce([
      {
        passId: 'pass_1_thesis_focus',
        passTitle: 'Pass 1 — Thesis & Focus',
        issues: [
          {
            passId: 'pass_1_thesis_focus',
            code: 'thesis_connection',
            severity: 'medium',
            message: 'Issue',
            sectionTitle: 'Body 1',
            actionStatus: 'open',
          },
        ],
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(new Request('http://localhost/api/assignments/a1/revision-checks'), {
      params: Promise.resolve({ id: 'a1' }),
    });
    const body = (await response.json()) as {
      passes: Array<{ passId: string }>;
      issues: Array<{ code: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.passes[0]?.passId).toBe('pass_1_thesis_focus');
    expect(body.issues[0]?.code).toBe('thesis_connection');
  });
});
