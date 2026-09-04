// instrumentation/bear-emergence-gate — `setBearEmergence(false)` holds the run's
// own emergence of bears, and turning it back on lets one arrive.
//
// specs/instrumentation.md fixes the gate: "The run's own emergence of bears: a
// slot filling when its conditions are met, the re-emergence after a bear is
// removed included." specs/hunter.md fixes the conditions it gates: a slot fills
// "the moment both of its conditions hold" — the critter has advanced
// `BEAR_EMERGE_ADVANCE` (`3`) rows and `BEAR_EMERGE_DELAY` (`0.6` s) have passed
// since the slot fell empty.
//
// SO THE SCENARIO SATISFIES BOTH CONDITIONS AND THEN WATCHES THE GATE. The critter
// is posed ten rows off the near shore and its `bestRow` posed with it, which is
// more than three times the rows the first slot asks for, and the strait is then
// left running for sixty seconds — a hundred times the delay. With the gate off no
// bear may join the roster in all that time; with it on, one must.
//
// EVERY OTHER SCENARIO IN THIS SUITE RESTS ON THE FIRST HALF. `startCrossing` shuts
// this gate, and a build that ignored it would put a bear into every check that
// runs past six tenths of a second with the critter three rows up — which is most
// of them — and the point that failed would be about the mechanic rather than about
// the gate.
//
// THE CRITTER STANDS ON A FLOE, WHICH IS WHAT MAKES THE WAIT SAFE. Ten rows off the
// near shore is row `9`, a water lane, and specs/water.md costs a life for standing
// on open water; a floe posed under it makes its footing `floe` (specs/strait.md),
// and `poseLane` parks that lane at a speed of `0`, so the critter stands still for
// the whole minute and the crossing it is in the middle of never ends. Nothing else
// is on the strait, and the crossing timer is held, so the roster can change for
// exactly one reason.
//
// THE RECORDING IS ARMED NARROWLY, at the end of the silent minute and across the
// moment the gate is opened, because that is the section this point is about: a
// recording of the whole wait would be seven thousand identical frames.

import { afterEach, beforeEach, it } from "vitest";
import { BEAR_EMERGE_ADVANCE, BEAR_EMERGE_DELAY, ROW_NEAR } from "../constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the critter is posed: ten rows off the near shore, in mid-strait. */
const CRITTER_COL = 20;
const ROWS_ADVANCED = 10;
const CRITTER_ROW = ROW_NEAR - ROWS_ADVANCED; // row 9, a water lane

/** The floe posed under it, and the column its left edge sits at. */
const FLOE_KIND = "raft4" as const;
const FLOE_COL = CRITTER_COL - 1; // a four-tile raft covering columns 19..22

/**
 * How long the gated strait is watched for, in seconds: the sixty this item names.
 *
 * specs/hunter.md fills the first slot `BEAR_EMERGE_DELAY` (`0.6` s) after it falls
 * empty, so this is a hundred times the delay a conforming build would have taken.
 */
const WATCH_SECONDS = 60;

/** How much game time separates two samples of that watch, in seconds. */
const POLL_SECONDS = 0.25;

/**
 * A last second with the gate still shut, recorded, so the evidence shows the
 * strait before the gate is opened as well as after.
 */
const TAIL_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the hunt away while emergence is gated, and lets one arrive when it is not", async () => {
  startCrossing(h);

  // The critter, ten rows up, standing on a parked floe so the minute below costs
  // it nothing.
  poseLane(h, CRITTER_ROW, FLOE_KIND, [FLOE_COL]);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  h.debug.setBestRow(CRITTER_ROW);
  h.debug.setBearEmergence(false);

  await h.advance(1);
  const posed = h.snapshot();
  assertEqual(
    posed.critter.footing,
    "floe",
    `the critter's footing on row ${CRITTER_ROW}, which is a water lane a posed ` +
      `floe covers (specs/strait.md) — on open water it would lose a life and ` +
      `end the crossing this point watches`,
  );
  assertEqual(
    ROW_NEAR - posed.critter.bestRow,
    ROWS_ADVANCED,
    `the rows the critter has advanced this crossing, which specs/hunter.md ` +
      `reads as ROW_NEAR - bestRow and asks to be at least ` +
      `BEAR_EMERGE_ADVANCE (${BEAR_EMERGE_ADVANCE}) for the first slot`,
  );
  assertEqual(
    posed.bears.length,
    0,
    "the bears on the strait before the watch",
  );

  // The gated minute runs at the harness's COARSE pace, through `skipUntil`: the
  // same ticks, one picture in ten. Nothing here is read per frame — the sweep
  // looks every POLL_SECONDS of GAME time, which is what decides how soon a bear
  // that should not be there is noticed.
  const gated = await h.skipUntil((s) => s.bears.length > 0, {
    maxSeconds: WATCH_SECONDS,
    pollSeconds: POLL_SECONDS,
  });
  assertEqual(
    gated.hit,
    false,
    `a bear joining the roster over ${WATCH_SECONDS} s with ` +
      `setBearEmergence(false), the critter ${ROWS_ADVANCED} rows up and the ` +
      `slot's ${BEAR_EMERGE_DELAY} s delay a hundred times over — the gate holds ` +
      `the run's own emergence (specs/instrumentation.md)`,
  );

  const arrived = await captureReplay(h, "gate", async () => {
    // A second more with the gate still shut, so the recording shows both sides.
    await h.advance(ticksFor(TAIL_SECONDS));
    h.debug.setBearEmergence(true);
    return h.until((s) => s.bears.length > 0, {
      maxFrames: ticksFor(WATCH_SECONDS),
    });
  });

  assertTrue(
    arrived.hit,
    `a bear joining the roster within ${WATCH_SECONDS} s of ` +
      `setBearEmergence(true), with both of the first slot's conditions long ` +
      `since met (specs/hunter.md)`,
  );
  assertGreaterThan(
    arrived.snapshot.bears.length,
    0,
    "the bears on the strait once emergence is running again",
  );
});
