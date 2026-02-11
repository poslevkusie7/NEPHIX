'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { AssignmentSummaryDTO } from '@nephix/contracts';

function assignmentStatusLabel(status: AssignmentSummaryDTO['status']): string {
  if (status === 'completed') {
    return 'Completed';
  }
  if (status === 'in_progress') {
    return 'In progress';
  }
  return 'Not started';
}

export function AssignmentFeedClient() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [feed, setFeed] = useState<AssignmentSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      let response = await fetch(path, init);
      if (response.status === 401) {
        const refresh = await fetch('/api/auth/refresh', { method: 'POST' });
        if (refresh.ok) {
          response = await fetch(path, init);
        }
      }

      if (response.status === 401) {
        router.push('/login');
        throw new Error('Session expired. Please login again.');
      }

      return response;
    },
    [router],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const meResponse = await apiFetch('/api/me');
      if (!meResponse.ok) {
        throw new Error('Unauthorized');
      }

      const meBody = (await meResponse.json()) as { user: { email: string } };
      setUserEmail(meBody.user.email);

      const feedResponse = await apiFetch('/api/feed');
      if (!feedResponse.ok) {
        throw new Error('Failed to load assignments feed.');
      }

      const feedBody = (await feedResponse.json()) as { feed: AssignmentSummaryDTO[] };
      setFeed(feedBody.feed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignments feed.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  async function logout(event: FormEvent) {
    event.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  async function deleteAccount() {
    if (deletingAccount) {
      return;
    }

    const confirmed = window.confirm(
      'Delete your account permanently? This will remove all your study progress and cannot be undone.',
    );
    if (!confirmed) {
      return;
    }

    setDeletingAccount(true);
    setError(null);

    try {
      const response = await apiFetch('/api/me', { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Failed to delete account.');
        return;
      }
      router.push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account.');
    } finally {
      setDeletingAccount(false);
    }
  }

  if (loading) {
    return (
      <main className="container" style={{ paddingTop: 30 }}>
        <div className="panel pulse" style={{ padding: 24 }}>
          Loading assignments feed...
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ paddingTop: 20, paddingBottom: 26 }}>
      <header className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Nephix Assignment Feed</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {userEmail ? `Signed in as ${userEmail}` : 'Signed in'}
            </p>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void deleteAccount()}
              disabled={deletingAccount}
            >
              {deletingAccount ? 'Deleting...' : 'Delete Account'}
            </button>
            <form onSubmit={logout}>
              <button type="submit" className="btn">
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      {error ? (
        <p className="error" style={{ marginTop: 0 }}>
          {error}
        </p>
      ) : null}

      <section className="panel" style={{ padding: 16, minHeight: 600 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Scroll feed and open any assignment post to start working.
        </p>

        {feed.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No assignments found. Seed data and refresh.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {feed.map((assignment) => {
              const progress =
                assignment.totalUnits > 0
                  ? Math.round((assignment.completedUnits / assignment.totalUnits) * 100)
                  : 0;
              return (
                <Link
                  key={assignment.id}
                  href={`/study/${assignment.id}`}
                  className="panel"
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    padding: 14,
                    display: 'block',
                  }}
                >
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {assignment.subject} • Due {new Date(assignment.deadlineISO).toLocaleDateString()}
                  </p>
                  <h2 style={{ margin: '6px 0 0' }}>{assignment.title}</h2>
                  <p className="muted" style={{ margin: '6px 0 0' }}>
                    {assignmentStatusLabel(assignment.status)} • {assignment.completedUnits}/{assignment.totalUnits} posts complete
                  </p>
                  <div
                    style={{
                      marginTop: 10,
                      height: 8,
                      borderRadius: 999,
                      background: '#e2e8f0',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${progress}%`,
                        background: '#0f766e',
                        height: '100%',
                      }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
