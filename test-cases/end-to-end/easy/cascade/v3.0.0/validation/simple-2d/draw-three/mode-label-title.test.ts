// draw-three/mode-label-title — the title screen names this build's deal mode.
//
// THE RULE. specs/stock.md fixes this build's `DEAL_MODE_LABEL` as the literal
// `DRAW THREE`, and specs/screens.md has the title screen draw that label
// "somewhere on the screen so a player sees which deal the game is played with".
//
// THIS POINT DECIDES THE LITERAL, which is why the text is written out here rather
// than read from the build's own `src/constants.ts` or from the `dealModeLabel` the
// snapshot reports. The common `screens.title-shows-mode-label` holds the drawn text
// against what the build reports, so that point decides consistency and this one
// decides that what is reported and drawn is the label this variant plays under. A
// build that draws `DRAW ONE` on a Draw Three deal is wrong here and nowhere else.
//
// THE LABEL IS GRADED IN TWO PLACES BY TWO POINTS. The HUD's copy of it is
// `draw-three/mode-label-hud`, so a build that names the mode on one screen and not
// on the other misses one requirement rather than two.
//
// THE POSE. `reset`, then the title screen, and one frame drawn. Nothing is posed on
// the table: the label belongs to the screen rather than to any arrangement, and the
// screen is set directly rather than reached through a control, so a build with a
// broken title control fails that control's point and not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
} from "../harness";

/** The deal-mode label specs/stock.md fixes for this variant, as `DEAL_MODE_LABEL`. */
const DEAL_MODE_LABEL = "DRAW THREE";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws DRAW THREE on the title screen", async () => {
  h.debug.reset();
  h.debug.setScreen("title");

  const calls = await drawFrame(h);
  captureStill(h, "title");

  assertTrue(
    drewText(calls, DEAL_MODE_LABEL),
    `the title screen drawing the literal "${DEAL_MODE_LABEL}", this build's ` +
      "DEAL_MODE_LABEL (specs/stock.md, specs/screens.md)",
  );
});
