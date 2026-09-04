// draw-one/mode-label-hud — the HUD draws the literal `DRAW ONE` during play.
//
// `specs/stock.md` fixes the text for this variant — "`DEAL_MODE_LABEL` | `DRAW
// ONE`" — and `specs/screens.md` fixes where the second copy of it goes:
// "`DEAL_MODE_LABEL` is drawn in the strip as well, so the deal mode is visible
// throughout play", the strip being the HUD, which "is drawn on the `playing`
// screen". `specs/screens.md` also states that "the literal text it names is the
// text that is drawn".
//
// WHY THIS IS NOT `screens/hud-shows-mode-label`. That common point holds the
// drawn text against the `dealModeLabel` the build itself REPORTS, so it decides
// consistency under both variants; this one decides the literal the
// specification fixed for THIS variant. And it is a separate point from
// `draw-one/mode-label-title` because they are separate requirements: a build
// correct on the title screen and wrong in the HUD misses one of them, not both.
//
// THE TABLE IS EMPTY BECAUSE THE HUD IS NOT ABOUT THE TABLE. `specs/screens.md`
// draws the HUD on the `playing` screen, dealt or not, so the scenario is the
// `playing` screen and nothing else: no cards, no gesture, nothing whose state
// could decide whether the label appears. Where the strip sits and what else it
// carries are `screens/hud-clear-of-piles` and `screens/title-shows-new-game`.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  drewText,
  openTable,
  type Harness,
} from "../harness";
import { DEAL_MODE_LABEL } from "./constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws DRAW ONE in the HUD during play", async () => {
  await openTable(h);

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  if (!drewText(calls, DEAL_MODE_LABEL)) {
    fail(
      `the HUD to draw ${JSON.stringify(DEAL_MODE_LABEL)}, this build's DEAL_MODE_LABEL (specs/screens.md)`,
      drawnText(calls),
    );
  }
});
