// passives/cooldown-floor — a cooldown Oil would take below MIN_COOLDOWN is
// floored there.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Cooldown"): "A weapon's
// cooldown is its table `cooldown` times `cooldownMul`, floored at
// MIN_COOLDOWN (0.2) seconds: cooldown = max(MIN_COOLDOWN, table cooldown ×
// cooldownMul)". Beacon's fixed row gives cooldown 0.25 (specs/evolutions.md,
// BEACON_STATS) and Oil 5 gives cooldownMul 1 − 0.08 × 5 = 0.6, so the product
// is 0.15 and the floor takes it to 0.2. specs/world.md ("Timers"): a timer set
// to 0.2 seconds is due round(0.2 × 60) = 12 ticks after the tick it was set
// on, so Beacon fires every 12 ticks rather than the 9 the unfloored product
// would give.
//
// THE WORLD. An isolated playing run: Oil at level 5 in the first passive slot,
// Beacon alone at level 1 with its timer at 0, and one moth 300 units along +x,
// the target "Beacon needs at least one enemy to fire" requires. Every driver
// switch is off but weaponFire, so the moth holds its distance, nothing hits it
// while the sweep runs, and every bolt stays at the lamplighter's center where
// it was created; each new bolt id is therefore a firing.
//
// WHAT IS READ. Beacon's timer after the firing tick, 0.2 rather than 0.15, and
// the ticks of the following 12 on which a bolt with an id not seen before
// appeared, exactly [12].
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the timer, a stated constant read back
// as a double. None on the tick, which the timer rule fixes to a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import {
  BEACON_STATS,
  FIGURE_TOLERANCE,
  MIN_COOLDOWN,
  cooldownFor,
  ticksFor,
  type HeldPassives,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  projectilesOf,
  type Harness,
} from "../harness";
import {
  armAll,
  freshTicks,
  holdPassives,
  probesAround,
  projectileIdsOf,
  slotOf,
  timerOf,
} from "./night";

/** The passives held: Oil at level 5. */
const HELD: HeldPassives = { oil: 5 };

/** An evolved weapon has a single level (specs/evolutions.md). */
const LEVEL = 1;

/** max(0.2, 0.25 × 0.6) = 0.2, the floor rather than the 0.15 product. */
const COOLDOWN = cooldownFor(BEACON_STATS.cooldown, HELD);

/** round(0.2 × 60) = 12 ticks. */
const PERIOD_TICKS = ticksFor(COOLDOWN);

/** The target Beacon needs, held 300 units away and never reached. */
const TARGET = "moth";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("floors Beacon's cooldown at 0.2 with Oil 5 held and fires every 12 ticks", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, [{ x: 300, y: 0 }]);
  const slots = armAll(h, [["beacon", LEVEL]]);

  const run = await captureReplay(h, "floor", async () => {
    const fired = await h.tick(1);
    const seen = new Set(projectileIdsOf(fired, "beacon"));
    const trace = await h.trace(PERIOD_TICKS);
    return {
      fired,
      bolts: projectilesOf(fired, "beacon").length,
      firings: freshTicks(trace, (s) => projectileIdsOf(s, "beacon"), seen),
    };
  });

  assertEqual(run.bolts, 1, "Beacon bolts after the firing tick");
  assertWithin(
    timerOf(run.fired, slotOf(slots, "beacon")),
    MIN_COOLDOWN,
    FIGURE_TOLERANCE,
    "Beacon's timer after firing, floored at MIN_COOLDOWN",
  );
  assertDeepEqual(
    run.firings,
    [PERIOD_TICKS],
    "the ticks after the first firing on which a new Beacon bolt appeared",
  );
});
