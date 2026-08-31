// hunter/re-emerges-after-reset — a bear traffic took is replaced.
//
// specs/hunter.md: "A slot falls empty when a crossing begins and when the bear
// filling it leaves the strait... A bear removed by traffic is replaced on the
// emerging conditions above, so its slot fills again once its delay has passed."
// So a reset is not the end of the hunt: the slot the bear vacated refills, on the
// near shore, `BEAR_EMERGE_DELAY` (0.6 s) later.
//
// THE FIRST BEAR IS ONE THE GAME EMERGED, not one this check added. A slot is what
// refills, and only the game's own emergence puts a bear in a slot, so the
// scenario waits for the hunt to start itself and only then takes that bear off
// the strait.
//
// It is taken off by TRAFFIC, which is the removal the rule names: the bear is
// settled on a row of the ice band, a car is parked over its tile, and the lane is
// then released, so the removal is the game's own. The vehicles are cleared
// immediately afterwards, so what the delay is measured against is an empty strait
// and nothing can take the replacement as well.

import { afterEach, beforeEach, it } from "vitest";
import {
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  ROW_NEAR,
  START_COL,
  laneSpeed,
} from "../../src/constants";
import { assertEqual, assertLength, fail } from "../assert";
import {
  captureReplay,
  createHarness,
  lastBear,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The row three rows of advance puts the critter on. */
const ADVANCED_ROW = ROW_NEAR - BEAR_EMERGE_ADVANCE;

/** The ice row the first bear is settled on to be run down, and the car's column. */
const STRIKE_ROW = ROW_NEAR - 1;
const STRIKE_COL = START_COL;

/** The level the lane's speed is taken at. */
const LEVEL = 1;

/** How long the hunt is waited on, either time: far past any delay it can ask for. */
const WATCH_SECONDS = 5;

/** Ticks of slack allowed either side of BEAR_EMERGE_DELAY, as in emerges-after-advance. */
const DELAY_SLACK_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts another bear on the near shore a delay after traffic took the first", async () => {
  startCrossing(h, LEVEL);
  h.debug.setCritterTile(START_COL, ADVANCED_ROW);
  h.debug.setBestRow(ADVANCED_ROW);
  h.debug.setBearEmergence(true);

  // The hunt starts itself, so the bear that is about to be taken is one holding
  // a slot. This stretch is not recorded: it is the arrangement, not the point.
  const opened = await h.until((snapshot) => snapshot.bears.length > 0, {
    maxFrames: ticksFor(WATCH_SECONDS),
    poll: 1,
  });
  if (!opened.hit) {
    fail(
      `a bear on the strait within ${WATCH_SECONDS} s, so there is one for ` +
        `traffic to take`,
      "the hunt never started",
    );
  }
  const first = lastBear(opened.snapshot);

  const { before, after } = await captureReplay(h, "reset", async () => {
    // Settled on an ice row and held there, so the removal below is traffic
    // arriving on it rather than the chase carrying it somewhere else.
    h.debug.setBearRouting(first.id, false);
    h.debug.setBearTravel(first.id, false);
    h.debug.setBearTile(first.id, STRIKE_COL, STRIKE_ROW);

    // A car over its tile, and then the lane released: a vehicle in a lane whose
    // speed is above 0 covering a tile the bear occupies is the removal the rule
    // names.
    poseLane(h, STRIKE_ROW, "car", [STRIKE_COL]);
    h.debug.setLaneSpeed(STRIKE_ROW, laneSpeed(STRIKE_ROW, LEVEL));
    const struck = await h.until((snapshot) => snapshot.bears.length === 0, {
      maxFrames: ticksFor(WATCH_SECONDS),
      poll: 1,
    });
    if (!struck.hit) {
      fail(
        "the bear taken off the strait by the vehicle released over it, so " +
          "there is a reset to be replaced",
        `bears ${JSON.stringify(struck.snapshot.bears.map((bear) => bear.id))}`,
      );
    }

    // The strait goes back to empty, so the delay below is measured against
    // nothing and the replacement is not taken as well.
    h.debug.clearVehicles();

    await h.advance(ticksFor(BEAR_EMERGE_DELAY) - DELAY_SLACK_TICKS);
    const early = h.snapshot();
    await h.advance(2 * DELAY_SLACK_TICKS);
    return { before: early, after: h.snapshot() };
  });

  assertLength(before.bears, 0, "the hunt a whisker before the delay ran out");
  assertLength(after.bears, 1, "the hunt a whisker after the delay ran out");
  assertEqual(
    after.bears[0]?.row,
    ROW_NEAR,
    "the row the replacement appeared on",
  );
});
