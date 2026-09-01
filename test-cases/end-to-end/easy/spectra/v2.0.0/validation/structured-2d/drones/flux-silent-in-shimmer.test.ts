// drones/flux-silent-in-shimmer — a shimmering Flux fires nothing.
//
// specs/drones.md, What that means in play: "It fires nothing while it shimmers: a
// Flux that is shimmering when it crosses the fire line takes its shot as soon as
// it settles on a band, if it is still diving." The rule pairs with the immunity:
// the window in which the drone cannot be destroyed is also the window in which it
// cannot hurt the ship, so the telegraph is a fair trade rather than a free pass.
//
// WHAT IS DRIVEN. One Flux alone, sixty units above `DIVE_FIRE_Y` (`360`), in phase
// `diving` with travel and fire ON — an unimpeded dive that really crosses the fire
// line specs/swarm.md buys a shot at — and its band clock posed half a telegraph
// into the shimmer with its OSCILLATION GATE OFF, which specs/instrumentation.md
// defines as holding "whichever band or shimmer it is in indefinitely". So the
// whole dive is flown mid-shimmer, and the rule under test applies to every frame
// of it rather than to the fraction of a second a live telegraph would have left.
//
// THE READING. `watchDive` samples every frame of the dive and counts every enemy
// bullet by id, so a shot taken at the crossing is counted however far it has
// fallen by the time the dive ends. The count must be zero. The depth the dive
// reached is read too, and required to have passed the fire line: without it a
// build whose dive never descends would be credited with a silence it never had the
// chance to break.
//
// The other side of the rule — that a Flux which is NOT shimmering fires, and fires
// the band it holds — is `drones/flux-fires-held-band`.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_FIRE_Y,
  FLUX_SHIMMER,
  FORM_CENTER_X,
  fluxHold,
} from "../../src/constants";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { watchDive } from "./dive";

/** The stage the scenario is posed at: where the shimmer starts is per stage. */
const STAGE = 1;

/**
 * The band clock the diving Flux is posed at: half a telegraph into the shimmer.
 *
 * Inside the shimmer under any reading of either boundary, and — with the
 * oscillation gate off — where it stays for the whole dive.
 */
const MID_SHIMMER = fluxHold(STAGE) + FLUX_SHIMMER / 2;

/**
 * How far above `DIVE_FIRE_Y` the diving Flux starts, in logical units.
 *
 * Sixty units is a fifth of a second at `DIVE_SPEED` (`300`), so the crossing that
 * would buy a shot happens early in the dive whatever path the build lays out.
 */
const ABOVE_FIRE_LINE = 60;

/** Where the diving Flux starts: on the ship's lane, above the fire line. */
const AT = { x: FORM_CENTER_X, y: DIVE_FIRE_Y - ABOVE_FIRE_LINE } as const;

/** The enemy bullets a Flux that fires nothing leaves on the field. */
const SHOTS = 0;

/**
 * Frames the dive is watched for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." The sweep stops
 * itself the moment the drone leaves phase `diving`, and only a diving drone fires,
 * so this cap only bounds a build whose dives never end.
 */
const DIVE_FRAMES = ticksFor(8);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts no enemy bullet on the field while a diving Flux shimmers", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one diver the
  // requirement is about.
  startPosed(h);
  const flux = poseDrone(h, "flux", AT.x, AT.y, {
    bandClock: MID_SHIMMER,
    // Off, so the drone shimmers for every frame of the dive below and the rule
    // applies to the whole of it.
    oscillation: false,
    phase: "diving",
    travel: true,
    fire: true,
  });

  const dive = await watchDive(h, flux, { maxFrames: DIVE_FRAMES });
  captureStill(h, "silent");

  assertGreaterThanOrEqual(
    dive.deepest,
    DIVE_FIRE_Y,
    "the depth the shimmering Flux's dive reached, past the DIVE_FIRE_Y a shot " +
      "is bought at (specs/swarm.md)",
  );
  assertLength(
    dive.shots,
    SHOTS,
    "the enemy bullets a Flux diving through its shimmer fires (specs/drones.md)",
  );
});
