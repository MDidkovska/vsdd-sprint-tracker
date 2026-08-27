import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { PROGRAMME_ID } from '../config';

export type AppView = 'team' | 'leadership';

export interface Selection {
  programmeId: string;
  streamId: string;
  teamId: string;
  sprintId: string;
  weekNumber: 1 | 2;
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

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('team');
  const [selection, setSelectionState] = useState<Selection>(DEFAULT_SELECTION);

  const value = useMemo<SelectionContextValue>(
    () => ({
      view,
      selection,
      setView,
      setSelection: (patch) => setSelectionState((current) => ({ ...current, ...patch })),
      openTeam: (patch) => {
        setSelectionState((current) => ({ ...current, ...patch }));
        setView('team');
      },
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
