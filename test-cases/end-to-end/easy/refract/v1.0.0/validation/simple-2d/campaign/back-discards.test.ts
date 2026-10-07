// Refract — campaign/back-discards: back during playing discards the drawn
// beams.
//
// Board 1 is entered and a real segment is drawn on it — the first hop of the
// route routes.ts precomputed from specs/campaign-boards.md, a permitted move
// that does not solve the board — then one real back must return to select,
// and the board re-entered must show nothing of it: every beam empty and the
// board's own layout untouched, held against the authoritative notation
// (specs/modes/campaign.md "back during playing returns to select. The beams
// drawn on the board are discarded, and the board is unchanged the next time
// it is entered").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCampaign,
  tapAction,
  traceRoute,
  type Harness,
} from "../harness";
import { boardToNotation } from "../notation";
import { CAMPAIGN_BOARDS } from "../routes";
import { assertBeamsEmpty } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("backing out discards the beams and leaves the board unchanged", async () => {
  await resetTo(h);
  await startCampaign(h);
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "board 1 entered off the grid");

  const route = CAMPAIGN_BOARDS[0].routes.triangle;
  if (route === undefined) {
    return fail("a triangle route for course board 1 in routes.ts", undefined);
  }
  traceRoute(h, route.slice(0, 2));
  assertLength(
    h.snapshot().beams.triangle?.cells ?? [],
    2,
    "one drawn segment on the board, waiting to be discarded",
  );

  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "select",
    "back during playing returns to select (specs/modes/campaign.md)",
  );

  await tapAction(h, "confirm");
  captureStill(h, "discarded");

  const reentered = h.snapshot();
  assertEqual(
    reentered.screen,
    "playing",
    "board 1 entered again after the back",
  );
  assertEqual(reentered.boardIndex, 0, "the board re-entered is board 1");
  assertBeamsEmpty(reentered, "the beams drawn before the back are discarded");
  assertEqual(
    boardToNotation(oracleBoard(reentered)),
    CAMPAIGN_BOARDS[0].notation,
    "the board is unchanged the next time it is entered " +
      "(specs/modes/campaign.md)",
  );
});
