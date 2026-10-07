// cursor/bolt-travels-up — a bolt in flight climbs at BOLT_SPEED.
//
// `specs/cursor.md`: "A bolt travels straight up at `BOLT_SPEED` (`900` units
// per second), integrated against the delta time of each update."
//
// THE COLUMN IS CLEAR AND THE BOARD IS EMPTY. `startPlaying` leaves no node, no
// segment and no foe anywhere, so nothing the bolt could resolve against stands
// between it and the reading: `cursor.bolt-stops-at-node`,
// `cursor.bolt-stops-at-segment` and `cursor.bolt-stops-at-foe` grade what
// resolving does, and this point grades the travel alone.
//
// THE BOLT IS POSED RATHER THAN FIRED. `addBolt` puts one in flight at a known
// centre (`specs/instrumentation.md`), so the measurement starts from a figure
// this check knows instead of from wherever a build's muzzle put it — which is
// `cursor.bolt-spawns-at-cursor`'s requirement and would otherwise be smuggled
// into this one.
//
// THE WINDOW IS HALF A SECOND, AND IT IS SIZED TO THE BOARD. `specs/board.md`
// makes the board 640 units tall, so at `BOLT_SPEED` a full second would carry
// the bolt off the top — where `cursor.bolt-vanishes-at-top` requires it to be
// gone, and where there would be nothing left to measure. Half a second carries
// it 450 units, from row 19's centre (704) to y = 254, still 174 units inside
// the board.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_Y, BOLT_SPEED } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual, fail } from "../assert";
import {
  boltById,
  captureReplay,
  createHarness,
  framesFor,
  poseBolt,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";

/** The column the bolt climbs, well clear of both side edges. */
const COLUMN = 12;

/** The row the bolt is posed on: the floor, whose centre y is 704. */
const START_ROW = 19;

/** The measured window, in frames of the harness's 100 Hz clock: 0.5 s. */
const WINDOW_FRAMES = framesFor(0.5);

/**
 * How far the bolt rises in the window, in logical units.
 *
 * `BOLT_SPEED` integrated over the window's own duration, which is 450 units.
 */
const EXPECTED_RISE = BOLT_SPEED * seconds(WINDOW_FRAMES);

/**
 * The review item's margin: five percent of the expected rise, 22.5 units.
 *
 * Two and a half frames of travel at the stated rate on this clock, so a build
 * whose integration lands a frame either side of the window is not docked for
 * it, and a build off by a tenth of the rate — 45 units over the window — is.
 */
const RISE_TOLERANCE = EXPECTED_RISE * 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("raises the bolt BOLT_SPEED units per second up a clear column", async () => {
  // `startPlaying` empties the field and every roster, so the column above the
  // bolt holds nothing for it to resolve against.
  await startPlaying(h);
  const id = await poseBolt(h, COLUMN, START_ROW);

  const opened = boltById(await h.snapshot(), id);
  if (opened === undefined) {
    fail(
      `the bolt addBolt appended to the roster (id ${id}) reported by ` +
        "snapshot() before the window opens — specs/instrumentation.md",
      "no bolt with that id",
    );
  }
  const startedAt = opened.y;

  await captureReplay(h, "climb", () => h.advance(WINDOW_FRAMES));

  const flying = boltById(await h.snapshot(), id);
  if (flying === undefined) {
    fail(
      `the bolt (id ${id}) still in flight after ${WINDOW_FRAMES} frames ` +
        `(${seconds(WINDOW_FRAMES)} s) up an empty column — at BOLT_SPEED ` +
        `(${BOLT_SPEED}) it should be ${EXPECTED_RISE} units up, at ` +
        `y = ${startedAt - EXPECTED_RISE}, still ` +
        `${startedAt - EXPECTED_RISE - BOARD_Y} units inside the board`,
      "no bolt with that id",
    );
  }

  const risen = startedAt - flying.y;
  assertGreaterThan(
    risen,
    0,
    `how far the bolt's centre y rose from ${startedAt} — specs/cursor.md: a ` +
      "bolt travels straight UP",
  );
  assertLessThanOrEqual(
    Math.abs(risen - EXPECTED_RISE),
    RISE_TOLERANCE,
    `how far the bolt's centre y rose over ${WINDOW_FRAMES} frames ` +
      `(${seconds(WINDOW_FRAMES)} s), against BOLT_SPEED (${BOLT_SPEED}) ` +
      "units per second — specs/cursor.md",
  );
});
