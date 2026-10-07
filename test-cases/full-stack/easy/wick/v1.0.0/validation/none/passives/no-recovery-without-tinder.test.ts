// Wick — passives/no-recovery-without-tinder: with no Tinder held, `hp` does
// not recover.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder`" with
// `BASE_RECOVERY` (`0`), and "a passive not held is level `0`, so every
// multiplier starts at `1`, armor and amount bonus at `0`, and max health and
// recovery at their base". `specs/world.md` ("Health and recovery") applies
// `hp = min(maxHp, hp + recovery × TICK_DT)` "On every tick, before contact
// damage is applied", and "`recovery` is in health per second and is
// `BASE_RECOVERY` with no Tinder held". So `hp` posed to `50` reads `50` after
// any number of ticks.
//
// THE POSE. An isolated night with no passive held and `hp` posed to `START`
// (`50`) through `setHp`, then `DRIVE` (`600`) ticks, ten seconds of game time,
// which the smallest Tinder level would carry to `55`. Every faculty stays
// held, nothing is alive to hit back, and nothing is collected, so no rule but
// recovery could move `hp` at all.
//
// TOLERANCE. `FLOAT_TOL` on the reading: `hp` is untouched, so it is the posed
// figure exactly. A build recovering at the smallest Tinder level is five whole
// units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  player,
  type Harness,
} from "../harness";

/** The health the run is posed at, well under the maximum. */
const START = 50;

/** Ten seconds of game time. */
const DRIVE = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hp 50 after ten seconds with no Tinder held", async () => {
  const opened = await isolate(h);
  assertEqual(opened.run.passives?.length, 0, "the passives held");
  await h.debug.setHp(START);

  const later = await h.step(DRIVE);
  await captureStill(h, "none");

  assertNear(
    player(later).hp,
    START,
    FLOAT_TOL,
    "hp after ten seconds with no Tinder held",
  );
});
