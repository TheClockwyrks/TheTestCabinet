// draw-three/deal-mode-reported — the build reports the deal mode it plays.
//
// THE RULE. `specs/stock.md` fixes this build's deal mode in a table: `TURN_COUNT`
// is `3` and `DEAL_MODE` is `draw-three`. `specs/instrumentation.md` has
// `snapshot()` report both, `dealMode` and `turnCount`, built from those figures.
//
// THIS IS THE POINT THAT PINS THE FIGURE. The two values come from
// `./constants.ts`, which is this project's own restatement of the specification
// and never a reading off the build — an engineless run seeds no `src/` to import
// from, and a check that compared a build's constant against itself would pass a
// build that named every figure consistently and wrongly. Every COMMON validator
// that has to size itself to the deal mode reads `snapshot().turnCount` instead
// of a literal, so one common suite stays honest across both variants; that
// decomposition rests on this point deciding that the reported figure is `3`.
//
// THE POSE IS AN EMPTY TABLE IN PLAY. The deal mode is a property of the build
// rather than of an arrangement, so nothing is posed beyond the screen the
// picture is taken on.
//
// The label drawn for the mode is decided by `draw-three/mode-label-title` and
// `draw-three/mode-label-hud`; what a turn does with the count is
// `draw-three/turn-count`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";
import { DEAL_MODE, TURN_COUNT } from "./constants";

/** One frame, so the still carries the table the reading was taken on. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports draw-three and a turn count of three", async () => {
  await openTable(h);

  const snapshot = await h.snapshot();
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "mode");

  assertEqual(
    snapshot.dealMode,
    DEAL_MODE,
    "the deal-mode id the snapshot reports, this build's DEAL_MODE " +
      "(specs/stock.md)",
  );
  assertEqual(
    snapshot.turnCount,
    TURN_COUNT,
    "the turn count the snapshot reports, this build's TURN_COUNT " +
      "(specs/stock.md)",
  );
});
