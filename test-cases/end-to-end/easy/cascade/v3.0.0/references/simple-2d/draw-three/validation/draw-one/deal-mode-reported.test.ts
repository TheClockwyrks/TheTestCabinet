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
// The two readings are the two halves of one fact — which deal this build plays —
// and a build cannot get one right by accident while the other is wrong. What the
// build DRAWS for its deal mode is `draw-one/mode-label-title` and
// `draw-one/mode-label-hud`.
//
// THE FIGURE IS WRITTEN OUT RATHER THAN IMPORTED. `src/constants.ts` is supplied
// with the project and carries this figure already, but the figure IS this item's
// requirement, so reading it back out of the build's own module would decide the
// point against whatever the build says rather than against the specification: a
// build that edited the file it was told not to edit would report its own figure
// to a check sized by that same figure and pass. The literal is written here for
// the same reason `draw-three` writes its own, and for the reason the engineless
// suite keeps a `constants.ts` of its own. Checks that merely SIZE a scenario to
// the deal mode still read `snapshot().turnCount`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** The deal-mode id specs/stock.md fixes for this variant, as `DEAL_MODE`. */
const DEAL_MODE = "draw-one";

/** The turn count specs/stock.md fixes for this variant, as `TURN_COUNT`. */
const TURN_COUNT = 1;

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
