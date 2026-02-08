vi.mock('@/lib/auth/require-user', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('@nephix/db', () => ({
  listFeedForUser: vi.fn(),
}));

import { listFeedForUser } from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

async function loadRoute() {
  return import('../../apps/web/app/api/feed/route');
}

describe('GET /api/feed', () => {
  it('returns 401 when user is missing', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce(null);

    const { GET } = await loadRoute();
    const response = await GET(new Request('http://localhost/api/feed'));
    expect(response.status).toBe(401);
  });

  it('returns feed for authenticated user', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });

    vi.mocked(listFeedForUser).mockResolvedValueOnce([
      {
        id: 'as_1',
        title: 'Essay Unit',
        subject: 'Literature',
        taskType: 'essay',
        deadlineISO: '2026-02-20T00:00:00.000Z',
        status: 'in_progress',
        currentUnitId: 'unit_1',
        totalUnits: 4,
        completedUnits: 1,
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(new Request('http://localhost/api/feed'));
    const body = (await response.json()) as { feed: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.feed[0]?.id).toBe('as_1');
    expect(listFeedForUser).toHaveBeenCalledWith('user_1');
  });
});
