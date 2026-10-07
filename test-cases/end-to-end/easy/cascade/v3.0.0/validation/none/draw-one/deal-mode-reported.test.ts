// draw-one/deal-mode-reported — the build reports the deal mode it was asked to
// play: `dealMode` is `"draw-one"` and `turnCount` is `1`.
//
// `specs/stock.md` fixes the two figures for this variant — "`TURN_COUNT` | `1`"
// and "`DEAL_MODE` | `draw-one`" — and `specs/instrumentation.md` fixes where
// they are read: "`dealMode`, `turnCount`, `dealModeLabel` | The deal-mode
// figures `specs/stock.md` fixes."
//
// WHY THIS POINT EXISTS AT ALL, GIVEN THE OTHER FIVE. It is the anchor the whole
// COMMON suite hangs off. A common check never hard-codes a turn count: where a
// common scenario has to size itself to the deal mode it reads
// `snapshot().turnCount`, which makes those checks self-consistent rather than
// correct. This is the one point that holds that reading against the
// specification's own literal, so a build that turned two cards and reported
// `turnCount: 2` fails HERE rather than passing the common suite by agreeing with
// itself. `draw-one/turn-count` decides the other side of the same pairing — that
// the build's behaviour matches its figure — and the two together are what pin
// the deal.
//
// It reads the reported figures and nothing else. The LABEL is a separate
// requirement, graded by `draw-one/mode-label-title` and
// `draw-one/mode-label-hud` where it is drawn, and by
// `screens/title-shows-mode-label` and `screens/hud-shows-mode-label` for
// agreeing with what is reported.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";
import { DEAL_MODE, TURN_COUNT } from "./constants";

/** One frame, so the still shows the table the figures were read from. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports draw-one and a turn count of one", async () => {
  await openTable(h);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "mode");

  const state = await h.snapshot();

  assertEqual(state.dealMode, DEAL_MODE, "the deal mode the build reports");
  assertEqual(state.turnCount, TURN_COUNT, "the turn count the build reports");
});
