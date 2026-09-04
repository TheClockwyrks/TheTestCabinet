// presentation/readouts-clear-of-the-board — the readouts sit clear of the
// board.
//
// specs/ui.md "playing": inside the board's extent the screen draws only the
// board — its cells, the nodes with whatever readout a node itself carries, and
// the beams — and every other element of the screen sits clear of that extent,
// the mode's own readouts and the two controls included. specs/board.md gives
// the extent: cell centers spanning x 352..928 and y 152..632 on the largest
// board, with every node's form inside NODE_R of its center. So on a posed 7x6
// board, in each mode, every text run the frame draws must bound outside that
// widened box (`BOARD_EXTENT`), or it overlaps a node or a beam on the largest
// board a player can be handed.
//
// The posed board is GEO_7X6, which carries no crystal on purpose: a crystal
// shows its charge count, which a build may legitimately draw as a numeral at
// the crystal's own cell, and that numeral is a readout the node itself carries
// — the one thing specs/ui.md leaves inside the extent. Each run's box is measured in the page under the font in
// force at its draw (see text-bounds.ts), so the reading is of the run's real
// extent rather than its anchor alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { BOARD_EXTENT } from "../constants";
import { GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  startCascade,
  type Harness,
} from "../harness";
import { measuredTextBounds, type TextBox } from "./text-bounds";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every measured run bounds outside the widened extent of the largest board. */
function assertClearOfBoard(boxes: TextBox[], mode: string): void {
  // The playing screen always has text to place: the key bound to `clear` is
  // named on screen there (specs/ui.md), so a frame with no text at all is a
  // build this item cannot be read on, not a pass.
  assertGreaterThan(
    boxes.length,
    0,
    `${mode} playing draws text (specs/ui.md names the clear key on screen)`,
  );
  for (const box of boxes) {
    const clear =
      box.x1 < BOARD_EXTENT.x0 ||
      box.x0 > BOARD_EXTENT.x1 ||
      box.y1 < BOARD_EXTENT.y0 ||
      box.y0 > BOARD_EXTENT.y1;
    if (!clear) {
      fail(
        `text bounds outside the board's extent x ${BOARD_EXTENT.x0}..${BOARD_EXTENT.x1}, ` +
          `y ${BOARD_EXTENT.y0}..${BOARD_EXTENT.y1} (${mode} playing: ${JSON.stringify(box.text)})`,
        `x ${box.x0.toFixed(1)}..${box.x1.toFixed(1)}, y ${box.y0.toFixed(1)}..${box.y1.toFixed(1)}`,
      );
    }
  }
}

it("keeps every campaign playing text run outside the 7x6 board's extent", async () => {
  // A fresh game rests in campaign mode (specs/instrumentation.md), so the
  // posed board plays under the campaign's own readouts.
  await loadBoard(h, GEO_7X6);
  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "campaign", "the posed board plays in campaign");

  const boxes = await measuredTextBounds(h, await h.frameCalls());
  assertClearOfBoard(boxes, "campaign");
});

it("keeps every cascade playing text run outside the 7x6 board's extent", async () => {
  // Enter the sequence as its menu item does, then pose the largest board
  // under the cascade's readouts — the solved count and the tier.
  await startCascade(h);
  await loadBoard(h, GEO_7X6);
  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "cascade", "the posed board plays in cascade");

  await captureStill(h, "playing");
  const boxes = await measuredTextBounds(h, await h.frameCalls());
  assertClearOfBoard(boxes, "cascade");
});
