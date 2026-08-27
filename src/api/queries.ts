/**
 * TanStack Query hooks over the repository. These same hooks work unchanged
 * with the Phase B HTTP repository — only the injected implementation differs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRepository } from './RepositoryContext';
import { useNotificationClient } from '../features/notifications/NotificationClientContext';
import { useVersionClient } from '../features/leadership/VersionClientContext';
import type {
  DecisionInput,
  ReopenInput,
  SaveDraftInput,
  SubmitInput,
  UpdateLocator,
} from './repository';

export const queryKeys = {
  currentUser: ['currentUser'] as const,
  notifications: ['notifications'] as const,
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
  versionHistory: (teamId: string, checkpointId: string) =>
    ['versionHistory', teamId, checkpointId] as const,
  versionComparison: (baseVersionId: string, compareVersionId: string) =>
    ['versionComparison', baseVersionId, compareVersionId] as const,
};

export function useCurrentUser() {
  const repo = useRepository();
  return useQuery({ queryKey: queryKeys.currentUser, queryFn: () => repo.getCurrentUser() });
}

/**
 * The current user's in-app notification inbox (task 9.1). Goes through the
 * injected notification client — the REAL HTTP endpoint by default, the mock
 * only under `VITE_AUTH_MODE=mock`. Loading it lazily generates the caller's
 * deadline reminders server-side, so the query both drives the bell's unread
 * count and triggers generation. A failed request surfaces as a query error
 * (no silent fallback to mock data).
 */
export function useNotifications() {
  const client = useNotificationClient();
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => client.getInbox(),
    // Do not retry a connection error into a spinner loop; surface it.
    retry: false,
  });
}

export function useMarkNotificationRead() {
  const notificationClient = useNotificationClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationClient.markRead(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const notificationClient = useNotificationClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => notificationClient.markAllRead(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });
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

/**
 * Version history for a team + checkpoint (task 9.4), newest first. Goes through
 * the injected version client — the REAL HTTP endpoint by default, the mock only
 * under `VITE_AUTH_MODE=mock`. A failed request surfaces as a query error (no
 * silent fallback); it is not retried into a spinner loop.
 */
export function useVersionHistory(teamId: string, checkpointId: string, enabled = true) {
  const client = useVersionClient();
  return useQuery({
    queryKey: queryKeys.versionHistory(teamId, checkpointId),
    queryFn: () => client.getVersions(teamId, checkpointId),
    enabled: enabled && Boolean(teamId && checkpointId),
    retry: false,
  });
}

/**
 * Field-level comparison of two immutable versions (task 9.4). Enabled only when
 * two distinct version ids are chosen. Errors (invalid/deleted version, cross
 * team/checkpoint, permission) surface explicitly for the UI to render.
 */
export function useVersionComparison(
  baseVersionId: string | undefined,
  compareVersionId: string | undefined,
) {
  const client = useVersionClient();
  const canCompare = Boolean(
    baseVersionId && compareVersionId && baseVersionId !== compareVersionId,
  );
  return useQuery({
    queryKey: queryKeys.versionComparison(baseVersionId ?? 'none', compareVersionId ?? 'none'),
    queryFn: () => client.compareVersions(baseVersionId as string, compareVersionId as string),
    enabled: canCompare,
    retry: false,
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
