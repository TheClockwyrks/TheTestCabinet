// passives/tinder-recovery-per-tick — Tinder recovers health continuously,
// `TINDER_RECOVERY_PER_LEVEL` per second per level, applied on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `TINDER_RECOVERY_PER_LEVEL` is `0.5`, and
// "recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder", with
// `BASE_RECOVERY` (`0`), so Tinder 2 recovers `1` health per second. The
// Recovery section applies it tick by tick: "On every tick of the `playing`
// screen: `hp = min(maxHp, hp + recovery × TICK_DT)` ... Recovery is
// continuous rather than periodic." So from `hp` `50` one tick reads
// `50 + 1 / 60` and sixty ticks read `51`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Tinder 2 alone,
// with `hp` posed to `50`, half the `100` maximum Tinder does not change, so
// no cap intervenes across the whole second (`recovery-caps-at-max-hp` is
// where the cap is decided). Every driver switch is off, so no contact hit, no
// heal, and no weapon touches `hp`; the only thing moving it is the recovery
// step of phase 3 (`specs/world.md`, One tick). Every tick of the second is
// read, so a build that recovered once a second rather than once a tick fails
// on the first reading.
//
// THE TOLERANCE. `REAL_EPS` on each tick's reading, `50` plus a whole number
// of `1 / 60` steps; sixty such additions carry a floating error far below it,
// and a build recovering periodically is a sixtieth of a unit out at once.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { REAL_EPS, TICK_DT, TICK_HZ, recoveryOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** The Tinder level held: `recovery` `1` health per second. */
const TINDER = 2;

/** Health per second under Tinder 2. */
const RECOVERY = recoveryOf(TINDER);

/** The health posed before the second: half the maximum, far from the cap. */
const POSED_HP = 50;

/** One second of game time. */
const TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("recovers 1 / 60 health a tick under Tinder 2 and reaches 51 over a second", async () => {
  isolate(h);
  holdPassive(h, "tinder", TINDER);
  h.debug.setHp(POSED_HP);

  await captureReplay(h, "recovery", async () => {
    for (let tick = 1; tick <= TICKS; tick += 1) {
      const s = await advanceTicks(h, 1);
      assertNear(
        s.run.player.hp,
        POSED_HP + RECOVERY * TICK_DT * tick,
        REAL_EPS,
        `hp after tick ${tick} of the second under Tinder 2 (specs/passives.md, Recovery)`,
      );
    }
  });

  assertNear(
    h.snapshot().run.player.hp,
    POSED_HP + RECOVERY,
    REAL_EPS,
    "hp after one second under Tinder 2 (specs/passives.md, Recovery)",
  );
});
