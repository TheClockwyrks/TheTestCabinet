// Refract — campaign/back-discards: back during playing discards the drawn
// beams.
//
// A real partial beam — a prefix of the spec-derived route, traced through the
// build's own rules — is on board 1 when `back` is pressed. The press must
// return to `select`, and the next entry of the same board must find it
// unchanged — the specified layout — with every beam empty
// (specs/modes/campaign.md: back during playing returns to select; the beams
// drawn on the board are discarded, and the board is unchanged the next time
// it is entered).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTruthy } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  startCampaign,
  tapAction,
  toCells,
  type Harness,
} from "../harness";
import { parseBoard } from "../notation";
import { CAMPAIGN_BOARDS } from "../routes";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to select, discards the beams, and leaves the board unchanged", async () => {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1
  assertEqual(h.snapshot().screen, "playing", "board 1 entered");

  // Draw a real partial beam: the first two cells of the spec-derived route.
  const route = CAMPAIGN_BOARDS[0].routes.triangle;
  assertTruthy(route, "board 1's triangle route exists in routes.ts");
  if (route === undefined) return;
  const prefix = toCells(route.slice(0, 2));
  h.debug.trace(prefix);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    prefix,
    "the partial beam is drawn before back is pressed",
  );

  await tapAction(h, "back");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "select",
    "back during playing returns to select",
  );

  // The next entry: the specified board, with every beam empty.
  await tapAction(h, "confirm"); // the highlight still sits on board 1
  await h.advance(1);
  captureStill(h, "discarded");

  const reentered = h.snapshot();
  assertEqual(reentered.screen, "playing", "board 1 re-entered");
  assertEqual(reentered.boardIndex, 0);
  const specified = parseBoard(CAMPAIGN_BOARDS[0].notation);
  const entered = boardFromSnapshot(reentered);
  assertEqual(entered.cols, specified.cols, "the board's cols are unchanged");
  assertEqual(entered.rows, specified.rows, "the board's rows are unchanged");
  assertDeepEqual(
    [...entered.nodes].sort((a, b) => a.row - b.row || a.col - b.col),
    [...specified.nodes].sort((a, b) => a.row - b.row || a.col - b.col),
    "the board's nodes are unchanged",
  );
  assertDeepEqual(
    reentered.beams.triangle?.cells,
    [],
    "the discarded beam is not waiting on re-entry",
  );
});
