// discharge/chain-propagates — the chain runs onward from each node it detonates.
//
// specs/discharge.md: "Each node the chain detonates arcs onward the same way, so
// the discharge floods through the connected cluster of charged nodes until no
// charged node stands within reach of any node it detonated."
//
// THE LINE IS SPACED AT EXACTLY `DISCHARGE_RADIUS`, so each node is inside the
// reach of the one before it and outside the reach of every node before that. The
// far end stands `4 * DISCHARGE_RADIUS` tiles from the struck node — four times
// the reach — so it can only be cleared by the chain running onward hop by hop. A
// build that arcs from the struck node alone clears the first node of the line
// and leaves the other three standing, and the failure names which hop it stopped
// at.
//
// EVERY NODE OF THE LINE IS POSED AT CHARGE 1, the lowest charge that conducts,
// so each reading separates the wrong models: detonated leaves the tile EMPTY, a
// hop that never happened leaves `1`, and an arc treated as a knock-down leaves
// `0`.
//
// THE FOUR READINGS ARE ONE POINT because they exercise one edge — the onward hop
// — the same way, four hops deep. A build that stops after any of them fails
// here and the context names the tile it stopped before.
//
// THE WORLD IS THE LINE AND A BOLT. Nothing else stands on the board, so no node
// of the line has a second route to it, and the bolt climbs the struck node's own
// column, which the rest of the line is not in.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../../src/constants";
import { assertNull, assertTrue } from "../assert";
import {
  captureReplay,
  chargeAt,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: the near end of the line. */
const STRUCK_C = 10;
const LINE_R = 6;

/** How many charged nodes stand beyond the struck one. */
const HOPS = 4;

/**
 * The line's columns, each `DISCHARGE_RADIUS` past the last.
 *
 * `[12, 14, 16, 18]`: the first is inside the struck node's own `5 x 5` block,
 * and every one after it is reachable only from the node before it.
 */
const LINE_COLUMNS = Array.from(
  { length: HOPS },
  (_, i) => STRUCK_C + DISCHARGE_RADIUS * (i + 1),
);

/** The lowest charge specs/discharge.md conducts through: "charge `1` or above". */
const CONDUCTING_CHARGE = 1;

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded. specs/discharge.md resolves "the whole
 * chain ... at the moment the bolt strikes, within the same update", so no
 * further time is given to the chain itself.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears a line of charged nodes end to end from one detonation", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, LINE_R, CHARGE_MAX);
  for (const c of LINE_COLUMNS) h.debug.setNode(c, LINE_R, CONDUCTING_CHARGE);
  poseBolt(h, STRUCK_C, LINE_R + 1);

  const swept = await captureReplay(h, "propagation", () =>
    h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_SWEEP_TICKS }),
  );

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  LINE_COLUMNS.forEach((c, i) => {
    assertNull(
      chargeAt(swept.snapshot, c, LINE_R),
      `the node at (${c}, ${LINE_R}), hop ${i + 1} of ${HOPS} along the line ` +
        `and Chebyshev ${DISCHARGE_RADIUS * (i + 1)} from the detonation`,
    );
  });
});
