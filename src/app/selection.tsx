import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { PROGRAMME_ID } from '../config';
import {
  parseDeepLink,
  serializeDeepLink,
  type DeepLinkState,
} from './deepLink';

export type AppView = 'team' | 'leadership' | 'admin' | 'audit';

export interface Selection {
  programmeId: string;
  streamId: string;
  teamId: string;
  sprintId: string;
  weekNumber: 1 | 2;
  /**
   * The exact submitted version being viewed, when the context resolves to
   * submitted evidence. Preserved in the deep link so a copied/refreshed link
   * points at the same version; validated against the versions contract by the
   * consuming view (invalid/unauthorised ids are dropped, never trusted).
   */
  versionId?: string;
}

interface SelectionContextValue {
  view: AppView;
  selection: Selection;
  setView: (view: AppView) => void;
  setSelection: (patch: Partial<Selection>) => void;
  /** Jump to a team in the Team Update view (used from Leadership drill-down). */
  openTeam: (patch: Partial<Selection>) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

const DEFAULT_SELECTION: Selection = {
  programmeId: PROGRAMME_ID,
  streamId: 'MMM',
  teamId: 'mmm-a',
  sprintId: 'S14',
  weekNumber: 1,
};

const DEFAULT_VIEW: AppView = 'team';

interface AppLocation {
  view: AppView;
  selection: Selection;
}

/** Read the current context from the URL hash, falling back to defaults. */
function locationFromHash(): AppLocation {
  const parsed = parseDeepLink(window.location.hash);
  return {
    view: parsed.view ?? DEFAULT_VIEW,
    selection: {
      ...DEFAULT_SELECTION,
      ...(parsed.programmeId ? { programmeId: parsed.programmeId } : {}),
      ...(parsed.streamId ? { streamId: parsed.streamId } : {}),
      ...(parsed.teamId ? { teamId: parsed.teamId } : {}),
      ...(parsed.sprintId ? { sprintId: parsed.sprintId } : {}),
      ...(parsed.weekNumber ? { weekNumber: parsed.weekNumber } : {}),
      ...(parsed.versionId ? { versionId: parsed.versionId } : {}),
    },
  };
}

function toDeepLinkState({ view, selection }: AppLocation): DeepLinkState {
  return {
    view,
    programmeId: selection.programmeId,
    streamId: selection.streamId,
    teamId: selection.teamId,
    sprintId: selection.sprintId,
    weekNumber: selection.weekNumber,
    ...(selection.versionId ? { versionId: selection.versionId } : {}),
  };
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<AppLocation>(() => locationFromHash());
  const { view, selection } = location;

  // Keep the URL in step with the context. The first sync normalizes the URL
  // without adding a history entry; later changes push so Back/Forward can
  // restore each visited context. Guarded against pushing our own state back
  // when a change originated from a popstate (the hash already matches).
  const firstSyncDone = useRef(false);
  useEffect(() => {
    const target = serializeDeepLink(toDeepLinkState(location));
    if (window.location.hash === target) {
      firstSyncDone.current = true;
      return;
    }
    if (!firstSyncDone.current) {
      firstSyncDone.current = true;
      window.history.replaceState(null, '', target);
    } else {
      window.history.pushState(null, '', target);
    }
  }, [location]);

  // Restore context on browser Back/Forward.
  useEffect(() => {
    function onPopState() {
      setLocation(locationFromHash());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const value = useMemo<SelectionContextValue>(
    () => ({
      view,
      selection,
      setView: (next) => setLocation((current) => ({ ...current, view: next })),
      setSelection: (patch) =>
        setLocation((current) => ({
          ...current,
          selection: { ...current.selection, ...patch },
        })),
      openTeam: (patch) =>
        setLocation((current) => ({
          view: 'team',
          selection: { ...current.selection, ...patch },
        })),
    }),
    [view, selection],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}
