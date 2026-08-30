// draw-one/mode-label-title — the title screen draws the literal `DRAW ONE`.
//
// `specs/stock.md` fixes the text for this variant — "`DEAL_MODE_LABEL` | `DRAW
// ONE`", and "`DEAL_MODE_LABEL` is the text drawn on the title screen and in the
// HUD, as `specs/screens.md` states" — and `specs/screens.md` fixes where: the
// `title` screen carries a "Deal-mode label | `DEAL_MODE_LABEL` | This build's
// label", "drawn somewhere on the screen so a player sees which deal the game is
// played with". `specs/screens.md` also states that "the literal text it names is
// the text that is drawn".
//
// WHY THIS IS NOT `screens/title-shows-mode-label`. That common point holds the
// drawn label against the `dealModeLabel` the build itself REPORTS, so it decides
// consistency and it decides it under both variants. A build that played Draw One
// and called it `DRAW THREE` everywhere would satisfy it. This point is the
// literal: the specification's own text, from this directory's `constants.ts`,
// which is the only place in the project it is written down.
//
// ONE SCREEN, ONE REQUIREMENT. `draw-one/mode-label-hud` decides the same literal
// where the HUD draws it, so a build that is right on the title screen and wrong
// in the HUD misses one point rather than two. The screen is set directly rather
// than leaned on `reset` leaving it there, which is `instrumentation/reset-
// restores-title`'s requirement and not this one's.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  drewText,
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

it("draws DRAW ONE on the title screen", async () => {
  await h.debug.reset();
  await h.debug.setScreen("title");

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  if (!drewText(calls, DEAL_MODE_LABEL)) {
    fail(
      `the title screen to draw ${JSON.stringify(DEAL_MODE_LABEL)}, this build's DEAL_MODE_LABEL (specs/screens.md)`,
      drawnText(calls),
    );
  }
});
