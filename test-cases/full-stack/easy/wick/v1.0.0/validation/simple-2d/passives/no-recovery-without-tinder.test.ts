// passives/no-recovery-without-tinder — with no Tinder held, health does not
// climb back on its own.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder", with
// BASE_RECOVERY 0, and ("Holding a passive") "a passive not held is level 0, so
// every multiplier starts at 1, armor and amount bonus at 0, and max health and
// recovery at their base". specs/world.md ("Health and recovery") applies
// hp = min(maxHp, hp + recovery × TICK_DT) on every tick and states "`recovery`
// is in health per second and is BASE_RECOVERY with no Tinder held", so ten
// seconds of ticks leave hp exactly where it was posed.
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held, NO
// passive held, every driver switch off, and hp posed to 50, half the maxHp of
// 100 that no Tallow leaves, so there is room to climb into if a build climbs.
// Nothing else can move hp: no enemy touches the lamplighter and no heal is
// placed.
//
// WHAT IS READ. hp after 600 ticks, ten seconds of game time, still 50. The
// span is long because a build that recovers by a small fraction of a point a
// tick is only visible after many of them: at TINDER_RECOVERY_PER_LEVEL's own
// 0.5 a second, 600 ticks would have added 5.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9): the posed figure read back after a
// recovery term of exactly 0, which adds nothing whatever the arithmetic.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, ticksFor } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The health the run is posed at, well below the maximum. */
const POSED_HP = 50;

/** Ten seconds of game time, in ticks, under the timer rule. */
const SPAN = ticksFor(10);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves hp at 50 over 600 ticks with no Tinder held", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Tinder");
  h.debug.setHp(POSED_HP);

  const after = await h.tick(SPAN);
  captureStill(h, "none");

  assertWithin(
    after.run.player.hp,
    POSED_HP,
    FIGURE_TOLERANCE,
    `hp after ${SPAN} ticks with no Tinder held`,
  );
});
