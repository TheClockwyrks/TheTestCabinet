// Wick — passives/pulse-interval-fixed: a puddle's pulse interval is the named
// constant at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "The
// intervals a weapon fixes by a named constant are used as written:
// `OIL_PULSE`, `BLAZE_PULSE`, `LANTERN_REHIT`, `SHARD_REHIT`, and
// `SCONCE_REHIT`", and ("What passives leave as written") "every re-hit
// interval, every pulse interval, and every enemy figure are likewise fixed".
// `specs/weapons.md` gives `OIL_PULSE` (`0.3`), and `specs/world.md`
// ("Timers") converts it: "An interval of `s` seconds anywhere in this
// specification is likewise `round(s x TICK_HZ)` ticks", so a puddle pulses
// every `18` ticks whatever Oil is held. A posed shape "first hits and first
// pulses on the next tick" (`specs/instrumentation.md`). A re-hit interval is
// `passives/rehit-interval-fixed`'.
//
// THE POSE. An isolated night with Oil 5 held through `setPassive`, the largest
// `cooldownMul` the specification allows, and one hound under a posed Oil
// Splash puddle. `spawnPuddle` gives the shape "the figures its weapon would
// give" one created now, so it carries the interval its weapon fixes.
// `effectMotion` stays off so the shape does not move; "`ttl` and every re-hit
// entry still count, and hits still resolve" whatever that switch holds. A
// hound's `hp` is `120`, which the puddle's `4` does not take to `0` over the
// drive, and no weapon is held at all.
//
// TOLERANCE. None: the ticks the enemy's `hp` fell on are exact. A build
// scaling the interval by `cooldownMul` (`0.6`) hits on ticks `11` and `19`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { OIL_PULSE, dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  isolate,
  placeEnemyNear,
  placePuddle,
  type Harness,
} from "../harness";
import { ticksEnemyHpFell } from "./stage";

/** The Oil level held: `cooldownMul` `0.6`, the largest the passive allows. */
const OIL_LEVEL = 5;

/** How far from the lamplighter the target stands. */
const SEPARATION = 200;

/** The ticks the cadence is read over. */
const DRIVE = 40;

/** `round(0.3 x 60)`. */
const PULSE = dueTicks(OIL_PULSE);

/** The ticks a puddle posed now pulses on: the next, and every interval after. */
const PULSES = [1, 1 + PULSE, 1 + PULSE * 2];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pulses a puddle every 18 ticks with Oil 5 held", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);
  const at = opened.run.player;

  const pulsed = await placeEnemyNear(h, "hound", SEPARATION, 0);
  await placePuddle(h, "oil-splash", at.x + SEPARATION, at.y);

  const posed = await h.snapshot();
  const ticks = await captureReplay(h, "interval", () => h.stepWatching(DRIVE));

  assertDeepEqual(
    ticksEnemyHpFell(posed, ticks, pulsed.id),
    PULSES,
    "the ticks the puddle's pulses landed on with Oil 5 held",
  );
});
