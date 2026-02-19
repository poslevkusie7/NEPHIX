vi.mock('@/lib/auth/require-user', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('@nephix/db', async () => {
  class ValidationError extends Error {}
  class NotFoundError extends Error {}
  class UnauthorizedTransitionError extends Error {}
  return {
    completeUnitForUser: vi.fn(),
    ValidationError,
    NotFoundError,
    UnauthorizedTransitionError,
  };
});

import {
  ValidationError,
  completeUnitForUser,
} from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

async function loadRoute() {
  return import('../../apps/web/app/api/units/[unitId]/complete/route');
}

describe('POST /api/units/:unitId/complete', () => {
  it('returns completion result with soft-gate warnings', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });

    vi.mocked(completeUnitForUser).mockResolvedValueOnce({
      completedUnitId: 'u1',
      nextUnitId: 'u2',
      assignmentStatus: 'in_progress',
      gateStatus: 'warn',
      warnings: ['Writing started before thesis confirmation.'],
    });

    const { POST } = await loadRoute();
    const response = await POST(new Request('http://localhost/api/units/u1/complete'), {
      params: Promise.resolve({ unitId: 'u1' }),
    });
    const body = (await response.json()) as { result: { gateStatus: string; warnings: string[] } };

    expect(response.status).toBe(200);
    expect(body.result.gateStatus).toBe('warn');
    expect(body.result.warnings[0]).toContain('thesis');
  });

  it('returns 400 when completion criteria fail', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });

    vi.mocked(completeUnitForUser).mockRejectedValueOnce(
      new ValidationError('Unit does not satisfy completion criteria.'),
    );

    const { POST } = await loadRoute();
    const response = await POST(new Request('http://localhost/api/units/u1/complete'), {
      params: Promise.resolve({ unitId: 'u1' }),
    });

    expect(response.status).toBe(400);
  });
});
