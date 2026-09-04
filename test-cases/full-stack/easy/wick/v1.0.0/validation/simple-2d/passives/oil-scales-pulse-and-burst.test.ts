// passives/oil-scales-pulse-and-burst — Oil shortens Halo's pulse interval and
// Flare's burst interval, the two weapons whose table cooldown is not a firing
// delay.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Cooldown"): "For Halo and
// Corona the table `cooldown` is the pulse interval of the aura, and for Flare
// it is the interval between bursts; both scale the same way", the same way
// being "the table cooldown times `cooldownMul`, floored at MIN_COOLDOWN
// (0.2)". With OIL_COOLDOWN_PER_LEVEL 0.08, Oil 5 gives cooldownMul 0.6. Row 1
// of HALO_LEVELS gives cooldown 1.00 and row 1 of FLARE_LEVELS gives 60
// (specs/weapons.md), so the two timers read 1.00 × 0.6 = 0.6 and 60 × 0.6 =
// 36, both above the floor.
//
// THE WORLD. An isolated playing run: nothing on the field, Oil at level 5 in
// the first passive slot, Halo and Flare held at level 1 with both timers at 0,
// and every driver switch off but weaponFire. Neither weapon needs a target
// ("Halo pulses on the first `playing` tick it is held"; "Flare fires whether
// or not any enemy exists"), so no enemy is posed and nothing can hit anything.
//
// WHAT IS READ. Each weapon's timer after the tick it acted on, beside the
// aura Halo placed and the burst Flare left, so the timers are read after a
// real pulse and a real burst rather than off an untouched pose.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each timer, a product of two stated
// figures read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  FLARE_LEVELS,
  HALO_LEVELS,
  cooldownFor,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armAll, holdPassives, slotOf, timerOf } from "./night";

/** The passives held: Oil at level 5. */
const HELD: HeldPassives = { oil: 5 };

/** The level both weapons are held at: row 1 of each table. */
const LEVEL = 1;

/** max(0.2, 1.00 × 0.6) = 0.6, the aura's pulse interval. */
const PULSE = cooldownFor(HALO_LEVELS[LEVEL - 1].cooldown, HELD);

/** max(0.2, 60 × 0.6) = 36, the interval between bursts. */
const BURST = cooldownFor(FLARE_LEVELS[LEVEL - 1].cooldown, HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets Halo's timer to 0.6 and Flare's to 36 with Oil 5 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const slots = armAll(h, [
    ["halo", LEVEL],
    ["flare", LEVEL],
  ]);

  const after = await h.tick(1);
  captureStill(h, "intervals");

  assertLength(zonesOfKind(after, "aura"), 1, "auras after the pulsing tick");
  assertLength(zonesOfKind(after, "burst"), 1, "bursts after the firing tick");
  assertWithin(
    timerOf(after, slotOf(slots, "halo")),
    PULSE,
    FIGURE_TOLERANCE,
    "Halo's timer after its pulse with Oil 5 held",
  );
  assertWithin(
    timerOf(after, slotOf(slots, "flare")),
    BURST,
    FIGURE_TOLERANCE,
    "Flare's timer after its burst with Oil 5 held",
  );
});
