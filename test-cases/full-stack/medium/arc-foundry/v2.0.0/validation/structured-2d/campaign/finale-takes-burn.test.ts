// campaign/finale-takes-burn — a Rectifier's burn lands on the Overload Dynamo,
// and every tick of it counts.
//
// specs/enemies.md, of the Overload Dynamo: "It takes slow and burn like any
// other unit." The rule the burn follows is the roster's own: a burn of `dps`
// sets `burnDps = max(burnDps, dps)` and `burnUntil = now + dur` and removes that
// many points a second while it runs. specs/campaign.md then counts "direct hits
// and burn ticks alike" into the Maze Rating, which is the run's only figure, so a
// build whose burn does not tally scores every maze too low.
//
// THE SLOW IS THE SIBLING POINT `finale-takes-slow`.
//
// TWO ARRANGEMENTS, BECAUSE THE HIT AND THE TALLY ARE DIFFERENT READINGS.
//
// First, the hit. A Scrap Rectifier stands beside the entry and the Dynamo walks
// past it under its own power. specs/components.md gives the Rectifier a burn of
// `shotDamage * 0.5` over `2.0` s, which its `2` damage makes `1` a second, and
// both figures are read off the Dynamo on the frame the hit first shows.
//
// Then the tally. A burn landing beside a firing structure cannot be told from its
// shots, so the second arrangement holds the Dynamo on an empty yard, applies a
// burn through `setUnitBurn` — which specs/instrumentation.md applies "through the
// rule specs/enemies.md fixes" and credits to no structure — and reads the Maze
// Rating rise by the burn's own arithmetic while nothing at all is firing. The
// Dynamo is invincible, so its health is read too: the tally rises and the health
// does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import {
  componentDamage,
  RECTIFIER_BURN_DUR,
  RECTIFIER_BURN_FRAC,
} from "../constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  type Harness,
  openYard,
  parkUnit,
  releaseUnit,
  standComponent,
  unitById,
} from "../harness";

/** A Scrap Rectifier beside the Substation's entry, reaching the path. */
const RECTIFIER = { col: 2, row: 7 };

/** What specs/components.md gives it at Scrap. */
const BURN = {
  dps: componentDamage("rectifier", 1) * RECTIFIER_BURN_FRAC,
  seconds: RECTIFIER_BURN_DUR,
};

/**
 * The rate this check is driven at.
 *
 * Both spans are frames spent letting a cadence and a burn run rather than frames
 * a position is read on, and specs/instrumentation.md guarantees that "an
 * interval of simulation time reaches the same state however it was divided into
 * frames". A shot still steps well inside the `2 * PROJECTILE_HIT_R` window it
 * has to be caught in.
 */
const BURN_HZ = 60;

/** Five seconds: many cadences of it, while the Dynamo is still in reach. */
const MAX_FRAMES = 5 * BURN_HZ;

/** A hit lands inside one frame of the sample that first shows it. */
const TOLERANCE = 2 / BURN_HZ;

/** The burn posed on the empty yard, and how long it is watched for. */
const POSED = { dps: 40, seconds: 6 };
const WATCH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: BURN_HZ });
});

afterEach(() => {
  h.dispose();
});

it("carries a Rectifier's burn, and tallies every tick of it", async () => {
  openYard(h);
  standComponent(h, "rectifier", 1, RECTIFIER.col, RECTIFIER.row);
  const id = releaseUnit(h, "overload");

  const struck = await captureReplay(h, "burn", async () => {
    const burning = await h.until((s) => unitById(s, id).burnDps > 0, {
      maxFrames: MAX_FRAMES,
      poll: 1,
    });
    assertEqual(burning.hit, true, "the Rectifier landed a hit on the Dynamo");
    const withBurn = unitById(burning.snapshot, id);
    return {
      burnDps: withBurn.burnDps,
      burnFor: withBurn.burnUntil - burning.snapshot.simTime,
    };
  });

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
