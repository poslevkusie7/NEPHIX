'use client';

import { useRouter } from 'next/navigation';
import {
  WheelEvent as ReactWheelEvent,
  forwardRef,
  PointerEvent as ReactPointerEvent,
  UIEvent as ReactUIEvent,
  useImperativeHandle,
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
  ClarificationTurn,
  CompleteUnitResponse,
  PatchUnitStateRequest,
  RevisionIssue,
  ThesisSuggestion,
  UserUnitStateDTO,
} from '@nephix/contracts';
import {
  EssayCardShell,
  getWritingUnitLabelForUnit,
  OutlineEditor,
  RevisionEditor,
  ThesisEditor,
  WritingEditor,
} from '@/components/essay-unit-ui';
import { AnimatedContourBackground } from '@/components/animated-contour-background';

type StudyClientProps = {
  initialAssignmentId?: string | null;
  initialUnitId?: string | null;
};

const ASSISTANT_FONT_OPTIONS = [
  { value: 'arial', label: 'Arial' },
  { value: 'open-dyslexic', label: 'Open Dyslexic' },
  { value: 'gill-sans', label: 'Gill Sans' },
] as const;

type AssistantFontMode = (typeof ASSISTANT_FONT_OPTIONS)[number]['value'];

const ASSISTANT_THEME_OPTIONS = [
  { value: 'theme-1', label: 'Theme 1', swatch: ['#97acc8', '#051230', '#b6bfc1'] },
  { value: 'theme-2', label: 'Theme 2', swatch: ['#c2ae93', '#a7d4e4', '#064f6e'] },
  { value: 'theme-3', label: 'Theme 3', swatch: ['#802626', '#f99d1b', '#b4cdc2'] },
  { value: 'theme-4', label: 'Theme 4', swatch: ['#bb7125', '#4b3317', '#051230'] },
  { value: 'theme-5', label: 'Theme 5', swatch: ['#f3a257', '#253122', '#b6bfc1'] },
  { value: 'theme-6', label: 'Theme 6', swatch: ['#ffffff', '#111111', '#9a9a9a'] },
  { value: 'theme-7', label: 'Theme 7', swatch: ['#ffffff', '#000000', '#000000'] },
  { value: 'theme-8', label: 'Black & White', swatch: ['#ffffff', '#000000', '#6f6f6f'] },
] as const;

type AssistantThemeMode = (typeof ASSISTANT_THEME_OPTIONS)[number]['value'];

function hasActiveTextSelection(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSwipeIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      'button, input, textarea, select, option, label, a, summary, [role="button"], [data-no-swipe="true"]',
    ),
  );
}

type SwipeHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
};

type UnitWorkspaceHandle = {
  persist: () => Promise<boolean>;
};

function getEssayStepLabel(
  unit: AssignmentDetailDTO['units'][number],
  units: AssignmentDetailDTO['units'],
): string {
  if (unit.unitType === 'thesis') {
    return 'Thesis';
  }
  if (unit.unitType === 'outline') {
    return 'Outline';
  }
  if (unit.unitType === 'revise') {
    return 'Revise';
  }
  if (unit.unitType === 'writing') {
    const title = unit.title.toLowerCase();
    const writingUnits = units.filter((entry) => entry.unitType === 'writing');
    const writingIndex = writingUnits.findIndex((entry) => entry.id === unit.id);
    if (title.includes('intro')) {
      return 'Intro';
    }
    if (title.includes('conclusion')) {
      return 'Conclusion';
    }
    if (title.includes('body') && title.includes('1')) {
      return 'Body 1';
    }
    if (title.includes('body') && title.includes('2')) {
      return 'Body 2';
    }
    if (title.includes('body') && title.includes('3')) {
      return 'Body 3';
    }

    const middleWritingUnits = writingUnits.filter((entry) => {
      const entryTitle = entry.title.toLowerCase();
      return !entryTitle.includes('intro') && !entryTitle.includes('conclusion');
    });
    const middleIndex = middleWritingUnits.findIndex((entry) => entry.id === unit.id);
    if (middleIndex >= 0) {
      return `Body ${middleIndex + 1}`;
    }

    if (writingIndex === 0) {
      return 'Intro';
    }
    if (writingIndex === writingUnits.length - 1) {
      return 'Conclusion';
    }
    if (writingIndex > 0) {
      return `Body ${writingIndex}`;
    }
    return 'Writing';
  }
  return unit.title;
}


type RevisionFocus = 'clarity' | 'structure' | 'argument' | 'style';

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
      if (isSwipeIgnoredTarget(event.target)) {
        reset();
        return;
      }

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
    onPointerCancel: () => {
      reset();
    },
  };
}

