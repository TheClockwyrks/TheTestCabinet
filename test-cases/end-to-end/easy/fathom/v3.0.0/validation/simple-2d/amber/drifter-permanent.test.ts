// amber/drifter-permanent — a drifter stays, at its own pace, until it is eaten.
//
// specs/gameplay.md: "A drifter stays in the maze until it is eaten, holding its
// glow and its pace for as long as that takes", travelling "at `DRIFTER_SPEED`
// (`64` logical units per second, half the forager's speed)". So a drifter neither
// fades on a timer nor slows: it is still there long after the
// `DRIFTER_INTERVAL` (`25 s`) cadence that admitted it would have come round
// again, and it leaves the list only when the forager reaches it.
//
// THE PACE IS MEASURED AS PATH, NOT AS DISPLACEMENT. A drifter "changes direction
// at tile centers", so a straight line between two samples taken a second apart
// cuts every corner it turned. Each window here sums the ground covered tick by
// tick over `PACE_TICKS`, which at `DRIFTER_SPEED` is one `TILE` of travel and so
// spans at most one turn; the corner a single right-angle turn cuts is under half
// a percent of that path, well inside the two percent this point allows.
//
// THE BOARD HOLDS ONE DRIFTER AND NOTHING ELSE. `poseApart` clears the roster,
// the drifters and the plankton, so no hunter can reach either room and no
// cadence can admit a second drifter: specs/gameplay.md admits one at the den gate
// only "while plankton remain in the maze". The drifter followed here is therefore
// the one this check spawned, and an empty board cannot be cleared either, so the
// long stretch below cannot end in a descent.
//
// THE DRIFTER PATROLS A SEALED RING. `poseApart` puts the forager in its own room
// and the ring across solid rock, so over half a minute of wandering the drifter
// cannot arrive at the forager and be eaten before the stretch is up — which on a
// real maze, one connected region, is only ever a head start.
//
// THE LONG STRETCH IS RUN OFF CAMERA. The clip a reviewer watches is the last few
// seconds of it — a drifter still drifting, half a minute after it appeared, and
// then taken — rather than half a minute of the same.

