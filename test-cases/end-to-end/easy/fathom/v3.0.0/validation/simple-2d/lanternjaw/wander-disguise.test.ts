// lanternjaw/wander-disguise — it wanders at the drifter's pace and hunts faster.
//
// specs/predators/lanternjaw.md gives it two speeds: `DRIFTER_SPEED` (64), "the
// bonus drifter's pace", while wandering, and `PREDATOR_SPEED` (116) while
// chasing, "which is below the forager's own speed". specs/predators.md has the
// snapshot report the current one as `speed`, "in logical units per second".
//
// BOTH ARE READ TWICE: what the build SAYS its speed is, and how much ground it
// actually covers. A build can report the right figure and travel at another, and
// a disguise that reads 64 while crossing the maze at 116 is exactly the fault
// this point exists to catch. The ground is summed tick by tick rather than taken
// as a displacement, so a reversal mid-run is counted as the travel it is.
//
// THE FIX IS EARNED, NOT POKED IN. Posing `chase` on a hunter that has no reason
// to hold one asks a build to keep a fix its own senses would drop, and builds
// answer differently: one re-reads its senses on the next tick, sees nothing, and
// is wandering again before the check has looked. So the Lanternjaw is given the
// reason the page gives it. Standing seven tiles off, the forager at `G = 0` is
// 224 units away against a reach of 128 and is not there as far as the hunter is
// concerned; turning the light up to `G = 1` stretches that reach to 320 and the
// same forager, on the same tile, is suddenly inside it. The build's own sensing
// makes the fix.
//
// WHAT THIS DOES NOT DECIDE. Whether the fix is taken at the boundary at all is
// `lanternjaw/light-range`'s, so a build that never acquires stands this check
// down rather than failing it twice.

import { afterEach, beforeEach, it } from "vitest";
import {
  BRIGHT_HOLD,
  DRIFTER_SPEED,
  FORAGER_SPEED,
  PREDATOR_SPEED,
} from "../../src/constants";
import { assertEqual, assertLessThan, assertLessThanOrEqual } from "../assert";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  seconds,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/**
 * How far apart the pair stands, in tiles.
 *
 * Seven is 224 units: outside the 128 the Lanternjaw reaches while the forager is
 * dark, and inside the 320 it reaches once the forager is fully lit, both with a
 * couple of tiles of margin, so neither half of the item turns on a distance a
 * build has to match to the unit.
 */
const GAP_TILES = 7;

/** Spare corridor beyond each of them, so neither runs into rock mid-measurement. */
const LEAD_TILES = 1;
const TAIL_CORRIDOR = 6;

/**
 * How long each speed is measured over, in ticks.
 *
 * A second of wander (64 units of travel) and half a second of chase (58), both
 * long enough that the 2 percent bound is more than a tick's worth of rounding and
 * short enough that neither run reaches the end of the corridor it is on.
 */
const WANDER_TICKS = ticks(1);
const CHASE_TICKS = ticks(0.5);

/**
 * A beat between the fix and the chase measurement, in ticks.
 *
 * An eighth of a second. A build may raise the state on one step and take up the
 * chase speed on the next, and both honour the page, so the hunting speed is read
 * a beat after the flag rather than on the tick it flipped.
 */
const SETTLE_TICKS = ticks(0.125);

/**
 * How long the fix is given to be taken once the light comes up, in ticks.
 *
 * A tenth of a second, a hard bound. Whether it is taken at all is
 * `lanternjaw/light-range`'s verdict, so a miss stands this check down.
 */
const FIX_TICKS = ticks(0.1);

/** The item's bound on both speeds and on both distances: 2 percent. */
const TOLERANCE = 0.02;

/** Ticks run after every reading, purely so the clip shows the charge. */
const CLIP_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Run `count` ticks and report the ground one predator covered, summed step by
 * step, together with the state it ended in.
 */
async function travel(
  h: Harness,
  index: number,
  count: number,
): Promise<{ covered: number; speed: number; state: string }> {
  let covered = 0;
  let last = h.snapshot().predators[index];
  for (let tick = 0; tick < count; tick += 1) {
    await h.advance(1);
    const now = h.snapshot().predators[index];
    covered += Math.hypot(now.x - last.x, now.y - last.y);
    last = now;
  }
  return { covered, speed: last.speed, state: last.state };
}

