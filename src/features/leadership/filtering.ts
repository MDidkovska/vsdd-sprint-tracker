/**
 * Re-export the pure leadership filtering/summary semantics from the domain
 * layer. Kept here so existing feature imports remain stable while the export
 * path (repository) reuses the exact same domain functions.
 */
export {
  applyFilters,
  computeSummary,
  flattenTeams,
  matchesFilters,
} from '../../domain/leadershipFiltering';
