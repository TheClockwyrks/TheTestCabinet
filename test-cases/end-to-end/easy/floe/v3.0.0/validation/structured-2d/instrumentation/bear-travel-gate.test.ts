// instrumentation/bear-travel-gate — `setBearTravel` gates one bear's locomotion,
// and only its locomotion.
//
// specs/instrumentation.md gives the gate exactly that scope: "Gates that bear's
// locomotion alone. Off, its center holds however long a scenario runs and the two
// tiles it occupies hold with it. Its sense and its routing run untouched, so it
// still reports the target it reads and the step its routing chose."
// specs/hunter.md fixes what is being held off: "Each tick a bear travels its
// current speed times the tick's length, along the axis of the step it is on."
//
// WITHOUT IT A BEAR'S ROUTE CANNOT BE READ WITHOUT ALSO RUNNING ITS TRAVEL. A
// check about WHICH step a bear chooses — around a hazard, away from a vehicle, or
// with no open neighbour at all — wants the decision and not the journey. That
// makes the gate load-bearing — `poseBear` offers it for exactly this — and a gate
// the suite leans on has to be known to work before anything leaning on it means
// anything.
//
// SO ONE BEAR IS HELD FOR A SECOND AND BOTH HALVES OF THAT SENTENCE ARE READ. The
// center must be exactly the tile center it was settled on — a second of game time
// at `bearIceSpeed(1)` (`3` tiles per second) would otherwise have carried it
// three tiles — and the step its routing chose must still be reported. A check
// that read only the center would pass a build that had switched the whole
// creature off, which is the wrong model this gate is most likely to be given.
//
// THE STEP THE ROUTING MUST REPORT IS UNAMBIGUOUS. The bear is settled at
// `(10, 15)` and the critter at `(20, 15)`, on the same row of an empty ice band
// where specs/hunter.md closes no tile, so a shortest route is ten steps right and
// RIGHT is the only one of the four directions that shortens it. A build that
// reported its own tile — a bear that chose nothing — and a build that reported
// any other neighbour each read as a different, named tile.
//
// ONE BEAR IS THE WHOLE SCENARIO, because the gate is per-bear and the requirement
// is about the gated one. That a bear travels at all is
// `hunter/glides-continuously`, and how fast is `hunter/ice-speed`.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { requireBear } from "./roster";

/** The level posed: nothing here reads a speed, so the table's own is fine. */
const LEVEL = 1;

/** The row both bodies stand on: solid ice, well clear of every edge. */
const ROW = 15;

/** The tile the bear is settled on, and the critter it hunts, ten columns right. */
const BEAR_COL = 10;
const CRITTER_COL = 20;

/** The one step a shortest route to that critter can start with. */
const STEP_COL = BEAR_COL + 1;

/** The game time the held bear is run for, in seconds: the item's figure. */
const SECTION_SECONDS = 1;

/**
 * How far the held bear's center may sit from the tile center it was settled on,
 * as `assertCloseTo` digits.
 *
 * Six digits is half a millionth of a stage unit. A center that HOLDS is a center
 * nothing was added to, so the only distance from the tile center is the
 * arithmetic of the pose itself; a build whose travel ran anyway is out by whole
 * tiles.
 */
const CENTRE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a gated bear's center still while its routing keeps choosing a step", async () => {
  startCrossing(h, LEVEL);
  h.debug.setCritterTile(CRITTER_COL, ROW);

  // Only locomotion is gated: the bear keeps the sense that reads the critter and
  // the routing that chooses the step, which is what the second half reads.
  const bear = poseBear(h, BEAR_COL, ROW, { travel: false });

  const posed = h.snapshot();
  const settled = requireBear(posed, bear, "the gated bear");
  assertEqual(
    settled.travel,
    false,
    `snapshot() bear ${bear}.travel after setBearTravel(${bear}, false), which ` +
      `the snapshot reports (specs/instrumentation.md)`,
  );
  assertEqual(
    settled.sense,
    true,
    `snapshot() bear ${bear}.sense, which the gate leaves untouched ` +
      `(specs/instrumentation.md)`,
  );
  assertEqual(
    settled.routing,
    true,
    `snapshot() bear ${bear}.routing, which the gate leaves untouched ` +
      `(specs/instrumentation.md)`,
  );

  const read = await captureReplay(h, "gate", async () => {
    await h.advance(ticksFor(SECTION_SECONDS));
    return h.snapshot();
  });

  const held = requireBear(read, bear, "the gated bear after the section");
  assertCloseTo(
    held.x,
    tileCX(BEAR_COL),
    CENTRE_DIGITS,
    `the center x bear ${bear} reports after ${SECTION_SECONDS} s of game time ` +
      `with its travel off, against the center of the tile it was settled on — ` +
      `its center "holds however long a scenario runs" ` +
      `(specs/instrumentation.md)`,
  );
  assertCloseTo(
    held.y,
    tileCY(ROW),
    CENTRE_DIGITS,
    `the center y bear ${bear} reports after the same second`,
  );
  assertEqual(
    `${held.col},${held.row}`,
    `${BEAR_COL},${ROW}`,
    `the tile bear ${bear} is settled on after the same second — the two tiles ` +
      `it occupies hold with its center (specs/instrumentation.md)`,
  );

  assertEqual(
    `${held.stepCol},${held.stepRow}`,
    `${STEP_COL},${ROW}`,
    `the tile bear ${bear} reports travelling into after the same second, which ` +
      `is the one step a shortest route from (${BEAR_COL}, ${ROW}) to the ` +
      `critter at (${CRITTER_COL}, ${ROW}) can start with — its routing runs ` +
      `untouched, "so it still reports ... the step its routing chose" ` +
      `(specs/instrumentation.md)`,
  );
  assertEqual(
    `${held.target.col},${held.target.row}`,
    `${CRITTER_COL},${ROW}`,
    `the tile bear ${bear} hunts after the same second — its sense runs ` +
      `untouched (specs/instrumentation.md)`,
  );
});
