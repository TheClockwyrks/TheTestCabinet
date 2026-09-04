// swarm/dive-leaves-slot — a launched dive takes the drone out of the formation.
//
// specs/swarm.md, "The dive": "A launch takes one drone resting in the formation,
// chosen at random from those standing, and puts it in phase `diving`", and a
// diving drone "follows a smooth swooping path down through the field". So a launch
// has two consequences a build cannot fake one of: the phase says `diving` AND the
// drone is no longer standing in its slot. A build that flips the phase and leaves
// the drone sitting in the formation has not launched a dive, and one that slides a
// drone out of the block without changing its phase has not either.
//
// ONE DRONE STANDS IN THE FORMATION, so the launcher's random choice among "those
// standing" has exactly one answer and the drone this validator reads is the drone
// the wave launched. Its travel is on, because being carried away is half of what
// is being read; its firing is off, so no bullet it takes on the way down reaches
// anything, and its oscillation is off, so a Shard's band cannot wander.
//
// The dive clock is posed at `0` and the dive gate opened, as
// `swarm/dive-first-delay` poses them: without that there is no moment a launch is
// due from. WHEN the launch happens is that point's; this one reads only what the
// launch DID.
//
// HOW FAR "AWAY FROM ITS SLOT" IS. A drone resting in the formation sits within
// `SWAY_AMP` (20) of its slot, wherever the block's sway has carried it, so any
// distance past that is a drone that has left. Half a second of dive covers
// `DIVE_SPEED` (300) times that — 150 units of path — so a build flying the
// specified dive clears the bound many times over even if its path curves back on
// itself.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRST_DELAY, SWAY_AMP, slotX, slotY } from "../constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  droneOf,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the formation is posed at: the first, which `startPosed` opens. */
const STAGE = 1;

/** The slot the one standing drone rests in: off the grid's centre column. */
const SLOT = { col: 3, row: 1 } as const;

/** How long the sweep waits for the launch: twice DIVE_FIRST_DELAY. */
const SWEEP_FRAMES = ticksFor(2 * DIVE_FIRST_DELAY);

/** The seconds of dive the drone is read after, once it has been launched. */
const FLOWN = 0.5;

/**
 * How far from its slot the drone must have got, in logical units.
 *
 * A drone still resting in the formation sits at its slot plus an offset of at most
 * `SWAY_AMP` (20), so anything past that has left the block. It is the sway's own
 * reach rather than a tolerance on the dive.
 */
const AWAY = SWAY_AMP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the launched drone in phase diving and carries it off its slot", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", slotX(SLOT.col), slotY(SLOT.row), {
    phase: "formation",
    travel: true,
  });
  h.debug.setDiveClock(0);
  h.debug.setDiveLaunching(true);

  const launched = await h.until(
    (snapshot) => snapshot.drones.some((drone) => drone.phase === "diving"),
    { maxFrames: SWEEP_FRAMES, poll: 1 },
  );
  assertTrue(
    launched.hit,
    `a dive launched out of the formation within ` +
      `${String(seconds(SWEEP_FRAMES))}s of the dive clock being posed at 0 ` +
      `and dive launching turned on, at stage ${String(STAGE)} ` +
      `(specs/swarm.md)`,
  );

  await h.advance(ticksFor(FLOWN));
  const diving = droneOf(h.snapshot(), id);
  captureStill(h, "diving");

  assertEqual(
    diving.phase,
    "diving",
    `the phase of the drone the wave launched, ${String(FLOWN)}s after the ` +
      `launch (specs/swarm.md)`,
  );
  assertGreaterThan(
    distance(diving, { x: diving.slotX, y: diving.slotY }),
    AWAY,
    `how far the launched drone had got from its slot ` +
      `(${String(diving.slotX)}, ${String(diving.slotY)}) ` +
      `${String(FLOWN)}s into its dive, against the SWAY_AMP ` +
      `(${String(SWAY_AMP)}) a drone still resting in the block can sit from ` +
      `it (specs/swarm.md, specs/field.md)`,
  );
});
