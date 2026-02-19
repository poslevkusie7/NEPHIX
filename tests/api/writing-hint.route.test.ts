vi.mock('@/lib/auth/require-user', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('@nephix/db', async () => {
  class NotFoundError extends Error {}
  class ValidationError extends Error {}
  return {
    NotFoundError,
    ValidationError,
    getAssignmentUnitById: vi.fn(),
    getAssignmentStateForUser: vi.fn(),
    collectWritingSectionsForAssignment: vi.fn(),
    patchUnitStateForUser: vi.fn(),
    recordInteractionEvent: vi.fn(),
    recalculateScheduleForAssignment: vi.fn(),
  };
});

vi.mock('@/lib/ai/client', () => ({
  tryCompleteWithXai: vi.fn(),
}));

import {
  collectWritingSectionsForAssignment,
  getAssignmentStateForUser,
  getAssignmentUnitById,
  patchUnitStateForUser,
  recalculateScheduleForAssignment,
  recordInteractionEvent,
} from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { tryCompleteWithXai } from '@/lib/ai/client';

async function loadRoute() {
  return import('../../apps/web/app/api/units/[unitId]/writing-hint/route');
}

describe('POST /api/units/:unitId/writing-hint', () => {
  it('returns one-sentence hint', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });
    vi.mocked(getAssignmentUnitById).mockResolvedValueOnce({
      id: 'u1',
      assignmentId: 'a1',
      unitType: 'writing',
      orderIndex: 3,
      title: 'Write: Body 1',
      payload: { sectionTitle: 'Body 1' },
      targetWords: 200,
      assignment: {
        id: 'a1',
        title: 'Essay',
        subject: 'Literature',
        deadlineISO: new Date().toISOString(),
        taskType: 'essay',
      },
    });
    vi.mocked(getAssignmentStateForUser).mockResolvedValueOnce({
      assignmentId: 'a1',
      status: 'in_progress',
      currentUnitId: 'u1',
      unitStates: [
        {
          unitId: 't1',
          status: 'completed',
          effectiveStatus: 'completed',
          bookmarked: false,
          readinessWarnings: [],
          content: { thesis: 'Thesis text', confirmed: true },
          position: null,
          updatedAtISO: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(collectWritingSectionsForAssignment).mockResolvedValueOnce([
      {
        unitId: 'u1',
        title: 'Write: Body 1',
        text: '',
        targetWords: 200,
      },
    ]);
    vi.mocked(tryCompleteWithXai).mockResolvedValueOnce(
      'Focus your next sentence on the paragraph claim. Then add evidence.',
    );
    vi.mocked(patchUnitStateForUser).mockResolvedValueOnce({
      unitId: 'u1',
      status: 'active',
      effectiveStatus: 'active',
      bookmarked: false,
      readinessWarnings: [],
      content: { writingHint: 'Focus your next sentence on the paragraph claim.' },
      position: null,
      updatedAtISO: new Date().toISOString(),
    });
    vi.mocked(recordInteractionEvent).mockResolvedValueOnce(undefined);
    vi.mocked(recalculateScheduleForAssignment).mockResolvedValueOnce([]);

    const { POST } = await loadRoute();
    const response = await POST(
      new Request('http://localhost/api/units/u1/writing-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSectionText: '' }),
      }),
      { params: Promise.resolve({ unitId: 'u1' }) },
    );
    const body = (await response.json()) as { hint: { text: string } };

    expect(response.status).toBe(200);
    expect(body.hint.text.split(/[.!?]\s+/).filter(Boolean).length).toBe(1);
  });
});
