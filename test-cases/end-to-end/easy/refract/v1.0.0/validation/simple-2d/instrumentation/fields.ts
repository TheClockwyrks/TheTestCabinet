// instrumentation/fields.ts — the snapshot's documented top-level fields.
// PRIVATE to the instrumentation suites (no review item names this file).
//
// specs/instrumentation.md "Snapshot shape" lists exactly these.
// snapshot-resting-values holds that no field goes missing whatever the mode,
// and the single-field poses (set-solved-count, set-tier) hold every field but
// their own to what it was. Writing the list once keeps the suites asserting
// the same specification.

/** Every top-level field the snapshot shape in specs/instrumentation.md lists. */
export const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "mode",
  "menuIndex",
  "boardIndex",
  "solvedBoards",
  "unlockedCount",
  "selectIndex",
  "solvedCount",
  "tier",
  "board",
  "beams",
  "solved",
  "tracing",
  "pointer",
  "muted",
  "simTime",
] as const;

/** One of the documented fields. */
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/**
 * The documented fields of a snapshot, and nothing else, so two snapshots can
 * be compared on what the specification fixes. A build may carry fields of its
 * own beside them (specs/state.md lets it hold derived data), and those are
 * its to change.
 */
export function documented(snapshot: object): Record<SnapshotField, unknown> {
  const fields = snapshot as Record<string, unknown>;
  const picked = {} as Record<SnapshotField, unknown>;
  for (const field of SNAPSHOT_FIELDS) picked[field] = fields[field];
  return picked;
}
