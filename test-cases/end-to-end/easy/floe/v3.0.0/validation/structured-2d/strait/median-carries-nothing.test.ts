// strait/median-carries-nothing — the median shelf carries no lane, and a
// critter standing on it stays on solid footing while the strait runs.
//
// specs/strait.md gives row `10` to the median shelf — "Solid ice, full width.
// It carries no lane." — and says of it and the near shore: "The near shore and
// the median shelf carry no vehicle and no floe, at any level. They are the two
// strips the critter can stand on indefinitely without the water or the traffic
// reaching it." The footing table gives row `10` `solid`, unconditionally.
//
// The point is read in two ways, because a build fails it in two ways.
//
// FIRST, THE LAYOUT. A level's roster is what `setLevel` produces
// (specs/instrumentation.md: it "lays the strait out for it"), and every level is
// read, because "at any level" is the specification's own quantifier: the eight
// ice lanes are rows `11`-`18` and the eight water lanes rows `2`-`9`
// (specs/ice.md, specs/water.md), and a level that laid a ninth ice lane or
// stretched the water band would put an item on row `10`.
//
// SECOND, THE STRAIT RUNNING. Ten seconds of LIVE lanes, because the failure
// worth catching is not a lane laid onto the median but a lane that WRAPS
// through it: specs/water.md and specs/ice.md have an item carried off one edge
// return at the other, and a build that returns it a row out, or that advances a
// lane's row along with its position, walks its items through the median while
// the level's own layout looked right. That failure is invisible on a fresh
// layout and shows only after the lanes have run.
//
// AT THE TOP LEVEL, because the lanes are fastest there — `laneSpeed(row, L)`
// scales by `LEVEL_SPEED_STEP` (`1.06`) per level (specs/ice.md) — so ten seconds
// carries the most items across the strait's edges and gives a wrapping fault
// the most chances to show.
//
// WHAT IS READ WHILE IT RUNS. The critter's footing, the two rosters, and the
// critter itself: `solid` every sample, no vehicle and no floe ever reported on
// row `10`, the critter still on the strait, and no life spent. Those are one
// requirement — that the median is clear footing — read from the side the
// critter feels it and the side the rosters state it.
//
// THE FOUR WORLD GATES ARE SHUT, so what runs for those ten seconds is the lanes
// and nothing else: no bear emerges behind a critter that has climbed nine rows,
// no incidental catch costs a life, no bonus catch turns up, and the crossing
// timer does not expire under it. The lanes themselves are exactly what
// `setLevel` laid out — `startCrossing` clears the two rosters, so this puts them
// straight back with a second `setLevel`, which is what re-lays them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ROW_MEDIAN, START_COL, START_LIVES, TOTAL_LEVELS } from "../constants";
import {
  captureReplay,
  createHarness,
  resetTo,
  seconds,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the strait runs at: the fastest lanes the game has. */
const LEVEL = TOTAL_LEVELS;

/** The seconds of live lanes the critter stands through, from the item. */
const RUN_SECONDS = 10;

/**
 * Ticks per frame while those seconds run.
 *
 * The simulation advances by the whole `TICK_DT` ticks a frame's delta completes
 * and reaches the same state however an interval was divided into frames
 * (specs/overview.md), so four ticks a frame runs exactly the same ten seconds
 * as one tick a frame. It is four rather than one so the whole ten seconds fits
 * a recording at its full frame rate, and it still samples the footing every
 * thirtieth of a second.
 */
const TICKS_PER_FRAME = 4;

/** Frames those seconds take at that pace. */
const FRAMES = ticksFor(RUN_SECONDS) / TICKS_PER_FRAME;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lays no vehicle and no floe on the median, at every level", () => {
  for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
    resetTo(h);
    h.debug.setLevel(level);

    const laid = h.snapshot();
    assertLength(
      laid.vehicles.filter((vehicle) => vehicle.row === ROW_MEDIAN),
      0,
      `level ${level}: vehicles laid out on the median, row ${ROW_MEDIAN} ` +
        `(specs/strait.md)`,
    );
    assertLength(
      laid.floes.filter((floe) => floe.row === ROW_MEDIAN),
      0,
      `level ${level}: floes laid out on the median, row ${ROW_MEDIAN} ` +
        `(specs/strait.md)`,
    );
  }
});

it("holds the critter on solid footing through ten seconds of live lanes", async () => {
  startCrossing(h, LEVEL);
  // `startCrossing` emptied the two rosters; this puts the level's own sixteen
  // lanes straight back, live, which is the situation this reading is about.
  h.debug.setLevel(LEVEL);
  h.debug.setCritterTile(START_COL, ROW_MEDIAN);

  h.pace(TICKS_PER_FRAME);
  try {
    await captureReplay(h, "median", async () => {
      for (let frame = 0; frame < FRAMES; frame += 1) {
        await h.advance(1);
        const now = h.snapshot();
        const at = `after ${seconds((frame + 1) * TICKS_PER_FRAME)} s`;

        assertEqual(
          now.critter.footing,
          "solid",
          `${at}: the footing row ${ROW_MEDIAN} gives (specs/strait.md)`,
        );
        assertLength(
          now.vehicles.filter((vehicle) => vehicle.row === ROW_MEDIAN),
          0,
          `${at}: vehicles on the median (specs/strait.md)`,
        );
        assertLength(
          now.floes.filter((floe) => floe.row === ROW_MEDIAN),
          0,
          `${at}: floes on the median (specs/strait.md)`,
        );
        assertEqual(
          now.critter.present,
          true,
          `${at}: the critter still on the strait (specs/strait.md)`,
        );
        assertEqual(
          now.lives,
          START_LIVES,
          `${at}: the lives a crossing on the median spends (specs/strait.md)`,
        );
      }
    });
  } finally {
    h.pace(1);
  }
});
