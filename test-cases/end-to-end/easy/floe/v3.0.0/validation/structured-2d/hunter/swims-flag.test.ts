// hunter/swims-flag — a bear reports swimming over open water, and only there.
//
// specs/hunter.md: "A bear's footing is the footing of the tile it is travelling
// into. It is `swimming` when that tile is on the water band and no floe covers
// it, and on ice otherwise: the near shore, the ice band, the median, the far
// shore, and any water tile a floe covers are all ice footing."
//
// So the flag is not "is this the water band" and not "is this a lane row": it is
// the water band AND nothing covering it. Four bears are settled at once, on the
// four readings that separate every wrong model from the right one — open water,
// the ice band, the median, and a water tile a parked raft covers. A build that
// reads the band alone gets the raft wrong; a build that reads the roster alone
// gets the median or the ice band wrong; a build that never sets the flag gets
// open water wrong.
//
// Each bear is settled with its travel and its routing off, so the tile it is
// travelling into is its own tile and the reading is the one the pose asked for.
// The raft is parked, so the tile under the fourth bear stays covered while the
// reading is taken. One tick is run before the flag is read, because
// `specs/instrumentation.md` reports it as a derived value: what is graded is what
// the build's own update makes of the pose, not the instant between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ITEM_LEN, ROW_MEDIAN } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  floesOn,
  itemCoversTile,
  poseBear,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";
import { requireBear } from "./harness";

/** The water row the raft is laid on, and the column its left edge sits on. */
const WATER_ROW = 6;
const RAFT_COL = 12;

/** A bear on each of the four footings the rule separates. */
const OPEN_WATER = { col: 20, row: WATER_ROW };
const ON_ICE = { col: 20, row: 15 };
const ON_MEDIAN = { col: 20, row: ROW_MEDIAN };
const ON_RAFT = { col: RAFT_COL + 1, row: WATER_ROW };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports swimming over open water and ice footing everywhere else", async () => {
  startCrossing(h);
  poseLane(h, WATER_ROW, "raft4", [RAFT_COL]);

  const settled = { sense: false, routing: false, travel: false } as const;
  const water = poseBear(h, OPEN_WATER.col, OPEN_WATER.row, settled);
  const ice = poseBear(h, ON_ICE.col, ON_ICE.row, settled);
  const median = poseBear(h, ON_MEDIAN.col, ON_MEDIAN.row, settled);
  const raft = poseBear(h, ON_RAFT.col, ON_RAFT.row, settled);

  // The scenario this check needs, read off the game itself: the fourth bear's
  // tile really is covered by the raft and the first bear's really is not. The two
  // readings that separate the band from the covering are the whole of this item,
  // and neither means anything if the raft is somewhere else.
  const rafts = floesOn(h.snapshot(), WATER_ROW);
  assertEqual(
    rafts.some((item) => itemCoversTile(item, ON_RAFT.col)),
    true,
    `a floe over water tile (${ON_RAFT.col}, ${WATER_ROW})`,
  );
  assertEqual(
    rafts.some((item) => itemCoversTile(item, OPEN_WATER.col)),
    false,
    `a floe over water tile (${OPEN_WATER.col}, ${WATER_ROW}), which is read ` +
      `as open water`,
  );

  const after = await captureReplay(h, "swim", async () => {
    await h.advance(1);
    return h.snapshot();
  });

  assertEqual(
    requireBear(after, water, "the bear over open water").swimming,
    true,
    `swimming, for a bear on water row ${WATER_ROW} no floe covers`,
  );
  assertEqual(
    requireBear(after, ice, "the bear on the ice band").swimming,
    false,
    `swimming, for a bear on ice row ${ON_ICE.row}`,
  );
  assertEqual(
    requireBear(after, median, "the bear on the median").swimming,
    false,
    `swimming, for a bear on the median (row ${ROW_MEDIAN})`,
  );
  assertEqual(
    requireBear(after, raft, "the bear on the raft").swimming,
    false,
    `swimming, for a bear on water row ${WATER_ROW} under a ` +
      `${ITEM_LEN.raft4}-tile raft`,
  );
});
