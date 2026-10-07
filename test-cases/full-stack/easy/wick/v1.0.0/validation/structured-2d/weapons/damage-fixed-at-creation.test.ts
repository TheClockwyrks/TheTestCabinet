// weapons/damage-fixed-at-creation — a shape's damage is fixed when it is
// created.
//
// THE SPEC LINE. `specs/weapons.md`, "Hits and death": "A shape's damage per
// hit is fixed when the shape is created, from the level and `damageMul` in
// force on that tick, with one exception: the aura of Halo or Corona and each
// Chandelier lantern have their damage recomputed on every tick, with their
// radius. A Wick level gained later leaves every other live shape's damage as
// it was." An Oil Splash puddle is such a shape: posed with no Wick held it
// carries the level-1 row's damage `4` ("Oil Splash"; `spawnPuddle` in
// `specs/instrumentation.md` gives it "that row's damage times the `damageMul`
// in force at the call"), and Wick rising to level 2 afterwards, which would
// make a fresh puddle's damage `4.8`, leaves this one at `4`.
//
// WHAT IS READ. The puddle's `damage` before Wick is held and on the tick
// after it is, and the hp of a hound standing in the puddle after its first
// two pulses: "A puddle is a pulsing effect with interval `OIL_PULSE` (`0.3`)
// ... each pulse deals `damage` to every enemy overlapping it", and a posed
// puddle "pulses first on the next tick and every `OIL_PULSE` ... after"
// (`specs/instrumentation.md`), so the pulses land on ticks `1` and `19`
// (`round(0.3 × 60)` = `18` ticks apart, `specs/world.md`, Timers) and a hound
// of `120` hp reads `116` and then `112`.
//
// THE POSE. The puddle at `(200, 0)` with the hound at its center, inside the
// puddle's radius `50` at any distance under `68`. `enemyMotion` is held so the
// hound stays in the puddle, `enemyContact` so no contact damage enters,
// `weaponFire` so no held weapon fires — no weapon is held. Nothing kills the
// hound: two pulses of `4` from `120`.
//
// THE TOLERANCE. `REAL_EPS` on the damage, a table figure times `1`, and on
// the hp, two subtractions; the wrong figure, `4.8`, is nearly a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  ENEMIES,
  OIL_PULSE,
  OIL_SPLASH_LEVELS,
  REAL_EPS,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  holdPassive,
  isolate,
  placeEnemy,
  placePuddle,
  zoneById,
  type Harness,
} from "../harness";

/** Where the puddle lands, and where the hound stands: the same point. */
const AT = { x: 200, y: 0 };

/** The level-1 row's damage, `4`, fixed at the pose with no Wick held. */
const DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** The Wick level gained after the pose. */
const WICK_LATER = 2;

/** Ticks between pulses: `round(0.3 × 60)` = `18`. */
const PULSE = ticksOf(OIL_PULSE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a posed puddle at damage 4 across Wick rising to level 2", async () => {
  isolate(h);
  const hound = placeEnemy(h, "hound", AT.x, AT.y);
  const puddle = placePuddle(h, "oil-splash", AT.x, AT.y);
  assertNear(
    zoneById(h.snapshot(), puddle)?.damage ?? NaN,
    DAMAGE,
    REAL_EPS,
    "the puddle's damage as posed with no Wick held (specs/weapons.md, Oil Splash)",
  );

  holdPassive(h, "wick", WICK_LATER);
  const firstPulse = await advanceTicks(h, 1);
  assertNear(
    zoneById(firstPulse, puddle)?.damage ?? NaN,
    DAMAGE,
    REAL_EPS,
    "the puddle's damage on the tick after Wick rose to level 2 (specs/weapons.md, Hits and death)",
  );
  assertNear(
    enemyById(firstPulse, hound)?.hp ?? NaN,
    ENEMIES.hound.hp - DAMAGE,
    REAL_EPS,
    "the hound's hp after the puddle's first pulse under Wick 2 (specs/weapons.md, Hits and death)",
  );

  const secondPulse = await advanceTicks(h, PULSE);
  captureStill(h, "fixed");
  assertNear(
    enemyById(secondPulse, hound)?.hp ?? NaN,
    ENEMIES.hound.hp - 2 * DAMAGE,
    REAL_EPS,
    "the hound's hp after the puddle's second pulse under Wick 2 (specs/weapons.md, Hits and death)",
  );
});
