// passives/cooldown-floor — a cooldown scaled below `MIN_COOLDOWN` is floored
// there.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Cooldown: "A weapon's
// cooldown is its table `cooldown` times `cooldownMul`, floored at
// `MIN_COOLDOWN` (`0.2`) seconds: `cooldown = max(MIN_COOLDOWN, table cooldown
// × cooldownMul)`". Beacon's fixed row gives `cooldown` `0.25`
// (`specs/evolutions.md`, Beacon), and `cooldownMul` is `0.6` at Oil 5, so the
// product is `0.15` and the floor makes the timer `0.2`.
//
// WHEN THE NEXT FIRING LANDS. `specs/world.md`, Timers: "a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on", so
// `round(0.2 × 60)` = `12` ticks, and the tick before each is due fires
// nothing. Two whole cycles are watched, so a build whose floor applies once
// and then drifts fails as surely as one that never applies it: at `0.15` the
// interval would be `9` ticks.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Oil 5 and Beacon
// alone, with one hound at `FAR_POST`, the enemy Beacon "needs at least one
// enemy to fire" at (`specs/evolutions.md`, Beacon). `effectMotion` stays off,
// so "every projectile holds its position and velocity"
// (`specs/instrumentation.md`): each bolt sits at the lamplighter's center,
// nine hundred units from the hound, and hits nothing across the whole watch.
// Every other switch stays off too, so the only thing that happens over the
// twenty-five ticks is Beacon's timer.
//
// THE TOLERANCE. `REAL_EPS` on the timer, a constant set outright; the
// unfloored figure, `0.15`, is a twentieth of a second away. The ticks the
// firings land on are whole counts, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BEACON_STATS, MIN_COOLDOWN, REAL_EPS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  projectilesCreatedSince,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { FAR_POST, fireUnder, timerOf } from "./firing";

/** The Oil level held: `cooldownMul` `0.6`, which would take `0.25` to `0.15`. */
const OIL = 5;

/** Ticks from one firing to the next at the floor: `round(0.2 × 60)` = `12`. */
const INTERVAL = ticksOf(MIN_COOLDOWN);

/** Cycles watched after the first firing. */
const CYCLES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("floors Beacon's cooldown at 0.2 under Oil 5 and fires it every 12 ticks", async () => {
  const firing = await fireUnder(h, {
    passives: [["oil", OIL]],
    weapons: [["beacon", 1]],
    enemies: [["hound", FAR_POST]],
  });

  assertEqual(
    firing.projectiles.length,
    BEACON_STATS.amount,
    "the bolts the firing tick created (specs/evolutions.md, Beacon)",
  );
  assertNear(
    timerOf(firing, "beacon"),
    MIN_COOLDOWN,
    REAL_EPS,
    "Beacon's timer after a firing under Oil 5 (specs/passives.md, Cooldown)",
  );

  await captureReplay(h, "floor", async () => {
    let previous: WickSnapshot = firing.after;
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      const short = await advanceTicks(h, INTERVAL - 1);
      assertEqual(
        projectilesCreatedSince(previous, short).length,
        0,
        `the bolts created over the ${INTERVAL - 1} ticks before firing ${cycle + 1} is due (specs/world.md, Timers)`,
      );
      const due = await advanceTicks(h, 1);
      assertEqual(
        projectilesCreatedSince(short, due).length,
        BEACON_STATS.amount,
        `the bolts created on tick ${INTERVAL} of cycle ${cycle} (specs/world.md, Timers)`,
      );
      assertNear(
        timerOf({ ...firing, after: due }, "beacon"),
        MIN_COOLDOWN,
        REAL_EPS,
        `Beacon's timer after firing ${cycle + 1} (specs/passives.md, Cooldown)`,
      );
      previous = due;
    }
  });
});
