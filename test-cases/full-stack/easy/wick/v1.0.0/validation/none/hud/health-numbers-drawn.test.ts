// hud/health-numbers-drawn — the health numbers are drawn beside the bar.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Health | A bar
// whose filled width scales with `hp / maxHp`, with both numbers beside it, `hp`
// rounded up to a whole number". This point decides the numbers; the bar's
// scaling is `hud/health-bar-scales`.
//
// THE FIGURES, AND WHY THEY CANNOT BE ANYTHING ELSE ON THE HUD. One Tallow is
// held, so `maxHp` is `BASE_MAX_HP` (`100`) `+ TALLOW_HP_PER_LEVEL` (`15`)
// `x 1`, the formula `specs/instrumentation.md` states under "Snapshot shape",
// and the health is posed at a whole `73`, which "rounded up to a whole number"
// leaves at `73`. Nothing else the HUD carries on this night shows either
// figure: the night is posed at the harness's level with no kills, an empty
// world, and the clock at `0:02`.
//
// HOW A FIGURE IS READ. `specs/ui.md` fixes no font, no layout, and no copy, so a
// build may draw `73 / 115` in one call, draw the parts separately, or lay each
// glyph down on its own, and all three are the same picture to a player. The runs
// of text the frame drew are grouped into the lines they landed on and the words
// their spacing makes, and a figure is a maximal run of digits in some word, so a
// readout of `73` answers and one reading `173` does not.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_MAX_HP, TALLOW_HP_PER_LEVEL } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
} from "../harness";
import { drewFigure } from "./readouts";
import { drawnCalls, poseNight } from "./stage";

/** The Tallow held, which lifts `maxHp` off its base. */
const TALLOW_LEVEL = 1;

/** `BASE_MAX_HP + TALLOW_HP_PER_LEVEL x 1`. */
const MAX_HP = BASE_MAX_HP + TALLOW_HP_PER_LEVEL * TALLOW_LEVEL;

/** The health posed: a whole number, so what is drawn is that number. */
const HP = 73;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the health and the maximum health beside the bar", async () => {
  await poseNight(h);
  await holdPassive(h, "tallow", TALLOW_LEVEL);
  await h.debug.setHp(HP);

  const calls = await drawnCalls(h);
  await captureStill(h, "numbers");

  const posed = await h.snapshot();
  assertEqual(
    posed.run.maxHp,
    MAX_HP,
    `maxHp with one Tallow held, which is the figure the HUD has to show`,
  );
  assertEqual(posed.run.player.hp, HP, "the health posed");
  assertTrue(drewFigure(calls, HP), `the health ${HP} drawn on the HUD`);
  assertTrue(
    drewFigure(calls, MAX_HP),
    `the maximum health ${MAX_HP} drawn on the HUD`,
  );
});
