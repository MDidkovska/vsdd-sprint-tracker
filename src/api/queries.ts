/**
 * TanStack Query hooks over the repository. These same hooks work unchanged
 * with the Phase B HTTP repository — only the injected implementation differs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepository } from './RepositoryContext';
import type {
  DecisionInput,
  ReopenInput,
  SaveDraftInput,
  SubmitInput,
  UpdateLocator,
} from './repository';

export const queryKeys = {
  currentUser: ['currentUser'] as const,
  hierarchy: (programmeId: string) => ['hierarchy', programmeId] as const,
  sprints: (programmeId: string) => ['sprints', programmeId] as const,
  checkpoints: (sprintId: string) => ['checkpoints', sprintId] as const,
  update: (locator: UpdateLocator) =>
    ['update', locator.teamId, locator.sprintId, locator.checkpointId] as const,
  versions: (locator: UpdateLocator) =>
    ['versions', locator.teamId, locator.sprintId, locator.checkpointId] as const,
  leadership: (programmeId: string, sprintId: string, checkpointId: string) =>
    ['leadership', programmeId, sprintId, checkpointId] as const,
  audit: (entityId: string) => ['audit', entityId] as const,
  decisions: (versionId: string) => ['decisions', versionId] as const,
};

export function useCurrentUser() {
  const repo = useRepository();
  return useQuery({ queryKey: queryKeys.currentUser, queryFn: () => repo.getCurrentUser() });
}

export function useHierarchy(programmeId: string) {
  const repo = useRepository();
  return useQuery({
    queryKey: queryKeys.hierarchy(programmeId),
    queryFn: () => repo.getHierarchy(programmeId),
  });
}

export function useSprints(programmeId: string) {
  const repo = useRepository();
  return useQuery({
    queryKey: queryKeys.sprints(programmeId),
    queryFn: () => repo.getSprints(programmeId),
  });
}

export function useCheckpoints(sprintId: string) {
  const repo = useRepository();
  return useQuery({
    queryKey: queryKeys.checkpoints(sprintId),
    queryFn: () => repo.getCheckpoints(sprintId),
    enabled: Boolean(sprintId),
  });
}

export function useUpdate(locator: UpdateLocator, enabled = true) {
  const repo = useRepository();
  return useQuery({
    queryKey: queryKeys.update(locator),
    queryFn: () => repo.getUpdate(locator),
    enabled: enabled && Boolean(locator.teamId && locator.sprintId && locator.checkpointId),
  });
}

export function useVersions(locator: UpdateLocator, enabled = true) {
  const repo = useRepository();
  return useQuery({
    queryKey: queryKeys.versions(locator),
    queryFn: () => repo.getVersions(locator),
    enabled: enabled && Boolean(locator.teamId && locator.sprintId && locator.checkpointId),
  });
}

export function useLeadershipSnapshot(
  programmeId: string,
  sprintId: string,
  checkpointId: string,
) {
  const repo = useRepository();
  return useQuery({
    queryKey: queryKeys.leadership(programmeId, sprintId, checkpointId),
    queryFn: () => repo.getLeadershipSnapshot(programmeId, sprintId, checkpointId),
    enabled: Boolean(programmeId && sprintId && checkpointId),
  });
}

export function useSaveDraft() {
  const repo = useRepository();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDraftInput) => repo.saveDraft(input),
    onSuccess: (doc) => {
      client.setQueryData(queryKeys.update(doc), doc);
    },
  });
}

export function useSubmitUpdate() {
  const repo = useRepository();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitInput) => repo.submit(input),
    onSuccess: ({ document }) => {
      client.setQueryData(queryKeys.update(document), document);
      void client.invalidateQueries({ queryKey: ['leadership'] });
      void client.invalidateQueries({ queryKey: queryKeys.versions(document) });
    },
  });
}

export function useReopenUpdate() {
  const repo = useRepository();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReopenInput) => repo.reopen(input),
    onSuccess: (doc) => {
      client.setQueryData(queryKeys.update(doc), doc);
      void client.invalidateQueries({ queryKey: ['leadership'] });
    },
  });
}

export function useRecordDecision() {
  const repo = useRepository();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: DecisionInput) => repo.recordDecision(input),
    onSuccess: (decision) => {
      void client.invalidateQueries({ queryKey: queryKeys.decisions(decision.updateVersionId) });
    },
  });
}
