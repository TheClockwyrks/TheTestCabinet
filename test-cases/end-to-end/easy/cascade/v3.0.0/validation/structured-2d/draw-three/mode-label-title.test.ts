// Cascade — draw-three/mode-label-title: the title screen draws the literal DRAW THREE.
//
// specs/stock.md fixes this variant's `DEAL_MODE_LABEL` as `DRAW THREE`, and
// specs/screens.md puts that label on the title screen — "The deal-mode label is
// drawn somewhere on the screen so a player sees which deal the game is played
// with" — adding that "the literal text it names is the text that is drawn".
//
// The common item `screens.title-shows-mode-label` holds the drawn text against
// the `dealModeLabel` the build itself REPORTS, so it decides consistency: a
// build that reports `DRAW ONE` and draws `DRAW ONE` on a Draw Three run passes
// it. This point is the one that decides the literal the specification fixes,
// which is why the label is graded by both.
//
// It is also graded in two PLACES by two points — here and
// `draw-three/mode-label-hud` — so a build correct on the title screen and wrong
// in the HUD misses one requirement rather than both.
//
// The screen is opened with `setScreen` rather than left to `reset`, so a build
// whose `reset` opens on the wrong screen fails `instrumentation/reset-restores-
// title` rather than this point as well.
//
// Case is not the requirement. What the screen must carry is the words, and a
// build that draws them inside a longer run — a marker, a prefix, padding — has
// drawn the label, so the match is a case-insensitive substring of the screen's
// text rather than a run equal to it. And the text is the RUNS the screen spells
// (`drawnTextLines`) rather than its `fillText` calls: a build that
// letter-spaces the label draws it a glyph per call, and specs/stock.md fixes
// the words, not their spacing.

import { afterEach, beforeEach, it } from "vitest";
import { assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  resetTo,
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

it("draws DRAW THREE on the title screen", async () => {
  resetTo(h);
  h.debug.setScreen("title");

  const calls = await h.drawFrame();
  captureStill(h, "title");

  const drawn = drawnTextLines(calls).join(" | ").toUpperCase();
  assertMatches(drawn, DEAL_MODE_LABEL, "the text the title screen drew");
});
