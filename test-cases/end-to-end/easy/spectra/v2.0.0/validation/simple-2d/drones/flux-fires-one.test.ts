// drones/flux-fires-one — a Flux's whole dive puts exactly one bullet up.
//
// specs/drones.md, What that means in play: "A Flux takes exactly one shot over a
// dive, carrying the band it stores at the moment of the shot." specs/swarm.md
// fixes WHEN that shot is taken — "A diver takes its first shot in the frame its
// center first crosses `DIVE_FIRE_Y` (360) traveling downward" — and leaves HOW
// MANY follow to the kind, which is the figure this point reads. It is the Flux's
// counterpart to `drones/shard-fires-one` and `drones/prism-fires-two-bands`, and
// without it a build whose diving Flux sprays is caught nowhere: the two points
// that already drive a Flux's dive read the BAND of the bullet
// (`drones/flux-fires-held-band`, which says outright that the count is not its
// reading) and the SILENCE of a shimmering one (`drones/flux-silent-in-shimmer`,
// which asserts zero).
//
// WHY THE DIVE IS WATCHED RATHER THAN COUNTED AT ITS END. An enemy bullet falls at
// `ENEMY_BULLET_SPEED` (320) and leaves the field about a second after it is fired,
// so the roster at the end of a dive holds only what was fired late in it.
// `watchDive` samples every frame and counts each bullet ONCE, by id, so a build
// that fires twice a second apart is counted as two however far the first has
// fallen.
//
// THE DRONE IS HELD ON A BAND, NOT LEFT TO SHIMMER. The band clock is posed
// half-way through the held part of the window with the OSCILLATION GATE OFF,
// which specs/instrumentation.md defines as holding "whichever band or shimmer it
// is in indefinitely". So the deferral rule — a shimmering Flux fires nothing and
// takes its shot when it settles — cannot bear on the count: the drone is settled
// for every frame of the dive. The deferral itself is `drones/flux-defers-shot`'s.
//
// The Flux is posed alone, sixty units above the fire line, in phase `diving` with
// its travel and its fire on and nothing else: no formation to pull a second diver
// in (`setDiveLaunching` is off through `startPosed`), no other drone to contribute
// a bullet, and the ship's contact test off, so a bullet reaching the ship neither
// ends the run nor leaves the roster early.
//
// This grades the COUNT alone. Which band that bullet carries is
// `drones/flux-fires-held-band`'s, and where the dive goes is `swarm`'s.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRE_Y, FORM_CENTER_X, fluxHold } from "../../src/constants";
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

/** The stage the scenario is posed at: the held part's length is per stage. */
const STAGE = 1;

/** The shots specs/drones.md gives a Flux over a dive. */
const SHOTS = 1;

/**
 * The band clock the diving Flux is posed at: half-way through the held part.
 *
 * Inside the hold — the window in which a Flux fires at all — under any reading of
 * either end, and, with the oscillation gate off, where it stays for the dive.
 */
const MID_HOLD = fluxHold(STAGE) / 2;

/**
 * Where the diving Flux starts.
 *
 * Sixty units above `DIVE_FIRE_Y` (360) on the ship's lane, so the crossing that
 * buys the shot happens early in the dive whatever path the build lays out, and
 * well below `FIELD_TOP` (64) so nothing about the entrance is in play.
 */
const AT = { x: FORM_CENTER_X, y: DIVE_FIRE_Y - 60 } as const;

/**
 * Frames the dive is watched for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." Eight seconds of the
 * harness's 120 Hz clock is the whole span a dive may occupy, so a build is held to
 * the count over its WHOLE dive however long it flies; the sweep stops itself the
 * moment the drone leaves phase `diving`, which is sooner on any build that ends
 * its dives.
 */
const DIVE_FRAMES = ticksFor(8);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves exactly one enemy bullet over a held Flux's whole dive", async () => {
  startPosed(h);
  const flux = poseDrone(h, "flux", AT.x, AT.y, {
    bandClock: MID_HOLD,
    // Off, so the drone is settled on a band for every frame of the dive and the
    // deferral rule cannot bear on the count read below.
    oscillation: false,
    phase: "diving",
    travel: true,
    fire: true,
  });

  const dive = await watchDive(h, flux, { maxFrames: DIVE_FRAMES });
  captureStill(h, "one");

  assertGreaterThanOrEqual(
    dive.deepest,
    DIVE_FIRE_Y,
    `the depth the Flux's dive reached, past DIVE_FIRE_Y (${DIVE_FIRE_Y}) — a ` +
      `dive that never crosses the fire line is owed no shot at all, so the ` +
      `count below would be a count on nothing (specs/swarm.md)`,
  );
  assertLength(
    dive.shots,
    SHOTS,
    "the shots a Flux takes over one dive, held on a band throughout (specs/drones.md)",
  );
});
