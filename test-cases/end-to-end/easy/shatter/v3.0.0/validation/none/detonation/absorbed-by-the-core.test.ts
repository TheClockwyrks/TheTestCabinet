// detonation/absorbed-by-the-core — the star's core takes a torpedo, and pays nothing.
//
// specs/collision.md pairs a torpedo with the core: "The torpedo is absorbed and
// removed. Nothing scores." specs/field.md makes the core the one physical
// boundary on the field, a circle of `CORE_R` (30) at the star's centre, and
// specs/weapons.md is explicit that the well never PULLS a torpedo — so a torpedo
// aimed down the star's own column reaches the core on its own straight line and
// on nothing the environment did.
//
// THE READING SAYS WHERE THE FLIGHT ENDED, not merely that it did. A torpedo also
// leaves the roster when its `TORPEDO_LIFE` (3.5 s) runs out, so "the torpedo is
// gone" alone would be satisfied by a build that ignored the core entirely and let
// the shot fly on until it expired. What is asserted instead is the last position
// it held while still in flight: within a tick's travel of the core's surface. The
// sweep runs for a second at most, well inside the lifetime, so a build that flew
// through would end it still in flight and fail on that.
//
// ITS GUIDANCE IS OFF and the field is empty, so nothing steers it and nothing
// else can end the flight. Only the core is left, which is the pair this decides.
//
// SCORING NOTHING IS THE SECOND HALF OF THE SAME PAIR: specs/scoring.md says "a
// shot that is absorbed by the core pays nothing", and `startPlaying` opens the run
// at `0`, so an exact reading of `0` is the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import { CORE_R, STAR_X, STAR_Y, TORPEDO_R } from "../constants";
import { starDistance } from "../geometry";
import {
  captureStill,
  centreOf,
  createHarness,
  poseTorpedo,
  requireTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { TORPEDO_TICK_TRAVEL, driveTorpedo } from "./scenario";

/**
 * How far up the star's column the torpedo starts, in logical units.
 *
 * Clear of the halo `specs/field.md` draws out to `HALO_R` (120) so nothing about
 * the arrangement rests on the star's decoration, and far enough that the flight is
 * unmistakably a flight: `200` units less the core's surface is about a sixth of a
 * second at `TORPEDO_SPEED`, against a lifetime of three and a half.
 */
const START_ABOVE = 200;

/** Straight down the field, in radians: `specs/overview.md` has `+y` point down. */
const HEADING_DOWN = Math.PI / 2;

/**
 * How near the star's centre the torpedo's last in-flight position must be.
 *
 * The core's surface as specs/collision.md fixes it — two circles touch when their
 * centres are within the sum of their radii, so a torpedo touches the core at
 * `CORE_R + TORPEDO_R` (36) — plus one tick of its own travel, since collision is
 * swept and the tick that resolves the absorption may have carried it that far
 * further in before the sample was taken.
 */
const CORE_REACH = CORE_R + TORPEDO_R + TORPEDO_TICK_TRAVEL;

/** Ticks run after the reading, so the still shows the star with nothing left of it. */
const AFTERMATH_TICKS = ticksFor(0.2);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("removes a torpedo driven into the core, and scores nothing for it", async () => {
  await startPlaying(harness);
  const torpedoId = await poseTorpedo(
    harness,
    STAR_X,
    STAR_Y - START_ABOVE,
    HEADING_DOWN,
    { homing: false },
  );

  const run = await driveTorpedo(harness, torpedoId);

  await harness.advance(AFTERMATH_TICKS);
  await captureStill(harness, "absorbed");

  assertTrue(
    run.hit,
    "the torpedo removed within a second of being driven at the core (specs/collision.md)",
  );
  const last = requireTorpedo(run.before, torpedoId, "absorbed-by-the-core");
  assertLessThanOrEqual(
    starDistance(centreOf(last)),
    CORE_REACH,
    "the torpedo's last position in flight, at the core's surface (specs/collision.md)",
  );
  assertEqual(
    run.at.score,
    0,
    "a torpedo absorbed by the core paying nothing (specs/scoring.md)",
  );
});