it("It wanders at the drifter's pace and hunts faster", async () => {
  await startPlaying(h);
  const line = await poseSightLine(h, GAP_TILES, {
    lead: LEAD_TILES,
    tail: TAIL_CORRIDOR,
  });
  // Facing away down the corridor: its drift is the thing being timed, and a
  // drift that closed the gap would shorten the standoff the second half rests
  // on.
  const index = await spawnPredator(h, "lanternjaw", line.pred, {
    dir: line.dir,
    state: "wander",
  });
  // Parked, on a board carrying no plankton, with `G` left at the zero a dive
  // opens on — which is what puts the forager outside the hunter's reach for the
  // first half.
  await parkForager(h, line.forager);
  const watch = await sceneGuard(h);

  const read = await captureReplay(h, "disguise", async () => {
    const wandered = await travel(h, index, WANDER_TICKS);

    // The light comes up, and the Lanternjaw's own sensing does the rest. The
    // tile is posed again first so the standoff is the one the fixture states
    // whatever the drift did with it.
    await h.debug.setPredatorTile(index, line.pred.tx, line.pred.ty);
    await h.debug.setPredatorState(index, "wander");
    await poseBrightness(h, 1, BRIGHT_HOLD);
    const fixed = await h.until((s) => s.predators[index].state === "chase", {
      maxFrames: FIX_TICKS,
      poll: 1,
    });
    assertEqual(
      fixed.hit,
      true,
      "the Lanternjaw took a fix on a fully lit forager seven tiles away on a " +
        "clear line, which is the chase whose pace this point's second half " +
        "measures",
    );
    await h.advance(SETTLE_TICKS);
    const chased = await travel(h, index, CHASE_TICKS);
    await h.advance(CLIP_TICKS);
    return { wandered, chased, end: h.snapshot() };
  });

  requireSceneHeld(read.end, watch);

  const wanderSeconds = seconds(WANDER_TICKS);
  const chaseSeconds = seconds(CHASE_TICKS);

  assertEqual(
    read.wandered.state,
    "wander",
    "the Lanternjaw held no fix while its disguised pace was measured",
  );
  assertLessThanOrEqual(
    Math.abs(read.wandered.speed - DRIFTER_SPEED),
    DRIFTER_SPEED * TOLERANCE,
    `the speed an unfixed Lanternjaw reports against DRIFTER_SPEED ` +
      `(${DRIFTER_SPEED}), the bonus drifter's pace — it read ` +
      `${read.wandered.speed.toFixed(2)}`,
  );
  assertLessThanOrEqual(
    Math.abs(read.wandered.covered - DRIFTER_SPEED * wanderSeconds),
    DRIFTER_SPEED * wanderSeconds * TOLERANCE,
    `the units it actually covered in ${wanderSeconds.toFixed(2)} s of wander ` +
      `against the ${(DRIFTER_SPEED * wanderSeconds).toFixed(1)} DRIFTER_SPEED ` +
      `calls for — it covered ${read.wandered.covered.toFixed(1)}`,
  );

  assertEqual(
    read.chased.state,
    "chase",
    "the Lanternjaw held its fix throughout the hunting measurement",
  );
  assertLessThanOrEqual(
    Math.abs(read.chased.speed - PREDATOR_SPEED),
    PREDATOR_SPEED * TOLERANCE,
    `the speed a fixed Lanternjaw reports against PREDATOR_SPEED ` +
      `(${PREDATOR_SPEED}) — it read ${read.chased.speed.toFixed(2)}`,
  );
  assertLessThanOrEqual(
    Math.abs(read.chased.covered - PREDATOR_SPEED * chaseSeconds),
    PREDATOR_SPEED * chaseSeconds * TOLERANCE,
    `the units it actually covered in ${chaseSeconds.toFixed(2)} s of chase ` +
      `against the ${(PREDATOR_SPEED * chaseSeconds).toFixed(1)} PREDATOR_SPEED ` +
      `calls for — it covered ${read.chased.covered.toFixed(1)}`,
  );
  assertLessThan(
    read.chased.speed,
    FORAGER_SPEED,
    `the hunting speed against FORAGER_SPEED (${FORAGER_SPEED}), which it is ` +
      "below, so a forager under way is never simply run down",
  );
});
