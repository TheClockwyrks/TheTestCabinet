// hurt/flash-armed-on-contact — the tick a contact hit lands leaves `hurtFlash`
// at `HURT_FLASH`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/world.md`, Contact damage:
// "The lamplighter carries `hurtFlash`, a timer that counts down with the
// contact cooldowns in phase 7 and is set to `HURT_FLASH` on every tick on
// which a contact hit lands, whatever the number of hits that tick." The same
// section's table gives the figure: "Seconds the hurt flash runs |
// `HURT_FLASH` | `0.3`". Phase 7 counts the timer down BEFORE the hit is
// applied ("Every live enemy's `contactCooldown` and the lamplighter's
// `hurtFlash` count down, and, while `enemyContact` is on, an overlapping
// enemy whose cooldown is due hits"), so the tick that lands a hit ends with
// the timer at the full `HURT_FLASH` whatever it held going in.
//
// WHAT IS READ, AND WHY. `run.hurtFlash` off the snapshot the hit's own tick
// left. `specs/instrumentation.md` reports it in seconds, so the reading is
// the figure the specification states with no conversion.
//
// THE DRIVE. `hurt/flash.ts`'s shared pose: an isolated `playing` run holding
// one rat 20 units from the lamplighter, `enemyContact` on, and one tick. The
// rat's `contactCooldown` is `0` from the spawn and a timer at `0` is due, so
// the hit lands on that first tick.
//
// THE TOLERANCE. `REAL_EPS`. The timer is SET on this tick rather than
// counted, so a conformant build holds the literal `0.3`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HURT_FLASH, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armFlash } from "./flash";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads hurtFlash 0.3 on the tick a rat's contact hit lands", async () => {
  const armed = await armFlash(h);
  captureStill(h, "armed");

  assertNear(
    armed.run.hurtFlash,
    HURT_FLASH,
    REAL_EPS,
    "hurtFlash on the tick the contact hit landed (specs/world.md, Contact damage)",
  );
});
