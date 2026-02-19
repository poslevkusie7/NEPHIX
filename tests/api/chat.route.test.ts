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
    createClarificationTurnForUnit: vi.fn(),
    listClarificationTurnsForUnit: vi.fn(),
  };
});

vi.mock('@/lib/ai/client', () => ({
  tryCompleteWithXai: vi.fn(),
}));

import {
  createClarificationTurnForUnit,
  getAssignmentUnitById,
  listClarificationTurnsForUnit,
} from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { tryCompleteWithXai } from '@/lib/ai/client';

async function loadRoute() {
  return import('../../apps/web/app/api/units/[unitId]/chat/route');
}

describe('POST /api/units/:unitId/chat', () => {
  it('returns 401 when user is missing', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce(null);
    const { POST } = await loadRoute();

    const response = await POST(
      new Request('http://localhost/api/units/u1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'What does this sentence mean?' }),
      }),
      { params: Promise.resolve({ unitId: 'u1' }) },
    );

    expect(response.status).toBe(401);
  });

  it('rejects out-of-scope rewrite requests', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });

    const { POST } = await loadRoute();
    const response = await POST(
      new Request('http://localhost/api/units/u1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Please rewrite this whole fragment.' }),
      }),
      { params: Promise.resolve({ unitId: 'u1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('creates a clarification turn', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });
    vi.mocked(getAssignmentUnitById).mockResolvedValueOnce({
      id: 'u1',
      assignmentId: 'a1',
      unitType: 'reading',
      orderIndex: 0,
      title: 'Fragment 1',
      payload: { text: 'Shared rules limit freedom in exchange for stability.' },
      targetWords: null,
      assignment: {
        id: 'a1',
        title: 'Reading',
        subject: 'History',
        deadlineISO: new Date().toISOString(),
        taskType: 'reading',
      },
    });
    vi.mocked(tryCompleteWithXai).mockResolvedValueOnce(
      'This line explains that people accept limits to gain social stability.',
    );
    vi.mocked(listClarificationTurnsForUnit).mockResolvedValueOnce([]);
    vi.mocked(createClarificationTurnForUnit).mockResolvedValueOnce({
      id: 't1',
      unitId: 'u1',
      userMessage: 'What does this mean?',
      assistantMessage: 'This line explains that people accept limits to gain social stability.',
      createdAtISO: new Date().toISOString(),
    });

    const { POST } = await loadRoute();
    const response = await POST(
      new Request('http://localhost/api/units/u1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'What does this mean?' }),
      }),
      { params: Promise.resolve({ unitId: 'u1' }) },
    );
    const body = (await response.json()) as { turn: { id: string } };

    expect(response.status).toBe(200);
    expect(body.turn.id).toBe('t1');
  });
});
