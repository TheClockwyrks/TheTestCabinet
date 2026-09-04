// campaign/finale-takes-slow — a Choke's slow lands on the Overload Dynamo.
//
// specs/enemies.md, of the Overload Dynamo: "It takes slow and burn like any
// other unit." specs/campaign.md says the same of the finale's Dynamo. The rule
// the slow follows is the roster's own: a slow of amount `amt` sets
// `slowFactor = min(slowFactor, 1 - amt)` and `slowUntil = now + dur`, and while
// it holds the unit moves at `baseSpeed * slowFactor`.
//
// THE BURN IS THE SIBLING POINT `finale-takes-burn`. The Dynamo is invincible and
// the two effects reach it by different routes, so a build that exempts it from
// one and not the other is a different defect from one that exempts it from both,
// and each is decided by name.
//
// HOW IT IS DECIDED. A Scrap Choke stands beside the entry and the Dynamo is
// released to walk past it under its own power — its travel is exactly what a slow
// acts on, so it is not held here. specs/components.md gives the Choke
// `slow(0.22)` over `CHOKE_SLOW_DUR` (`1.2` s) at Scrap. The factor, the
// remaining duration and the reported speed are all read off the Dynamo on the
// frame the hit first shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import { CHOKE_SLOW, CHOKE_SLOW_DUR, OVERLOAD_SPEED } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  releaseUnit,
  standComponent,
  TICK_HZ,
  unitById,
  type Harness,
} from "../harness";

/** A Scrap Choke beside the Substation's entry, reaching the path. */
const CHOKE = { col: 2, row: 3 };

/** What specs/components.md gives it at Scrap. */
const SLOW = { amount: CHOKE_SLOW[0]!, seconds: CHOKE_SLOW_DUR };

/** Five seconds: many cadences of it, while the Dynamo is still in reach. */
const MAX_FRAMES = 5 * 120;

/** A hit lands inside one frame of the sample that first shows it. */
const TOLERANCE = 2 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a Choke's slow like any other unit", async () => {
  await openYard(h);
  await standComponent(h, "choke", 1, CHOKE.col, CHOKE.row);
  const id = await releaseUnit(h, "overload");

  const struck = await captureReplay(h, "slow", async () => {
    const slowed = await h.until((s) => unitById(s, id).slowFactor < 1, {
      maxFrames: MAX_FRAMES,
      poll: 1,
    });
    assertEqual(slowed.hit, true, "the Choke landed a hit on the Dynamo");
    const withSlow = unitById(slowed.snapshot, id);
    return {
      slowFactor: withSlow.slowFactor,
      slowFor: withSlow.slowUntil - slowed.snapshot.simTime,
      speed: withSlow.speed,
      baseSpeed: withSlow.baseSpeed,
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
});
