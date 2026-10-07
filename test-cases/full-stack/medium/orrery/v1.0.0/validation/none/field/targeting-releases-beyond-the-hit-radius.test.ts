// field/targeting-releases-beyond-the-hit-radius — past the hit radius the
// pointer targets no hex.
//
// THE RULE. "The pointer targets the field hex whose center is nearest to the
// pointer position, provided that distance is at most `HEX_HIT_R` (`26`)"
// (`specs/field.md`, Targeting a hex). The proviso is a real one: farther than
// `HEX_HIT_R` from every center, no hex is targeted, and the snapshot carries
// that as "`at`: the targeted hex, `null` off every hex"
// (`specs/instrumentation.md`). A build that took the nearest center however far
// away it was would target a hex everywhere on the stage.
//
// THE CONFIGURATION. The vertex where three hex cells meet: due north of hex
// `(0, 0)`'s computed center by `HEX_PITCH / sqrt(3)` (`27.71`), which is a
// pointy-top cell's own reach from center to vertex at pitch `HEX_PITCH` (`48`).
// The three centers meeting there — `(0, 0)`, `(0, -1)` and `(1, -1)` — are each
// exactly `27.71` from it, and the check reads that back off the specification's
// own formulas, along with every field hex center being farther than `HEX_HIT_R`,
// before asking the build anything. It is the point of the whole field at which a
// pointer is furthest from every center while still standing on the field, so
// nothing nearer than `26` can be hiding anywhere.
//
// THE CONTROL. The same drag is walked onto `(0, 0)`'s center first and reports
// `(0, 0)`, so the `null` that follows is the rule declining to target rather
// than a build that never targets anything.
//
// THE WORLD IS POSED, NOT SEARCHED. `BARE` is loaded as a challenge document and
// the machine emptied, so no part is on the field, and there is no live run,
// which would reduce a press on the field to a focus change. The drag is released
// where it stands, which "places nothing".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertNull,
  fail,
} from "../assert";
import { FIELD_CX, FIELD_CY, HEX_HIT_R, HEX_PITCH } from "../constants";
import {
  at,
  distance,
  fieldHexes,
  hexCenter,
  traySlot,
  type Hex,
  type StagePoint,
} from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

/** A pointy-top cell's reach from its center to a vertex, at pitch `HEX_PITCH`. */
const VERTEX_R = HEX_PITCH / Math.sqrt(3);

/** The vertex where the cells of `(0, 0)`, `(0, -1)` and `(1, -1)` meet. */
const VERTEX: StagePoint = { x: FIELD_CX, y: FIELD_CY - VERTEX_R };

/** The three hexes whose cells meet at that vertex. */
const MEETING: readonly Hex[] = [ORIGIN, at(0, -1), at(1, -1)];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports at as null at a cell vertex, where every center is past HEX_HIT_R", async () => {
  for (const hex of MEETING) {
    assertCloseTo(
      distance(VERTEX, hexCenter(hex)),
      VERTEX_R,
      6,
      `(${hex.q}, ${hex.r}) meets the other two at this vertex, HEX_PITCH / sqrt(3) from it`,
    );
  }
  for (const hex of fieldHexes()) {
    assertGreaterThan(
      distance(VERTEX, hexCenter(hex)),
      HEX_HIT_R,
      `(${hex.q}, ${hex.r}) is farther from the vertex than HEX_HIT_R`,
    );
  }

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, hexCenter(ORIGIN));
  const control = (await h.snapshot()).editor.drag;

  await moveTo(h, VERTEX);
  await h.advance(1);
  await captureStill(h, "untargeted");

  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  if (control === null || control.kind !== "place") {
    fail(
      'a live place drag, reported as editor.drag with kind "place"',
      control,
    );
  }
  assertEqual(
    control.at?.q,
    ORIGIN.q,
    "the same drag targets (0, 0) on its center, so this drag does target hexes: q",
  );
  assertEqual(
    control.at?.r,
    ORIGIN.r,
    "the same drag targets (0, 0) on its center, so this drag does target hexes: r",
  );

  if (drag === null || drag.kind !== "place") {
    fail('a live place drag, reported as editor.drag with kind "place"', drag);
  }
  assertNull(
    drag.at,
    "no field hex center is within HEX_HIT_R of a cell vertex, so no hex is targeted",
  );
});
