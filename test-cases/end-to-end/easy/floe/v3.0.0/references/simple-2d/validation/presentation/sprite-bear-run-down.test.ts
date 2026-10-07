// presentation/sprite-bear-run-down — a bear travelling down on ice is drawn from
// the run pair for that heading.
//
// specs/assets.md seeds `assets/bear/` with eighteen frames and tabulates them:
// frames `0`–`7` are the four-facing run, `0`,`1` down, `2`,`3` up, `4`,`5`
// left, `6`,`7` right, and "Travelling on ice footing" is drawn from "The run
// pair for its facing". specs/hunter.md fixes the footing: a bear's footing is
// the footing of the tile it is travelling into, and "the near shore, the ice
// band, the median, the far shore, and any water tile a floe covers are all ice
// footing".
//
// THE FOUR HEADINGS ARE FOUR POINTS. A build that wired one heading and left the
// other three on frame `0` must grade differently from one that wired none, and
// a single point over all four can only fail once. Each of the four commits its
// own step and reads its own pair.
//
// THE READING IS EXCLUSIVE, NOT MERELY INCLUSIVE: every bear frame drawn on the
// bear must belong to this heading's pair. Asserting only that one of the two
// was among them would pass a build that blits all eighteen frames on top of
// each other. The eighteen seeded frames are pixel-for-pixel distinct, so a
// match names exactly one of them.
//
// WHY THE ICE BAND AND NOT THE MEDIAN. Every tile the bear enters has to be ice
// footing. From the median shelf (row `10`) a step UP enters row `9`, the top of
// the water band, which carries no floe on an empty strait — specs/hunter.md
// makes that bear `swimming`, and specs/assets.md then draws it from the SWIM
// pair, which is `presentation/sprite-bear-swim`'s point. Row `15` sits inside
// the ice band with ice above, below and to either side, so the step is the ice
// footing this point is about.
//
// THE BEAR IS POSED WITH ONLY THE FACULTY THIS POINT EXERCISES. Its routing is
// off, so it takes no step of its own and travels exactly the step
// `setBearStep` commits it to; its travel is left ON, because being between
// tiles is the situation the drawing rule names. Nothing else is on the strait
// but the critter `startCrossing` puts on the near shore, four rows away and
// beyond any reach with the catch test shut.

import { afterEach, beforeEach, it } from "vitest";
import { BEAR_ICE_SPEED, TICK_HZ, TILE } from "../constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  BEAR_RUN_FRAMES,
  captureStill,
  createHarness,
  poseBear,
  startCrossing,
  type Facing,
  type Harness,
} from "../harness";
import { drawnFrom, frameIndexes, spritesOfFrame } from "./sprites";

/** A tile inside the ice band, with ice footing on all four sides. */
const COL = 20;
const ROW = 15;

/**
 * How far into a step the bear is read, in ticks.
 *
 * At `BEAR_ICE_SPEED` (`3`) tiles per second and `TICK_HZ` (`120`) ticks per
 * second, eight ticks carry it a fifth of a tile: unambiguously between tiles,
 * and nowhere near the far centre it would settle on after forty. What is read
 * is a bear mid-glide, which is what "travelling" means.
 */
const TRAVEL_TICKS = 8;

/** A sanity ceiling on the above: it must not reach the next tile centre. */
const TILE_TICKS = Math.round(TICK_HZ / BEAR_ICE_SPEED);

/**
 * How far a draw's centre may sit from the bear's own reported centre.
 *
 * specs/assets.md draws a 32 x 32 frame "centered on its subject's own center".
 * Half a tile is the widest tolerance that still names one tile. A build that
 * interpolates its render between the last two ticks is inside a single tick's
 * travel of the reported centre, which at this speed is under one unit.
 */
const CENTRED_WITHIN = TILE / 2;

/** The heading this point commits the bear to, and reads. */
const HEADING: Facing = "down";

/** The two frames specs/assets.md gives that heading's run. */
const PAIR = BEAR_RUN_FRAMES[HEADING];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a bear travelling down on ice from its down run pair", async () => {
  assertGreaterThanOrEqual(
    TILE_TICKS,
    TRAVEL_TICKS * 2,
    "the reading tick sits well inside one tile's travel",
  );

  startCrossing(h);
  const id = poseBear(h, COL, ROW, { routing: false });
  h.debug.setBearStep(id, HEADING);
  await h.advance(TRAVEL_TICKS);

  const sprites = await spritesOfFrame(h);
  const roster = h.snapshot().bears;
  assertLength(roster, 1, `bear ${id}, the only bear this scenario posed`);
  const bear = roster[0];
  const indexes = frameIndexes(
    drawnFrom(sprites, "bear", bear, CENTRED_WITHIN),
    "bear",
  );
  // Before the assertions, so a failing check still leaves the frame it read.
  captureStill(h, "scene");

  assertEqual(
    bear.swimming,
    false,
    "the bear on ice footing, travelling within the ice band " +
      "(specs/hunter.md) — the situation the run pair is drawn for",
  );
  assertGreaterThanOrEqual(
    indexes.length,
    1,
    `the bear drawn from a frame of assets/bear/ while travelling ${HEADING}`,
  );
  assertLength(
    indexes.filter((index) => !PAIR.includes(index)),
    0,
    `every frame drawn on the bear from its ${HEADING} run pair, ` +
      `${PAIR.join(" or ")} (specs/assets.md) — drew ${indexes.join(", ")}`,
  );
});
