// hunter/emerges-at-near-shore — the bear that emerges appears on the near shore.
//
// specs/hunter.md: an empty slot fills with "a bear settled on the near shore in
// the critter's column, facing up". WHERE it appears is this item; WHEN it appears
// is `emerges-after-advance`'s, so the conditions here are posed to be met and the
// roster is then watched one tick at a time, so the reading is taken on the very
// tick the bear joined rather than a fifth of a second into its travel.
//
// A bear covers `BEAR_ICE_SPEED` (3) tiles a second, which is a fortieth of a tile
// in the tick it emerged on, so the tile it last settled on is still the tile it
// appeared on however fast it left. That is what makes a per-tick watch the right
// grain and a coarser one wrong.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BEAR_EMERGE_ADVANCE, ROW_NEAR, START_COL } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { lastBear } from "./harness";

/** The row three rows of advance puts the critter on. */
const ADVANCED_ROW = ROW_NEAR - BEAR_EMERGE_ADVANCE;

/** How long the roster is watched: far past the delay any slot can ask for. */
const WATCH_SECONDS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts the bear it emerges on the near shore", async () => {
  startCrossing(h);
  h.debug.setCritterTile(START_COL, ADVANCED_ROW);
  h.debug.setBestRow(ADVANCED_ROW);
  h.debug.setBearEmergence(true);

  const sighting = await captureReplay(h, "emerge", () =>
    h.until((snapshot) => snapshot.bears.length > 0, {
      maxFrames: ticksFor(WATCH_SECONDS),
      poll: 1,
    }),
  );

  assertTrue(sighting.hit, `a bear within ${WATCH_SECONDS} s of the advance`);
  const bear = lastBear(sighting.snapshot);
  assertEqual(bear?.row, ROW_NEAR, "the row the bear emerged on");
});
