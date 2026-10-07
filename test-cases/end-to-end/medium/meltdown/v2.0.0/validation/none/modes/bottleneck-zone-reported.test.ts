// modes/bottleneck-zone-reported — Bottleneck marks the central zone the
// specification names, and both corridors cross it.
//
// THE RULE. `specs/modes.md`: "Bottleneck restricts building to a marked central
// zone, `BOTTLENECK_ZONE`: columns `13` through `36` and rows `8` through `27`,
// both ends included" — and "the zone spans both straight vent-to-exhaust
// corridors". The snapshot reports it as `buildZone`, inclusive at both ends and
// `null` off this mode.
//
// TWO READINGS OVER THE ONE FIELD.
//
//   THE RECTANGLE. All four bounds, together, against the figures the
//   specification states. A build that read the zone as exclusive at its far
//   corner reports `37` and `28`; one that centred a zone of its own on the floor
//   reports something else again; one that forgot the mode reports `null`.
//
//   THE COVERAGE. That the zone the build reported really is crossed by both
//   corridors. The left vent's corridor runs along rows `LEFT_VENT_ROWS` and the
//   top vent's down columns `TOP_VENT_COLS` (`specs/floor.md`), so the reported
//   zone's row band must reach the first of those rows and the last, and its
//   column band the first of those columns and the last. That is the property the
//   mode's own section claims, read off the build rather than off this project's
//   copy of the rectangle — a build reporting a zone tucked into a corner of the
//   floor satisfies "a zone" and fails this.
//
// WHAT THIS ITEM DOES NOT DECIDE. Whether the zone is ENFORCED is
// `modes.bottleneck-refuses-outside` and `-allows-inside`; that the zone is
// `null` on every other mode is `modes.difficulty-changes-nothing-else`'s for
// Containment.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  BOTTLENECK_ZONE,
  LEFT_VENT_ROWS,
  TOP_VENT_COLS,
  type BuildZone,
} from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The two corridors the zone must be crossed by (specs/floor.md). */
const LEFT_CORRIDOR_FIRST_ROW = LEFT_VENT_ROWS[0];
const LEFT_CORRIDOR_LAST_ROW = LEFT_VENT_ROWS[LEFT_VENT_ROWS.length - 1];
const TOP_CORRIDOR_FIRST_COL = TOP_VENT_COLS[0];
const TOP_CORRIDOR_LAST_COL = TOP_VENT_COLS[TOP_VENT_COLS.length - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports columns 13 to 36 and rows 8 to 27, spanning both corridors", async () => {
  await startRun(h, "bottleneck");
  await h.advance(1);
  await captureStill(h, "zone");

  const snapshot = await h.snapshot();
  assertNotNull(snapshot.buildZone, "the build zone Bottleneck fixes");
  const zone = snapshot.buildZone as BuildZone;

  assertDeepEqual(
    zone,
    BOTTLENECK_ZONE,
    "the zone specs/modes.md names, inclusive at both ends",
  );

  // The coverage claim, read off the zone the build reported.
  assertLessThanOrEqual(
    zone.row0,
    LEFT_CORRIDOR_FIRST_ROW,
    "the zone reaches the first row of the left vent's corridor",
  );
  assertGreaterThanOrEqual(
    zone.row1,
    LEFT_CORRIDOR_LAST_ROW,
    "the zone reaches the last row of the left vent's corridor",
  );
  assertLessThanOrEqual(
    zone.col0,
    TOP_CORRIDOR_FIRST_COL,
    "the zone reaches the first column of the top vent's corridor",
  );
  assertGreaterThanOrEqual(
    zone.col1,
    TOP_CORRIDOR_LAST_COL,
    "the zone reaches the last column of the top vent's corridor",
  );
});
