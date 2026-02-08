'use client';

import { useRouter } from 'next/navigation';
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AssignmentDetailDTO,
  AssignmentStateDTO,
  AssignmentSummaryDTO,
  BookmarkUnitRequest,
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

type SwipeHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
};

function useSwipeNavigation(callbacks: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}): SwipeHandlers {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const currentRef = useRef<{ x: number; y: number } | null>(null);

  const reset = () => {
    startRef.current = null;
    currentRef.current = null;
  };

  return {
    onPointerDown: (event) => {
      startRef.current = { x: event.clientX, y: event.clientY };
      currentRef.current = { x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event) => {
      if (!startRef.current) {
        return;
      }
      currentRef.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: () => {
      if (!startRef.current || !currentRef.current) {
        reset();
        return;
      }

      const dx = currentRef.current.x - startRef.current.x;
      const dy = currentRef.current.y - startRef.current.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const threshold = 60;

      if (absX > absY && absX > threshold) {
        if (dx < 0) {
          callbacks.onSwipeLeft?.();
        } else {
          callbacks.onSwipeRight?.();
        }
      }

      if (absY > absX && absY > threshold) {
        if (dy < 0) {
          callbacks.onSwipeUp?.();
        } else {
          callbacks.onSwipeDown?.();
        }
      }

      reset();
    },
    onPointerCancel: reset,
  };
}

export function StudyClient() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [feed, setFeed] = useState<AssignmentSummaryDTO[]>([]);
  const [currentAssignmentId, setCurrentAssignmentId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetailDTO | null>(null);
  const [assignmentState, setAssignmentState] = useState<AssignmentStateDTO | null>(null);
  const [viewUnitId, setViewUnitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const loadFeed = useCallback(async () => {
    const response = await apiFetch('/api/feed');
    if (!response.ok) {
      throw new Error('Failed to load feed.');
    }

    const body = (await response.json()) as { feed: AssignmentSummaryDTO[] };
    setFeed(body.feed);
    setCurrentAssignmentId((prev) => prev ?? body.feed[0]?.id ?? null);
  }, [apiFetch]);

  const loadAssignmentBundle = useCallback(
    async (assignmentId: string) => {
      const [assignmentResponse, stateResponse] = await Promise.all([
        apiFetch(`/api/assignments/${assignmentId}`),
        apiFetch(`/api/assignments/${assignmentId}/state`),
      ]);

      if (!assignmentResponse.ok || !stateResponse.ok) {
        throw new Error('Failed to load assignment workspace.');
      }

      const assignmentBody = (await assignmentResponse.json()) as { assignment: AssignmentDetailDTO };
      const stateBody = (await stateResponse.json()) as { state: AssignmentStateDTO };

      setAssignment(assignmentBody.assignment);
      setAssignmentState(stateBody.state);
      setViewUnitId((prev) => prev ?? stateBody.state.currentUnitId ?? assignmentBody.assignment.units[0]?.id ?? null);
    },
    [apiFetch],
  );

  const refreshCurrentAssignment = useCallback(async () => {
    if (!currentAssignmentId) {
      return;
    }

    await loadAssignmentBundle(currentAssignmentId);
    await loadFeed();
  }, [currentAssignmentId, loadAssignmentBundle, loadFeed]);

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

      await loadFeed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize app.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, loadFeed]);

  useEffect(() => {
    loadInitial().catch(() => undefined);
  }, [loadInitial]);

  useEffect(() => {
    if (!currentAssignmentId) {
      setAssignment(null);
      setAssignmentState(null);
      return;
    }

    loadAssignmentBundle(currentAssignmentId).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load assignment.');
    });
  }, [currentAssignmentId, loadAssignmentBundle]);

  const assignmentIndex = useMemo(
    () => feed.findIndex((item) => item.id === currentAssignmentId),
    [feed, currentAssignmentId],
  );

  const units = assignment?.units ?? [];
  const stateByUnit = useMemo(() => {
    const entries = assignmentState?.unitStates ?? [];
    return new Map(entries.map((entry) => [entry.unitId, entry]));
  }, [assignmentState]);

  const activeUnitId = assignmentState?.currentUnitId ?? units[0]?.id ?? null;
  const activeUnitIndex = activeUnitId ? units.findIndex((unit) => unit.id === activeUnitId) : -1;
  const effectiveViewUnitId = viewUnitId ?? activeUnitId;
  const viewUnitIndex = effectiveViewUnitId
    ? units.findIndex((unit) => unit.id === effectiveViewUnitId)
    : -1;
  const currentUnit = viewUnitIndex >= 0 ? units[viewUnitIndex] : null;
  const currentUnitState = currentUnit ? stateByUnit.get(currentUnit.id) : undefined;

  function canOpenUnit(index: number): boolean {
    if (!assignmentState) {
      return false;
    }

    if (index <= activeUnitIndex) {
      return true;
    }

    for (let i = 0; i < index; i += 1) {
      const status = stateByUnit.get(units[i].id)?.status ?? 'unread';
      if (status !== 'completed') {
        return false;
      }
    }

    return true;
  }

  function moveAssignment(delta: number) {
    if (assignmentIndex < 0) {
      return;
    }

    const nextIndex = assignmentIndex + delta;
    if (nextIndex < 0 || nextIndex >= feed.length) {
      return;
    }

    setCurrentAssignmentId(feed[nextIndex].id);
    setViewUnitId(null);
  }

  function moveUnit(delta: number) {
    if (!currentUnit || viewUnitIndex < 0) {
      return;
    }

    const targetIndex = viewUnitIndex + delta;
    if (targetIndex < 0 || targetIndex >= units.length) {
      return;
    }

    if (!canOpenUnit(targetIndex)) {
      return;
    }

    setViewUnitId(units[targetIndex].id);
  }

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

  async function toggleBookmark() {
    if (!currentUnit || !currentUnitState) {
      return;
    }

    const payload: BookmarkUnitRequest = { bookmarked: !currentUnitState.bookmarked };
    const response = await apiFetch(`/api/units/${currentUnit.id}/bookmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
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

  async function completeUnit() {
    if (!currentUnit) {
      return;
    }

    if (currentUnit.id !== activeUnitId) {
      setError('Only the active unit can be completed.');
      return;
    }

    const response = await apiFetch(`/api/units/${currentUnit.id}/complete`, {
      method: 'POST',
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to complete unit.');
      return;
    }

    setViewUnitId(null);
    await refreshCurrentAssignment();
  }

  async function runRevisionChecks(): Promise<RevisionIssue[]> {
    if (!currentAssignmentId) {
      return [];
    }

    const response = await apiFetch(`/api/assignments/${currentAssignmentId}/revision-checks`);
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

  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: () => moveUnit(1),
    onSwipeRight: () => moveUnit(-1),
    onSwipeUp: () => moveAssignment(1),
    onSwipeDown: () => moveAssignment(-1),
  });

  if (loading) {
    return (
      <main className="container" style={{ paddingTop: 30 }}>
        <div className="panel pulse" style={{ padding: 24 }}>
          Loading study feed...
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ paddingTop: 20, paddingBottom: 26 }}>
      <header className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Nephix Study Feed</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {userEmail ? `Signed in as ${userEmail}` : 'Signed in'}
            </p>
          </div>
          <form onSubmit={logout}>
            <button type="submit" className="btn">
              Logout
            </button>
          </form>
        </div>
      </header>

      {error ? (
        <p className="error" style={{ marginTop: 0 }}>
          {error}
        </p>
      ) : null}

      <section className="row mobile-stack" style={{ alignItems: 'stretch' }}>
        <aside className="panel" style={{ width: 330, minHeight: 540, padding: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Assignments</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              Deadline-first
            </span>
          </div>

          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {feed.length === 0 ? <p className="muted">No assignments available.</p> : null}
            {feed.map((item) => {
              const active = item.id === currentAssignmentId;
              const progressPercent = item.totalUnits > 0 ? (item.completedUnits / item.totalUnits) * 100 : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="btn"
                  onClick={() => {
                    setCurrentAssignmentId(item.id);
                    setViewUnitId(null);
                  }}
                  style={{
                    textAlign: 'left',
                    borderColor: active ? '#0f766e' : '#dbe3ec',
                    background: active ? '#ecfeff' : 'white',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{item.title}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {new Date(item.deadlineISO).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {item.subject}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      height: 8,
                      borderRadius: 999,
                      background: '#e2e8f0',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${progressPercent}%`,
                        background: '#0f766e',
                        height: '100%',
                      }}
                    />
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {item.completedUnits}/{item.totalUnits} completed
                  </div>
                </button>
              );
            })}
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => moveAssignment(-1)} style={{ flex: 1 }}>
              Prev Assignment
            </button>
            <button type="button" className="btn" onClick={() => moveAssignment(1)} style={{ flex: 1 }}>
              Next Assignment
            </button>
          </div>
        </aside>

        <section className="panel" style={{ flex: 1, padding: 16 }} {...swipeHandlers}>
          {assignment && assignmentState && currentUnit ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{assignment.title}</h2>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    Unit {viewUnitIndex + 1}/{units.length} • {currentUnit.title}
                  </p>
                </div>
                <UnitStatusBadge status={currentUnitState?.status ?? 'unread'} />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn" onClick={() => moveUnit(-1)}>
                  Prev Unit
                </button>
                <button type="button" className="btn" onClick={() => moveUnit(1)}>
                  Next Unit
                </button>
                <button type="button" className="btn btn-soft" onClick={toggleBookmark}>
                  {currentUnitState?.bookmarked ? 'Remove Bookmark' : 'Bookmark'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={completeUnit}
                  disabled={currentUnit.id !== activeUnitId}
                >
                  Mark Complete
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <UnitWorkspace
                  unit={currentUnit}
                  unitState={currentUnitState}
                  units={units}
                  unitStateMap={stateByUnit}
                  isActive={currentUnit.id === activeUnitId}
                  onPatch={patchUnitState}
                  onRevisionCheck={runRevisionChecks}
                />
              </div>
            </>
          ) : (
            <p className="muted">Choose an assignment to begin.</p>
          )}
        </section>
      </section>
    </main>
  );
}

