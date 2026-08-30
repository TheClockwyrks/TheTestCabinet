// insertion/backward-shift — the train makes room for a seated core.
//
// THE SPEC LINE. `specs/injector.md`, "Insertion": "The inserted core takes arc
// position `p` and the charge the projectile carried. Every core whose arc
// position before the strike is at most `p` shifts back by the channel spacing.
// Cores ahead of `p` hold their arc positions, so the head never moves forward on
// an insertion." `SPACING` is 28 units (specs/channel.md).
//
// WHAT IS ARRANGED. Five cores in one segment, and a shot seated behind the
// third. `p` is then the fourth core's arc position, so the fourth and the fifth
// are "at most `p`" and fall back one spacing each, while the first three hold.
// Both halves of the rule are therefore live in one arrangement: the head is
// ahead of `p` and must not move, the tail is behind it and must.
//
// HOW THE READING SEPARATES THE SHIFT FROM THE ADVANCE. The strike resolves
// inside a tick, and step 2 of that tick has already advanced the segment before
// step 3 inserts (specs/channel.md, "The order of a tick"). So the head's arc
// position after the tick is NOT the one it started with — it is that plus one
// tick of the feed. Reading the head against its own earlier value would grade
// the feed speed, which is `channel/feed-speed`'s point, not this one. So the
// reading is the SPAN from head to tail, which the shared advance leaves alone:
// the five cores are one segment, they advance together, and only the insertion
// can change the distance between the two ends of them.
//
//   span after - span before = SPACING   <- the shift the insertion made room with
//   0 <= head after - head before        <- the head did not move back
//
// THE TOLERANCES.
//
// The span is compared to `SPACING` within `ARC_TOL` (0.5 units, the case's
// standing tolerance on an arc position). It is arithmetic on posed values rather
// than an integration, so the only slack it needs is the difference between two
// arc positions a build reports; half a unit is generous for that and a twentieth
// of the 28 it is checking, so a build that shifted by a different spacing — or
// by nothing — fails.
//
// The head's own movement is bounded by half a spacing rather than by a tick of
// the feed, deliberately. What has to be ruled out is the head shifting BACK one
// spacing, which is what a build that shifts the whole train does; what must not
// be ruled out is the head advancing, which every conformant build does on the
// tick the strike lands on. One tick at the fastest feed the specification allows
// anywhere — level 5's 38 units/s at the maximum pressure of 100, so `76 / 60 =
// 1.27` units (specs/progression.md, specs/channel.md) — is well inside 14, and
// so is one tick of the 180 units/s catch-up rate at 3.0. So the bound passes
// every conformant build without grading any rate.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertNear } from "../assert";
import { ARC_TOL, SPACING, STRIKE_DISTANCE, type ChargeId } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  spacedRun,
  tail,
  topRunS,
  type Harness,
} from "../harness";
import {
  approach,
  assertInFlight,
  LEAD_STEP,
  PARKED,
  PLUMB_SHOT_X,
  poseFor,
  SHOT,
  UP_AIM,
} from "./stage";

/**
 * The five charges, one per core, so no three consecutive cores can ever match
 * and nothing this check drives can extract. The shot's own charge is
 * `olivine`, which lands between the third and fourth of these — cobalt and
 * garnet — and matches neither of them.
 */
const RUN: ChargeId[] = ["halide", "sulfur", "cobalt", "garnet", "olivine"];

/** Which core of the run the shot is aimed at, counting from the head. */
const STRUCK_INDEX = 2;

/**
 * How far along `+x` of the shot's path the STRUCK core's centre stands.
 *
 * It has to do two jobs. It must be positive, so `dot(d - c.position, forward)`
 * is negative on leg 0 and the shot enters BEHIND the third core rather than
 * ahead of it (specs/injector.md). And it must leave the third core plainly the
 * nearest of the five: its neighbours sit one spacing away in `x`, so the fourth
 * core's centre distance is `SPACING - LAG` and the second's is `SPACING + LAG`.
 * At 8 units the three distances are 8, 20 and 36, so the third core wins by 12
 * units and the second is outside the window altogether — and a sample a whole
 * tick off the ideal moves each of them by under 3 units.
 */
const LAG = 8;

/** Ticks driven after the strike, so the replay shows the shifted train riding on. */
const SETTLE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shifts the train behind the seated slot back by one spacing", async () => {
  assertBetween(
    LAG,
    1,
    STRIKE_DISTANCE - 1,
    "the shot arrives behind the struck core and inside the strike distance",
  );

  await poseHall(h, { cores: PARKED, loaded: SHOT });

  const short = await approach(h, UP_AIM);
  assertInFlight(short);

  // Five cores in one segment, placed so that after the single tick that follows
  // the struck core stands LAG units to the +x side of the shot's path.
  const struckS = topRunS(PLUMB_SHOT_X + LAG);
  h.debug.poseTrain(
    spacedRun(poseFor(struckS + STRUCK_INDEX * SPACING, LEAD_STEP), RUN),
  );
  const before = h.snapshot();
  assertEqual(coreCount(before), RUN.length, "the five-core segment is posed");
  const spanBefore = head(before).s - tail(before).s;
  const headBefore = head(before).s;

  const after = await captureReplay(h, "shift", async () => {
    const struck = await h.step(1);
    await h.step(SETTLE);
    return struck;
  });

  assertEqual(
    coreCount(after),
    RUN.length + 1,
    "the shot seated into the train, taking it from five cores to six",
  );
  assertNear(
    head(after).s - tail(after).s - spanBefore,
    SPACING,
    ARC_TOL,
    "the train opened exactly one spacing of room for the seated core " +
      "(specs/injector.md, Insertion)",
  );
  assertBetween(
    head(after).s - headBefore,
    0,
    SPACING / 2,
    "the head kept its arc position: cores ahead of the seated slot do not " +
      "shift back (specs/injector.md, Insertion)",
  );
});
