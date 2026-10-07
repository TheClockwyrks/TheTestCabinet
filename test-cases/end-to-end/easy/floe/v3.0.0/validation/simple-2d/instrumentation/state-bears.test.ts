// Floe — instrumentation/state-bears: every bear's state — its two tiles, its
// centre, its committed step, the tile it hunts and its three faculties — is
// reported and reads back.
//
// `specs/instrumentation.md` states the rule the whole surface is built to:
// "`snapshot` returns exactly this object. Every field an operation can set is
// present, so every operation is verifiable by setting it and reading it back."
// The rest of this suite reads its verdicts out of that object, so a field that
// is absent, that answers with something of the wrong kind, or that fails to
// report what a pose put into it costs the point that asks for it somewhere
// else, under a heading about a mechanic. This family of the shape is named
// here instead.
//
// THE SHAPE AND THE READ-BACK ARE ONE CLAIM PER FAMILY, and the families are
// separate points. A build whose bears report nothing usable must grade
// differently from one whose whole snapshot is wrong, and a single point over
// the whole surface can only fail once — so the six `instrumentation/state-*`
// points divide the object along the lines `specs/instrumentation.md` itself
// draws.
//
// EVERY POSE IS READ BEFORE ANYTHING RUNS. The harness holds the game off its own
// clock, so nothing happens between a pose and the snapshot that checks it: one
// frame would run the hold, the cooldown and the lanes on, and the check would be
// reading the update rather than the pose.
//
// EVERY VALUE IS ONE THE POSE HAD TO CARRY. Each is deliberately not the value
// `startCrossing` left behind, so a build that ignores a pose reads back the
// value it already held rather than the one asked for, and the failure names the
// operation. Each boolean is posed BOTH WAYS for the same reason: a field read
// back once could be a constant.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// posed gate holds a faculty off is each gate item's, that a posed step is
// carried out is `hunter/*`'s, and that a lane at a speed carries its items that
// far is `ice/*`'s and `water/*`'s.
//
// TWO BEARS ARE ON THE STRAIT, NOT ONE. `bears` is a roster, and an array of one
// says nothing about a build that reports the same bear twice or that loses the
// second: `specs/hunter.md` runs two from `SECOND_BEAR_LEVEL`, so two is the
// shape a check has to read. Both are posed with all three faculties off, so the
// frame driven for the picture leaves them exactly where they were put.
//
// `id`, `facing` and `swimming` are read for their PRESENCE and their kind alone,
// and that is not an omission. No operation sets any of them: an id is the
// surface's own (`instrumentation/entity-ids`), a facing follows the step a bear
// is travelling on, and `swimming` is derived from the tile it is over, which
// `hunter/swims-flag` grades.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../constants";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  bearOf,
  captureStill,
  createHarness,
  poseBear,
  startCrossing,
  type Facing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The strait the per-entity poses below are applied to. */
/** The bear's poses: a tile, a committed step, a mid-glide centre, a target. */
const BEAR_COL = 25;
const BEAR_ROW = 13;
const BEAR_STEP: Facing = "left";
const BEAR_STEP_COL = BEAR_COL - 1;
const BEAR_STEP_ROW = BEAR_ROW;
const BEAR_X = 803.5;
const BEAR_Y = 500.25;
const BEAR_TARGET_COL = 33;
const BEAR_TARGET_ROW = 4;

/** The four facings and the three footings the shape names. */
const FACINGS: readonly Facing[] = ["up", "down", "left", "right"];
/** The two tiles the bears are settled on, one per band, clear of the critter. */
const BEAR_TILES: readonly (readonly [number, number])[] = [
  [4, 12],
  [34, 6],
];

