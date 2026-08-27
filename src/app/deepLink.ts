/**
 * Deep-link serialization (task 9.3).
 *
 * A deep link encodes the exact reporting context — view, programme, stream,
 * team, sprint, checkpoint (week) and, when viewing submitted evidence, the
 * version — in the URL hash. Using the hash keeps direct load, refresh and
 * copied links working on any static host without a server rewrite rule, while
 * the History API drives Back/Forward.
 *
 * Parsing is deliberately defensive: only structurally valid values are
 * returned (a known view, week 1 or 2, non-empty ids). Whether a referenced
 * team/sprint/version actually exists or is authorised is decided by the
 * existing Phase 7 data contracts and Phase 8 RBAC at the point of use — this
 * module never trusts the URL as authority.
 */
import type { AppView } from './selection';

const VIEWS: readonly AppView[] = ['team', 'leadership', 'admin', 'audit'];

export interface DeepLinkState {
  view: AppView;
  programmeId: string;
  streamId: string;
  teamId: string;
  sprintId: string;
  weekNumber: 1 | 2;
  versionId?: string;
}

function isView(value: string | null): value is AppView {
  return value !== null && (VIEWS as readonly string[]).includes(value);
}

/** Serialize a full context into a hash fragment (e.g. `#/?view=leadership&…`). */
export function serializeDeepLink(state: DeepLinkState): string {
  const params = new URLSearchParams();
  params.set('view', state.view);
  if (state.programmeId) params.set('programme', state.programmeId);
  if (state.streamId) params.set('stream', state.streamId);
  if (state.teamId) params.set('team', state.teamId);
  if (state.sprintId) params.set('sprint', state.sprintId);
  params.set('week', String(state.weekNumber));
  if (state.versionId) params.set('version', state.versionId);
  return `#/?${params.toString()}`;
}

/**
 * Parse a hash fragment into a partial context. Unknown or malformed values are
 * dropped so callers can safely spread the result over their defaults.
 */
export function parseDeepLink(hash: string): Partial<DeepLinkState> {
  const questionMark = hash.indexOf('?');
  if (questionMark === -1) return {};

  const params = new URLSearchParams(hash.slice(questionMark + 1));
  const out: Partial<DeepLinkState> = {};

  const view = params.get('view');
  if (isView(view)) out.view = view;

  const programmeId = params.get('programme');
  if (programmeId) out.programmeId = programmeId;

  const streamId = params.get('stream');
  if (streamId) out.streamId = streamId;

  const teamId = params.get('team');
  if (teamId) out.teamId = teamId;

  const sprintId = params.get('sprint');
  if (sprintId) out.sprintId = sprintId;

  const week = params.get('week');
  if (week === '1' || week === '2') out.weekNumber = Number(week) as 1 | 2;

  const versionId = params.get('version');
  if (versionId) out.versionId = versionId;

  return out;
}

/** Build an absolute, shareable link for the given context. */
export function buildShareableLink(state: DeepLinkState): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${serializeDeepLink(state)}`;
}
