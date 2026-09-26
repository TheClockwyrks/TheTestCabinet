// Wick — evolutions/blaze-row: `BLAZE_STATS` is in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Blaze"), the fixed row `BLAZE_STATS`: damage `8`,
//     cooldown `2.0`, radius `70`, duration `4.0`, amount `5`.
//   - `specs/evolutions.md` ("Blaze"): "on each firing, `amount` puddles
//     appear, each centered at an independent uniformly random point of the
//     disk of radius `OIL_SCATTER` (`400`) about the player's center, each a
//     circle of `radius` that stays where it landed for `duration` seconds.
//     Blaze fires whether or not any enemy exists."
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", every radius "the fixed length times
//     `areaMul`", "duration ... used as written", and amount "the fixed amount
//     plus `amountBonus`"; with no passive held every multiplier is `1` and the
//     bonus `0` (`specs/passives.md`).
//   - `specs/state.md` (`ZoneState`): `kind` is "`puddle` for an Oil Splash or
//     Blaze puddle" and a puddle's `ttl` is "its `duration`";
//     `specs/world.md` ("One tick"), phase 6: only a zone "that existed before
//     this tick" counts its `ttl` down, so a puddle reads `4.0` after its
//     firing tick.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", floored at `MIN_COOLDOWN` (`0.2`),
//     which `2.0` clears.
//
// WHAT IS READ. After the firing tick: the count of Blaze puddles, `5`, each of
// kind `puddle` with radius 70, damage 8, and `ttl` 4.0; and Blaze's timer,
// 2.0. Every figure of the row is asserted, so a build whose fixed row departs
// from the specification in any column fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Blaze alone, no passive held, nothing on the
// field, every driver switch but `weaponFire` off. Blaze needs no target, so
// the empty field costs the reading nothing and every puddle is still in
// `zones` with the figures it was created with.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, `ttl`, and the timer, each a
// stated figure read back as a double. None on the count or the kind.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { BLAZE_STATS, FIGURE_TOLERANCE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armEvolved, assertTimerAfterFiring } from "./evolved";
import { blazePuddles } from "./blaze";

/** Blaze's fixed row. */
const ROW = BLAZE_STATS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 5 puddles of radius 70 with damage 8 and ttl 4.0 and sets the timer to 2.0", async () => {
  const { slot } = armEvolved(h, "blaze");

  const after = await h.tick(1);
  captureStill(h, "row");

  const puddles = blazePuddles(after);
  assertEqual(
    puddles.length,
    ROW.amount,
    "Blaze puddles after the firing tick",
  );
  for (const puddle of puddles) {
    const which = `puddle ${puddle.id}`;
    assertEqual(puddle.kind, "puddle", `${which}: kind`);
    assertWithin(
      puddle.radius,
      ROW.radius,
      FIGURE_TOLERANCE,
      `${which}: radius`,
    );
    assertWithin(
      puddle.damage,
      ROW.damage,
      FIGURE_TOLERANCE,
      `${which}: damage`,
    );
    assertWithin(
      puddle.ttl ?? Number.NaN,
      ROW.duration,
      FIGURE_TOLERANCE,
      `${which}: ttl on the tick it was created`,
    );
  }
  assertTimerAfterFiring(
    after,
    slot,
    ROW.cooldown,
    "Blaze's timer after the firing tick",
  );
});
