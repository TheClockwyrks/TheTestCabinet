// brightness/from-eating — eating brightens the forager, and the brightness clamps.
//
// specs/sensing.md: "Brightness is a value `G` in `[0, 1]`, `0` when the forager
// has not eaten recently... Each plankton eaten adds `BRIGHT_PER_EAT` (`0.34`) to
// `G`, clamped at `1`."
//
// Two claims, and a build can hold either alone: the STEP each pellet is worth,
// and the CEILING it never passes. So the forager grazes a posed corridor one
// pellet at a time and `G` is read after each. The first eat, taken from `G = 0`,
// is the one the step is measured on, because a build whose clamp is wrong would
// otherwise hide a wrong step behind it. Four eats is one more than the three
// `BRIGHT_PER_EAT` needs to reach `1`, so the last of them is asked of a forager
// that is already at the ceiling.
//
// NOTHING IS POSED. `setBrightness` would settle `G` by fiat, which is the one
// thing this point cannot do: what it grades is what EATING does. The only pose in
// the scenario is the corridor itself and the zero the graze starts from, which is
// the state a dive opens on (specs/sensing.md: "`0` when the forager has not eaten
// recently").
//
// THE PELLETS ARE PLANTED ONE AT A TIME AND THE FORAGER IS CARRIED ONTO EACH. A
// posed board carries no plankton at all (`fixtures.ts`), so the graze starts from
// the `0` the item measures the first step from, and each eat is arranged by
// planting a pellet on the next tile and moving the forager's center into it —
// which is exactly the condition specs/gameplay.md eats on. Whether a held
// movement action carries the forager anywhere is the movement points' subject,
// and this point does not lean on it.
//
// AND ONE PELLET IS NEVER EATEN. `specs/gameplay.md` clears the maze on "the
// plankton that leaves none behind", so a spare stands at the far end of the run
// for the whole measurement and the round cannot end under it.

import { afterEach, beforeEach, it } from "vitest";
import { BRIGHT_PER_EAT } from "../../src/constants";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import type { FathomSnapshot } from "../surface";
import type { Tile } from "../maze";

/** Tiles of posed corridor: four pellets to graze, and the spare past them. */
const RUN_TILES = 8;

/** How many pellets are eaten. Three reach the ceiling; the fourth is asked at it. */
const EATS = 4;

/**
 * How long each pellet is given to be eaten, in ticks.
 *
 * specs/gameplay.md eats it "the moment its center enters that tile", so a
 * conforming build eats on the tick after the forager is stood on it. One second
 * is a wide margin on that and a hard ceiling, so a build that leaves the pellet
 * standing FAILS rather than being waited for.
 */
const REACH_MAX_TICKS = ticksFor(1);

/**
 * Ticks run between the pellet going and `G` being read.
 *
 * `G` is what the eat changed, and a build is free to apply the change at the end
 * of the step that detected it or at the top of the next; both keep the rule the
 * page states. Two ticks is past either, and `2.1` logical units of travel, which
 * cannot carry the forager into the next pellet a whole tile away.
 */
const READ_BEAT = 2;

/** The review item's tolerance on what one pellet is worth. */
const STEP_TOLERANCE = 0.01;

/** The review item's tolerance on the ceiling `G` clamps at. */
const CLAMP_TOLERANCE = 0.01;

/** How far above zero the graze may start and still measure the step from `0`. */
const ZERO_TOLERANCE = 0.001;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Plant one pellet on `tile`, stand the forager on it, and read the state after. */
async function grazeOne(
  harness: Harness,
  before: FathomSnapshot,
  tile: Tile,
): Promise<FathomSnapshot> {
  harness.debug.setPlankton(tile.tx, tile.ty, true);
  harness.debug.setForagerTile(tile.tx, tile.ty);
  const swept = await harness.until(
    (s) => s.planktonRemaining < before.planktonRemaining + 1,
    { maxFrames: REACH_MAX_TICKS, poll: 1 },
  );
  assertTrue(
    swept.hit,
    `the forager ate the plankton its center was stood on within ` +
      `${REACH_MAX_TICKS} ticks, which specs/gameplay.md has it do the moment ` +
      "its center enters that tile",
  );
  await harness.advance(READ_BEAT);
  return harness.snapshot();
}

it("Eating brightens the forager", async () => {
  startPlaying(h);
  const run = await poseStraightRun(h, RUN_TILES);
  // The spare, which is never eaten, so no mouthful below can be the one that
  // leaves none behind and clears the maze mid-measurement.
  h.debug.setPlankton(run.start.tx + RUN_TILES - 1, run.start.ty, true);
  const watch = await sceneGuard(h, { foragerParked: false });

  const graze = await captureReplay(h, "brighten", async () => {
    const start = h.snapshot();
    const after: FathomSnapshot[] = [];
    let previous = start;
    for (let i = 0; i < EATS; i += 1) {
      previous = await grazeOne(h, previous, {
        tx: run.start.tx + 1 + i,
        ty: run.start.ty,
      });
      after.push(previous);
    }
    return { start, after };
  });

  const end = graze.after[graze.after.length - 1];
  requireSceneHeld(end, watch);

  // The measurement is of a step taken from zero, which is what the item states and
  // what keeps a wrong step from hiding behind a clamp.
  assertLessThanOrEqual(
    graze.start.brightness,
    ZERO_TOLERANCE,
    "the brightness the graze started from, posed to the 0 a dive opens on",
  );

  assertLessThanOrEqual(
    Math.abs(
      graze.after[0].brightness - graze.start.brightness - BRIGHT_PER_EAT,
    ),
    STEP_TOLERANCE,
    `how far the first pellet moved G, against BRIGHT_PER_EAT ` +
      `(${BRIGHT_PER_EAT}): it went from ${graze.start.brightness} to ` +
      `${graze.after[0].brightness}`,
  );

  // The ceiling. `EATS * BRIGHT_PER_EAT` is well past `1`, so a build that adds
  // without clamping is over it and a build that clamps is exactly on it.
  for (const [index, sample] of graze.after.entries()) {
    assertLessThanOrEqual(
      sample.brightness,
      1,
      `G after ${index + 1} plankton, which is clamped at 1 (specs/sensing.md)`,
    );
  }
  assertLessThanOrEqual(
    Math.abs(end.brightness - 1),
    CLAMP_TOLERANCE,
    `G after ${EATS} plankton, ${(EATS * BRIGHT_PER_EAT).toFixed(2)} of ` +
      "brightness eaten, which clamps at exactly 1",
  );
});