/** Every field of one reported tile is a number. */
function assertTile(tile: { col: unknown; row: unknown }, what: string): void {
  assertEqual(typeof tile.col, "number", `${what}.col`);
  assertEqual(typeof tile.row, "number", `${what}.row`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every bear's fields and reads every pose of them back", async () => {
  startCrossing(h);

  // Two bears, both held still: this point reads their fields, and a bear that
  // travelled between the picture and the reading would be reporting another
  // point's mechanic.
  const posed: number[] = [];
  for (const [col, row] of BEAR_TILES) {
    posed.push(
      poseBear(h, col, row, {
        sense: false,
        routing: false,
        travel: false,
      }),
    );
  }
  const bear = posed[0];

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the strait it was applied to.
  captureStill(h, "read-back");

  const s = h.snapshot();

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = <T>(
    pose: () => void,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): void => {
    pose();
    assertEqual(read(h.snapshot()), want, what);
  };

  // ---- The fields every bear reports ------------------------------------

  assertLength(
    s.bears,
    BEAR_TILES.length,
    "snapshot().bears, of which this scenario posed two",
  );
  for (const bear of s.bears) {
    assertEqual(typeof bear.id, "number", "snapshot().bears[].id");
    assertTile(bear, "snapshot().bears[], the tile it last settled on");
    assertEqual(
      typeof bear.stepCol,
      "number",
      "snapshot().bears[].stepCol, the tile it is travelling into",
    );
    assertEqual(typeof bear.stepRow, "number", "snapshot().bears[].stepRow");
    assertEqual(
      typeof bear.x,
      "number",
      "snapshot().bears[].x, which is its CENTER",
    );
    assertEqual(typeof bear.y, "number", "snapshot().bears[].y");
    assertContains(FACINGS, bear.facing, "snapshot().bears[].facing");
    assertEqual(typeof bear.swimming, "boolean", "snapshot().bears[].swimming");
    assertTile(bear.target, "snapshot().bears[].target");
    assertEqual(typeof bear.sense, "boolean", "snapshot().bears[].sense");
    assertEqual(typeof bear.routing, "boolean", "snapshot().bears[].routing");
    assertEqual(typeof bear.travel, "boolean", "snapshot().bears[].travel");
  }

  // ---- What each pose reads back ----------------------------------------

  h.debug.setBearTile(bear, BEAR_COL, BEAR_ROW);
  const settled = bearOf(h.snapshot(), bear);
  assertEqual(
    `${settled.col},${settled.row}`,
    `${BEAR_COL},${BEAR_ROW}`,
    `the tile snapshot() reports the bear settled on after ` +
      `setBearTile(${bear}, ${BEAR_COL}, ${BEAR_ROW})`,
  );
  assertEqual(
    `${settled.stepCol},${settled.stepRow}`,
    `${BEAR_COL},${BEAR_ROW}`,
    `the tile it is travelling into after setBearTile(${bear}, ${BEAR_COL}, ` +
      `${BEAR_ROW}) — settling puts it on that tile, so it is no longer between ` +
      `two (specs/instrumentation.md)`,
  );
  assertEqual(
    `${settled.x},${settled.y}`,
    `${tileCX(BEAR_COL)},${tileCY(BEAR_ROW)}`,
    `the CENTRE snapshot() reports after setBearTile(${bear}, ${BEAR_COL}, ` +
      `${BEAR_ROW})`,
  );

  h.debug.setBearStep(bear, BEAR_STEP);
  const stepping = bearOf(h.snapshot(), bear);
  assertEqual(
    `${stepping.stepCol},${stepping.stepRow}`,
    `${BEAR_STEP_COL},${BEAR_STEP_ROW}`,
    `the tile it is travelling into after ` +
      `setBearStep(${bear}, ${JSON.stringify(BEAR_STEP)}) from tile ` +
      `(${BEAR_COL}, ${BEAR_ROW})`,
  );

  // The mid-glide pose: the centre alone, with the two tiles left as they stand.
  h.debug.setBearPosition(bear, BEAR_X, BEAR_Y);
  const glided = bearOf(h.snapshot(), bear);
  assertEqual(
    `${glided.x},${glided.y}`,
    `${BEAR_X},${BEAR_Y}`,
    `the CENTRE snapshot() reports after setBearPosition(${bear}, ${BEAR_X}, ` +
      `${BEAR_Y})`,
  );

  readsBack(
    () => h.debug.setBearTarget(bear, BEAR_TARGET_COL, BEAR_TARGET_ROW),
    (s) => {
      const found = bearOf(s, bear);
      return `${found.target.col},${found.target.row}`;
    },
    `${BEAR_TARGET_COL},${BEAR_TARGET_ROW}`,
    `the tile snapshot() reports the bear hunting after ` +
      `setBearTarget(${bear}, ${BEAR_TARGET_COL}, ${BEAR_TARGET_ROW})`,
  );

  for (const enabled of [true, false]) {
    readsBack(
      () => h.debug.setBearSense(bear, enabled),
      (s) => bearOf(s, bear).sense,
      enabled,
      `snapshot() bear ${bear}'s sense after setBearSense(${bear}, ${enabled})`,
    );
    readsBack(
      () => h.debug.setBearRouting(bear, enabled),
      (s) => bearOf(s, bear).routing,
      enabled,
      `snapshot() bear ${bear}'s routing after ` +
        `setBearRouting(${bear}, ${enabled})`,
    );
    readsBack(
      () => h.debug.setBearTravel(bear, enabled),
      (s) => bearOf(s, bear).travel,
      enabled,
      `snapshot() bear ${bear}'s travel after ` +
        `setBearTravel(${bear}, ${enabled})`,
    );
  }
});
