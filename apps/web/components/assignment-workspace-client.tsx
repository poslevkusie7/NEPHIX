'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, UIEvent as ReactUIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssignmentDetailDTO,
  AssignmentStateDTO,
  BookmarkUnitRequest,
  ClarificationTurn,
  CompleteUnitResponse,
  PatchUnitStateRequest,
  RevisionIssueActionStatus,
  RevisionIssue,
  RevisionPassResult,
  ThesisSuggestion,
  UserUnitStateDTO,
} from '@nephix/contracts';

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issueActionKey(issue: { passId?: string; code: string; sectionTitle?: string }): string {
  return `${issue.passId ?? 'unknown'}::${issue.code}::${issue.sectionTitle ?? ''}`;
}

type AssignmentWorkspaceClientProps = {
  assignmentId: string;
};

export function AssignmentWorkspaceClient({ assignmentId }: AssignmentWorkspaceClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetailDTO | null>(null);
  const [assignmentState, setAssignmentState] = useState<AssignmentStateDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [completingUnitId, setCompletingUnitId] = useState<string | null>(null);
  const [finishingAssignment, setFinishingAssignment] = useState(false);
  const [gateWarningsByUnitId, setGateWarningsByUnitId] = useState<Record<string, string[]>>({});
  const bookmarkJumpedRef = useRef<string | null>(null);
  const [isReadingChatOpen, setIsReadingChatOpen] = useState(false);
  const [readingChatUnitId, setReadingChatUnitId] = useState<string | null>(null);
  const [readingChatMessage, setReadingChatMessage] = useState('');
  const [readingChatTurns, setReadingChatTurns] = useState<ClarificationTurn[]>([]);
  const [readingChatLoading, setReadingChatLoading] = useState(false);
  const [readingChatBusy, setReadingChatBusy] = useState(false);
  const [readingChatError, setReadingChatError] = useState<string | null>(null);
  const readingChatScrollRef = useRef<HTMLDivElement | null>(null);

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
    setGateWarningsByUnitId(() => {
      const next: Record<string, string[]> = {};
      for (const unitState of stateBody.state.unitStates) {
        next[unitState.unitId] = Array.isArray(unitState.readinessWarnings)
          ? unitState.readinessWarnings
          : [];
      }
      return next;
    });
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
  const readingUnits = useMemo(
    () => units.filter((unit) => unit.unitType === 'reading'),
    [units],
  );
  const bookmarkUnitId = searchParams.get('unitId');
  const stateByUnit = useMemo(() => {
    const entries = assignmentState?.unitStates ?? [];
    return new Map(entries.map((entry) => [entry.unitId, entry]));
  }, [assignmentState]);

  const activeUnitId = assignmentState?.currentUnitId ?? units[0]?.id ?? null;
  const completedUnits = useMemo(
    () => (assignmentState?.unitStates ?? []).filter((entry) => entry.status === 'completed').length,
    [assignmentState],
  );
  const allUnitsCompleted = units.length > 0 && completedUnits >= units.length;
  const selectedReadingUnit =
    readingUnits.find((unit) => unit.id === readingChatUnitId) ?? readingUnits[0] ?? null;

  useEffect(() => {
    if (readingUnits.length === 0) {
      setReadingChatUnitId(null);
      return;
    }

    const preferredUnitId =
      activeUnitId && readingUnits.some((unit) => unit.id === activeUnitId)
        ? activeUnitId
        : readingUnits[0]?.id ?? null;

    setReadingChatUnitId(preferredUnitId);
  }, [activeUnitId, readingUnits]);

  useEffect(() => {
    if (!bookmarkUnitId || !assignment) {
      return;
    }
    if (bookmarkJumpedRef.current === bookmarkUnitId) {
      return;
    }
    const target = document.getElementById(`unit-${bookmarkUnitId}`);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bookmarkJumpedRef.current = bookmarkUnitId;
  }, [assignment, bookmarkUnitId]);

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
      const warnings = Array.isArray(body.result.warnings) ? body.result.warnings : [];
      setGateWarningsByUnitId((prev) => ({
        ...prev,
        [unitId]: warnings,
      }));
      setError(body.result.gateStatus === 'warn' ? 'Completed with readiness warnings.' : null);
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

  async function runRevisionChecks(): Promise<{ passes: RevisionPassResult[]; issues: RevisionIssue[] }> {
    const response = await apiFetch(`/api/assignments/${assignmentId}/revision-checks`);
    if (!response.ok) {
      return { passes: [], issues: [] };
    }

    const body = (await response.json()) as { passes?: RevisionPassResult[]; issues?: RevisionIssue[] };
    return {
      passes: Array.isArray(body.passes) ? body.passes : [],
      issues: Array.isArray(body.issues) ? body.issues : [],
    };
  }

  async function requestClarificationChat(unitId: string, message: string): Promise<ClarificationTurn> {
    const response = await apiFetch(`/api/units/${unitId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Failed to send clarification request.');
    }
    const body = (await response.json()) as { turn: ClarificationTurn };
    return body.turn;
  }

  async function requestClarificationHistory(unitId: string): Promise<ClarificationTurn[]> {
    const response = await apiFetch(`/api/units/${unitId}/chat`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Failed to load chat history.');
    }
    const body = (await response.json()) as { turns?: ClarificationTurn[] };
    return Array.isArray(body.turns) ? body.turns : [];
  }

  async function requestThesisSuggestions(
    unitId: string,
    regenerate: boolean,
  ): Promise<ThesisSuggestion[]> {
    const response = await apiFetch(`/api/units/${unitId}/thesis-suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ regenerate }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Failed to generate thesis suggestions.');
    }
    const body = (await response.json()) as { suggestions: ThesisSuggestion[] };
    return Array.isArray(body.suggestions) ? body.suggestions : [];
  }

  async function requestOutlineGenerate(
    unitId: string,
  ): Promise<Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>> {
    const response = await apiFetch(`/api/units/${unitId}/outline-generate`, {
      method: 'POST',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Failed to generate outline.');
    }
    const body = (await response.json()) as {
      sections: Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>;
    };
    return Array.isArray(body.sections) ? body.sections : [];
  }

  async function requestWritingHint(unitId: string, currentSectionText: string): Promise<string> {
    const response = await apiFetch(`/api/units/${unitId}/writing-hint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentSectionText }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Failed to generate writing hint.');
    }
    const body = (await response.json()) as { hint?: { text?: string } };
    return typeof body.hint?.text === 'string' ? body.hint.text : '';
  }

  useEffect(() => {
    if (!isReadingChatOpen || !readingChatUnitId) {
      return;
    }

    setReadingChatLoading(true);
    setReadingChatError(null);
    requestClarificationHistory(readingChatUnitId)
      .then((turns) => {
        setReadingChatTurns(turns);
      })
      .catch((error: unknown) => {
        setReadingChatError(error instanceof Error ? error.message : 'Failed to load chat history.');
      })
      .finally(() => {
        setReadingChatLoading(false);
      });
  }, [isReadingChatOpen, readingChatUnitId]);

  useEffect(() => {
    if (!isReadingChatOpen) {
      return;
    }
    const element = readingChatScrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [isReadingChatOpen, readingChatTurns]);

  async function sendReadingClarificationMessage() {
    const message = readingChatMessage.trim();
    if (!message || !readingChatUnitId || readingChatBusy || readingChatLoading) {
      return;
    }

    setReadingChatBusy(true);
    setReadingChatError(null);
    try {
      const turn = await requestClarificationChat(readingChatUnitId, message);
      setReadingChatTurns((previous) => [...previous, turn]);
      setReadingChatMessage('');
    } catch (error) {
      setReadingChatError(error instanceof Error ? error.message : 'Failed to send clarification request.');
    } finally {
      setReadingChatBusy(false);
    }
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

  async function finishAssignment() {
    if (finishingAssignment) {
      return;
    }

    if (!allUnitsCompleted) {
      const message = "You haven't completed the assignment fully.";
      setError(message);
      window.alert(message);
      return;
    }

    setFinishingAssignment(true);
    setError(null);
    try {
      await refreshCurrentAssignment();
      router.push('/study');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finish assignment.');
    } finally {
      setFinishingAssignment(false);
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
          {assignment.taskType === 'essay' ? (
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {units.length} posts in this assignment feed.
            </p>
          ) : (
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {completedUnits}/{units.length} posts complete
            </p>
          )}

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

          {assignment.taskType === 'reading' && readingUnits.length > 0 ? (
            <div className="row mobile-stack" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => {
                  setIsReadingChatOpen(true);
                  setReadingChatError(null);
                }}
              >
                Open Clarification Chat
              </button>
            </div>
          ) : null}

          {assignment.taskType === 'reading' && isReadingChatOpen && selectedReadingUnit ? (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.45)',
                zIndex: 70,
                display: 'grid',
                placeItems: 'center',
                padding: 16,
              }}
            >
              <div
                className="panel"
                style={{
                  width: 'min(760px, 100%)',
                  maxHeight: '80vh',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 14,
                  overflow: 'hidden',
                }}
                role="dialog"
                aria-modal="true"
                aria-label="Clarification chat"
              >
                <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Clarification Chat</strong>
                  <button type="button" className="btn btn-sm" onClick={() => setIsReadingChatOpen(false)}>
                    Close
                  </button>
                </div>
                <p className="muted" style={{ margin: 0 }}>
                  Ask any question. Chat answers are capped at 10 words.
                </p>

                <div
                  ref={readingChatScrollRef}
                  style={{
                    marginTop: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    maxHeight: '48vh',
                    overflowY: 'auto',
                    padding: '6px 2px',
                  }}
                >
                  {readingChatLoading ? (
                    <p className="muted" style={{ margin: 0 }}>
                      Loading chat...
                    </p>
                  ) : null}
                  {readingChatError ? (
                    <p className="error" style={{ margin: 0 }}>
                      {readingChatError}
                    </p>
                  ) : null}
                  {!readingChatLoading && readingChatTurns.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      Example input: What is the main idea here?
                    </p>
                  ) : (
                    readingChatTurns.map((turn) => (
                      <div key={turn.id} style={{ display: 'grid', gap: 8 }}>
                        <div
                          style={{
                            alignSelf: 'flex-end',
                            maxWidth: '86%',
                            border: '1px solid #99f6e4',
                            borderRadius: 12,
                            background: '#ccfbf1',
                            padding: '8px 10px',
                          }}
                        >
                          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{turn.userMessage}</p>
                        </div>
                        <div
                          style={{
                            alignSelf: 'flex-start',
                            maxWidth: '86%',
                            border: '1px solid #dbe3ec',
                            borderRadius: 12,
                            background: '#f8fafc',
                            padding: '8px 10px',
                          }}
                        >
                          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{turn.assistantMessage}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form
                  className="row mobile-stack"
                  style={{
                    marginTop: 10,
                    alignItems: 'flex-end',
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendReadingClarificationMessage();
                  }}
                >
                  <input
                    value={readingChatMessage}
                    onChange={(event) => setReadingChatMessage(event.target.value)}
                    placeholder="Type your question..."
                    disabled={readingChatBusy || readingChatLoading}
                    autoFocus
                    style={{ flex: 1 }}
                  />
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={
                      readingChatBusy ||
                      readingChatLoading ||
                      !readingChatUnitId ||
                      readingChatMessage.trim().length === 0
                    }
                  >
                    {readingChatBusy ? 'Sending...' : 'Send'}
                  </button>
                </form>
              </div>
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
            {units.map((unit, index) => {
              const unitState = stateByUnit.get(unit.id);
              const isActive = unit.id === activeUnitId;
              const isCompleted = unitState?.status === 'completed';
              const isEditable = true;
              const isBookmarkTarget = bookmarkUnitId === unit.id;
              const postTitle =
                unit.unitType === 'writing'
                  ? unit.title.replace(/^Write:\s*/i, '')
                  : unit.unitType === 'outline'
                    ? 'Outline'
                    : unit.title;

              return (
                <article
                  key={unit.id}
                  id={`unit-${unit.id}`}
                  className="panel"
                  style={{
                    padding: 14,
                    borderColor: isBookmarkTarget ? '#38bdf8' : isActive ? '#5eead4' : '#dbe3ec',
                    boxShadow: isBookmarkTarget
                      ? '0 10px 24px rgba(14, 165, 233, 0.25)'
                      : isActive
                        ? '0 10px 24px rgba(13, 148, 136, 0.18)'
                        : undefined,
                  }}
                >
                  <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                        Post {index + 1}/{units.length} • {unit.unitType}
                      </p>
                      <h3 style={{ margin: '4px 0 0' }}>{postTitle}</h3>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <UnitWorkspace
                      unit={unit}
                      unitState={unitState}
                      units={units}
                      unitStateMap={stateByUnit}
                      isActive={isActive}
                      isCompleted={isCompleted}
                      completingUnitId={completingUnitId}
                      isEditable={isEditable}
                      gateWarnings={gateWarningsByUnitId[unit.id] ?? []}
                      onPatch={patchUnitState}
                      onCompleteUnit={completeUnit}
                      onRevisionCheck={runRevisionChecks}
                      onGenerateThesisSuggestions={requestThesisSuggestions}
                      onGenerateOutline={requestOutlineGenerate}
                      onRequestWritingHint={requestWritingHint}
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
                  </div>
                </article>
              );
            })}
          </div>

          <div
            className="row mobile-stack"
            style={{ justifyContent: 'flex-end', alignItems: 'center', marginTop: 16 }}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void finishAssignment()}
              disabled={finishingAssignment}
            >
              {finishingAssignment
                ? 'Finishing...'
                : assignment.taskType === 'essay'
                  ? 'Finish Writing'
                  : 'Finish Reading'}
            </button>
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
  isActive: boolean;
  isCompleted: boolean;
  completingUnitId: string | null;
  isEditable: boolean;
  gateWarnings: string[];
  onPatch: (unitId: string, payload: PatchUnitStateRequest) => Promise<void>;
  onCompleteUnit: (unitId: string) => Promise<void>;
  onRevisionCheck: () => Promise<{ passes: RevisionPassResult[]; issues: RevisionIssue[] }>;
  onGenerateThesisSuggestions: (unitId: string, regenerate: boolean) => Promise<ThesisSuggestion[]>;
  onGenerateOutline: (
    unitId: string,
  ) => Promise<Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>>;
  onRequestWritingHint: (unitId: string, currentSectionText: string) => Promise<string>;
};

function UnitWorkspace({
  unit,
  unitState,
  units,
  unitStateMap,
  isActive,
  isCompleted,
  completingUnitId,
  isEditable,
  gateWarnings,
  onPatch,
  onCompleteUnit,
  onRevisionCheck,
  onGenerateThesisSuggestions,
  onGenerateOutline,
  onRequestWritingHint,
}: UnitWorkspaceProps) {
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const contentRef = useRef<Record<string, unknown>>({});
  const readingContainerRef = useRef<HTMLDivElement | null>(null);
  const initializedUnitRef = useRef<string | null>(null);
  const [thesisSuggestions, setThesisSuggestions] = useState<ThesisSuggestion[]>([]);
  const [thesisSuggestionsBusy, setThesisSuggestionsBusy] = useState(false);
  const [outlineBusy, setOutlineBusy] = useState(false);
  const [writingHintBusy, setWritingHintBusy] = useState(false);
  const [revisionPasses, setRevisionPasses] = useState<RevisionPassResult[]>([]);

  useEffect(() => {
    if (initializedUnitRef.current === unit.id) {
      return;
    }

    const existing = unitState?.content;
    if (isObjectRecord(existing)) {
      contentRef.current = existing;
      setContent(existing);
    } else {
      if (unit.unitType === 'outline') {
        const sections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
        const nextContent = { sections, confirmed: false };
        contentRef.current = nextContent;
        setContent(nextContent);
      } else if (unit.unitType === 'thesis') {
        const nextContent = { thesis: '', confirmed: false };
        contentRef.current = nextContent;
        setContent(nextContent);
      } else if (unit.unitType === 'writing') {
        const nextContent = { text: '', confirmed: false };
        contentRef.current = nextContent;
        setContent(nextContent);
      } else if (unit.unitType === 'revise') {
        const nextContent = { confirmed: false, issues: [] };
        contentRef.current = nextContent;
        setContent(nextContent);
      } else {
        contentRef.current = {};
        setContent({});
      }
    }

    initializedUnitRef.current = unit.id;
    setSaveState('idle');
    setThesisSuggestions(
      Array.isArray(contentRef.current.thesisSuggestions)
        ? (contentRef.current.thesisSuggestions as ThesisSuggestion[])
        : [],
    );
    setRevisionPasses([]);
  }, [unit.id, unit.unitType, unit.payload, unitState?.content]);

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
    const nextContent = { ...contentRef.current, ...patch };
    contentRef.current = nextContent;
    setContent(nextContent);
  }

  async function saveCurrent(): Promise<boolean> {
    if (!isEditable || saveState === 'saving') {
      return false;
    }
    setSaveState('saving');
    try {
      if (unit.unitType === 'reading') {
        const scrollTop = readingContainerRef.current?.scrollTop ?? 0;
        await onPatch(unit.id, { position: { scrollTop } });
      } else {
        await onPatch(unit.id, { content: contentRef.current });
      }
      setSaveState('saved');
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  }

  async function saveAndMaybeComplete(): Promise<void> {
    const saved = await saveCurrent();
    if (!saved) {
      return;
    }

    const shouldCompleteOnSave = !isCompleted && (unit.unitType !== 'reading' || isActive);
    if (shouldCompleteOnSave) {
      await onCompleteUnit(unit.id);
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

  const gateWarningsBlock =
    gateWarnings.length > 0 ? (
      <div
        style={{
          border: '1px solid #f59e0b',
          borderRadius: 10,
          background: '#fffbeb',
          padding: 10,
          display: 'grid',
          gap: 6,
        }}
      >
        <strong style={{ fontSize: 12, textTransform: 'uppercase', color: '#92400e' }}>
          Soft gate warnings
        </strong>
        {gateWarnings.map((warning) => (
          <p key={warning} style={{ margin: 0, color: '#78350f' }}>
            {warning}
          </p>
        ))}
      </div>
    ) : null;

  const writingGuideMap = useMemo(() => {
    const outlineUnit = units.find((entry) => entry.unitType === 'outline');
    if (!outlineUnit) {
      return new Map<string, string>();
    }

    const outlineState = unitStateMap.get(outlineUnit.id);
    const outlineContent = isObjectRecord(outlineState?.content) ? outlineState.content : {};
    const payloadSections = Array.isArray(outlineUnit.payload.sections) ? outlineUnit.payload.sections : [];
    const contentSections = Array.isArray(outlineContent.sections) ? outlineContent.sections : payloadSections;

    const map = new Map<string, string>();
    for (const rawSection of contentSections) {
      if (!isObjectRecord(rawSection)) {
        continue;
      }
      const sectionId = typeof rawSection.id === 'string' ? rawSection.id : '';
      const question =
        typeof rawSection.guidingQuestion === 'string' ? rawSection.guidingQuestion.trim() : '';
      if (sectionId && question) {
        map.set(sectionId, question);
      }
    }
    return map;
  }, [unitStateMap, units]);

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
      <div style={{ display: 'grid', gap: 10 }}>
        {gateWarningsBlock}
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
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void saveAndMaybeComplete()}
          disabled={!isEditable || saveState === 'saving' || completingUnitId === unit.id}
        >
          {saveState === 'saving' || completingUnitId === unit.id
            ? 'Saving...'
            : isCompleted
              ? 'Finished'
              : 'Mark finished'}
        </button>
      </div>
    );
  }

  if (unit.unitType === 'thesis') {
    const thesis = typeof content.thesis === 'string' ? content.thesis : '';
    const confirmed = Boolean(content.confirmed);

    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {gateWarningsBlock}
        <label className="field">
          <span>Thesis statement</span>
          <textarea
            value={thesis}
            onChange={(event) => updateContent({ thesis: event.target.value })}
            placeholder="Write your thesis in 1-2 sentences..."
            disabled={!isEditable}
          />
        </label>
        <div className="row mobile-stack">
          <button
            type="button"
            className="btn btn-sm"
            disabled={thesisSuggestionsBusy}
            onClick={async () => {
              setThesisSuggestionsBusy(true);
              try {
                const suggestions = await onGenerateThesisSuggestions(unit.id, false);
                setThesisSuggestions(suggestions);
                updateContent({ thesisSuggestions: suggestions });
              } finally {
                setThesisSuggestionsBusy(false);
              }
            }}
          >
            {thesisSuggestionsBusy ? 'Generating...' : 'Generate thesis ideas'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={thesisSuggestionsBusy}
            onClick={async () => {
              setThesisSuggestionsBusy(true);
              try {
                const suggestions = await onGenerateThesisSuggestions(unit.id, true);
                setThesisSuggestions(suggestions);
                updateContent({ thesisSuggestions: suggestions });
              } finally {
                setThesisSuggestionsBusy(false);
              }
            }}
          >
            Regenerate
          </button>
        </div>
        {thesisSuggestions.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {thesisSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="btn btn-soft"
                style={{
                  textAlign: 'left',
                  borderColor: suggestion.text === thesis ? '#0d9488' : undefined,
                }}
                onClick={() => {
                  updateContent({
                    thesis: suggestion.text,
                    confirmed: true,
                  });
                }}
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        ) : null}
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => updateContent({ confirmed: event.target.checked })}
            disabled={!isEditable}
          />
          <span>I confirm this thesis as final.</span>
        </label>
        <div className="row" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="btn"
            onClick={() => void saveAndMaybeComplete()}
            disabled={!isEditable || saveState === 'saving' || completingUnitId === unit.id}
          >
            {saveState === 'saving' ? 'Saving...' : 'Save'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            {thesis.length} characters{saveLabel ? ` • ${saveLabel}` : ''}
          </p>
        </div>
      </div>
    );
  }

  if (unit.unitType === 'outline') {
    const fallbackSections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
    const sections = Array.isArray(content.sections) ? content.sections : fallbackSections;
    const confirmed = Boolean(content.confirmed);

    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {gateWarningsBlock}
        <div className="row mobile-stack">
          <button
            type="button"
            className="btn btn-sm"
            disabled={outlineBusy}
            onClick={async () => {
              setOutlineBusy(true);
              try {
                const generated = await onGenerateOutline(unit.id);
                updateContent({ sections: generated });
              } finally {
                setOutlineBusy(false);
              }
            }}
          >
            {outlineBusy ? 'Generating...' : 'Generate outline'}
          </button>
        </div>
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
            onChange={(event) => updateContent({ confirmed: event.target.checked })}
            disabled={!isEditable}
          />
          <span>I confirm this outline.</span>
        </label>
        <div className="row" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="btn"
            onClick={() => void saveAndMaybeComplete()}
            disabled={!isEditable || saveState === 'saving' || completingUnitId === unit.id}
          >
            {saveState === 'saving' ? 'Saving...' : 'Save'}
          </button>
          {saveLabel ? (
            <p className="muted" style={{ margin: 0 }}>
              {saveLabel}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (unit.unitType === 'writing') {
    const text = typeof content.text === 'string' ? content.text : '';
    const targetWords = typeof unit.targetWords === 'number' ? unit.targetWords : null;
    const confirmed = Boolean(content.confirmed);
    const hint = typeof content.writingHint === 'string' ? content.writingHint : '';
    const sectionId = typeof unit.payload.sectionId === 'string' ? unit.payload.sectionId : '';
    const outlineGuide = sectionId ? writingGuideMap.get(sectionId) : undefined;
    const guidingQuestion =
      outlineGuide ??
      (typeof unit.payload.guidingQuestion === 'string' ? unit.payload.guidingQuestion : '');

    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {gateWarningsBlock}
        {guidingQuestion ? (
          <p className="muted" style={{ marginTop: 0 }}>
            {guidingQuestion}
          </p>
        ) : null}
        <div className="row mobile-stack">
          <button
            type="button"
            className="btn btn-sm"
            disabled={writingHintBusy}
            onClick={async () => {
              setWritingHintBusy(true);
              try {
                const nextHint = await onRequestWritingHint(unit.id, text);
                if (nextHint) {
                  updateContent({ writingHint: nextHint });
                }
              } finally {
                setWritingHintBusy(false);
              }
            }}
          >
            {writingHintBusy ? 'Generating...' : 'Suggest a hint'}
          </button>
        </div>
        {hint ? (
          <div
            style={{
              border: '1px solid #dbe3ec',
              borderRadius: 12,
              padding: 10,
              background: '#f8fafc',
            }}
          >
            <p className="muted" style={{ margin: 0 }}>
              Hint
            </p>
            <p style={{ margin: '4px 0 0' }}>{hint}</p>
          </div>
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
            onChange={(event) => updateContent({ confirmed: event.target.checked })}
            disabled={!isEditable}
          />
          <span>I confirm this section draft is ready.</span>
        </label>
        <div className="row" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="btn"
            onClick={() => void saveAndMaybeComplete()}
            disabled={!isEditable || saveState === 'saving' || completingUnitId === unit.id}
          >
            {saveState === 'saving' ? 'Saving...' : 'Save'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            {countWords(text)} words
            {typeof targetWords === 'number' ? ` (target ${targetWords})` : ''}
            {saveLabel ? ` • ${saveLabel}` : ''}
          </p>
        </div>
      </div>
    );
  }

  const issues = Array.isArray(content.issues)
    ? content.issues.filter((issue) => isObjectRecord(issue))
    : [];
  const issueActions =
    content.issueActions && isObjectRecord(content.issueActions)
      ? (content.issueActions as Record<string, RevisionIssueActionStatus>)
      : {};
  const confirmed = Boolean(content.confirmed);
  const fullDraft = writingSections
    .map((section) => `${section.title.replace(/^Write:\s*/i, '')}\n${section.text}`)
    .join('\n\n');
  const revisionText = typeof content.revisionText === 'string' ? content.revisionText : fullDraft;
  const passesToRender =
    revisionPasses.length > 0
      ? revisionPasses
      : [
          {
            passId: 'legacy',
            passTitle: 'Revision Issues',
            issues: issues as unknown as RevisionIssue[],
          },
        ];

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {gateWarningsBlock}
      <label className="field">
        <span>Revision draft</span>
        <textarea
          value={revisionText}
          onChange={(event) => updateContent({ revisionText: event.target.value })}
          style={{ minHeight: 220 }}
        />
      </label>

      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const next = await onRevisionCheck();
            setRevisionPasses(next.passes);
            updateContent({ issues: next.issues });
          }}
          disabled={!isEditable}
        >
          Run Revision Checks
        </button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {passesToRender.every((pass) => pass.issues.length === 0) ? (
          <p className="muted" style={{ margin: 0 }}>
            No issues yet. Run checks to analyze structure and word balance.
          </p>
        ) : (
          passesToRender.map((pass) => (
            <div key={pass.passId} style={{ display: 'grid', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{pass.passTitle}</strong>
              {pass.issues.map((rawIssue, index) => {
                const severity =
                  rawIssue.severity === 'high' ||
                  rawIssue.severity === 'medium' ||
                  rawIssue.severity === 'low'
                    ? rawIssue.severity
                    : 'low';
                const message = typeof rawIssue.message === 'string' ? rawIssue.message : 'Issue';
                const sectionTitle =
                  typeof rawIssue.sectionTitle === 'string' ? rawIssue.sectionTitle : undefined;
                const issueKey = issueActionKey(rawIssue);
                const actionStatus = issueActions[issueKey] ?? rawIssue.actionStatus ?? 'open';

                return (
                  <div
                    key={`${pass.passId}-${message}-${index}`}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: 10,
                      background:
                        severity === 'high' ? '#fee2e2' : severity === 'medium' ? '#fef3c7' : '#eff6ff',
                      display: 'grid',
                      gap: 6,
                    }}
                  >
                    <strong style={{ textTransform: 'uppercase', fontSize: 12 }}>{severity}</strong>
                    <p style={{ margin: 0 }}>{message}</p>
                    {sectionTitle ? (
                      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                        Section: {sectionTitle}
                      </p>
                    ) : null}
                    <div className="row mobile-stack">
                      {(['open', 'postponed', 'ignored', 'resolved'] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          className="btn btn-sm"
                          style={{
                            borderColor: actionStatus === status ? '#0d9488' : undefined,
                          }}
                          onClick={() => {
                            const nextActions = {
                              ...issueActions,
                              [issueKey]: status,
                            };
                            updateContent({
                              issueActions: nextActions,
                              lastIssueAction: {
                                issueKey,
                                status,
                              },
                            });
                          }}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <label className="row" style={{ alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            updateContent({ confirmed: event.target.checked });
          }}
          disabled={!isEditable}
        />
        <span>Confirm completion</span>
      </label>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="btn" onClick={() => void saveAndMaybeComplete()} disabled={!isEditable || saveState === 'saving' || completingUnitId === unit.id}>
          {saveState === 'saving' ? 'Saving...' : 'Save'}
        </button>
        {saveLabel ? (
          <p className="muted" style={{ margin: 0 }}>
            {saveLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
