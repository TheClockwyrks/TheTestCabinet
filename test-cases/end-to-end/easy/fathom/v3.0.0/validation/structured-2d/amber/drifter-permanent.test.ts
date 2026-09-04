// amber/drifter-permanent — a drifter stays in the maze until it is eaten.
//
// specs/gameplay.md: "A drifter stays in the maze until it is eaten, holding its
// glow and its pace for as long as that takes." So a drifter neither fades on a
// timer nor is swept up by the cadence that admitted it: it is still there long
// after `DRIFTER_INTERVAL` (`25 s`) would have come round again, and it leaves
// the list only when the forager reaches it.
//
// WHAT THIS POINT READS, AND WHAT IT NO LONGER DOES. The PACE a drifter holds is
// `amber.drifter-speed`, measured over a straight run of its own; this point is
// the permanence alone — still on the board after a stretch past the cadence, and
// gone on the bite.
//
// THE WORLD HOLDS THE FORAGER AND ONE DRIFTER. `poseApart` empties the board, so
// the roster is gone, no plankton stand on it, and — because specs/gameplay.md
// admits drifters at the gate only "while plankton remain in the maze" — the
// cadence lets none in. The drifter followed below is therefore the one this check
// spawned and the only one there is.
//
// THE DRIFTER PATROLS A RING OF ITS OWN. `poseApart` puts the forager in one room
// and the ring across solid rock, so over half a minute of wandering the drifter
// cannot arrive at the forager and be eaten before the stretch is up.
//
// THE LONG STRETCH IS RUN OFF CAMERA, through `skip`: the same real ticks, and no
// frames spent. The clip a reviewer watches is the last few seconds of it — a
// drifter still drifting, half a minute after it appeared, and then taken.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { DRIFTER_INTERVAL } from "../constants";
import { poseApart, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { ticksFor } from "../harness";

/** The ring the drifter patrols, in tiles along its top edge. */
const RING = 4;

/** How far that sealed ring stands from the forager's room, in tiles. */
const APART = 12;

/** Ticks of wandering between the presence checks, run off camera. */
const GAP_TICKS = ticksFor(12);

/** How many of those checks the stretch is broken into. */
const CHECKPOINTS = 3;

/** Ticks of the drifter simply drifting that the clip shows, at the end. */
const WATCH_TICKS = ticksFor(2);

/** Ticks allowed for the bite once the forager stands on the drifter's tile. */
const EAT_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a drifter in the maze until the forager eats it", async () => {
  startPlaying(h);
  const rooms = await poseApart(h, APART, { ring: RING });
  await parkForager(h, rooms.near);
  const drifter = await spawnDrifter(h, rooms.far);
  const guard = await sceneGuard(h);
  const opened = h.snapshot();

  assertEqual(
    opened.drifters.length,
    1,
    "the bonus drifters on the board once one was spawned onto the sealed ring",
  );

  // The long stretch, off camera, with the list read at each checkpoint so a
  // drifter that vanished halfway names the moment rather than the end.
  for (let checkpoint = 1; checkpoint <= CHECKPOINTS; checkpoint += 1) {
    await h.skip(GAP_TICKS);
    const seen = h.snapshot();
    assertGreaterThanOrEqual(
      seen.drifters.length,
      1,
      `the bonus drifters in the maze ${(seen.simTime - opened.simTime).toFixed(1)} s ` +
        "after one was spawned, which stays until it is eaten (specs/gameplay.md)",
    );
  }

  const watched = await captureReplay(h, "permanent", async () => {
    await h.advance(WATCH_TICKS);
    return h.snapshot();
  });

  requireSceneHeld(watched, guard);
  assertGreaterThan(
    watched.simTime - opened.simTime,
    DRIFTER_INTERVAL,
    "the seconds of simulation the drifter was watched over, against the " +
      "DRIFTER_INTERVAL cadence it has to outlast",
  );
  assertGreaterThanOrEqual(
    watched.drifters.length,
    1,
    "the bonus drifters still in the maze at the end of that stretch",
  );

  // And it leaves the list only when the forager reaches it. The drifter is held
  // where it stands and the forager put on its tile, which is the contact
  // specs/gameplay.md defines; what the bite PAYS is amber.drifter-score's.
  const taken = watched.drifters[0];
  h.debug.setDrifterMind(drifter, false);
  h.debug.setForagerTile(taken.tx, taken.ty);
  await h.advance(EAT_TICKS);
  assertEqual(
    h.snapshot().drifters.length,
    watched.drifters.length - 1,
    "the bonus drifters left once the forager stood on the drifter's tile " +
      `(${String(taken.tx)}, ${String(taken.ty)})`,
  );
});
