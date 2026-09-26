// Refract — campaign/back-discards: back during playing discards the drawn
// beams.
//
// specs/modes/campaign.md, leaving a board: "back during playing returns to
// select. The beams drawn on the board are discarded, and the board is
// unchanged the next time it is entered." A partial beam is really drawn on
// board 1 — two cells of the route the case precomputed from the notation —
// then back is pressed, and the board re-entered: the screen must be select
// in between, the beams empty on re-entry, and the board itself the same
// layout it was.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  fireAction,
  startCampaign,
  traceRoute,
  type Harness,
} from "../harness";
import { CAMPAIGN_BOARDS } from "../routes";
import { plainNodes } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to select, discards the beams, and leaves the board unchanged", async () => {
  await startCampaign(h);
  await fireAction(h, "confirm"); // board 1, unlocked from the start
  const first = await h.snapshot();
  assertEqual(first.screen, "playing", "board 1 opens for the partial draw");
  const entered = boardFromSnapshot(first);

  // Draw one real segment of board 1's solution, then abandon the board.
  const route = CAMPAIGN_BOARDS[0].routes.triangle;
  if (route === undefined) {
    fail(
      "board 1's precomputed triangle route",
      Object.keys(CAMPAIGN_BOARDS[0].routes),
    );
  }
  await traceRoute(h, route.slice(0, 2));
  const drawn = await h.snapshot();
  assertEqual(
    drawn.beams.triangle?.cells.length,
    2,
    "a partial beam is on the board before back",
  );

  await fireAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back during playing returns to select",
  );

  // Re-enter: every beam empty, the board exactly as it was.
  await fireAction(h, "confirm");
  await captureStill(h, "discarded");
  const again = await h.snapshot();
  assertEqual(again.screen, "playing", "board 1 reopens");
  assertEqual(again.boardIndex, 0, "the board re-entered is board 1");
  for (const [channel, beam] of Object.entries(again.beams)) {
    assertDeepEqual(beam.cells, [], `${channel}'s drawn beam was discarded`);
  }
  assertEqual(again.board.cols, entered.cols, "the board's cols are unchanged");
  assertEqual(again.board.rows, entered.rows, "the board's rows are unchanged");
  assertDeepEqual(
    plainNodes(boardFromSnapshot(again)),
    plainNodes(entered),
    "the board is unchanged the next time it is entered",
  );
});
