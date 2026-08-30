// draw-one/deal-mode-reported — the build reports the deal mode it was seeded for.
//
// THE RULE. specs/stock.md fixes this build's deal mode: `DEAL_MODE` is
// `draw-one` and `TURN_COUNT` is `1`. specs/instrumentation.md has the snapshot
// carry both, built at the call from those figures, as `dealMode` and `turnCount`.
//
// WHY THE POINT EXISTS AT ALL. Every check in this project that has to size a
// scenario to the deal mode reads `snapshot().turnCount` rather than writing `1`,
// so one common suite stays honest across both variants. This is the point that
// pins that reading to the specification: a build reporting `3` would satisfy
// every common check that trusted the reading and fail here, which is exactly
// where the fault belongs.
//
// THE FIGURES ARE THE SEEDED ONES. `src/constants.ts` is supplied with the
// project and not edited by the build, and it carries specs/stock.md's table
// verbatim, so importing `DEAL_MODE` and `TURN_COUNT` from it reads back the
// figure the build was handed rather than a literal restated here.
//
// The two readings are the two halves of one fact — which deal this build plays —
// and a build cannot get one right by accident while the other is wrong. What the
// build DRAWS for its deal mode is `draw-one/mode-label-title` and
// `draw-one/mode-label-hud`.

import { afterEach, beforeEach, it } from "vitest";
import { DEAL_MODE, TURN_COUNT } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports draw-one and a turn count of one", async () => {
  // An empty table in live play: the reading is of the build's own figures and
  // concerns no card, so no card is posed.
  openTable(h);

  await h.advance(1);
  captureStill(h, "mode");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.dealMode,
    DEAL_MODE,
    "snapshot().dealMode, this build's DEAL_MODE (specs/stock.md)",
  );
  assertEqual(
    snapshot.turnCount,
    TURN_COUNT,
    "snapshot().turnCount, the cards one turn of the stock moves " +
      "(specs/stock.md)",
  );
});
