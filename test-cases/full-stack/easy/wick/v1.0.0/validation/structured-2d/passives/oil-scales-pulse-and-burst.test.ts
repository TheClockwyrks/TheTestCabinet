// passives/oil-scales-pulse-and-burst — Oil shortens Halo's pulse interval and
// Flare's burst interval, both of which are the weapon's table cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Cooldown: "For Halo and
// Corona the table `cooldown` is the pulse interval of the aura, and for Flare
// it is the interval between bursts; both scale the same way", over
// "cooldown = max(MIN_COOLDOWN, table cooldown × cooldownMul)" with
// `cooldownMul = 1 − 0.08 × oil`, which is `0.6` at Oil 5. Halo's level-1 row
// gives `cooldown` `1.00` and Flare's gives `60` (`specs/weapons.md`), so the
// two timers read `0.6` and `36`, both above `MIN_COOLDOWN` (`0.2`).
//
// WHEN THE TIMERS ARE READ. On the tick each weapon fires, after the set:
// "After firing, the timer is set to the weapon's current cooldown"
// (`specs/weapons.md`, Cooldown timers). Halo "pulses on the first `playing`
// tick it is held" and Flare's timer is armed to `0`, so one tick sets both.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Oil 5, Halo at
// level 1, and Flare at level 1, with no enemy at all: neither weapon needs a
// target (`specs/weapons.md`, Targeting summary), and with nothing alive the
// aura's pulse and the burst hit nothing, so the tick sets two timers and
// changes nothing else. Every driver switch but `weaponFire` stays off.
//
// THE TOLERANCE. `REAL_EPS` on each timer, one table figure times one
// multiplier; the unscaled figures, `1.0` and `60`, are far outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLARE_LEVELS, HALO_LEVELS, REAL_EPS, cooldownOf } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder, timerOf } from "./firing";

/** The Oil level held: `cooldownMul` `0.6`. */
const OIL = 5;

/** The pulse interval Halo's level-1 `1.00` becomes under Oil 5: `0.6`. */
const PULSE = cooldownOf(HALO_LEVELS[0].cooldown, OIL);

/** The burst interval Flare's level-1 `60` becomes under Oil 5: `36`. */
const BURST = cooldownOf(FLARE_LEVELS[0].cooldown, OIL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets Halo's timer to 0.6 and Flare's to 36 under Oil 5", async () => {
  const firing = await fireUnder(h, {
    passives: [["oil", OIL]],
    weapons: [
      ["halo", 1],
      ["flare", 1],
    ],
  });
  captureStill(h, "intervals");

  assertNear(
    timerOf(firing, "halo"),
    PULSE,
    REAL_EPS,
    "Halo's timer after its first pulse under Oil 5 (specs/passives.md, Cooldown)",
  );
  assertNear(
    timerOf(firing, "flare"),
    BURST,
    REAL_EPS,
    "Flare's timer after its first burst under Oil 5 (specs/passives.md, Cooldown)",
  );
});
