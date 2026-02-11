vi.mock('@/lib/auth/require-user', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('@nephix/db', () => ({
  listBookmarkedReadingUnitsForUser: vi.fn(),
}));

import { listBookmarkedReadingUnitsForUser } from '@nephix/db';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';

async function loadRoute() {
  return import('../../apps/web/app/api/bookmarks/route');
}

describe('GET /api/bookmarks', () => {
  it('returns 401 when user is missing', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce(null);

    const { GET } = await loadRoute();
    const response = await GET(new Request('http://localhost/api/bookmarks'));
    expect(response.status).toBe(401);
  });

  it('returns bookmarks for authenticated user', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      id: 'user_1',
      email: 'student@example.com',
      createdAtISO: new Date().toISOString(),
    });

    vi.mocked(listBookmarkedReadingUnitsForUser).mockResolvedValueOnce([
      {
        unitId: 'unit_1',
        assignmentId: 'as_1',
        assignmentTitle: 'Reading: Sample',
        assignmentSubject: 'History',
        unitTitle: 'Fragment 1',
        preview: 'First three words...',
        updatedAtISO: new Date().toISOString(),
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(new Request('http://localhost/api/bookmarks'));
    const body = (await response.json()) as { bookmarks: Array<{ unitId: string }> };

    expect(response.status).toBe(200);
    expect(body.bookmarks[0]?.unitId).toBe('unit_1');
    expect(listBookmarkedReadingUnitsForUser).toHaveBeenCalledWith('user_1');
  });
});