type UnitWorkspaceProps = {
  unit: AssignmentDetailDTO['units'][number];
  unitState: UserUnitStateDTO | undefined;
  units: AssignmentDetailDTO['units'];
  unitStateMap: Map<string, UserUnitStateDTO>;
  isActive: boolean;
  onPatch: (unitId: string, payload: PatchUnitStateRequest) => Promise<void>;
  onRevisionCheck: () => Promise<RevisionIssue[]>;
};

function UnitWorkspace({
  unit,
  unitState,
  units,
  unitStateMap,
  isActive,
  onPatch,
  onRevisionCheck,
}: UnitWorkspaceProps) {
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const initializedRef = useRef(false);
  const readingScrollSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    initializedRef.current = false;
    setSaveState('idle');
  }, [unit.id, unit.unitType, unit.payload, unitState?.updatedAtISO, unitState?.content]);

  useEffect(() => {
    if (unit.unitType === 'reading') {
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    setSaveState('saving');

    const timeout = setTimeout(() => {
      onPatch(unit.id, { content })
        .then(() => {
          setSaveState('saved');
        })
        .catch(() => {
          setSaveState('error');
        });
    }, 650);

    return () => clearTimeout(timeout);
  }, [content, onPatch, unit.id, unit.unitType]);

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
    return () => {
      if (readingScrollSaveRef.current) {
        clearTimeout(readingScrollSaveRef.current);
      }
    };
  }, []);

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
    setContent((prev) => ({ ...prev, ...patch }));
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Autosaving...'
      : saveState === 'saved'
        ? 'All changes saved'
        : saveState === 'error'
          ? 'Save failed'
          : '';

  if (unit.unitType === 'reading') {
    const text = typeof unit.payload.text === 'string' ? unit.payload.text : '';

    const onReadingScroll = (event: ReactUIEvent<HTMLDivElement>) => {
      if (!isActive) {
        return;
      }

      const scrollTop = event.currentTarget.scrollTop;
      if (readingScrollSaveRef.current) {
        clearTimeout(readingScrollSaveRef.current);
      }
      readingScrollSaveRef.current = setTimeout(() => {
        onPatch(unit.id, { position: { scrollTop } }).catch(() => undefined);
      }, 250);
    };

    return (
      <CardShell title={unit.title} subtitle="Read this fragment and move to the next unit when done.">
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
          Chat/AI clarification is planned for phase 2; current MVP keeps authoritative text unchanged.
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
            disabled={!isActive}
          />
        </label>
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => updateContent({ confirmed: event.target.checked })}
            disabled={!isActive}
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
        <div style={{ display: 'grid', gap: 10 }}>
          {sections.map((rawSection, index) => {
            const section = isObjectRecord(rawSection) ? rawSection : {};
            const id = typeof section.id === 'string' ? section.id : `section-${index + 1}`;
            const title = typeof section.title === 'string' ? section.title : '';
            const guidingQuestion =
              typeof section.guidingQuestion === 'string' ? section.guidingQuestion : '';
            const targetWords =
              typeof section.targetWords === 'number' ? section.targetWords : Number(section.targetWords) || 0;

            return (
              <div
                key={id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 10,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <label className="field">
                  <span>Section title</span>
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
                    disabled={!isActive}
                  />
                </label>
                <label className="field">
                  <span>Guiding question</span>
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
                    disabled={!isActive}
                  />
                </label>
                <label className="field">
                  <span>Target words</span>
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
                    disabled={!isActive}
                  />
                </label>
              </div>
            );
          })}
        </div>

        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => updateContent({ confirmed: event.target.checked })}
            disabled={!isActive}
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
            disabled={!isActive}
            style={{ minHeight: 240 }}
          />
        </label>
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => updateContent({ confirmed: event.target.checked })}
            disabled={!isActive}
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
          onChange={(event) => updateContent({ confirmed: event.target.checked })}
          disabled={!isActive}
        />
        <span>I confirm revision is complete for this assignment.</span>
      </label>
      <p className="muted" style={{ margin: 0 }}>
        {saveLabel}
      </p>
    </CardShell>
  );
}
