// fog/light-reveals-walls — the light reveals the rock it lands on and stops
// there.
//
// specs/sensing.md states it as one sentence with two halves: "The light reveals
// the rock it lands on and stops there. A rock tile the light reaches is lit and
// drawn as rock, and the tiles behind it are left as they were." A build can hold
// either half alone — one that never lights rock at all satisfies "stops there",
// and one that lights a whole ray satisfies "reveals the rock it lands on" — so
// both are read out of the same frame.
//
// THE SECOND HALF IS ONLY WORTH READING IF THE FAR TILE IS IN RANGE. A tile the
// light could not have reached anyway says nothing about the rock in front of it.
// So the corridor is posed short: with `PROBE_RUN` (`2`) tiles of open water ahead
// of the forager the rock closing it stands `96` logical units away and the
// corridor tile on its far side stands `128`, both inside the `160` the light
// reaches at `G = 1` (`V = VISION_MIN + VISION_GAIN * G`). The only thing between
// the forager and that far tile is the rock, and the check asserts that geometry
// from the specification's own figures before it reads a visibility.
//
// AN AXIAL RAY, not a grazing one. specs/sensing.md traces the light along "the
// segment joining those two centers", and the rock flanking a corridor sits at an
// angle where two conforming builds may honestly disagree about a segment that
// clips a corner. The rock squarely at the end of a corridor the forager is
// standing in does not: that line runs down the corridor's own center line
// through nothing but open tiles (`poseLitWallProbe`).
//
// THE BOARD IS OTHERWISE EMPTY. `poseLitWallProbe` clears the roster, the drifters
// and the plankton, so no hunter is anywhere on it, the forager's brightness is
// the one this check posed, and no flare or pulse reveals anything.

import { afterEach, beforeEach, it } from "vitest";
import { BRIGHT_HOLD, VISION_GAIN, VISION_MIN } from "../constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { poseLitWallProbe } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  poseBrightness,
  startPlaying,
  visibilityOf,
  type Harness,
} from "../harness";
import {
  fromForager,
  parkForager,
  requireSceneHeld,
  sceneGuard,
} from "../scene";

/**
 * Tiles of open water between the forager and the rock that closes the corridor.
 *
 * Two, so the rock stands `96` units away and the corridor tile behind it stands
 * `128` — both inside `V` at `G = 1`, which is what makes "and stops there" a
 * claim about the rock rather than about the range.
 */
const PROBE_RUN = 2;

/** The widest the light pocket ever opens, in logical units: `V` at `G = 1`. */
const VISION_MAX = VISION_MIN + VISION_GAIN;

/** Ticks run after the pose, so the frame that is read was drawn under it. */
const SETTLE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The light reveals the rock it lands on and stops there", async () => {
  await startPlaying(h);
  const probe = await poseLitWallProbe(h, { run: PROBE_RUN });
  await parkForager(h, probe.forager);
  // The widest light the game has: `V = VISION_MIN + VISION_GAIN * G`
  // (specs/sensing.md), so both the rock and the tile behind it are in range and
  // only the rock can be what stops the light.
  await poseBrightness(h, 1, BRIGHT_HOLD);
  const watch = await sceneGuard(h);

  await h.advance(SETTLE_TICKS);
  const snapshot = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture.
  captureStill(h, "walls");

  requireSceneHeld(snapshot, watch);

  // The fixture's own geometry, from the specification's figures rather than
  // from the build's readings.
  const reach = (tile: { tx: number; ty: number }): number => {
    const center = centerOf(snapshot, tile);
    return fromForager(snapshot, center.x, center.y);
  };
  assertLessThan(
    reach(probe.wall),
    VISION_MAX,
    "the logical units between the forager and the rock closing the corridor, " +
      `which must be inside V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );
  assertLessThan(
    reach(probe.behind),
    VISION_MAX,
    "the logical units between the forager and the corridor tile behind that " +
      "rock, which is inside the same V — so only the rock can stop the light",
  );
  assertGreaterThan(
    reach(probe.behind),
    reach(probe.wall),
    "the tile behind the rock stands further off than the rock itself",
  );

  assertEqual(
    visibilityOf(snapshot, probe.wall),
    "l",
    `the rock at (${probe.wall.tx}, ${probe.wall.ty}) closing the corridor ` +
      `${PROBE_RUN + 1} tiles ${probe.dir} of the forager, with open water ` +
      "between them",
  );
  assertEqual(
    visibilityOf(snapshot, probe.behind),
    "u",
    `the corridor tile at (${probe.behind.tx}, ${probe.behind.ty}) directly ` +
      "behind that rock on the same line, which the light stops short of",
  );
});
