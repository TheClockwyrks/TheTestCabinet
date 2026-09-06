// Cascade — draw-three/mode-label-hud: the HUD draws the literal DRAW THREE during play.
//
// specs/stock.md fixes this variant's `DEAL_MODE_LABEL` as `DRAW THREE`, and
// specs/screens.md, The HUD: "`DEAL_MODE_LABEL` is drawn in the strip as well, so
// the deal mode is visible throughout play."
//
// The companion to `draw-three/mode-label-title`. The label is graded in two
// PLACES by two points, so a build that names the deal on its title screen and
// forgets it during play — the far more common miss, since the title screen is
// written once and the HUD is drawn every frame — misses exactly one requirement.
// The common item `screens.hud-shows-mode-label` decides that whatever is drawn
// during play agrees with the `dealModeLabel` the build reports; this point
// decides the literal the specification fixes for this variant.
//
// The reading is taken during play on an empty table, which is where the HUD is
// drawn (specs/screens.md, `playing`) and where the title screen's own copy of
// the label is not, so the only run of text that can satisfy this check is the
// one the HUD drew. Nothing is dealt: the label is drawn throughout play whatever
// the table holds, and a build whose deal threw would otherwise fail this point
// for another point's fault.
//
// Case is not the requirement, and neither is the run the label sits in: a build
// that draws it with a prefix or a separator has drawn the label, so the match is
// a case-insensitive substring of the frame's text. And the text is the RUNS the
// frame spells (`drawnTextLines`) rather than its `fillText` calls: a build that
// letter-spaces the label draws it a glyph per call, and specs/stock.md fixes
// the words, not their spacing.

import { afterEach, beforeEach, it } from "vitest";
import { assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  openTable,
  type Harness,
} from "../harness";
import { DEAL_MODE_LABEL } from "./constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws DRAW THREE in the HUD during play", async () => {
  openTable(h);

  const calls = await h.drawFrame();
  captureStill(h, "hud");

  const drawn = drawnTextLines(calls).join(" | ").toUpperCase();
  assertMatches(drawn, DEAL_MODE_LABEL, "the text the playing screen drew");
});
