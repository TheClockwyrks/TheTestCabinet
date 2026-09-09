// hunter/avoids-imminent-tile — a bear keeps out of a tile a running lane is
// about to sweep.
//
// specs/hunter.md draws the line between CLOSED and OPEN: a tile is closed when a
// vehicle covers it now, and it is open only when it is not closed AND "no vehicle
// of its lane will cover it within `BEAR_AVOID_LEAD` (`0.35` s), carrying that
// lane forward at its current speed and direction". Routing chooses among OPEN
// tiles, so a tile a plow is a quarter of a second from reaching is one a bear
// does not step into, even though nothing is on it yet.
//
// HOW THE TEN STEPS ARE READ. Each is read in a world of its own: the plow is
// posed at a chosen position on a running lane, a fresh bear is settled below it
// with its TRAVEL OFF, and one tick is run so the bear's own routing commits one
// step with nothing moving under it. Ten poses, ten committed steps, and no bear
// ever spends time on the lane — so the reading is the DECISION and not what
// became of the bear afterwards.
//
// THE TEN POSITIONS ARE THE DISTINGUISHING SET. The plow is placed so that five of
// them leave the tile above the bear imminent-but-not-yet-covered — the one state
// the lead rule is the whole of — and five leave it plainly open. A build that
// reads only "is a vehicle on it now" steps up on all ten and fails the five; a
// build that reads the lead steps up on none of the five. No position leaves the
// tile actually covered, so no reading here is one the closed rule alone decides.
//
// The check is one-directional, exactly as the item states: a step into an
// imminent tile fails, and a build that declines to step on a tile this reads as
// open is not faulted for being more cautious than the figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import { ROW_NEAR, laneSpeed, tileCX } from "../constants";
import {
  captureReplay,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";
import { imminentlyCovered, requireBear } from "./harness";

/** The running lane, the bear's tile below it, and the tile it is hunting above. */
const LANE_ROW = 17;
const BEAR_COL = 20;
const BEAR_ROW = ROW_NEAR - 1;
const TARGET = { col: BEAR_COL, row: LANE_ROW - 1 };

/** The level the lane's speed is taken at. */
const LEVEL = 1;

/**
 * The ten left edges the plow is posed at, in stage units.
 *
 * `specs/ice.md` runs row 17 leftward at `1.5` tiles a second, so in
 * `BEAR_AVOID_LEAD` (`0.35` s) a plow carries `16.8` units left. The tile above the
 * bear is centred on `tileCX(20)` = 656, so with the plow's left edge at `x` the
 * tile is COVERED for `x` in `(560, 656]` and IMMINENT but not covered for `x` in
 * `(656, 672.8]`.
 *
 * The first five sit inside that narrow window, at least two units clear of either
 * end so no reading turns on the last bits of a double; the last five sit past it,
 * where the tile is plainly open. None is in the covered range, so nothing here is
 * decided by the closed rule instead.
 */
const PLOW_POSITIONS = [659, 663, 666, 669, 671, 676, 690, 710, 740, 780];

/** Where the plow is first laid; every reading poses it again by stage units. */
const PLOW_COL = 21;

/**
 * Stage units the swept span is shrunk by at each end before a step is faulted.
 *
 * A reading is taken after the tick the decision was made on, and a lane carries
 * its items on that tick: row 17 at `1.5` tiles a second moves `0.4` units in the
 * `1/120` s step. One unit covers that and the arithmetic around it, and is a
 * thirtieth of a tile — far under the `16.8` units the lead itself is worth, so no
 * build can pass by sitting inside this.
 */
const LEAD_MARGIN_UNITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("never commits a step into a tile the lane sweeps within BEAR_AVOID_LEAD", async () => {
  startCrossing(h, LEVEL);
  const [plow] = poseLane(h, LANE_ROW, "plow", [PLOW_COL]);
  // The lane runs: a tile is imminent only because its lane is carrying something
  // toward it, so the speed the specification gives row 17 goes back on.
  h.debug.setLaneSpeed(LANE_ROW, laneSpeed(LANE_ROW, LEVEL));

  const faults: string[] = [];
  let imminentReadings = 0;

  await captureReplay(h, "route", async () => {
    for (const x of PLOW_POSITIONS) {
      h.debug.clearBears();
      h.debug.setVehicleX(plow, x);
      const id = poseBear(h, BEAR_COL, BEAR_ROW, {
        sense: false,
        travel: false,
      });
      h.debug.setBearTarget(id, TARGET.col, TARGET.row);
      await h.advance(1);

      const snapshot = h.snapshot();
      const bear = requireBear(snapshot, id, "the bear choosing its step");
      if (imminentlyCovered(snapshot, BEAR_COL, LANE_ROW, LEAD_MARGIN_UNITS)) {
        imminentReadings += 1;
      }
      if (
        imminentlyCovered(
          snapshot,
          bear.stepCol,
          bear.stepRow,
          LEAD_MARGIN_UNITS,
        )
      ) {
        faults.push(
          `plow at ${x}: stepped into (${bear.stepCol}, ${bear.stepRow})`,
        );
      }
    }
  });

  // The scenario really did put an imminent tile in front of the bear, so a clean
  // sheet below is a decision taken rather than one never faced. The five
  // positions the arithmetic above puts inside the window all read imminent
  // against the reference; the bar is ONE, because how many of them a build's own
  // reported lane speed and vehicle position agree on is `ice`'s requirement
  // rather than this one's, and faulting a build here for that would grade the
  // wrong thing.
  assertGreaterThanOrEqual(
    imminentReadings,
    1,
    `readings with the tile above the bear (centre x=${tileCX(BEAR_COL)}) ` +
      `imminent`,
  );
  assertLength(
    faults,
    0,
    `committed steps into a tile the lane sweeps within BEAR_AVOID_LEAD: ` +
      `${faults.slice(0, 3).join("; ")}`,
  );
});
