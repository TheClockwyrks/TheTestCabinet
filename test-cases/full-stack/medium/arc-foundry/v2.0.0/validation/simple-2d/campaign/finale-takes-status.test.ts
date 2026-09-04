// campaign/finale-takes-status — the Overload Dynamo takes slow and burn.
//
// specs/enemies.md, of the Overload Dynamo: "It takes slow and burn like any
// other unit." specs/campaign.md says the same of the finale's Dynamo. The rules
// those two effects follow are the roster's own: a slow of amount `amt` sets
// `slowFactor = min(slowFactor, 1 - amt)` and `slowUntil = now + dur`, and while
// it holds the unit moves at `baseSpeed * slowFactor`; a burn of `dps` sets
// `burnDps = max(burnDps, dps)` and `burnUntil = now + dur` and removes that many
// points a second while it runs.
//
// TWO ARRANGEMENTS, BECAUSE THE TWO HALVES ARE ABOUT DIFFERENT THINGS.
//
// First, the hits. A Scrap Choke and a Scrap Rectifier stand beside the entry,
// and the Dynamo is released to walk past them under its own power — its travel
// is exactly what a slow acts on, so it is not held here. specs/components.md
// gives the Choke `slow(0.22)` over `CHOKE_SLOW_DUR` (`1.2` s) at Scrap, and the
// Rectifier a burn of `shotDamage * 0.5` over `2.0` s, which its `2` damage makes
// `1` a second. All four figures are read off the Dynamo on the frame each hit
// first shows, and its reported speed is read against `baseSpeed * slowFactor`.
//
// Then the tally. specs/campaign.md counts "direct hits and burn ticks alike"
// into the Maze Rating, and a burn landing beside two firing structures cannot be
// told from their shots. So the second arrangement holds the Dynamo on an empty
// yard, applies a burn through `setUnitBurn` — which specs/instrumentation.md
// applies "through the rule `specs/enemies.md` fixes" and credits to no structure
// — and reads the Maze Rating rise by the burn's own arithmetic while nothing at
// all is firing.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import {
  CHOKE_SLOW,
  CHOKE_SLOW_DUR,
  OVERLOAD_SPEED,
  RECTIFIER_BURN_DUR,
  RECTIFIER_BURN_FRAC,
} from "../../src/constants";
import {
  captureReplay,
  componentDamage,
  createHarness,
  emptyYard,
  openYard,
  parkUnit,
  releaseUnit,
  standComponent,
  TICK_HZ,
  unitById,
  type Harness,
} from "../harness";

/** Two Scrap components beside the Substation's entry, both reaching the path. */
const CHOKE = { col: 2, row: 3 };
const RECTIFIER = { col: 2, row: 7 };

/** What specs/components.md gives each at Scrap. */
const SLOW = { amount: CHOKE_SLOW[0]!, seconds: CHOKE_SLOW_DUR };
const BURN = {
  dps: componentDamage("rectifier", 1) * RECTIFIER_BURN_FRAC,
  seconds: RECTIFIER_BURN_DUR,
};

/** Five seconds: many cadences of both, while the Dynamo is still in reach. */
const MAX_FRAMES = 5 * 120;

/** A hit lands inside one frame of the sample that first shows it. */
const TOLERANCE = 2 / TICK_HZ;

/** The burn posed on the empty yard, and how long it is watched for. */
const POSED = { dps: 40, seconds: 6 };
const WATCH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries a Choke's slow and a Rectifier's burn, and tallies the burn", async () => {
  openYard(h);
  standComponent(h, "choke", 1, CHOKE.col, CHOKE.row);
  standComponent(h, "rectifier", 1, RECTIFIER.col, RECTIFIER.row);
  const id = releaseUnit(h, "overload");

  const struck = await captureReplay(h, "status", async () => {
    const slowed = await h.until((s) => unitById(s, id).slowFactor < 1, {
      maxFrames: MAX_FRAMES,
      poll: 1,
    });
    assertEqual(slowed.hit, true, "the Choke landed a hit on the Dynamo");
    const withSlow = unitById(slowed.snapshot, id);

    const burning = await h.until((s) => unitById(s, id).burnDps > 0, {
      maxFrames: MAX_FRAMES,
      poll: 1,
    });
    assertEqual(burning.hit, true, "the Rectifier landed a hit on the Dynamo");
    const withBurn = unitById(burning.snapshot, id);

    return {
      slowFactor: withSlow.slowFactor,
      slowFor: withSlow.slowUntil - slowed.snapshot.simTime,
      speed: withSlow.speed,
      baseSpeed: withSlow.baseSpeed,
      burnDps: withBurn.burnDps,
      burnFor: withBurn.burnUntil - burning.snapshot.simTime,
      rating: burning.snapshot.mazeRating,
    };
  });

  assertCloseTo(
    struck.slowFactor,
    1 - SLOW.amount,
    6,
    `a Scrap Choke's slow of ${SLOW.amount}`,
  );
  assertBetween(
    struck.slowFor,
    SLOW.seconds - TOLERANCE,
    SLOW.seconds,
    `a Scrap Choke's slow runs for ${SLOW.seconds} s`,
  );
  assertCloseTo(
    struck.baseSpeed,
    OVERLOAD_SPEED,
    6,
    "the Overload Dynamo's own speed",
  );
  assertCloseTo(
    struck.speed,
    OVERLOAD_SPEED * (1 - SLOW.amount),
    4,
    "while slowed it moves at baseSpeed * slowFactor",
  );
  assertCloseTo(
    struck.burnDps,
    BURN.dps,
    6,
    `a Scrap Rectifier's burn of ${componentDamage("rectifier", 1)} * ` +
      `${RECTIFIER_BURN_FRAC}`,
  );
  assertBetween(
    struck.burnFor,
    BURN.seconds - TOLERANCE,
    BURN.seconds,
    `a Scrap Rectifier's burn runs for ${BURN.seconds} s`,
  );

  // And a burn credited to nothing still tallies, on a yard where nothing fires.
  emptyYard(h);
  const held = parkUnit(h, "overload", { x: 400, y: 400 });
  h.debug.setUnitBurn(held, POSED.dps, POSED.seconds);
  const before = h.snapshot();
  await h.advanceSeconds(WATCH);
  const after = h.snapshot();

  assertCloseTo(
    after.mazeRating - before.mazeRating,
    POSED.dps * WATCH,
    2,
    `${WATCH} s of a ${POSED.dps} a second burn, tallied into the Maze Rating`,
  );
  assertEqual(
    unitById(after, held).hp,
    unitById(before, held).hp,
    "and the burn removed no health from it",
  );
});
