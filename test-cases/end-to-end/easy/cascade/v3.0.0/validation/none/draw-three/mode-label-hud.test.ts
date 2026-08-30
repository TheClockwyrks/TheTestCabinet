// draw-three/mode-label-hud — the HUD names this build's deal mode during play.
//
// THE RULE. `specs/stock.md` fixes this build's `DEAL_MODE_LABEL` as the literal
// `DRAW THREE`, and `specs/screens.md` has the HUD carry it: "`DEAL_MODE_LABEL` is
// drawn in the strip as well, so the deal mode is visible throughout play."
//
// THIS POINT DECIDES THE LITERAL, as `draw-three/mode-label-title` does for the
// title screen. The common `screens.hud-shows-mode-label` holds the drawn text
// against the `dealModeLabel` the snapshot reports, so that point decides
// consistency and this one decides that the label this variant plays under is the
// one drawn. The two screens are two points, so a build that names the mode on the
// title screen and forgets it in the HUD misses one requirement rather than two.
//
// THE POSE. The live table, empty. The HUD is drawn on the `playing` screen
// whatever the table holds, so posing cards would add nothing the requirement
// concerns. Where within the strip the label sits is not decided here:
// `specs/screens.md` fixes a rectangle for each of the three HUD controls and none
// for the label.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
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

it("draws DRAW THREE in the HUD during play", async () => {
  await openTable(h);

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  assertTrue(
    drewText(calls, DEAL_MODE_LABEL),
    `the HUD drawing the literal "${DEAL_MODE_LABEL}" during play, this ` +
      "build's DEAL_MODE_LABEL (specs/stock.md, specs/screens.md)",
  );
});
