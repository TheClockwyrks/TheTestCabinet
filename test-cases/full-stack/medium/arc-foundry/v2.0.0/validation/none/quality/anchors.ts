// quality — reading the yard by ANCHOR rather than by id. CASE-PROVIDED.
//
// Not a check: vitest never collects a file that is not a `.test.ts`, and nothing
// here decides a review point. It exists because a combine is specified in terms
// of FOOTPRINTS rather than of identities — specs/scrap-press.md says the result
// "lands at the footprint of the piece the combine was initiated from" and that
// "every footprint a combine consumes hardens into a blocker" — and says nothing
// at all about whether a build reuses the ingredient's identifier for the result,
// for the blocker, or for neither. So the checks in this directory read the
// footprint the specification names and never the id a particular build happened
// to keep, which is the difference between grading the rule and grading one
// design.

import { assertTruthy } from "../assert";
import {
  structureAt,
  type FoundrySnapshot,
  type StructureView,
} from "../harness";

/** A tile coordinate: the top-left tile of a `2` by `2` footprint. */
export interface Anchor {
  col: number;
  row: number;
}

/** The structure anchored at that footprint, or a failure naming what stands there. */
export function anchored(
  snapshot: FoundrySnapshot,
  anchor: Anchor,
): StructureView {
  const found = structureAt(snapshot, anchor.col, anchor.row);
  assertTruthy(
    found,
    `a structure anchored at (${anchor.col}, ${anchor.row}); the yard holds ${
      snapshot.structures.length === 0
        ? "none"
        : snapshot.structures
            .map((s) => `${s.kind} at (${s.col}, ${s.row})`)
            .join(", ")
    }`,
  );
  return found as StructureView;
}

/** Whether any structure stands on that footprint at all. */
export function isEmpty(snapshot: FoundrySnapshot, anchor: Anchor): boolean {
  return structureAt(snapshot, anchor.col, anchor.row) === undefined;
}
