'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, UIEvent as ReactUIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssignmentDetailDTO,
  AssignmentStateDTO,
  BookmarkUnitRequest,
  CompleteUnitResponse,
  PatchUnitStateRequest,
  RevisionIssue,
  UserUnitStateDTO,
} from '@nephix/contracts';
import { CardShell, UnitStatusBadge } from '@nephix/ui';

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type AssignmentWorkspaceClientProps = {
  assignmentId: string;
};

export function AssignmentWorkspaceClient({ assignmentId }: AssignmentWorkspaceClientProps) {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetailDTO | null>(null);
  const [assignmentState, setAssignmentState] = useState<AssignmentStateDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [completingUnitId, setCompletingUnitId] = useState<string | null>(null);

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

  const loadAssignmentBundle = useCallback(async () => {
    const [assignmentResponse, stateResponse] = await Promise.all([
      apiFetch(`/api/assignments/${assignmentId}`),
      apiFetch(`/api/assignments/${assignmentId}/state`),
    ]);

    if (!assignmentResponse.ok || !stateResponse.ok) {
      throw new Error('Failed to load assignment feed.');
    }

    const assignmentBody = (await assignmentResponse.json()) as { assignment: AssignmentDetailDTO };
    const stateBody = (await stateResponse.json()) as { state: AssignmentStateDTO };

    setAssignment(assignmentBody.assignment);
    setAssignmentState(stateBody.state);
  }, [apiFetch, assignmentId]);

  const refreshCurrentAssignment = useCallback(async () => {
    await loadAssignmentBundle();
  }, [loadAssignmentBundle]);

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

      await loadAssignmentBundle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignment feed.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, loadAssignmentBundle]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const units = assignment?.units ?? [];
  const stateByUnit = useMemo(() => {
    const entries = assignmentState?.unitStates ?? [];
    return new Map(entries.map((entry) => [entry.unitId, entry]));
  }, [assignmentState]);

  const activeUnitId = assignmentState?.currentUnitId ?? units[0]?.id ?? null;
  const activeUnitIndex = activeUnitId ? units.findIndex((unit) => unit.id === activeUnitId) : -1;
  const completedUnits = useMemo(
    () => (assignmentState?.unitStates ?? []).filter((entry) => entry.status === 'completed').length,
    [assignmentState],
  );

  async function patchUnitState(unitId: string, payload: PatchUnitStateRequest): Promise<void> {
    const response = await apiFetch(`/api/units/${unitId}/state`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Failed to save state.');
    }

    const body = (await response.json()) as { state: UserUnitStateDTO };
    setAssignmentState((prev) => {
      if (!prev) {
        return prev;
      }

      const nextStates = prev.unitStates.filter((entry) => entry.unitId !== body.state.unitId);
      nextStates.push(body.state);
      nextStates.sort((a, b) => {
        const aIndex = units.findIndex((unit) => unit.id === a.unitId);
        const bIndex = units.findIndex((unit) => unit.id === b.unitId);
        return aIndex - bIndex;
      });

      return {
        ...prev,
        unitStates: nextStates,
      };
    });
  }

  async function completeUnit(unitId: string) {
    if (!activeUnitId || unitId !== activeUnitId) {
      setError('Only the active post can be completed.');
      return;
    }

    setCompletingUnitId(unitId);
    try {
      const response = await apiFetch(`/api/units/${unitId}/complete`, {
        method: 'POST',
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Failed to complete unit.');
        return;
      }

      const body = (await response.json()) as { result: CompleteUnitResponse };
      setError(null);
      await refreshCurrentAssignment();

      if (!body.result.nextUnitId) {
        setError('Assignment completed. Great work.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete unit.');
    } finally {
      setCompletingUnitId(null);
    }
  }

  async function toggleBookmark(unitId: string, bookmarked: boolean) {
    const payload: BookmarkUnitRequest = { bookmarked: !bookmarked };
    const response = await apiFetch(`/api/units/${unitId}/bookmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to update bookmark.');
      return;
    }

    const body = (await response.json()) as { state: UserUnitStateDTO };
    setAssignmentState((prev) => {
      if (!prev) {
        return prev;
      }

      const unitStates = prev.unitStates.map((entry) =>
        entry.unitId === body.state.unitId ? body.state : entry,
      );

      return {
        ...prev,
        unitStates,
      };
    });
  }

  async function runRevisionChecks(): Promise<RevisionIssue[]> {
    const response = await apiFetch(`/api/assignments/${assignmentId}/revision-checks`);
    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as { issues: RevisionIssue[] };
    return body.issues;
  }

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
          Loading assignment feed...
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ paddingTop: 20, paddingBottom: 26 }}>
      <header className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Assignment Feed</h1>
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

      <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Link href="/study" className="btn" style={{ textDecoration: 'none', color: 'inherit' }}>
          Back to Assignments Feed
        </Link>
      </div>

      {error ? (
        <p className="error" style={{ marginTop: 0 }}>
          {error}
        </p>
      ) : null}

      {assignment && assignmentState ? (
        <section className="panel" style={{ padding: 16, minHeight: 600 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {assignment.subject} • Due {new Date(assignment.deadlineISO).toLocaleDateString()}
          </p>
          <h2 style={{ margin: '6px 0 0' }}>{assignment.title}</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {completedUnits}/{units.length} posts complete
            {activeUnitIndex >= 0 ? ` • Active post ${activeUnitIndex + 1}` : ' • Assignment complete'}
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
                width: `${units.length > 0 ? (completedUnits / units.length) * 100 : 0}%`,
                background: '#0f766e',
                height: '100%',
              }}
            />
          </div>

          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Each unit is a post. Scroll up/down through this assignment feed.
          </p>

          <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
            {units.map((unit, index) => {
              const unitState = stateByUnit.get(unit.id);
              const isActive = unit.id === activeUnitId;
              const isCompleted = unitState?.status === 'completed';
              const isEditable = true;

              return (
                <article
                  key={unit.id}
                  className="panel"
                  style={{
                    padding: 14,
                    borderColor: isActive ? '#5eead4' : '#dbe3ec',
                    boxShadow: isActive ? '0 10px 24px rgba(13, 148, 136, 0.18)' : undefined,
                  }}
                >
                  <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                        Post {index + 1}/{units.length} • {unit.unitType}
                      </p>
                      <h3 style={{ margin: '4px 0 0' }}>{unit.title}</h3>
                    </div>
                    <UnitStatusBadge status={unitState?.status ?? 'unread'} />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <UnitWorkspace
                      unit={unit}
                      unitState={unitState}
                      units={units}
                      unitStateMap={stateByUnit}
                      isEditable={isEditable}
                      onPatch={patchUnitState}
                      onRevisionCheck={runRevisionChecks}
                    />
                  </div>

                  <div className="row mobile-stack" style={{ marginTop: 12 }}>
                    {unit.unitType === 'reading' ? (
                      <button
                        type="button"
                        className="btn btn-soft"
                        onClick={() => void toggleBookmark(unit.id, Boolean(unitState?.bookmarked))}
                      >
                        {unitState?.bookmarked ? 'Remove Bookmark' : 'Bookmark'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void completeUnit(unit.id)}
                      disabled={!isActive || isCompleted || completingUnitId === unit.id}
                    >
                      {isCompleted
                        ? 'Completed'
                        : completingUnitId === unit.id
                          ? 'Completing...'
                          : 'Complete & Continue'}
                    </button>
                  </div>

                  {!isActive && !isCompleted ? (
                    <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                      You can edit this post now, but completion still follows active order.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="panel" style={{ padding: 16, minHeight: 600 }}>
          <p className="muted" style={{ margin: 0 }}>
            Assignment not found.
          </p>
        </section>
      )}
    </main>
  );
}

type UnitWorkspaceProps = {
  unit: AssignmentDetailDTO['units'][number];
  unitState: UserUnitStateDTO | undefined;
  units: AssignmentDetailDTO['units'];
  unitStateMap: Map<string, UserUnitStateDTO>;
  isEditable: boolean;
  onPatch: (unitId: string, payload: PatchUnitStateRequest) => Promise<void>;
  onRevisionCheck: () => Promise<RevisionIssue[]>;
};

function UnitWorkspace({
  unit,
  unitState,
  units,
  unitStateMap,
  isEditable,
  onPatch,
  onRevisionCheck,
}: UnitWorkspaceProps) {
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const readingContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const existing = unitState?.content;
    if (isObjectRecord(existing)) {
      setContent(existing);
    } else {
      if (unit.unitType === 'outline') {
        const sections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
        setContent({ sections, confirmed: false });
      } else if (unit.unitType === 'thesis') {
        setContent({ thesis: '', confirmed: false });
      } else if (unit.unitType === 'writing') {
        setContent({ text: '', confirmed: false });
      } else if (unit.unitType === 'revise') {
        setContent({ confirmed: false, issues: [] });
      } else {
        setContent({});
      }
    }

    setSaveState('idle');
  }, [unit.id, unit.unitType, unit.payload, unitState?.updatedAtISO, unitState?.content]);

  useEffect(() => {
    if (unit.unitType !== 'reading') {
      return;
    }

    const position = unitState?.position;
    const scrollTop =
      isObjectRecord(position) && typeof position.scrollTop === 'number' ? position.scrollTop : 0;
    if (readingContainerRef.current) {
      readingContainerRef.current.scrollTop = scrollTop;
    }
  }, [unit.unitType, unit.id, unitState?.position]);

  useEffect(() => {
    if (!isEditable || saveState !== 'dirty') {
      return;
    }

    const timeout = setTimeout(() => {
      void (async () => {
        setSaveState('saving');
        try {
          if (unit.unitType === 'reading') {
            const scrollTop = readingContainerRef.current?.scrollTop ?? 0;
            await onPatch(unit.id, { position: { scrollTop } });
          } else {
            await onPatch(unit.id, { content });
          }
          setSaveState('saved');
        } catch {
          setSaveState('error');
        }
      })();
    }, 500);

    return () => {
      clearTimeout(timeout);
    };
  }, [content, isEditable, onPatch, saveState, unit.id, unit.unitType]);

  const writingSections = useMemo(() => {
    return units
      .filter((entry) => entry.unitType === 'writing')
      .map((entry) => {
        const sectionState = unitStateMap.get(entry.id);
        const saved = sectionState?.content;
        const text = isObjectRecord(saved) && typeof saved.text === 'string' ? saved.text : '';
        return {
          title: entry.title,
          text,
          targetWords: typeof entry.targetWords === 'number' ? entry.targetWords : 0,
        };
      });
  }, [units, unitStateMap]);

  function updateContent(patch: Record<string, unknown>) {
    setSaveState('dirty');
    setContent((prev) => ({ ...prev, ...patch }));
  }

  async function setConfirmedAndPersist(confirmed: boolean) {
    const nextContent = { ...content, confirmed };
    setContent(nextContent);

    if (!isEditable) {
      return;
    }

    setSaveState('saving');
    try {
      await onPatch(unit.id, { content: nextContent });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Saving...'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'dirty'
          ? 'Unsaved changes'
          : saveState === 'error'
            ? 'Save failed'
            : '';

  if (unit.unitType === 'reading') {
    const text = typeof unit.payload.text === 'string' ? unit.payload.text : '';

    const onReadingScroll = (event: ReactUIEvent<HTMLDivElement>) => {
      if (!isEditable) {
        return;
      }
      if (event.currentTarget.scrollTop >= 0) {
        setSaveState('dirty');
      }
    };

    return (
      <CardShell title={unit.title} subtitle="Read this fragment and move to the next post when done.">
        <div
          ref={readingContainerRef}
          onScroll={onReadingScroll}
          style={{
            border: '1px solid #dbe3ec',
            borderRadius: 12,
            padding: 14,
            background: '#f8fafc',
            maxHeight: 320,
            overflow: 'auto',
            lineHeight: 1.6,
          }}
        >
          {text}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {saveLabel || 'Scroll position is saved automatically.'}
        </p>
      </CardShell>
    );
  }

  if (unit.unitType === 'thesis') {
    const thesis = typeof content.thesis === 'string' ? content.thesis : '';
    const confirmed = Boolean(content.confirmed);

    return (
      <CardShell title={unit.title} subtitle="Formulate one clear thesis and confirm it.">
        <label className="field">
          <span>Thesis statement</span>
          <textarea
            value={thesis}
            onChange={(event) => updateContent({ thesis: event.target.value })}
            placeholder="Write your thesis in 1-2 sentences..."
            disabled={!isEditable}
          />
        </label>
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              void setConfirmedAndPersist(event.target.checked);
            }}
            disabled={!isEditable}
          />
          <span>I confirm this thesis as final for this assignment</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          {thesis.length} characters. {saveLabel}
        </p>
      </CardShell>
    );
  }

  if (unit.unitType === 'outline') {
    const fallbackSections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
    const sections = Array.isArray(content.sections) ? content.sections : fallbackSections;
    const confirmed = Boolean(content.confirmed);

    return (
      <CardShell title={unit.title} subtitle="Adjust section plan while staying close to target word balance.">
        <div className="outline-table-wrap">
          <table className="outline-table">
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Guiding Question</th>
                <th scope="col">Target Words</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((rawSection, index) => {
                const section = isObjectRecord(rawSection) ? rawSection : {};
                const id = typeof section.id === 'string' ? section.id : `section-${index + 1}`;
                const title = typeof section.title === 'string' ? section.title : '';
                const guidingQuestion =
                  typeof section.guidingQuestion === 'string' ? section.guidingQuestion : '';
                const targetWords =
                  typeof section.targetWords === 'number' ? section.targetWords : Number(section.targetWords) || 0;

                return (
                  <tr key={id}>
                    <td>
                      <input
                        value={title}
                        onChange={(event) => {
                          const next = [...sections];
                          next[index] = {
                            ...(isObjectRecord(next[index]) ? next[index] : {}),
                            id,
                            title: event.target.value,
                            guidingQuestion,
                            targetWords,
                          };
                          updateContent({ sections: next });
                        }}
                        disabled={!isEditable}
                      />
                    </td>
                    <td>
                      <input
                        value={guidingQuestion}
                        onChange={(event) => {
                          const next = [...sections];
                          next[index] = {
                            ...(isObjectRecord(next[index]) ? next[index] : {}),
                            id,
                            title,
                            guidingQuestion: event.target.value,
                            targetWords,
                          };
                          updateContent({ sections: next });
                        }}
                        disabled={!isEditable}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={targetWords}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          const bounded = Math.max(0, Number.isFinite(value) ? value : 0);
                          const next = [...sections];
                          next[index] = {
                            ...(isObjectRecord(next[index]) ? next[index] : {}),
                            id,
                            title,
                            guidingQuestion,
                            targetWords: bounded,
                          };
                          updateContent({ sections: next });
                        }}
                        disabled={!isEditable}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              void setConfirmedAndPersist(event.target.checked);
            }}
            disabled={!isEditable}
          />
          <span>I confirm this outline</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          {saveLabel}
        </p>
      </CardShell>
    );
  }

  if (unit.unitType === 'writing') {
    const text = typeof content.text === 'string' ? content.text : '';
    const confirmed = Boolean(content.confirmed);
    const targetWords = typeof unit.targetWords === 'number' ? unit.targetWords : null;

    return (
      <CardShell title={unit.title} subtitle="Draft this section only. Focus on ideas and flow first.">
        {typeof unit.payload.guidingQuestion === 'string' ? (
          <p className="muted" style={{ marginTop: 0 }}>
            {unit.payload.guidingQuestion}
          </p>
        ) : null}
        <label className="field">
          <span>Draft text</span>
          <textarea
            value={text}
            onChange={(event) => updateContent({ text: event.target.value })}
            disabled={!isEditable}
            style={{ minHeight: 240 }}
          />
        </label>
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              void setConfirmedAndPersist(event.target.checked);
            }}
            disabled={!isEditable}
          />
          <span>I confirm this section draft is ready</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          {countWords(text)} words
          {typeof targetWords === 'number' ? ` (target ${targetWords})` : ''}. {saveLabel}
        </p>
      </CardShell>
    );
  }

  const issues = Array.isArray(content.issues)
    ? content.issues.filter((issue) => isObjectRecord(issue))
    : [];
  const confirmed = Boolean(content.confirmed);
  const fullDraft = writingSections.map((section) => `## ${section.title}\n${section.text}`).join('\n\n');

  return (
    <CardShell title={unit.title} subtitle="Run rule-based checks and confirm revision goals.">
      <label className="field">
        <span>Current draft context (read-only)</span>
        <textarea value={fullDraft} readOnly style={{ minHeight: 220, background: '#f8fafc' }} />
      </label>

      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const nextIssues = await onRevisionCheck();
            updateContent({ issues: nextIssues });
          }}
          disabled={!isEditable}
        >
          Run Revision Checks
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {issues.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No issues yet. Run checks to analyze structure and word balance.
          </p>
        ) : (
          issues.map((rawIssue, index) => {
            const severity =
              rawIssue.severity === 'high' || rawIssue.severity === 'medium' || rawIssue.severity === 'low'
                ? rawIssue.severity
                : 'low';
            const message = typeof rawIssue.message === 'string' ? rawIssue.message : 'Issue';
            const sectionTitle =
              typeof rawIssue.sectionTitle === 'string' ? rawIssue.sectionTitle : undefined;

            return (
              <div
                key={`${message}-${index}`}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 10,
                  background:
                    severity === 'high' ? '#fee2e2' : severity === 'medium' ? '#fef3c7' : '#eff6ff',
                }}
              >
                <strong style={{ textTransform: 'uppercase', fontSize: 12 }}>{severity}</strong>
                <p style={{ margin: '6px 0 0' }}>{message}</p>
                {sectionTitle ? (
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                    Section: {sectionTitle}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <label className="row" style={{ alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            void setConfirmedAndPersist(event.target.checked);
          }}
          disabled={!isEditable}
        />
        <span>I confirm revision is complete for this assignment.</span>
      </label>
      <p className="muted" style={{ margin: 0 }}>
        {saveLabel}
      </p>
    </CardShell>
  );
}