import { afterEach, beforeEach, it } from "vitest";
import { DRIFTER_INTERVAL, DRIFTER_SPEED, TICK_HZ } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { poseApart, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { FathomSnapshot } from "../surface";

/** One bonus drifter, as the snapshot reports it. */
type Drifter = FathomSnapshot["drifters"][number];

/** The ring the drifter patrols, in tiles along its top edge. */
const RING = 4;

/** How far that sealed ring stands from the forager's room, in tiles. */
const APART = 12;

/**
 * Ticks each pace window covers.
 *
 * Half a second, which at `DRIFTER_SPEED` (64) is exactly one `TILE` (32) of
 * travel and so spans at most one turn — a drifter "changes direction at tile
 * centers" (specs/gameplay.md).
 */
const PACE_TICKS = ticks(0.5);

/** Ticks of wandering between the pace windows, run off camera. */
const GAP_TICKS = ticks(12);

/** Ticks of wandering after the third window, taking the stretch past the cadence. */
const TAIL_GAP_TICKS = ticks(6);

/** Ticks of the drifter simply drifting that the clip shows, after the last window. */
const WATCH_TICKS = ticks(2);

/** Ticks allowed for the bite once the forager stands on the drifter's tile. */
const EAT_TICKS = ticks(0.25);

/**
 * How far a measured pace may sit from `DRIFTER_SPEED`, in logical units per
 * second.
 *
 * The review item's own bound: two percent of the `64` specs/gameplay.md fixes.
 */
const PACE_TOLERANCE = DRIFTER_SPEED * 0.02;

/** The drifter nearest a point, which is the one a previous sample followed. */
function drifterNear(
  snapshot: FathomSnapshot,
  to: { x: number; y: number } | null,
): Drifter | null {
  if (snapshot.drifters.length === 0) return null;
  if (to === null) return snapshot.drifters[0];
  return snapshot.drifters.reduce((best, one) =>
    Math.hypot(one.x - to.x, one.y - to.y) <
    Math.hypot(best.x - to.x, best.y - to.y)
      ? one
      : best,
  );
}

/** One pace window: the ground covered per second, and whether the drifter held. */
interface Pace {
  speed: number;
  at: Drifter | null;
  held: boolean;
}

/** Follow the drifter tick by tick and report the pace it kept over the window. */
async function pace(
  h: Harness,
  from: { x: number; y: number } | null,
): Promise<Pace> {
  let previous = drifterNear(h.snapshot(), from);
  let path = 0;
  let held = previous !== null;
  for (let tick = 0; tick < PACE_TICKS; tick += 1) {
    await h.advance(1);
    const now = drifterNear(h.snapshot(), previous);
    if (now === null || previous === null) {
      held = false;
      previous = now;
      continue;
    }
    path += Math.hypot(now.x - previous.x, now.y - previous.y);
    previous = now;
  }
  return { speed: (path * TICK_HZ) / PACE_TICKS, at: previous, held };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A drifter stays until it is eaten", async () => {
  await startPlaying(h);
  const rooms = await poseApart(h, APART, { ring: RING });
  await parkForager(h, rooms.near);
  // The board `poseApart` posed carries no plankton, so the cadence admits no
  // drifter at the gate and the one followed below is the one spawned here.
  await spawnDrifter(h, rooms.far);
  const watch = await sceneGuard(h);
  const opened = h.snapshot();

  // The long stretch, off camera.
  const first = await pace(h, null);
  await h.advance(GAP_TICKS);
  const second = await pace(h, first.at);
  await h.advance(GAP_TICKS);
  const third = await pace(h, second.at);
  await h.advance(TAIL_GAP_TICKS);

  const watched = await captureReplay(h, "permanent", async () => {
    const last = await pace(h, third.at);
    await h.advance(WATCH_TICKS);
    const still = h.snapshot();
    return { last, still };
  });

  requireSceneHeld(watched.still, watch);
  assertEqual(
    opened.drifters.length,
    1,
    "the bonus drifters on the board once one was spawned onto the sealed ring",
  );
  assertGreaterThan(
    watched.still.simTime - opened.simTime,
    DRIFTER_INTERVAL,
    "the seconds of simulation the drifter was watched over, against the " +
      "DRIFTER_INTERVAL cadence it has to outlast",
  );
  assertGreaterThanOrEqual(
    watched.still.drifters.length,
    1,
    "the bonus drifters still in the maze at the end of that stretch",
  );

  const windows = [first, second, third, watched.last];
  for (const [index, window] of windows.entries()) {
    assertEqual(
      window.held,
      true,
      `the drifter was in the list at every tick of pace window ${index + 1}`,
    );
    assertLessThanOrEqual(
      Math.abs(window.speed - DRIFTER_SPEED),
      PACE_TOLERANCE,
      `how far the drifter's pace over window ${index + 1} sits from ` +
        `DRIFTER_SPEED (${DRIFTER_SPEED}), measured as ground covered along ` +
        `its own path over ${PACE_TICKS} ticks`,
    );
  }

  // And it leaves the list only when the forager reaches it. The drifter is
  // held where it stands and the forager put on its tile, which is the contact
  // specs/gameplay.md defines; what the bite PAYS is amber/drifter-score's.
  const taken = watched.still.drifters[0];
  h.debug.setDrifterMind(0, false);
  h.debug.setForagerTile(taken.tx, taken.ty);
  await h.advance(EAT_TICKS);
  assertEqual(
    h.snapshot().drifters.length,
    watched.still.drifters.length - 1,
    `the bonus drifters left once the forager stood on the drifter's tile ` +
      `(${taken.tx}, ${taken.ty})`,
  );
});