export function StudyClient({
  initialAssignmentId = null,
  initialUnitId = null,
}: StudyClientProps) {
  const router = useRouter();
  const requestedAssignmentId = initialAssignmentId;
  const requestedUnitId = initialUnitId;
  const requestedSelectionKey = `${requestedAssignmentId ?? ''}::${requestedUnitId ?? ''}`;

  const [feed, setFeed] = useState<AssignmentSummaryDTO[]>([]);
  const [currentAssignmentId, setCurrentAssignmentId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetailDTO | null>(null);
  const [assignmentState, setAssignmentState] = useState<AssignmentStateDTO | null>(null);
  const [viewUnitId, setViewUnitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReadingChatOpen, setIsReadingChatOpen] = useState(false);
  const [readingChatUnitId, setReadingChatUnitId] = useState<string | null>(null);
  const [readingChatMessage, setReadingChatMessage] = useState('');
  const [readingChatTurns, setReadingChatTurns] = useState<ClarificationTurn[]>([]);
  const [readingChatLoading, setReadingChatLoading] = useState(false);
  const [readingChatBusy, setReadingChatBusy] = useState(false);
  const [readingChatError, setReadingChatError] = useState<string | null>(null);
  const [assistantFont, setAssistantFont] = useState<AssistantFontMode>('arial');
  const [assistantTheme, setAssistantTheme] = useState<AssistantThemeMode>('theme-4');
  const [isContourBackgroundEnabled, setIsContourBackgroundEnabled] = useState(false);
  const [readingSlideClass, setReadingSlideClass] = useState('');
  const workspaceRef = useRef<UnitWorkspaceHandle | null>(null);
  const navigationInFlightRef = useRef(false);
  const appliedRequestedSelectionRef = useRef<string | null>(null);
  const readingChatScrollRef = useRef<HTMLDivElement | null>(null);
  const moveAssignmentRef = useRef<(delta: number) => Promise<void>>(async () => undefined);
  const moveUnitRef = useRef<(delta: number) => Promise<void>>(async () => undefined);
  const navigateReadingRef = useRef<(delta: number) => Promise<void>>(async () => undefined);
  const readingNavDirectionRef = useRef<'prev' | 'next' | null>(null);

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
      const availableUnits = assignmentBody.assignment.units;

      setAssignment(assignmentBody.assignment);
      setAssignmentState(stateBody.state);
      setViewUnitId((prev) => {
        if (prev && availableUnits.some((unit) => unit.id === prev)) {
          return prev;
        }
        return stateBody.state.currentUnitId ?? availableUnits[0]?.id ?? null;
      });
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

      await meResponse.json();

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
    const savedFont = window.localStorage.getItem('nephix-assistant-font');
    const matchedOption = ASSISTANT_FONT_OPTIONS.find((option) => option.value === savedFont);
    if (matchedOption) {
      setAssistantFont(matchedOption.value);
    } else if (savedFont) {
      window.localStorage.setItem('nephix-assistant-font', 'arial');
    }

    const savedTheme = window.localStorage.getItem('nephix-assistant-theme');
    const matchedTheme = ASSISTANT_THEME_OPTIONS.find((option) => option.value === savedTheme);
    if (matchedTheme) {
      setAssistantTheme(matchedTheme.value);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('nephix-assistant-font', assistantFont);
  }, [assistantFont]);

  useEffect(() => {
    window.localStorage.setItem('nephix-assistant-theme', assistantTheme);
  }, [assistantTheme]);

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

  useEffect(() => {
    if (feed.length === 0 || !requestedAssignmentId) {
      return;
    }
    if (appliedRequestedSelectionRef.current === requestedSelectionKey) {
      return;
    }

    appliedRequestedSelectionRef.current = requestedSelectionKey;
    const hasRequestedAssignment = feed.some((assignment) => assignment.id === requestedAssignmentId);
    if (!hasRequestedAssignment) {
      return;
    }

    setCurrentAssignmentId(requestedAssignmentId);
    setViewUnitId(requestedUnitId ?? null);
  }, [feed, requestedAssignmentId, requestedSelectionKey, requestedUnitId]);

  const assignmentIndex = useMemo(
    () => feed.findIndex((item) => item.id === currentAssignmentId),
    [feed, currentAssignmentId],
  );

  const units = useMemo(() => assignment?.units ?? [], [assignment]);
  const readingUnits = useMemo(
    () => units.filter((unit) => unit.unitType === 'reading'),
    [units],
  );
  const stateByUnit = useMemo(() => {
    const entries = assignmentState?.unitStates ?? [];
    return new Map(entries.map((entry) => [entry.unitId, entry]));
  }, [assignmentState]);

  const activeUnitId = assignmentState?.currentUnitId ?? units[0]?.id ?? null;
  const effectiveViewUnitId = viewUnitId ?? activeUnitId;
  const viewUnitIndex = effectiveViewUnitId
    ? units.findIndex((unit) => unit.id === effectiveViewUnitId)
    : -1;
  const currentUnit = viewUnitIndex >= 0 ? units[viewUnitIndex] : null;
  const currentUnitState = currentUnit ? stateByUnit.get(currentUnit.id) : undefined;
  const selectedReadingUnit =
    readingUnits.find((unit) => unit.id === readingChatUnitId) ?? readingUnits[0] ?? null;
  const isReadingView = currentUnit?.unitType === 'reading';
  const essayDisplayTitle = assignment?.title.replace(/^Essay:\s*/i, '') ?? '';
  const readingOrdinal = viewUnitIndex >= 0 ? viewUnitIndex + 1 : 0;
  const readingTotal = units.length;

  async function persistCurrentUnitBeforeNavigation(): Promise<boolean> {
    if (!workspaceRef.current) {
      return true;
    }

    const persisted = await workspaceRef.current.persist();
    if (!persisted) {
      setError('Could not save your current unit. Please try again.');
      return false;
    }

    return true;
  }

  async function moveAssignment(delta: number) {
    if (navigationInFlightRef.current) {
      return;
    }

    if (assignmentIndex < 0) {
      return;
    }

    const nextIndex = assignmentIndex + delta;
    if (nextIndex < 0 || nextIndex >= feed.length) {
      return;
    }

    navigationInFlightRef.current = true;
    try {
      const canContinue = await persistCurrentUnitBeforeNavigation();
      if (!canContinue) {
        return;
      }

      setError(null);
      setCurrentAssignmentId(feed[nextIndex].id);
      setViewUnitId(null);
    } finally {
      navigationInFlightRef.current = false;
    }
  }

  async function moveUnit(delta: number) {
    if (navigationInFlightRef.current) {
      return;
    }

    if (!currentUnit || viewUnitIndex < 0) {
      return;
    }

    const targetIndex = viewUnitIndex + delta;
    if (targetIndex < 0 || targetIndex >= units.length) {
      return;
    }

    navigationInFlightRef.current = true;
    try {
      const canContinue = await persistCurrentUnitBeforeNavigation();
      if (!canContinue) {
        return;
      }

      setError(null);
      setViewUnitId(units[targetIndex].id);
    } finally {
      navigationInFlightRef.current = false;
    }
  }

  async function navigateReadingRelative(delta: number) {
    if (navigationInFlightRef.current) {
      return;
    }
    if (!currentUnit || viewUnitIndex < 0) {
      return;
    }

    readingNavDirectionRef.current = delta < 0 ? 'prev' : 'next';
    const targetIndex = viewUnitIndex + delta;

    if (targetIndex >= 0 && targetIndex < units.length) {
      await moveUnit(delta);
      return;
    }

    await moveAssignment(delta);
  }

  async function jumpToUnit(targetIndex: number) {
    if (navigationInFlightRef.current) {
      return;
    }
    if (!currentUnit || viewUnitIndex < 0) {
      return;
    }
    if (targetIndex < 0 || targetIndex >= units.length) {
      return;
    }
    if (targetIndex === viewUnitIndex) {
      return;
    }

    navigationInFlightRef.current = true;
    try {
      const canContinue = await persistCurrentUnitBeforeNavigation();
      if (!canContinue) {
        return;
      }

      setError(null);
      setViewUnitId(units[targetIndex].id);
    } finally {
      navigationInFlightRef.current = false;
    }
  }

  moveAssignmentRef.current = moveAssignment;
  moveUnitRef.current = moveUnit;
  navigateReadingRef.current = navigateReadingRelative;

  async function completeCurrentUnitAndRefresh(): Promise<boolean> {
    if (!currentUnit) {
      return false;
    }

    const response = await apiFetch(`/api/units/${currentUnit.id}/complete`, {
      method: 'POST',
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to complete unit.');
      return false;
    }

    const body = (await response.json()) as { result: CompleteUnitResponse };
    setError(null);
    setViewUnitId(body.result.nextUnitId ?? null);
    await refreshCurrentAssignment();
    return true;
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

  const requestClarificationChat = useCallback(
    async (unitId: string, message: string): Promise<ClarificationTurn> => {
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
    },
    [apiFetch],
  );

  const requestClarificationHistory = useCallback(
    async (unitId: string): Promise<ClarificationTurn[]> => {
      const response = await apiFetch(`/api/units/${unitId}/chat`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load chat history.');
      }

      const body = (await response.json()) as { turns?: ClarificationTurn[] };
      return Array.isArray(body.turns) ? body.turns : [];
    },
    [apiFetch],
  );

  const requestThesisSuggestions = useCallback(
    async (unitId: string, regenerate: boolean): Promise<ThesisSuggestion[]> => {
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

      const body = (await response.json()) as { suggestions?: ThesisSuggestion[] };
      return Array.isArray(body.suggestions) ? body.suggestions : [];
    },
    [apiFetch],
  );

  const requestOutlineGenerate = useCallback(
    async (unitId: string): Promise<Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>> => {
      const response = await apiFetch(`/api/units/${unitId}/outline-generate`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to generate outline.');
      }

      const body = (await response.json()) as {
        sections?: Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>;
      };
      return Array.isArray(body.sections) ? body.sections : [];
    },
    [apiFetch],
  );

  const requestWritingHint = useCallback(
    async (unitId: string, currentSectionText: string): Promise<string> => {
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
    },
    [apiFetch],
  );

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
    } catch (chatError) {
      setReadingChatError(chatError instanceof Error ? chatError.message : 'Failed to send clarification request.');
    } finally {
      setReadingChatBusy(false);
    }
  }

  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: () => {
      void moveAssignment(1);
    },
    onSwipeRight: () => {
      void moveAssignment(-1);
    },
    onSwipeUp: () => {
      void moveUnit(1);
    },
    onSwipeDown: () => {
      void moveUnit(-1);
    },
  });

  useEffect(() => {
    if (readingUnits.length === 0) {
      setReadingChatUnitId(null);
      return;
    }

    if (currentUnit?.unitType === 'reading') {
      setReadingChatUnitId(currentUnit.id);
      return;
    }

    const preferredUnitId =
      activeUnitId && readingUnits.some((unit) => unit.id === activeUnitId)
        ? activeUnitId
        : readingUnits[0]?.id ?? null;
    setReadingChatUnitId(preferredUnitId);
  }, [activeUnitId, currentUnit?.id, currentUnit?.unitType, readingUnits]);

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
      .catch((chatError: unknown) => {
        setReadingChatError(chatError instanceof Error ? chatError.message : 'Failed to load chat history.');
      })
      .finally(() => {
        setReadingChatLoading(false);
      });
  }, [isReadingChatOpen, readingChatUnitId, requestClarificationHistory]);

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

  useEffect(() => {
    if (!isReadingView || !currentUnit?.id || !readingNavDirectionRef.current) {
      return;
    }

    setReadingSlideClass(
      readingNavDirectionRef.current === 'next' ? 'reading-slide-next' : 'reading-slide-prev',
    );

    const timer = window.setTimeout(() => {
      setReadingSlideClass('');
      readingNavDirectionRef.current = null;
    }, 220);

    return () => window.clearTimeout(timer);
  }, [currentUnit?.id, isReadingView]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (isReadingChatOpen || hasActiveTextSelection()) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (isReadingView) {
          void navigateReadingRef.current(-1);
          return;
        }
        void moveAssignmentRef.current(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (isReadingView) {
          void navigateReadingRef.current(1);
          return;
        }
        void moveAssignmentRef.current(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        void moveUnitRef.current(-1);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        void moveUnitRef.current(1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReadingChatOpen, isReadingView]);

  function canUseReadingSideNavigation(target: EventTarget | null): boolean {
    if (!isReadingView || isReadingChatOpen || hasActiveTextSelection()) {
      return false;
    }
    if (!(target instanceof Element)) {
      return true;
    }
    return !target.closest('input, textarea, select, button, [contenteditable="true"], [role="dialog"]');
  }

  function onFeedWheel(event: ReactWheelEvent<HTMLElement>) {
    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);
    const threshold = 45;

    if (absY > absX && absY > threshold) {
      event.preventDefault();
      void moveUnit(event.deltaY > 0 ? 1 : -1);
      return;
    }

    if (absX > absY && absX > threshold) {
      event.preventDefault();
      void moveAssignment(event.deltaX > 0 ? 1 : -1);
    }
  }

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
    <main
      className={`${isReadingView ? 'reading-assistant-page' : 'essay-assistant-page'} study-font-${assistantFont} study-theme-${assistantTheme}`}
      style={{ paddingTop: 0, paddingBottom: isReadingView ? 0 : 6 }}
    >
      {isContourBackgroundEnabled ? (
        <AnimatedContourBackground
          className={isReadingView ? 'assistant-contour-background--reading' : 'assistant-contour-background--essay'}
          lineColor="#06d681"
          lineOpacity={0.82}
          glowOpacity={0.1}
          speedSeconds={isReadingView ? 13 : 11.5}
          blurPx={4}
          intensity={1}
          centerFade={0}
        />
      ) : null}
      <button
        type="button"
        className="background-nav-zone background-nav-zone-left"
        onClick={() => {
          if (isReadingView) {
            void navigateReadingRef.current(-1);
            return;
          }
          void moveUnit(-1);
        }}
        disabled={viewUnitIndex <= 0}
        aria-label={isReadingView ? 'Previous reading unit' : 'Previous unit'}
        title={isReadingView ? 'Previous reading unit' : 'Previous unit'}
      >
        <span className="background-nav-zone-glow" />
      </button>
      <button
        type="button"
        className="background-nav-zone background-nav-zone-right"
        onClick={() => {
          if (isReadingView) {
            void navigateReadingRef.current(1);
            return;
          }
          void moveUnit(1);
        }}
        disabled={viewUnitIndex < 0 || viewUnitIndex >= units.length - 1}
        aria-label={isReadingView ? 'Next reading unit' : 'Next unit'}
        title={isReadingView ? 'Next reading unit' : 'Next unit'}
      >
        <span className="background-nav-zone-glow" />
      </button>
      <div className="assistant-screen-content">
        {error ? (
          <p className="error" style={{ marginTop: 0 }}>
            {error}
          </p>
        ) : null}

        <section
          className={
            isReadingView
              ? 'panel reading-assistant-shell'
              : 'essay-assistant-shell essay-container'
          }
          style={isReadingView ? { padding: 16, minHeight: 600 } : { minHeight: 0 }}
          {...swipeHandlers}
          onWheel={onFeedWheel}
        >
          {assignment && assignmentState && currentUnit ? (
            <>
            {isReadingView ? (
              <div className="reading-assistant-header">
                <p className="reading-assistant-subject">{assignment.subject}</p>
              </div>
            ) : (
              <div className="essay-assistant-header">
                <h2 className="essay-assistant-title essay-title">{essayDisplayTitle}</h2>
                <div className="essay-process-path" aria-label="Essay workflow path">
                  {units.map((unit, index) => {
                    const isCompleted = index < viewUnitIndex;
                    const isCurrent = index === viewUnitIndex;
                    const isLocked = index > viewUnitIndex;
                    const symbol = isCompleted ? '✓' : isCurrent ? '●' : '○';
                    const className = `essay-process-step${isCompleted ? ' completed' : ''}${isCurrent ? ' current' : ''}${isLocked ? ' locked' : ''}`;
                    const stepLabel = getEssayStepLabel(unit, units);
                    return (
                      <button
                        key={unit.id}
                        type="button"
                        className={`${className} essay-process-step-button`}
                        onClick={() => void jumpToUnit(index)}
                        aria-current={isCurrent ? 'step' : undefined}
                        aria-label={`Go to ${stepLabel} step`}
                        title={`Go to ${stepLabel}`}
                        disabled={isCurrent}
                      >
                        <span className="essay-process-symbol" aria-hidden="true">
                          {symbol}
                        </span>
                        <span className="essay-process-label">{stepLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isReadingView ? (
              <div className="essay-assistant-global-controls">
                <div className="assistant-font-menu">
                  <button
                    type="button"
                    className="assistant-font-trigger icon"
                    aria-label="Choose font"
                    title="Choose font"
                  >
                    Aa
                  </button>
                  <div className="assistant-font-menu-panel" role="menu" aria-label="Font options">
                    {ASSISTANT_FONT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`assistant-font-option${assistantFont === option.value ? ' active' : ''}`}
                        onClick={() => setAssistantFont(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="assistant-theme-menu assistant-font-menu">
                  <button
                    type="button"
                    className="assistant-font-trigger assistant-theme-trigger icon"
                    aria-label="Choose color theme"
                    title="Choose color theme"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 3a9 9 0 1 0 0 18c1.24 0 2.25-.9 2.25-2.02 0-.48-.2-.94-.2-1.4 0-.87.67-1.58 1.5-1.58h1.8A3.65 3.65 0 0 0 21 12.37 9.37 9.37 0 0 0 12 3Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
                      <circle cx="10" cy="7.5" r="1" fill="currentColor" />
                      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" />
                      <circle cx="16.5" cy="11.5" r="1" fill="currentColor" />
                    </svg>
                  </button>
                  <div className="assistant-font-menu-panel assistant-theme-menu-panel" role="menu" aria-label="Theme options">
                    {ASSISTANT_THEME_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`assistant-font-option assistant-theme-option${assistantTheme === option.value ? ' active' : ''}`}
                        aria-label={option.label}
                        title={option.label}
                        onClick={() => setAssistantTheme(option.value)}
                      >
                        <span className="assistant-theme-swatch" aria-hidden="true">
                          {option.swatch.map((color, colorIndex) => (
                            <span key={`${option.value}-${colorIndex}-${color}`} style={{ backgroundColor: color }} />
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={`assistant-animation-toggle assistant-font-trigger icon${isContourBackgroundEnabled ? ' active' : ''}`}
                  onClick={() => setIsContourBackgroundEnabled((current) => !current)}
                  aria-pressed={isContourBackgroundEnabled}
                  aria-label={isContourBackgroundEnabled ? 'Turn off background animation' : 'Turn on background animation'}
                  title={isContourBackgroundEnabled ? 'Turn off background animation' : 'Turn on background animation'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4.5 12c2.1-3.7 4.6-5.5 7.5-5.5s5.4 1.8 7.5 5.5c-2.1 3.7-4.6 5.5-7.5 5.5S6.6 15.7 4.5 12Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M7.8 12c1.1-1.7 2.5-2.5 4.2-2.5s3.1.8 4.2 2.5c-1.1 1.7-2.5 2.5-4.2 2.5S8.9 13.7 7.8 12Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}

            {!isReadingView ? (
              <div
                className={`essay-assistant-progress${currentUnit.unitType === 'outline' || currentUnit.unitType === 'revise' ? ' essay-assistant-progress-compact' : ''}`}
                aria-label="Essay completion progress"
              >
                <div className="essay-assistant-progress-track">
                  <div
                    className="essay-assistant-progress-fill progress-fill"
                    style={{
                      width: `${units.length > 0 && viewUnitIndex >= 0 ? ((viewUnitIndex + 1) / units.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="essay-assistant-progress-value">
                  {units.length > 0 && viewUnitIndex >= 0
                    ? Math.round(((viewUnitIndex + 1) / units.length) * 100)
                    : 0}
                  %
                </span>
              </div>
            ) : null}
            <div className={isReadingView ? `reading-assistant-workspace ${readingSlideClass}` : 'essay-assistant-workspace'} style={{ marginTop: isReadingView ? 14 : 8 }}>
              <UnitWorkspace
                ref={workspaceRef}
                unit={currentUnit}
                unitState={currentUnitState}
                units={units}
                unitStateMap={stateByUnit}
                isActive={isReadingView ? currentUnit.id === activeUnitId : true}
                readingOrdinal={readingOrdinal}
                readingTotal={readingTotal}
                readingProgressPercent={
                  readingTotal > 0
                    ? Math.max(0, Math.min(100, Math.round((readingOrdinal / readingTotal) * 100)))
                    : 0
                }
                onOpenReadingChat={
                  currentUnit.unitType === 'reading'
                    ? () => {
                        setIsReadingChatOpen(true);
                        setReadingChatError(null);
                      }
                    : undefined
                }
                onMovePrevUnit={
                  isReadingView ? () => void navigateReadingRef.current(-1) : () => void moveUnit(-1)
                }
                onMoveNextUnit={
                  isReadingView ? () => void navigateReadingRef.current(1) : () => void moveUnit(1)
                }
                canMovePrevUnit={viewUnitIndex > 0}
                canMoveNextUnit={
                  viewUnitIndex >= 0 && viewUnitIndex < units.length - 1
                }
                onPatch={patchUnitState}
                onRevisionCheck={runRevisionChecks}
                onGenerateThesisSuggestions={requestThesisSuggestions}
                onGenerateOutline={requestOutlineGenerate}
                onRequestWritingHint={requestWritingHint}
                onCompleteUnit={completeCurrentUnitAndRefresh}
              />
            </div>
            {!isReadingView ? (
              <div className="essay-assistant-nav row mobile-stack" style={{ marginTop: 8 }}>
                {readingUnits.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => {
                      setIsReadingChatOpen(true);
                      setReadingChatError(null);
                    }}
                  >
                    Open Clarification Chat
                  </button>
                ) : null}
              </div>
            ) : null}
            {isReadingView ? (
              <div className="reading-assistant-global-left">
                <button
                  type="button"
                  className="reading-assistant-menu-btn icon"
                  aria-label="Menu"
                  title="Menu"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4 6h16M4 12h16M4 18h16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}
            {isReadingView ? (
              <div className="reading-assistant-global-controls">
                <div className="assistant-font-menu">
                  <button
                    type="button"
                    className="assistant-font-trigger icon"
                    aria-label="Choose font"
                    title="Choose font"
                  >
                    Aa
                  </button>
                  <div className="assistant-font-menu-panel" role="menu" aria-label="Font options">
                    {ASSISTANT_FONT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`assistant-font-option${assistantFont === option.value ? ' active' : ''}`}
                        onClick={() => setAssistantFont(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="assistant-theme-menu assistant-font-menu">
                  <button
                    type="button"
                    className="assistant-font-trigger assistant-theme-trigger icon"
                    aria-label="Choose color theme"
                    title="Choose color theme"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 3a9 9 0 1 0 0 18c1.24 0 2.25-.9 2.25-2.02 0-.48-.2-.94-.2-1.4 0-.87.67-1.58 1.5-1.58h1.8A3.65 3.65 0 0 0 21 12.37 9.37 9.37 0 0 0 12 3Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
                      <circle cx="10" cy="7.5" r="1" fill="currentColor" />
                      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" />
                      <circle cx="16.5" cy="11.5" r="1" fill="currentColor" />
                    </svg>
                  </button>
                  <div className="assistant-font-menu-panel assistant-theme-menu-panel" role="menu" aria-label="Theme options">
                    {ASSISTANT_THEME_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`assistant-font-option assistant-theme-option${assistantTheme === option.value ? ' active' : ''}`}
                        aria-label={option.label}
                        title={option.label}
                        onClick={() => setAssistantTheme(option.value)}
                      >
                        <span className="assistant-theme-swatch" aria-hidden="true">
                          {option.swatch.map((color, colorIndex) => (
                            <span key={`${option.value}-${colorIndex}-${color}`} style={{ backgroundColor: color }} />
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={`assistant-animation-toggle assistant-font-trigger icon${isContourBackgroundEnabled ? ' active' : ''}`}
                  onClick={() => setIsContourBackgroundEnabled((current) => !current)}
                  aria-pressed={isContourBackgroundEnabled}
                  aria-label={isContourBackgroundEnabled ? 'Turn off background animation' : 'Turn on background animation'}
                  title={isContourBackgroundEnabled ? 'Turn off background animation' : 'Turn on background animation'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4.5 12c2.1-3.7 4.6-5.5 7.5-5.5s5.4 1.8 7.5 5.5c-2.1 3.7-4.6 5.5-7.5 5.5S6.6 15.7 4.5 12Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M7.8 12c1.1-1.7 2.5-2.5 4.2-2.5s3.1.8 4.2 2.5c-1.1 1.7-2.5 2.5-4.2 2.5S8.9 13.7 7.8 12Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="reading-assistant-bookmark-btn icon"
                  onClick={toggleBookmark}
                  aria-label={currentUnitState?.bookmarked ? 'Remove bookmark' : 'Add bookmark'}
                  title={currentUnitState?.bookmarked ? 'Remove bookmark' : 'Add bookmark'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"
                      fill={currentUnitState?.bookmarked ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}

            {isReadingChatOpen && selectedReadingUnit ? (
              <div className="reading-chat-modal-overlay">
                <div className="reading-chat-modal" role="dialog" aria-modal="true" aria-label="Clarification chat">
                  <button
                    type="button"
                    className="reading-chat-modal-close"
                    onClick={() => setIsReadingChatOpen(false)}
                    aria-label="Close chat"
                  >
                    ×
                  </button>
                  <h3 className="reading-chat-modal-title chat-header">Clarification Chat</h3>
                  <p className="reading-chat-modal-subtitle chat-subtitle">Ask any question.</p>

                  <div ref={readingChatScrollRef} className="reading-chat-modal-messages chat-body">
                    {readingChatLoading ? (
                      <p className="reading-chat-modal-muted">Loading chat...</p>
                    ) : null}
                    {readingChatError ? (
                      <p className="reading-chat-modal-error">{readingChatError}</p>
                    ) : null}
                    {!readingChatLoading && readingChatTurns.length === 0 ? (
                      <div className="reading-chat-modal-empty">
                        <div className="reading-chat-modal-logo" aria-hidden="true">
                          <span className="reading-chat-modal-logo-mark" />
                          <span className="reading-chat-modal-logo-word">nephix</span>
                        </div>
                        <p className="reading-chat-modal-empty-text">
                          Start with a short question about this reading.
                        </p>
                      </div>
                    ) : (
                      readingChatTurns.map((turn) => (
                        <div key={turn.id} className="reading-chat-modal-turn">
                          <div className="reading-chat-modal-bubble chat-message user user-message">{turn.userMessage}</div>
                          <div className="reading-chat-modal-bubble chat-message assistant ai-message">{turn.assistantMessage}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <form
                    className="reading-chat-modal-compose"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendReadingClarificationMessage();
                    }}
                  >
                    <input
                      className="chat-input"
                      value={readingChatMessage}
                      onChange={(event) => setReadingChatMessage(event.target.value)}
                      placeholder="Ask about the reading (10 word answers)"
                      disabled={readingChatBusy || readingChatLoading}
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="reading-chat-modal-send send-button"
                      disabled={
                        readingChatBusy ||
                        readingChatLoading ||
                        !readingChatUnitId ||
                        readingChatMessage.trim().length === 0
                      }
                    >
                      {readingChatBusy ? '...' : '↑'}
                    </button>
                  </form>
                </div>
              </div>
            ) : null}
            </>
          ) : (
            <p className="muted">No active assignment in the feed yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}

type UnitWorkspaceProps = {
  unit: AssignmentDetailDTO['units'][number];
  unitState: UserUnitStateDTO | undefined;
  units: AssignmentDetailDTO['units'];
  unitStateMap: Map<string, UserUnitStateDTO>;
  isActive: boolean;
  readingOrdinal: number;
  readingTotal: number;
  readingProgressPercent: number;
  onOpenReadingChat?: () => void;
  onMovePrevUnit?: () => void;
  onMoveNextUnit?: () => void;
  canMovePrevUnit?: boolean;
  canMoveNextUnit?: boolean;
  onPatch: (unitId: string, payload: PatchUnitStateRequest) => Promise<void>;
  onRevisionCheck: () => Promise<RevisionIssue[]>;
  onGenerateThesisSuggestions: (unitId: string, regenerate: boolean) => Promise<ThesisSuggestion[]>;
  onGenerateOutline: (
    unitId: string,
  ) => Promise<Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>>;
  onRequestWritingHint: (unitId: string, currentSectionText: string) => Promise<string>;
  onCompleteUnit?: () => Promise<boolean>;
};

const UnitWorkspace = forwardRef<UnitWorkspaceHandle, UnitWorkspaceProps>(function UnitWorkspace({
  unit,
  unitState,
  units,
  unitStateMap,
  isActive,
  readingOrdinal,
  readingTotal,
  readingProgressPercent,
  onOpenReadingChat,
  onMovePrevUnit,
  onMoveNextUnit,
  canMovePrevUnit = false,
  canMoveNextUnit = false,
  onPatch,
  onRevisionCheck,
  onGenerateThesisSuggestions,
  onGenerateOutline,
  onRequestWritingHint,
  onCompleteUnit,
}, ref) {
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const readingContainerRef = useRef<HTMLDivElement | null>(null);
  const [thesisSuggestions, setThesisSuggestions] = useState<ThesisSuggestion[]>([]);
  const [thesisSuggestionsBusy, setThesisSuggestionsBusy] = useState(false);
  const [outlineBusy, setOutlineBusy] = useState(false);
  const [writingHintBusy, setWritingHintBusy] = useState(false);
  const [isWritingHintOpen, setIsWritingHintOpen] = useState(false);
  const [isThesisReminderOpen, setIsThesisReminderOpen] = useState(false);
  const hasThesisUnit = units.some((entry) => entry.unitType === 'thesis');
  const selectedThesis = (() => {
    const thesisUnit = units.find((entry) => entry.unitType === 'thesis');
    if (!thesisUnit) {
      return '';
    }
    const thesisContent = unitStateMap.get(thesisUnit.id)?.content;
    if (!isObjectRecord(thesisContent)) {
      return '';
    }
    return typeof thesisContent.thesis === 'string' ? thesisContent.thesis.trim() : '';
  })();

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
    const existingHint =
      isObjectRecord(unitState?.content) && typeof unitState.content.writingHint === 'string'
        ? unitState.content.writingHint.trim()
        : '';
    setIsWritingHintOpen(existingHint.length > 0);
  }, [unit.id, unitState?.content]);

  useEffect(() => {
    setIsThesisReminderOpen(false);
  }, [unit.id]);

  useEffect(() => {
    if (unit.unitType !== 'thesis') {
      setThesisSuggestions([]);
      return;
    }

    const rawSuggestions = Array.isArray(content.thesisSuggestions) ? content.thesisSuggestions : [];
    const suggestions: ThesisSuggestion[] = rawSuggestions
      .map((entry, index) => {
        if (!isObjectRecord(entry)) {
          return null;
        }

        const text = typeof entry.text === 'string' ? entry.text : '';
        if (!text) {
          return null;
        }

        return {
          id: typeof entry.id === 'string' && entry.id ? entry.id : `suggestion-${index + 1}`,
          text,
        };
      })
      .filter((entry): entry is ThesisSuggestion => Boolean(entry));
    setThesisSuggestions(suggestions.slice(0, 3));
  }, [content, unit.unitType]);

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
    setContent((prev) => ({ ...prev, ...patch }));
  }

  const persist = useCallback(async () => {
    if (!isActive) {
      return true;
    }

    setSaveState('saving');

    try {
      if (unit.unitType === 'reading') {
        const scrollTop = readingContainerRef.current?.scrollTop ?? 0;
        await onPatch(unit.id, { position: { scrollTop } });
      } else {
        await onPatch(unit.id, { content });
      }
      setSaveState('saved');
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  }, [content, isActive, onPatch, unit.id, unit.unitType]);

  useImperativeHandle(
    ref,
    () => ({
      persist,
    }),
    [persist],
  );

  const essayStepFooterNav = null;

  if (unit.unitType === 'reading') {
    const text = typeof unit.payload.text === 'string' ? unit.payload.text : '';

    const onReadingScroll = (event: ReactUIEvent<HTMLDivElement>) => {
      if (!isActive) {
        return;
      }
      if (event.currentTarget.scrollTop >= 0) {
        setSaveState('dirty');
      }
    };

    return (
      <section className="reading-assistant-window">
        <div
          ref={readingContainerRef}
          onScroll={onReadingScroll}
          className="reading-assistant-fragment-body"
        >
          <div className="card-wrapper">
            <div className="reading-assistant-text-plate card">{text}</div>
          </div>
        </div>
        <div className="reading-assistant-inline-progress" aria-label="Reading progress">
          <div className="reading-assistant-inline-progress-track">
            <div
              className="reading-assistant-inline-progress-fill progress-fill"
              style={{ width: `${readingProgressPercent}%` }}
            />
          </div>
          <span className="reading-assistant-inline-progress-value">{readingProgressPercent}%</span>
        </div>
        <div className="reading-assistant-chat-under-nav">
          <button
            type="button"
            className="reading-assistant-chat-trigger"
            onClick={onOpenReadingChat}
            aria-label="Open clarification chat"
            title="Open clarification chat"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 6.5A3.5 3.5 0 0 1 7.5 3h9A3.5 3.5 0 0 1 20 6.5v5A3.5 3.5 0 0 1 16.5 15H11l-4.8 3.8a.7.7 0 0 1-1.2-.5V15A3.5 3.5 0 0 1 1 11.5v-5A3.5 3.5 0 0 1 4.5 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8.5" cy="9" r="1" fill="currentColor" />
              <circle cx="12" cy="9" r="1" fill="currentColor" />
              <circle cx="15.5" cy="9" r="1" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div className="reading-assistant-chat-wrap">
          <span className="reading-assistant-unit-counter" aria-label={`Reading ${readingOrdinal} of ${readingTotal}`}>
            <span className="reading-assistant-unit-counter-short">{readingOrdinal}</span>
            <span className="reading-assistant-unit-counter-full">{readingOrdinal} of {readingTotal}</span>
          </span>
        </div>
      </section>
    );
  }

  if (unit.unitType === 'thesis') {
    const thesis = typeof content.thesis === 'string' ? content.thesis : '';

    return (
      <EssayCardShell title={unit.title} noHeaderDivider footer={essayStepFooterNav}>
        <ThesisEditor
          thesis={thesis}
          suggestions={thesisSuggestions}
          busy={thesisSuggestionsBusy}
          disabled={!isActive}
          onGenerateIdeas={() => {
            void (async () => {
              setThesisSuggestionsBusy(true);
              try {
                const suggestions = await onGenerateThesisSuggestions(unit.id, thesisSuggestions.length > 0);
                const limited = suggestions.slice(0, 3);
                setThesisSuggestions(limited);
                updateContent({ thesisSuggestions: limited });
              } catch {
                setSaveState('error');
              } finally {
                setThesisSuggestionsBusy(false);
              }
            })();
          }}
          onSelectSuggestion={(suggestion) => {
            updateContent({
              thesis: suggestion.text,
            });
          }}
          onThesisChange={(value) => updateContent({ thesis: value })}
        />
      </EssayCardShell>
    );
  }

  if (unit.unitType === 'outline') {
    const fallbackSections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
    const sections = Array.isArray(content.sections) ? content.sections : fallbackSections;
    const hasGeneratedOutline = Boolean(content.outlineGenerated);

    return (
      <EssayCardShell
        title={unit.title}
        subtitle="Adjust section plan while staying close to target word balance."
        footer={essayStepFooterNav}
      >
        <OutlineEditor
          sections={sections.map((rawSection, index) => {
            const section = isObjectRecord(rawSection) ? rawSection : {};
            return {
              id: typeof section.id === 'string' ? section.id : `section-${index + 1}`,
              title: typeof section.title === 'string' ? section.title : '',
              guidingQuestion:
                typeof section.guidingQuestion === 'string' ? section.guidingQuestion : '',
              targetWords:
                typeof section.targetWords === 'number' ? section.targetWords : Number(section.targetWords) || 0,
            };
          })}
          busy={outlineBusy}
          disabled={!isActive}
          hasGeneratedOutline={hasGeneratedOutline}
          onGenerateOutline={() => {
            void (async () => {
              setOutlineBusy(true);
              try {
                const generated = await onGenerateOutline(unit.id);
                updateContent({ sections: generated, outlineGenerated: true });
              } catch {
                setSaveState('error');
              } finally {
                setOutlineBusy(false);
              }
            })();
          }}
          onGuidingQuestionChange={(index, value) => {
            const next = [...sections];
            const current = isObjectRecord(next[index]) ? next[index] : {};
            next[index] = {
              ...current,
              id: typeof current.id === 'string' ? current.id : `section-${index + 1}`,
              title: typeof current.title === 'string' ? current.title : '',
              guidingQuestion: value,
              targetWords:
                typeof current.targetWords === 'number' ? current.targetWords : Number(current.targetWords) || 0,
            };
            updateContent({ sections: next });
          }}
          onTargetWordsChange={(index, value) => {
            const next = [...sections];
            const current = isObjectRecord(next[index]) ? next[index] : {};
            next[index] = {
              ...current,
              id: typeof current.id === 'string' ? current.id : `section-${index + 1}`,
              title: typeof current.title === 'string' ? current.title : '',
              guidingQuestion:
                typeof current.guidingQuestion === 'string' ? current.guidingQuestion : '',
              targetWords: value,
            };
            updateContent({ sections: next });
          }}
        />
      </EssayCardShell>
    );
  }

  if (unit.unitType === 'writing') {
    const text = typeof content.text === 'string' ? content.text : '';
    const hint = typeof content.writingHint === 'string' ? content.writingHint : '';
    const sectionId = typeof unit.payload.sectionId === 'string' ? unit.payload.sectionId : '';
    const outlineUnit = units.find((entry) => entry.unitType === 'outline');
    const outlineContent = outlineUnit ? unitStateMap.get(outlineUnit.id)?.content : null;
    const outlineSectionsSource =
      isObjectRecord(outlineContent) && Array.isArray(outlineContent.sections)
        ? outlineContent.sections
        : outlineUnit && Array.isArray(outlineUnit.payload.sections)
          ? outlineUnit.payload.sections
          : [];
    const matchedOutlineSection = outlineSectionsSource.find(
      (rawSection) => isObjectRecord(rawSection) && rawSection.id === sectionId,
    );
    const targetWords =
      isObjectRecord(matchedOutlineSection) && typeof matchedOutlineSection.targetWords === 'number'
        ? matchedOutlineSection.targetWords
        : isObjectRecord(matchedOutlineSection)
          ? Number(matchedOutlineSection.targetWords) || (typeof unit.targetWords === 'number' ? unit.targetWords : null)
          : typeof unit.targetWords === 'number'
            ? unit.targetWords
            : null;

    return (
      <EssayCardShell
        title={unit.title}
        subtitle="Draft this section only. Focus on ideas and flow first."
        footer={essayStepFooterNav}
      >
        <WritingEditor
          label={getWritingUnitLabelForUnit(unit, units)}
          text={text}
          targetWords={targetWords}
          hint={hint}
          hintOpen={isWritingHintOpen}
          hintBusy={writingHintBusy}
          disabled={!isActive}
          hasThesisReminder={hasThesisUnit}
          selectedThesis={selectedThesis}
          thesisReminderOpen={isThesisReminderOpen}
          onTextChange={(value) => updateContent({ text: value })}
          onToggleThesisReminder={() => setIsThesisReminderOpen((open) => !open)}
          onToggleHint={() => {
            void (async () => {
              if (hint) {
                setIsWritingHintOpen((open) => !open);
                return;
              }

              setWritingHintBusy(true);
              try {
                const nextHint = await onRequestWritingHint(unit.id, text);
                if (nextHint) {
                  updateContent({ writingHint: nextHint });
                  setIsWritingHintOpen(true);
                }
              } catch {
                setSaveState('error');
              } finally {
                setWritingHintBusy(false);
              }
            })();
          }}
          onRegenerateHint={() => {
            void (async () => {
              setWritingHintBusy(true);
              try {
                const nextHint = await onRequestWritingHint(unit.id, text);
                if (nextHint) {
                  updateContent({ writingHint: nextHint });
                  setIsWritingHintOpen(true);
                }
              } catch {
                setSaveState('error');
              } finally {
                setWritingHintBusy(false);
              }
            })();
          }}
        />
      </EssayCardShell>
    );
  }

  const fullDraft = writingSections
    .map((section) => section.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const revisionDraft = typeof content.revisionDraft === 'string' ? content.revisionDraft : fullDraft;
  return (
    <EssayCardShell
      title={unit.title}
      subtitle="Improve clarity and structure."
      footer={essayStepFooterNav}
    >
      <RevisionEditor
        draft={revisionDraft}
        disabled={!isActive}
        onDraftChange={(value) => updateContent({ revisionDraft: value })}
        onAnalyze={() => {
          void (async () => {
            const nextIssues = await onRevisionCheck();
            updateContent({ issues: nextIssues });
          })();
        }}
        analyzeLabel="Analyze draft"
      />
    </EssayCardShell>
  );
});
