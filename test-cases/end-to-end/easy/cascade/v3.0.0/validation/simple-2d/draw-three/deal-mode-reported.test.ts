// draw-three/deal-mode-reported — the build reports the deal mode it plays.
//
// THE RULE. specs/stock.md fixes this build's deal mode in a table: `TURN_COUNT` is
// `3` and `DEAL_MODE` is `draw-three`. specs/instrumentation.md has `snapshot()`
// report both, `dealMode` and `turnCount`, built from those figures.
//
// THIS IS THE POINT THAT PINS THE FIGURE. The two literals are written out here
// rather than read from the build's own `src/constants.ts`, because this is the one
// check that holds the reported deal mode against the specification. Every common
// validator that has to size itself to the deal mode reads `snapshot().turnCount`
// instead of a literal, so one common suite stays honest across both variants; that
// decomposition rests on this point deciding that the reported figure is `3`.
//
// THE POSE IS AN EMPTY TABLE IN PLAY. The deal mode is a property of the build, not
// of an arrangement, so nothing is posed beyond the screen the picture is taken on.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports draw-three and a turn count of three", async () => {
  openTable(h);

  const snapshot = h.snapshot();
  await h.advance(1);
  captureStill(h, "mode");

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
