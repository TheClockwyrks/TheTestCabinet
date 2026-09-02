// hud/health-numbers-drawn — the HUD carries the health as two numbers.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Health | A bar
// whose filled width scales with `hp / maxHp`, with both numbers beside it, `hp`
// rounded up to a whole number." This point is about the two NUMBERS; the bar is
// `hud/health-bar-scales`.
//
// THE FIGURES, AND WHY THEY ARE 73 AND 115. `specs/instrumentation.md` derives
// `maxHp` as "`BASE_MAX_HP` (`100`) `+ TALLOW_HP_PER_LEVEL` (`15`) `×` the Tallow
// level held", so one level of Tallow makes the maximum `115`, and `73` is a
// whole health under it that no other readout on the HUD can be showing. On an
// isolated run the level is posed high and its experience is `0`, the kill count
// is `0`, and the clock reads `0:00`, so neither `73` nor `115` appears anywhere
// but the health readout. The health is posed to a whole number so the rounding
// rule leaves it as it stands and this point turns on the numbers alone.
//
// HOW A FIGURE IS READ. `specs/ui.md` fixes no font, no layout, and no copy, so
// a build may draw the readout as one run of text, as a run per part, or one
// call per glyph, and all three are the same picture to a player. `hud/readouts`
// therefore groups the runs a frame laid down into the words their spacing makes
// and takes the maximal runs of digits in each as the figures the HUD showed:
// `73 / 115`, `HP 73`, and a `73` drawn glyph by glyph all answer the same, and
// a `173` or a `730` does not.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_MAX_HP, TALLOW_HP_PER_LEVEL } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { drewFigure } from "./readouts";

/** The Tallow level held, which raises the maximum by `TALLOW_HP_PER_LEVEL`. */
const TALLOW_LEVEL = 1;

/** The maximum health the posed loadout derives, and the health posed under it. */
const MAX_HP = BASE_MAX_HP + TALLOW_HP_PER_LEVEL * TALLOW_LEVEL;
const HP = 73;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the health as two numbers", async () => {
  isolate(h);
  holdPassive(h, "tallow", TALLOW_LEVEL);
  h.debug.setHp(HP);

  const calls = await h.frameCalls();
  captureStill(h, "numbers");

  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the posed run is on");
  assertEqual(
    posed.run.maxHp,
    MAX_HP,
    "the maximum health the loadout derives",
  );
  assertEqual(posed.run.player.hp, HP, "the health the run holds");

  assertTrue(drewFigure(calls, HP), `the health ${HP} drawn on the HUD`);
  assertTrue(
    drewFigure(calls, MAX_HP),
    `the maximum ${MAX_HP} drawn on the HUD`,
  );
});
