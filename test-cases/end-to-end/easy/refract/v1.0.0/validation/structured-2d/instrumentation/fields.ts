// instrumentation/fields.ts — the snapshot's documented top-level fields.
// PRIVATE to the instrumentation suites (no review item names this file).
//
// specs/instrumentation.md "Snapshot shape" lists exactly these, and two items
// in this category assert over the whole list: snapshot-shape holds every field
// to its documented type on a posed board, and snapshot-resting-values holds
// that no field goes missing whatever the mode. Writing the list once keeps the
// two suites asserting the same specification.

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
