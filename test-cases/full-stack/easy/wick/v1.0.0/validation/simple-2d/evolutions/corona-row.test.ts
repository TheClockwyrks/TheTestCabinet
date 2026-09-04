// Wick — evolutions/corona-row: `CORONA_STATS` is in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Corona"), the fixed row `CORONA_STATS`: damage
//     `12`, cooldown `0.5`, radius `150`, "where the cooldown is the pulse
//     interval".
//   - `specs/evolutions.md` ("Corona"): "Corona is Halo's aura: one zone of
//     kind `aura`, a circle of `radius` centered on the player's center every
//     tick, its `radius` and `damage` recomputed on every tick ... Corona
//     pulses on its first tick and on every tick its cooldown timer is due;
//     each pulse deals `damage` to every enemy whose circle overlaps the aura".
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", radius "the fixed length times `areaMul`", and
//     cooldown "the fixed cooldown times `cooldownMul`, floored at
//     `MIN_COOLDOWN` (`0.2`)"; with no passive held every multiplier is `1`
//     (`specs/passives.md`), and `0.5` clears the floor.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`"; a rat has HP `15` and radius `12`
//     (`specs/enemies.md`), so it survives one pulse of 12 and its hp shows the
//     figure exactly. A moth's `5` health could not: any pulse of 5 or more
//     kills it, and a killed probe reports no figure.
//   - `specs/weapons.md` ("Cooldown timers"): the pulse sets "the timer ... to
//     the current cooldown"; `specs/world.md` ("One tick"), phase 5 counts the
//     timer down and pulses within the same tick, so the reading after that
//     tick is the freshly set figure.
//
// WHAT IS READ. After the pulse tick: the one aura's `radius` and `damage`, 150
// and 12; the rat's `hp`, 15 − 12 = 3; and Corona's timer, 0.5. Every figure of
// the row is asserted, so a build whose fixed row departs from the
// specification in any column fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Corona alone, no passive held, one rat 40
// units along `+x` inside the fixed radius, every driver switch but
// `weaponFire` off, so the zone the tick creates is the aura alone, every
// figure read is the fixed row's unscaled, and the pulse is the only thing that
// can touch the rat.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each figure: a stated figure, a
// stated figure times a multiplier of 1, or an exact difference of two stated
// figures, read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { CORONA_STATS, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved, assertTimerAfterFiring, assertTook } from "./evolved";
import { PROBE_DX, theAura } from "./corona";

/** Corona's fixed row. */
const ROW = CORONA_STATS;

/** The probe: a rat, HP 15 and radius 12, which a pulse of 12 leaves alive. */
const PROBE = "rat";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 150 and damage 12, removes 12 from the rat, and sets the timer to 0.5", async () => {
  const { slot } = armEvolved(h, "corona");
  const rat = spawnEnemyNear(h, PROBE, PROBE_DX, 0);
  enable(h, "weaponFire");
  const posed = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "row");

  const aura = theAura(after, "after the pulse tick");
  assertWithin(aura.radius, ROW.radius, FIGURE_TOLERANCE, "the aura's radius");
  assertWithin(aura.damage, ROW.damage, FIGURE_TOLERANCE, "the aura's damage");
  assertTook(posed, after, rat, ROW.damage, "the rat after the pulse");
  assertTimerAfterFiring(
    after,
    slot,
    ROW.cooldown,
    "Corona's timer after the pulse",
  );
});
