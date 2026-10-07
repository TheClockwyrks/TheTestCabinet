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
// THE PELLETS ARE POSED, AND NOT UNDER THE FORAGER. `poseStraightRun` opens on a
// board `clearPlankton` emptied, so this check lays a pellet on every tile of the
// run except the one the forager rests on: a pellet underfoot would be eaten on
// the first tick of the drive and start the measurement from `BRIGHT_PER_EAT`
// rather than from `0`.
//
// AND THE BOARD CANNOT RUN OUT. The run carries `RUN_TILES - 1` pellets and the
// graze takes `EATS` of them, so pellets are left standing throughout: eating the
// last plankton in a maze clears it (specs/gameplay.md), which would descend and
// end the measurement.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { BRIGHT_PER_EAT } from "../constants";
import { poseStraightRun, stockPlankton } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { FathomSnapshot } from "../surface";
import { grazeOne } from "./graze";

/** Tiles of posed corridor: the pellet underfoot, four to graze, and room to spare. */
const RUN_TILES = 8;

/** How many pellets are eaten. Three reach the ceiling; the fourth is asked at it. */
const EATS = 4;

/**
 * How long the swim to each next pellet is given, in ticks.
 *
 * Pellets sit one tile apart, and `FORAGER_SPEED` (`128`) covers a tile in `30`
 * ticks. One second is a wide margin on that and still a hard ceiling, so a build
 * that never reaches the next pellet fails rather than being waited for.
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

it("Eating brightens the forager", async () => {
  startPlaying(h);
  const run = await poseStraightRun(h, RUN_TILES);
  // The run stocked as a laid-out maze carries it, less the tile the forager
  // rests on: a pellet under it would be eaten on the first tick and the step
  // this point measures would start from BRIGHT_PER_EAT rather than from 0.
  await stockPlankton(h, [run.start]);
  const watch = await sceneGuard(h, { foragerParked: false });

  const graze = await captureReplay(h, "brighten", async () => {
    const start = h.snapshot();
    const after: FathomSnapshot[] = [];
    let previous = start;
    for (let i = 0; i < EATS; i += 1) {
      previous = await grazeOne(h, previous, {
        budget: REACH_MAX_TICKS,
        beat: READ_BEAT,
      });
      after.push(previous);
    }
    return { start, after };
  });

  const end = graze.after[graze.after.length - 1];
  requireSceneHeld(end, watch);

  // The measurement is of a step taken from zero, which is what the item states
  // and what keeps a wrong step from hiding behind a clamp.
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
      `brightness eaten, which clamps at exactly 1`,
  );
});
