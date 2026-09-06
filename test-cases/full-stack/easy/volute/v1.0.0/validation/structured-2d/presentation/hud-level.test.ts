// presentation/hud-level — the HUD carries the number of the level in play.
//
// THE REQUIREMENT. `specs/ui.md` — "The HUD": "Level | The number of the level in
// play", drawn on `playing` among the six readouts the HUD carries.
//
// THE FIGURE, AND WHY IT IS 4. `specs/progression.md` gives a run five levels,
// and `specs/instrumentation.md`'s `startLevel` "Opens `level`, a whole number
// clamped to `1` through `LEVEL_COUNT` (`5`) ... The score and the cells stay as
// they are". A run opened from the title carries a score of 0 ("Poses exactly
// what the start control does: the score `0`, the cells at `CELLS` (`3`)"), so on
// a run opened straight into level 4 the only figures the HUD has to show are a
// score of 0 and a level of 4: the cells are drawn as icons rather than as a
// number, and the pressure as a gauge. Nothing else on the HUD can be showing a
// 4, which is what makes the reading unambiguous.
//
// HOW THE FIGURE IS READ. As in `presentation/hud-score`: `specs/ui.md` fixes no
// font, no layout and no copy, so the digits of each logical run the frame
// spells — the package's merge of side-by-side glyphs on one baseline back into
// the string they spell — are the figures the HUD showed. A "4" drawn beside a
// label, alone, or glyph by glyph all answer the same; a "24" or a "45" does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { drewFigure } from "./readouts";

/** The level opened: one of the five, and not the 1 a run opens on. */
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the number of the level in play", async () => {
  await startRun(h, LEVEL);
  const calls = await h.frameCalls();
  captureStill(h, "hud");

  const playing = h.snapshot();
  assertEqual(
    playing.screen,
    "playing",
    "the screen a run opened on level 4 is on",
  );
  assertEqual(playing.level, LEVEL, "the level the run opened");
  assertEqual(
    playing.score,
    0,
    "the score a run opened from the title carries",
  );

  assertTrue(drewFigure(calls, LEVEL), "the level drawn on the HUD");
});
